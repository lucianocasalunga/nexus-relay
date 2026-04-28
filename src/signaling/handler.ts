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
import { incCounter, recordP2PLatency } from '../metrics';
import { isConfirmedEvent } from '../broadcast';
import { trackVerifiedEvent, cleanupPaymentTracker } from '../payments';
import {
  MSG_PEER_REGISTER,
  MSG_PEER_HEARTBEAT,
  MSG_PEER_REQUEST,
  MSG_PEER_SIGNAL,
  MSG_PEER_CACHE_HAVE,
  MSG_PEER_STATS,
  MSG_PEER_P2P_CONNECTED,
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

// === Rate limiting ===
// Sliding window (10s) per clientId per message type

interface RateWindow {
  count: number;
  windowStart: number;
}

const rateLimits: Map<string, Map<string, RateWindow>> = new Map();

const RATE_LIMITS: Record<string, number> = {
  [MSG_PEER_HEARTBEAT]:  3,
  [MSG_PEER_STATS]:      10,
  [MSG_PEER_CACHE_HAVE]: 5,
  [MSG_PEER_SIGNAL]:     20,
};

function isRateLimited(clientId: string, type: string): boolean {
  const max = RATE_LIMITS[type];
  if (!max) return false;

  const now = Date.now();
  let clientWindows = rateLimits.get(clientId);
  if (!clientWindows) {
    clientWindows = new Map();
    rateLimits.set(clientId, clientWindows);
  }

  let win = clientWindows.get(type);
  if (!win || now - win.windowStart > 10_000) {
    win = { count: 0, windowStart: now };
    clientWindows.set(type, win);
  }

  win.count++;
  if (win.count > max) {
    log.warn(`rate_limit hit: ${type} from ${clientId} (${win.count}/${max} in 10s)`);
    return true;
  }
  return false;
}

export function cleanupRateLimit(clientId: string): void {
  rateLimits.delete(clientId);
}

export function send(client: NexusClient, msg: unknown[]): void {
  if (client.ws.readyState === 1) { // OPEN
    client.ws.send(JSON.stringify(msg));
  }
}

export function handleSignaling(client: NexusClient, type: string, args: unknown[]): void {
  if (isRateLimited(client.id, type)) {
    send(client, [MSG_PEER_ERROR, { message: 'rate_limited', type }]);
    return;
  }

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
    case MSG_PEER_P2P_CONNECTED:
      onP2PConnected(client, args);
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

  // Validate publicKey if provided: must be 64-char hex (ed25519 pubkey)
  if (caps.publicKey) {
    if (!/^[0-9a-f]{64}$/.test(caps.publicKey)) {
      log.warn(`register rejected: invalid publicKey from ${client.id}`);
      send(client, [MSG_PEER_ERROR, { message: 'invalid publicKey: must be 64-char hex' }]);
      return;
    }
  }

  // Validate lightningAddress if provided (basic format: user@domain)
  if (caps.lightningAddress) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(caps.lightningAddress) || caps.lightningAddress.length > 200) {
      caps.lightningAddress = ''; // silently reject malformed, don't block registration
    }
  }

  try {
    // Cache identity for payments
    peerIdentity.set(client.id, {
      pubkey: caps.publicKey || '',
      lightningAddress: caps.lightningAddress || '',
    });

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
    // Passive reputation decay: peers above baseline decay slowly
    // unless actively serving events via P2P
    const rep = getReputation(client.id);
    const served = getEventsServed(client.id);
    if (rep > 70 && served === 0) {
      adjustReputation(client.id, -0.5); // decay toward baseline
    }

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
    log.warn(`signal rejected: missing target_peer or signal_data from ${client.id}`);
    send(client, [MSG_PEER_ERROR, { message: 'PEER_SIGNAL requires target_peer and signal_data' }]);
    return;
  }

  if (!isPeerRegistered(client.id)) {
    log.warn(`signal rejected: ${client.id} not registered`);
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  const target = getClient(payload.target_peer);
  if (!target) {
    log.warn(`signal rejected: target ${payload.target_peer} not found (stale peer ID?)`);
    send(client, [MSG_PEER_ERROR, { message: 'target_peer not found', target_peer: payload.target_peer }]);
    return;
  }

  // Relay the signal to the target peer
  send(target, [MSG_PEER_SIGNAL_RELAY, {
    from_peer: client.id,
    signal_data: payload.signal_data,
  }]);

  incCounter('signalsRelayed');
  log.info(`signal relayed ${client.id} → ${payload.target_peer}`);
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

  const offerTs = Date.now();
  if (Object.keys(offers).length > 0) {
    offerTimestamps.set(client.id, offerTs);
  }

  send(client, [MSG_PEER_OFFER, {
    offers,
    offer_ts: offerTs,
    fallback: Object.keys(offers).length < payload.event_ids.length ? 'strfry' : null,
  }]);

  log.debug(`peer_request from ${client.id}: ${payload.event_ids.length} events, ${Object.keys(offers).length} with P2P`);
}

