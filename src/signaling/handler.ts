import { NexusClient } from '../server';
import { registerPeer, handleHeartbeat, isPeerRegistered } from '../peers/manager';
import { PeerCapabilities } from '../peers/types';
import { logger } from '../utils/logger';
import {
  MSG_PEER_REGISTER,
  MSG_PEER_HEARTBEAT,
  MSG_PEER_REGISTERED,
  MSG_PEER_HEARTBEAT_ACK,
  MSG_PEER_ERROR,
} from './messages';

const log = logger('signaling');

function send(client: NexusClient, msg: unknown[]): void {
  client.ws.send(JSON.stringify(msg));
}

export function handleSignaling(client: NexusClient, type: string, args: unknown[]): void {
  switch (type) {
    case MSG_PEER_REGISTER:
      onRegister(client, args);
      break;
    case MSG_PEER_HEARTBEAT:
      onHeartbeat(client);
      break;
    default:
      log.warn(`unknown signaling type: ${type} from ${client.id}`);
      send(client, [MSG_PEER_ERROR, { message: `unknown type: ${type}` }]);
  }
}

async function onRegister(client: NexusClient, args: unknown[]): Promise<void> {
  if (isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_REGISTERED, { peer_id: client.id, status: 'already_registered' }]);
    return;
  }

  const caps = (args[0] ?? {}) as PeerCapabilities;

  try {
    await registerPeer(client.id, client.ip, caps);
    send(client, [MSG_PEER_REGISTERED, {
      peer_id: client.id,
      status: 'registered',
      heartbeat_interval: 30000,
    }]);
  } catch (err) {
    log.error(`register failed for ${client.id}`, err);
    send(client, [MSG_PEER_ERROR, { message: 'register failed' }]);
  }
}

async function onHeartbeat(client: NexusClient): Promise<void> {
  try {
    const ok = await handleHeartbeat(client.id);
    if (ok) {
      send(client, [MSG_PEER_HEARTBEAT_ACK, { peer_id: client.id, ts: Date.now() }]);
    } else {
      // Peer expired or not registered - tell client to re-register
      send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    }
  } catch (err) {
    log.error(`heartbeat failed for ${client.id}`, err);
  }
}
