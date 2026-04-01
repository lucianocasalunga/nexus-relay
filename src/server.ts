import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import http from 'http';
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
  pubkey: '9b31915dd140b34774cb60c42fc0e015d800cde7f5e4f82a5f2d4e21d72803e4',
  contact: 'admin@libernet.app',
  icon: 'https://media.libernet.app/static/img/relay-icon.png',
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
});

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
};

const publicDir = resolve(__dirname, '../public');

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // NIP-11: return relay info when Accept header is nostr+json
  const accept = req.headers['accept'] || '';
  if (accept.includes('application/nostr+json') || accept.includes('nostr+json')) {
    res.writeHead(200, {
      'Content-Type': 'application/nostr+json',
      ...CORS_HEADERS,
    });
    res.end(NIP11_INFO);
    return;
  }

  const url = req.url || '/';

  // Feed Engine proxy endpoints
  if (url.startsWith('/feed/')) {
    try {
      const feedRes = await fetchFromFeedEngine(url);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      });
      res.end(feedRes);
    } catch (err) {
      res.writeHead(502, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'feed_engine_unavailable' }));
    }
    return;
  }

  // Metrics API endpoint
  if (url === '/stats' || url === '/metrics') {
    try {
      const metrics = await getMetrics();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      });
      res.end(JSON.stringify(metrics, null, 2));
    } catch (err) {
      res.writeHead(500, CORS_HEADERS);
      res.end('Internal error');
    }
    return;
  }

  // Static files (with path traversal protection)
  const filePath = resolve(publicDir, (url === '/' ? 'test.html' : url).replace(/^\//, ''));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, CORS_HEADERS);
    res.end('Forbidden');
    return;
  }

  const ext = filePath.substring(filePath.lastIndexOf('.'));

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', ...CORS_HEADERS });
    res.end(content);
  } catch {
    res.writeHead(404, CORS_HEADERS);
    res.end('Not found');
  }
}

function fetchFromFeedEngine(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8890${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
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

    // Keep-alive ping every 30s (prevents Cloudflare Tunnel from closing idle WS)
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('pong', () => {
      // Client is alive — nothing to do, the ping/pong itself keeps the connection active
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        route(client, msg);
      } catch {
        log.warn(`invalid JSON from ${id}`);
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      clients.delete(id);
      handleDisconnect(id).catch(() => {});
      log.info(`disconnected: ${id} (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      clearInterval(pingInterval);
      log.error(`ws error ${id}`, err.message);
    });
  });

  httpServer.listen(config.nexusPort, () => {
    log.info(`Nexus Relay v1.0.0 listening on port ${config.nexusPort} (HTTP + WebSocket)`);
  });

  return wss;
}
