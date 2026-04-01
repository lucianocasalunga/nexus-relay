import WebSocket from 'ws';
import { strfryWsUrl } from './utils/config';
import { getClient } from './server';
import { isPeerRegistered, getRegisteredPeerIds } from './peers/manager';
import { addEventToPeer } from './peers/cache-tracker';
import { MSG_PEER_EVENT_NEW } from './signaling/messages';
import { logger } from './utils/logger';

const log = logger('broadcast');

let strfryWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export function startBroadcastListener(): void {
  connect();
}

function connect(): void {
  const url = strfryWsUrl();
  strfryWs = new WebSocket(url);

  strfryWs.on('open', () => {
    log.info('connected to strfry for broadcast');

    const sub = ['REQ', 'nexus-broadcast', {
      kinds: [1, 6, 7, 9735],
      since: Math.floor(Date.now() / 1000) - 60,
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
          broadcastToPeers(event);
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

function broadcastToPeers(event: { id: string; pubkey: string; kind: number; created_at: number; content: string }): void {
  // Use in-memory registered peers set (always current, no stale Redis IDs)
  const peerIds = getRegisteredPeerIds();
  if (peerIds.length === 0) return;

  const meta = {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
  };

  let sent = 0;
  for (const peerId of peerIds) {
    try {
      const client = getClient(peerId);
      if (client && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify([MSG_PEER_EVENT_NEW, { event }]));
        addEventToPeer(peerId, event.id, meta);
        sent++;
      }
    } catch {
      // Peer disconnected between check and send — safe to ignore
    }
  }

  if (sent > 0) {
    log.info(`broadcast event ${event.id.slice(0, 12)}... to ${sent}/${peerIds.length} peers`);
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
