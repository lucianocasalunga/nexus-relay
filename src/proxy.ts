import WebSocket from 'ws';
import { NexusClient } from './server';
import { strfryWsUrl } from './utils/config';
import { logger } from './utils/logger';
import { cacheProfile, getCachedProfiles, profileToEvent } from './redis/profile-cache';
import { incCounter } from './metrics';

const log = logger('proxy');

// Relay latency tracking (REQ sent → first EVENT received)
const reqTimestamps = new Map<string, number>(); // `${clientId}:${subId}` → ts
const relayLatencySamples: number[] = [];
const RELAY_LATENCY_MAX_SAMPLES = 200;

function recordRelayLatency(ms: number): void {
  if (ms < 0 || ms > 30_000) return;
  relayLatencySamples.push(ms);
  if (relayLatencySamples.length > RELAY_LATENCY_MAX_SAMPLES) {
    relayLatencySamples.shift();
  }
}

export function getRelayAvgLatency(): number | null {
  if (relayLatencySamples.length === 0) return null;
  return Math.round(relayLatencySamples.reduce((a, b) => a + b, 0) / relayLatencySamples.length);
}

// One strfry connection per Nexus client
const upstreams = new Map<string, WebSocket>();

// Queue messages while upstream is CONNECTING (prevents duplicate upstreams)
const pendingMessages = new Map<string, unknown[][]>();

// Track profile-only subscriptions for cache intercept
const profileSubs = new Map<string, { clientId: string; pubkeys: string[] }>();

export function proxyToStrfry(client: NexusClient, msg: unknown[]): void {
  const type = msg[0] as string;

  // Interceptar REQ de kind:0 — tentar servir do Redis cache
  if (type === 'REQ' && msg.length >= 3) {
    const subId = msg[1] as string;
    const filter = msg[2] as Record<string, unknown>;

    if (isProfileOnlyFilter(filter)) {
      const authors = filter.authors as string[] || [];
      if (authors.length > 0) {
        serveProfilesFromCache(client, subId, authors, msg);
        return;
      }
    }
  }

  _proxyRaw(client, msg);
}

/**
 * Verifica se um filtro busca apenas perfis (kind:0).
 */
function isProfileOnlyFilter(filter: Record<string, unknown>): boolean {
  const kinds = filter.kinds as number[] | undefined;
  return Array.isArray(kinds) && kinds.length === 1 && kinds[0] === 0;
}

/**
 * Serve perfis do Redis cache. Envia os encontrados imediatamente,
 * depois faz proxy pro strfry para buscar os restantes.
 */
async function serveProfilesFromCache(
  client: NexusClient,
  subId: string,
  pubkeys: string[],
  originalMsg: unknown[]
): Promise<void> {
  try {
    const cached = await getCachedProfiles(pubkeys);

    if (cached.size > 0) {
      // Enviar perfis do cache imediatamente
      for (const [, profile] of cached) {
        const event = profileToEvent(profile);
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(['EVENT', subId, event]));
        }
      }

      log.debug(`profile cache hit: ${cached.size}/${pubkeys.length} for ${client.id}`);

      // Se todos estão em cache, enviar EOSE e pronto
      if (cached.size >= pubkeys.length) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(['EOSE', subId]));
        }
        return;
      }

      // Buscar os restantes do strfry
      const missing = pubkeys.filter(pk => !cached.has(pk));
      const modifiedFilter = { kinds: [0], authors: missing, limit: missing.length };
      const modifiedMsg = ['REQ', subId, modifiedFilter];
      _proxyRaw(client, modifiedMsg);
    } else {
      // Nada no cache, proxy normal
      _proxyRaw(client, originalMsg);
    }
  } catch (err) {
    // Fallback: proxy normal
    log.debug(`profile cache error, falling back: ${(err as Error).message}`);
    _proxyRaw(client, originalMsg);
  }
}

function _proxyRaw(client: NexusClient, msg: unknown[]): void {
  let upstream = upstreams.get(client.id);

  // Upstream aberto — enviar direto
  if (upstream && upstream.readyState === WebSocket.OPEN) {
    if (msg[0] === 'REQ') {
      reqTimestamps.set(`${client.id}:${msg[1]}`, Date.now());
    }
    upstream.send(JSON.stringify(msg));
    return;
  }

  // Upstream conectando — enfileirar mensagem (previne duplicatas)
  if (upstream && upstream.readyState === WebSocket.CONNECTING) {
    let queue = pendingMessages.get(client.id);
    if (!queue) {
      queue = [];
      pendingMessages.set(client.id, queue);
    }
    queue.push(msg);
    return;
  }

  // Fechar upstream morto antes de criar novo (previne leak)
  if (upstream) {
    try { upstream.close(); } catch {}
    upstreams.delete(client.id);
  }

  // Create new upstream connection
  const url = strfryWsUrl();
  upstream = new WebSocket(url, { headers: { 'X-Nexus-Client': client.id } });

  upstream.on('open', () => {
    log.debug(`upstream connected for ${client.id}`);
    if (msg[0] === 'REQ') {
      reqTimestamps.set(`${client.id}:${msg[1]}`, Date.now());
    }
    upstream!.send(JSON.stringify(msg));

    // Enviar mensagens enfileiradas
    const queue = pendingMessages.get(client.id);
    if (queue) {
      for (const queuedMsg of queue) {
        upstream!.send(JSON.stringify(queuedMsg));
      }
      pendingMessages.delete(client.id);
    }
  });

  upstream.on('message', (data: Buffer) => {
    const raw = data.toString();

    // Contar eventos e cachear perfis
    try {
      const parsed = JSON.parse(raw);
      if (parsed[0] === 'EVENT') {
        incCounter('eventsViaRelay');
        // Medir latência relay: tempo entre REQ e primeiro EVENT da sub
        const key = `${client.id}:${parsed[1]}`;
        const ts = reqTimestamps.get(key);
        if (ts) {
          recordRelayLatency(Date.now() - ts);
          reqTimestamps.delete(key);
        }
        if (parsed[2]?.kind === 0) {
          cacheProfile(parsed[2]).catch(() => {});
        }
      }
    } catch {
      // Não é JSON válido, ignorar
    }

    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  });

  upstream.on('close', () => {
    log.debug(`upstream closed for ${client.id}`);
    upstreams.delete(client.id);
    pendingMessages.delete(client.id);
  });

  upstream.on('error', (err) => {
    log.warn(`upstream error for ${client.id}: ${err.message}`);
    upstreams.delete(client.id);
    pendingMessages.delete(client.id);
  });

  upstreams.set(client.id, upstream);
}

export function closeUpstream(clientId: string): void {
  const upstream = upstreams.get(clientId);
  if (upstream) {
    upstream.close();
    upstreams.delete(clientId);
  }
  // Limpar timestamps de REQ pendentes para este cliente
  for (const key of reqTimestamps.keys()) {
    if (key.startsWith(`${clientId}:`)) {
      reqTimestamps.delete(key);
    }
  }
}

export function getUpstreamCount(): number {
  return upstreams.size;
}
