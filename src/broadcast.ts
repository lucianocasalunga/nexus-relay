import WebSocket from 'ws';
import { strfryWsUrl } from './utils/config';
import { getSet } from './redis/client';
import { getClient } from './server';
import { isPeerRegistered } from './peers/manager';
import { MSG_PEER_EVENT_NEW } from './signaling/messages';
import { logger } from './utils/logger';

const log = logger('broadcast');

let strfryWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

/**
 * Subscribe to strfry for all new events (kind 1 = text notes, etc.)
 * and broadcast them to Super Peers so they can cache them.
 */
export function startBroadcastListener(): void {
  connect();
}

function connect(): void {
  const url = strfryWsUrl();
  strfryWs = new WebSocket(url);

  strfryWs.on('open', () => {
    log.info('connected to strfry for broadcast');

    // Subscribe to recent events (text notes, reposts, reactions, zaps)
    const sub = ['REQ', 'nexus-broadcast', {
      kinds: [1, 6, 7, 9735],
      since: Math.floor(Date.now() / 1000) - 60, // last 60 seconds
    }];
    strfryWs!.send(JSON.stringify(sub));
    log.info('subscribed to strfry for new events');
  });

  strfryWs.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[1] === 'nexus-broadcast') {
        const event = msg[2];
        if (event?.id) {
          broadcastToSuperPeers(event);
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  strfryWs.on('close', () => {
    log.warn('strfry broadcast connection closed, reconnecting in 5s...');
    scheduleReconnect();
  });

  strfryWs.on('error', (err) => {
    log.error('strfry broadcast error', err.message);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

async function broadcastToSuperPeers(event: { id: string; kind: number; content: string }): Promise<void> {
  try {
    const superPeers = await getSet('peers:super');
    if (superPeers.length === 0) return;

    let sent = 0;
    for (const peerId of superPeers) {
      if (!isPeerRegistered(peerId)) continue;

      const client = getClient(peerId);
      if (client && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify([MSG_PEER_EVENT_NEW, {
          event_id: event.id,
          kind: event.kind,
          size: JSON.stringify(event).length,
        }]));
        sent++;
      }
    }

    if (sent > 0) {
      log.debug(`broadcast event ${event.id.slice(0, 12)}... to ${sent} super peers`);
    }
  } catch (err) {
    log.error('broadcast failed', err);
  }
}

export function stopBroadcastListener(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (strfryWs) {
    strfryWs.close();
    strfryWs = null;
  }
}
