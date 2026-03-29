import { NexusClient } from './server';
import { proxyToStrfry } from './proxy';
import { logger } from './utils/logger';
import http from 'http';

const log = logger('feed');

const FEED_ENGINE_HOST = '127.0.0.1';
const FEED_ENGINE_PORT = 8890;

type FeedType = 'trending' | 'mostzapped' | 'global';

/**
 * Detecta se um REQ contem filtro de feed algoritmico.
 * Convencao: cliente envia tag "#feed" no filtro.
 * Ex: ["REQ", "sub1", { "#feed": ["trending"], "limit": 50 }]
 */
export function detectFeedFilter(filters: Record<string, unknown>[]): FeedType | null {
  for (const filter of filters) {
    const feedTag = filter['#feed'] as string[] | undefined;
    if (feedTag && Array.isArray(feedTag) && feedTag.length > 0) {
      const feed = feedTag[0] as string;
      if (feed === 'trending' || feed === 'mostzapped' || feed === 'global') {
        return feed;
      }
    }
  }
  return null;
}

/**
 * Busca event IDs do Feed Engine e depois busca os eventos completos do strfry.
 */
export async function serveFeed(client: NexusClient, msg: unknown[]): Promise<void> {
  const subId = msg[1] as string;
  const filters = msg.slice(2) as Record<string, unknown>[];
  const feedType = detectFeedFilter(filters);

  if (!feedType) {
    proxyToStrfry(client, msg);
    return;
  }

  const limit = (filters[0]?.limit as number) || 50;
  const offset = (filters[0]?.offset as number) || 0;

  try {
    // 1. Buscar IDs do Feed Engine
    const eventIds = await fetchFeedEventIds(feedType, limit, offset);

    if (eventIds.length === 0) {
      // Sem resultados, enviar EOSE
      sendToClient(client, JSON.stringify(['EOSE', subId]));
      return;
    }

    // 2. Buscar eventos completos do strfry por IDs
    fetchEventsFromStrfry(client, subId, eventIds);

    log.debug(`feed:${feedType} → ${eventIds.length} events para ${client.id}`);
  } catch (err) {
    log.error(`Erro no feed ${feedType}`, (err as Error).message);
    // Fallback: proxy normal pro strfry
    proxyToStrfry(client, msg);
  }
}

function fetchFeedEventIds(feed: FeedType, limit: number, offset: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const url = `http://${FEED_ENGINE_HOST}:${FEED_ENGINE_PORT}/feed/${feed}?limit=${limit}&offset=${offset}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const ids = json.events.map((e: { id: string }) => e.id);
          resolve(ids);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Busca eventos completos do strfry por IDs e envia ao cliente.
 * Usa o protocolo Nostr padrao: REQ com filtro de IDs.
 */
function fetchEventsFromStrfry(client: NexusClient, subId: string, eventIds: string[]): void {
  const WebSocket = require('ws');
  const { strfryWsUrl } = require('./utils/config');

  const ws = new WebSocket(strfryWsUrl());
  const internalSubId = `feed-${subId}-${Date.now()}`;

  ws.on('open', () => {
    // REQ com IDs especificos - strfry retorna os eventos completos
    ws.send(JSON.stringify(['REQ', internalSubId, { ids: eventIds }]));
  });

  // Mapa para manter a ordem do ranking
  const eventMap = new Map<string, unknown>();
  const orderMap = new Map<string, number>();
  eventIds.forEach((id, idx) => orderMap.set(id, idx));

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg[0] === 'EVENT' && msg[1] === internalSubId) {
        const event = msg[2];
        eventMap.set(event.id, event);
      }

      if (msg[0] === 'EOSE' && msg[1] === internalSubId) {
        // Enviar eventos na ordem do ranking (nao na ordem do strfry)
        const sorted = [...eventMap.entries()]
          .sort((a, b) => (orderMap.get(a[0]) || 0) - (orderMap.get(b[0]) || 0));

        for (const [, event] of sorted) {
          sendToClient(client, JSON.stringify(['EVENT', subId, event]));
        }

        sendToClient(client, JSON.stringify(['EOSE', subId]));
        ws.close();
      }
    } catch (err) {
      log.error('Erro ao processar evento do strfry', (err as Error).message);
    }
  });

  ws.on('error', (err: Error) => {
    log.error('Erro WS strfry para feed', err.message);
    sendToClient(client, JSON.stringify(['EOSE', subId]));
  });

  // Timeout de seguranca
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
      sendToClient(client, JSON.stringify(['EOSE', subId]));
    }
  }, 10000);
}

function sendToClient(client: NexusClient, data: string): void {
  if (client.ws.readyState === 1) { // WebSocket.OPEN
    client.ws.send(data);
  }
}