// Client announces which events it has cached
// Supports v1 (event_ids only) and v2 (events with metadata)
async function onCacheHave(client: NexusClient, args: unknown[]): Promise<void> {
  const payload = args[0] as {
    event_ids?: string[];
    events?: Array<{ id: string; pubkey: string; kind: number; created_at: number }>;
  } | undefined;

  if (!isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  // v2 format: events with metadata
  if (payload?.events && Array.isArray(payload.events)) {
    for (const evt of payload.events) {
      if (evt.id && evt.pubkey && evt.kind !== undefined && evt.created_at) {
        addEventToPeer(client.id, evt.id, {
          id: evt.id,
          pubkey: evt.pubkey,
          kind: evt.kind,
          created_at: evt.created_at,
        });
      }
    }
    log.debug(`cache_have v2 from ${client.id}: ${payload.events.length} events with metadata`);
    return;
  }

  // v1 format: event_ids only (retrocompat)
  if (payload?.event_ids && Array.isArray(payload.event_ids)) {
    for (const eventId of payload.event_ids) {
      addEventToPeer(client.id, eventId);
    }
    log.debug(`cache_have v1 from ${client.id}: ${payload.event_ids.length} events`);
    return;
  }

  send(client, [MSG_PEER_ERROR, { message: 'PEER_CACHE_HAVE requires event_ids or events array' }]);
}

// Track offer timestamps for P2P latency measurement (peerId → ms)
const offerTimestamps = new Map<string, number>();

// Track peer identity for payments (peerId → { pubkey, lightningAddress })
const peerIdentity = new Map<string, { pubkey: string; lightningAddress: string }>();

// Track last reported events_served per peer for delta calculation
const lastReportedServed = new Map<string, number>();

// Client reports sharing statistics
// v2: accepts event_ids_served for server-side verification
async function onStats(client: NexusClient, args: unknown[]): Promise<void> {
  const payload = args[0] as {
    events_served?: number;
    bytes_transferred?: number;
    peers_connected?: number;
    event_ids_served?: string[]; // v2: list of event IDs served in this cycle
  } | undefined;

  if (!payload) {
    send(client, [MSG_PEER_ERROR, { message: 'PEER_STATS requires payload' }]);
    return;
  }

  if (!isPeerRegistered(client.id)) {
    send(client, [MSG_PEER_ERROR, { message: 'not_registered', action: 're-register' }]);
    return;
  }

  let verifiedDelta = 0;

  if (payload.event_ids_served && Array.isArray(payload.event_ids_served)) {
    // v2: verify each reported event against server-confirmed set
    const ids = payload.event_ids_served.slice(0, 100); // cap at 100 per cycle
    for (const id of ids) {
      if (typeof id === 'string' && id.length === 64 && isConfirmedEvent(id)) {
        verifiedDelta++;
      }
    }
    log.debug(`stats v2 from ${client.id}: reported=${ids.length} verified=${verifiedDelta}`);
  } else {
    // v1 fallback: use cumulative delta with sanity check (unverified)
    const served = payload.events_served ?? 0;
    const lastServed = lastReportedServed.get(client.id) ?? 0;
    const delta = served - lastServed;
    lastReportedServed.set(client.id, served);
    verifiedDelta = (delta > 0 && delta < 20) ? delta : 0; // tighter cap for unverified
    log.debug(`stats v1 from ${client.id}: served=${served} delta=${delta} verified=${verifiedDelta}`);
  }

  if (verifiedDelta > 0) {
    for (let i = 0; i < verifiedDelta; i++) {
      recordEventServed(client.id);
    }
    incCounter('eventsViaP2P', verifiedDelta);
    incCounter('bytesP2P', payload.bytes_transferred ?? 0);
    adjustReputation(client.id, Math.min(verifiedDelta, 5));

    // Track for Lightning payment threshold
    const identity = peerIdentity.get(client.id);
    if (identity?.pubkey && identity?.lightningAddress) {
      trackVerifiedEvent(client.id, identity.pubkey, identity.lightningAddress, verifiedDelta);
    }
  }

  send(client, [MSG_PEER_STATS_OK, {
    peer_id: client.id,
    reputation: getReputation(client.id),
    total_events_served: getEventsServed(client.id),
    verified_this_cycle: verifiedDelta,
  }]);
}

// Peer notifies that a WebRTC connection was established
function onP2PConnected(client: NexusClient, args: unknown[]): void {
  const payload = args[0] as { remote_peer: string } | undefined;
  if (!payload?.remote_peer) return;

  if (!isPeerRegistered(client.id)) return;

  // Measure P2P latency from offer to data channel open
  const ts = offerTimestamps.get(client.id);
  if (ts) {
    recordP2PLatency(Date.now() - ts);
    offerTimestamps.delete(client.id);
  }

  // Register the connection (determines which peer is super based on who has the role)
  const ok = registerConnection(client.id, payload.remote_peer);
  if (ok) {
    log.info(`P2P connected: ${client.id.slice(0, 8)} ↔ ${payload.remote_peer.slice(0, 8)}`);
  }
}

export function cleanupPeerStats(peerId: string): void {
  lastReportedServed.delete(peerId);
  offerTimestamps.delete(peerId);
  peerIdentity.delete(peerId);
  cleanupPaymentTracker(peerId);
}
