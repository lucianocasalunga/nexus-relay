import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { route } from './router';
import { handleDisconnect } from './peers/manager';

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

export function startServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: config.nexusPort });

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

  log.info(`Nexus Relay v0.1.0 listening on port ${config.nexusPort}`);
  return wss;
}
