import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { route } from './router';
import { handleDisconnect } from './peers/manager';
import { getMetrics } from './metrics';

const log = logger('server');

export interface NexusClient {
  id: string;
  ws: WebSocket;
  ip: string;
  connectedAt: number;
}

const clients = new Map<string, NexusClient>();

export function getClient(id: string): NexusClient | undefined {
  return clients.get(id);
}

export function getClientCount(): number {
  return clients.size;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

// NIP-11 Relay Information Document
const NIP11_INFO = JSON.stringify({
  name: 'Nexus Relay',
  description: 'Hybrid P2P Nostr Relay - NIP-95',
  pubkey: '',
  contact: 'admin@libernet.app',
  supported_nips: [1, 2, 4, 9, 11, 12, 15, 16, 20, 22, 28, 33, 40, 95],
  software: 'nexus-relay',
  version: '1.0.0',
  limitation: {
    max_message_length: 131072,
    max_subscriptions: 1000,
    max_filters: 1000,
    max_limit: 5000,
    auth_required: false,
    payment_required: false,
  },
  extra: {
    p2p_enabled: true,
    p2p_protocol: 'NIP-95',
    p2p_signaling: 'WebRTC via WebSocket',
    p2p_peer_types: ['casual', 'super'],
    p2p_data_channel: 'reliable ordered',
    strfry_backend: true,
  },
});

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // NIP-11: return relay info when Accept header is nostr+json
  const accept = req.headers['accept'] || '';
  if (accept.includes('application/nostr+json') || accept.includes('nostr+json')) {
    res.writeHead(200, {
      'Content-Type': 'application/nostr+json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(NIP11_INFO);
    return;
  }

  const url = req.url || '/';

  // Metrics API endpoint
  if (url === '/stats' || url === '/metrics') {
    try {
      const metrics = await getMetrics();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(metrics, null, 2));
    } catch (err) {
      res.writeHead(500);
      res.end('Internal error');
    }
    return;
  }

  // Static files
  const filePath = resolve(__dirname, '../public', (url === '/' ? 'test.html' : url).replace(/^\//, ''));
  const ext = filePath.substring(filePath.lastIndexOf('.'));

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

export function startServer(): WebSocketServer {
  const httpServer = createServer(handleHttp);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const id = randomUUID();
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';

    const client: NexusClient = { id, ws, ip, connectedAt: Date.now() };
    clients.set(id, client);

    log.info(`connected: ${id} from ${ip} (total: ${clients.size})`);

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        route(client, msg);
      } catch {
        log.warn(`invalid JSON from ${id}`);
      }
    });

    ws.on('close', () => {
      clients.delete(id);
      handleDisconnect(id).catch(() => {});
      log.info(`disconnected: ${id} (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      log.error(`ws error ${id}`, err.message);
    });
  });

  httpServer.listen(config.nexusPort, () => {
    log.info(`Nexus Relay v1.0.0 listening on port ${config.nexusPort} (HTTP + WebSocket)`);
  });

  return wss;
}
