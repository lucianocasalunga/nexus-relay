import WebSocket from 'ws';
import { NexusClient } from './server';
import { strfryWsUrl } from './utils/config';
import { logger } from './utils/logger';

const log = logger('proxy');

// One strfry connection per Nexus client
const upstreams = new Map<string, WebSocket>();

export function proxyToStrfry(client: NexusClient, msg: unknown[]): void {
  let upstream = upstreams.get(client.id);

  if (upstream && upstream.readyState === WebSocket.OPEN) {
    upstream.send(JSON.stringify(msg));
    return;
  }

  // Create new upstream connection
  const url = strfryWsUrl();
  upstream = new WebSocket(url, { headers: { 'X-Nexus-Client': client.id } });

  upstream.on('open', () => {
    log.debug(`upstream connected for ${client.id}`);
    upstream!.send(JSON.stringify(msg));
  });

  upstream.on('message', (data: Buffer) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data.toString());
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
