import WebSocket from 'ws';
import { NexusClient } from './server';
import { strfryWsUrl } from './utils/config';
import { logger } from './utils/logger';
import { cacheProfile, getCachedProfiles, profileToEvent } from './redis/profile-cache';
import { incCounter } from './metrics';

const log = logger('proxy');

// One strfry connection per Nexus client
const upstreams = new Map<string, WebSocket>();

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

  if (upstream && upstream.readyState === WebSocket.OPEN) {
    upstream.send(JSON.stringify(msg));
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
    upstream!.send(JSON.stringify(msg));
  });

  upstream.on('message', (data: Buffer) => {
    const raw = data.toString();

    // Contar eventos e cachear perfis
    try {
      const parsed = JSON.parse(raw);
      if (parsed[0] === 'EVENT') {
        incCounter('eventsViaRelay');
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
  });

  upstream.on('error', (err) => {
    log.error(`upstream error for ${client.id}`, err.message);
    upstreams.delete(client.id);
  });

  upstreams.set(client.id, upstream);
}

export function closeUpstream(clientId: string): void {
  const upstream = upstreams.get(clientId);
  if (upstream) {
    upstream.close();
    upstreams.delete(clientId);
  }
}

export function getUpstreamCount(): number {
  return upstreams.size;
}
