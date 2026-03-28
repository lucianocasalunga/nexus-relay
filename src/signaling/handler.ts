import { NexusClient, getClient } from '../server';
import { registerPeer, handleHeartbeat, isPeerRegistered } from '../peers/manager';
import { addEventToPeer, getPeersWithEvent } from '../peers/cache-tracker';
import {
  classifyPeer, promotePeer, demotePeer,
  adjustReputation, recordEventServed, getReputation, getEventsServed,
} from '../peers/classifier';
import { isSuperPeerFull, registerConnection } from '../peers/connections';
import { PeerCapabilities } from '../peers/types';
import { logger } from '../utils/logger';
import {
  MSG_PEER_REGISTER,
  MSG_PEER_HEARTBEAT,
  MSG_PEER_REQUEST,
  MSG_PEER_SIGNAL,
  MSG_PEER_CACHE_HAVE,
  MSG_PEER_STATS,
  MSG_PEER_REGISTERED,
  MSG_PEER_HEARTBEAT_ACK,
  MSG_PEER_OFFER,
  MSG_PEER_SIGNAL_RELAY,
  MSG_PEER_PROMOTED,
  MSG_PEER_DEMOTED,
  MSG_PEER_STATS_OK,
  MSG_PEER_ERROR,
} from './messages';

const log = logger('signaling');

export function send(client: NexusClient, msg: unknown[]): void {
  if (client.ws.readyState === 1) { // OPEN
    client.ws.send(JSON.stringify(msg));
  }
}

export function handleSignaling(client: NexusClient, type: string, args: unknown[]): void {
  switch (type) {
    case MSG_PEER_REGISTER:
      onRegister(client, args);
      break;
    case MSG_PEER_HEARTBEAT:
      onHeartbeat(client);
      break;
    case MSG_PEER_SIGNAL:
      onSignal(client, args);
      break;
    case MSG_PEER_REQUEST:
      onRequest(client, args);
      break;
    case MSG_PEER_CACHE_HAVE:
      onCacheHave(client, args);
      break;
    case MSG_PEER_STATS:
      onStats(client, args);
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

      // Check if peer should be promoted or demoted
      await checkClassification(client);
    } else {
      send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    }
  } catch (err) {
    log.error(`heartbeat failed for ${client.id}`, err);
  }
}

// Check and apply peer classification on every heartbeat
async function checkClassification(client: NexusClient): Promise<void> {
  try {
    const result = await classifyPeer(client.id);

    if (result.shouldPromote) {
      await promotePeer(client.id);
      send(client, [MSG_PEER_PROMOTED, {
        peer_id: client.id,
        reason: result.reason,
        max_connections: 10,
      }]);
    } else if (result.shouldDemote) {
      await demotePeer(client.id);
      send(client, [MSG_PEER_DEMOTED, {
        peer_id: client.id,
        reason: result.reason,
      }]);
    }
  } catch (err) {
    log.error(`classification failed for ${client.id}`, err);
  }
}

// Relay WebRTC signaling data (ICE candidates, SDP offer/answer) between peers
function onSignal(client: NexusClient, args: unknown[]): void {
  const payload = args[0] as { target_peer: string; signal_data: unknown } | undefined;
  if (!payload?.target_peer || !payload?.signal_data) {
    send(client, [MSG_PEER_ERROR, { message: 'PEER_SIGNAL requires target_peer and signal_data' }]);
    return;
  }

  if (!isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  const target = getClient(payload.target_peer);
  if (!target) {
    send(client, [MSG_PEER_ERROR, { message: 'target_peer not found' }]);
    return;
  }

  // Relay the signal to the target peer
  send(target, [MSG_PEER_SIGNAL_RELAY, {
    from_peer: client.id,
    signal_data: payload.signal_data,
  }]);

  log.debug(`signal relayed ${client.id} → ${payload.target_peer}`);
}

// Client requests events - Nexus checks which peers have them and offers P2P
async function onRequest(client: NexusClient, args: unknown[]): Promise<void> {
  const payload = args[0] as { event_ids: string[] } | undefined;
  if (!payload?.event_ids || !Array.isArray(payload.event_ids)) {
    send(client, [MSG_PEER_ERROR, { message: 'PEER_REQUEST requires event_ids array' }]);
    return;
  }

  if (!isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  // For each requested event, find peers that have it (excluding requester and full Super Peers)
  const offers: Record<string, string[]> = {};

  for (const eventId of payload.event_ids) {
    const peers = getPeersWithEvent(eventId)
      .filter(pid => pid !== client.id && !isSuperPeerFull(pid));
    if (peers.length > 0) {
      offers[eventId] = peers;
    }
  }

  send(client, [MSG_PEER_OFFER, {
    offers,
    fallback: Object.keys(offers).length < payload.event_ids.length ? 'strfry' : null,
  }]);

  log.debug(`peer_request from ${client.id}: ${payload.event_ids.length} events, ${Object.keys(offers).length} with P2P`);
}

// Client announces which events it has cached
async function onCacheHave(client: NexusClient, args: unknown[]): Promise<void> {
  const payload = args[0] as { event_ids: string[] } | undefined;
  if (!payload?.event_ids || !Array.isArray(payload.event_ids)) {
    send(client, [MSG_PEER_ERROR, { message: 'PEER_CACHE_HAVE requires event_ids array' }]);
    return;
  }

  if (!isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  for (const eventId of payload.event_ids) {
    addEventToPeer(client.id, eventId);
  }

  log.debug(`cache_have from ${client.id}: ${payload.event_ids.length} events`);
}

// Client reports sharing statistics
async function onStats(client: NexusClient, args: unknown[]): Promise<void> {
  const payload = args[0] as {
    events_served?: number;
    bytes_transferred?: number;
    peers_connected?: number;
  } | undefined;

  if (!payload) {
    send(client, [MSG_PEER_ERROR, { message: 'PEER_STATS requires payload' }]);
    return;
  }

  if (!isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  // Record events served for reputation
  const served = payload.events_served ?? 0;
  for (let i = 0; i < served; i++) {
    recordEventServed(client.id);
  }

  // Boost reputation for reporting stats (cooperation signal)
  adjustReputation(client.id, 1);

  send(client, [MSG_PEER_STATS_OK, {
    peer_id: client.id,
    reputation: getReputation(client.id),
    total_events_served: getEventsServed(client.id),
  }]);

  log.debug(`stats from ${client.id}: served=${served} bytes=${payload.bytes_transferred ?? 0}`);
}
