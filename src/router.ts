import { NexusClient } from './server';
import { handleSignaling } from './signaling/handler';
import { proxyToStrfry } from './proxy';
import { logger } from './utils/logger';

const log = logger('router');

export function route(client: NexusClient, msg: unknown[]): void {
  if (!Array.isArray(msg) || msg.length === 0) {
    log.warn(`malformed message from ${client.id}`);
    return;
  }

  const type = msg[0] as string;

  if (typeof type === 'string' && type.startsWith('PEER_')) {
    handleSignaling(client, type, msg.slice(1));
  } else {
    // REQ, EVENT, CLOSE, AUTH, COUNT - proxy to strfry
    proxyToStrfry(client, msg);
  }
}
