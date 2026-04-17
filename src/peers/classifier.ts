import { getPeer, addToSet, removeFromSet, getRedis } from '../redis/client';
import { getEventsOfPeer } from './cache-tracker';
import { logger } from '../utils/logger';

const log = logger('classifier');

// Criteria for Super Peer promotion
const SUPER_PEER_CRITERIA = {
  minOnlineMs: 30 * 60 * 1000,   // 30 minutes
  minBandwidth: 5,                 // 5 Mbps
  minStorage: 100,                 // 100 MB
  minReputation: 50,               // 0-100 scale
  minCachedEvents: 1,              // at least 1 event cached
};

// In-memory cache (synced with Redis)
const peerReputation = new Map<string, number>();
const peerEventsServed = new Map<string, number>();
// Maps clientId → publicKey for persistent reputation
const peerPublicKeys = new Map<string, string>();

const REDIS_REP_PREFIX = 'nexus:reputation:';

async function loadReputationFromRedis(publicKey: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis || !publicKey) return null;
  const val = await redis.get(`${REDIS_REP_PREFIX}${publicKey}`);
  return val !== null ? parseInt(val, 10) : null;
}

async function saveReputationToRedis(publicKey: string, reputation: number): Promise<void> {
  const redis = getRedis();
  if (!redis || !publicKey) return;
  await redis.set(`${REDIS_REP_PREFIX}${publicKey}`, String(reputation));
}

export async function initReputation(peerId: string, publicKey?: string): Promise<void> {
  if (publicKey) {
    peerPublicKeys.set(peerId, publicKey);
  }
  const pk = publicKey || '';
  const saved = pk ? await loadReputationFromRedis(pk) : null;
  const rep = saved ?? 70;
  peerReputation.set(peerId, rep);
  if (saved !== null) {
    log.info(`restored reputation for ${peerId.slice(0, 8)}: ${rep}`);
  } else if (pk) {
    // First time — persist initial reputation
    await saveReputationToRedis(pk, rep);
  }
}

export function getReputation(peerId: string): number {
  return peerReputation.get(peerId) ?? 0;
}

export function adjustReputation(peerId: string, delta: number): number {
  const current = peerReputation.get(peerId) ?? 70;
  const next = Math.max(0, Math.min(100, current + delta));
  peerReputation.set(peerId, next);
  // Persist to Redis via publicKey
  const pk = peerPublicKeys.get(peerId);
  if (pk) {
    saveReputationToRedis(pk, next).catch(() => {});
  }
  return next;
}

export function recordEventServed(peerId: string): void {
  const count = (peerEventsServed.get(peerId) ?? 0) + 1;
  peerEventsServed.set(peerId, count);
  // Serving events boosts reputation
  if (count % 5 === 0) {
    adjustReputation(peerId, 2);
  }
}

export function getEventsServed(peerId: string): number {
  return peerEventsServed.get(peerId) ?? 0;
}

export interface ClassifyResult {
  shouldPromote: boolean;
  shouldDemote: boolean;
  reason: string;
}

export async function classifyPeer(peerId: string): Promise<ClassifyResult> {
  const peer = await getPeer(peerId);
  if (!peer) {
    return { shouldPromote: false, shouldDemote: false, reason: 'peer not found' };
  }

  const status = peer.status;
  const onlineMs = Date.now() - new Date(peer.connectedAt).getTime();
  const bandwidth = parseFloat(peer.bandwidth) || 0;
  const storage = parseFloat(peer.storage) || 0;
  const reputation = getReputation(peerId);
  const cachedEvents = getEventsOfPeer(peerId).length;

  const meetsTime = onlineMs >= SUPER_PEER_CRITERIA.minOnlineMs;
  const meetsBandwidth = bandwidth >= SUPER_PEER_CRITERIA.minBandwidth;
  const meetsStorage = storage >= SUPER_PEER_CRITERIA.minStorage;
  const meetsReputation = reputation >= SUPER_PEER_CRITERIA.minReputation;
  const meetsCache = cachedEvents >= SUPER_PEER_CRITERIA.minCachedEvents;

  // Promote casual → super
  if (status === 'casual' && meetsTime && meetsBandwidth && meetsStorage && meetsReputation && meetsCache) {
    return { shouldPromote: true, shouldDemote: false, reason: 'meets all criteria' };
  }

  // Demote super → casual
  if (status === 'super') {
    if (reputation < 30) {
      return { shouldPromote: false, shouldDemote: true, reason: `low reputation: ${reputation}` };
    }
    // Don't demote for time/bandwidth/storage after promotion (only reputation matters)
  }

  return { shouldPromote: false, shouldDemote: false, reason: 'no change needed' };
}

export async function promotePeer(peerId: string): Promise<void> {
  const { setPeerStatus } = await import('../redis/client');
  await setPeerStatus(peerId, 'super');
  await removeFromSet('peers:casual', peerId);
  await addToSet('peers:super', peerId);
  log.info(`promoted to super: ${peerId}`);
}

export async function demotePeer(peerId: string): Promise<void> {
  const { setPeerStatus } = await import('../redis/client');
  await setPeerStatus(peerId, 'casual');
  await removeFromSet('peers:super', peerId);
  await addToSet('peers:casual', peerId);
  log.info(`demoted to casual: ${peerId}`);
}

export async function classifyAllPeers(): Promise<void> {
  const { getRegisteredPeerIds } = await import('./manager');
  const { incCounter } = await import('../metrics');
  const peerIds = getRegisteredPeerIds();
  if (peerIds.length === 0) return;

  for (const peerId of peerIds) {
    const result = await classifyPeer(peerId);
    if (result.shouldPromote) {
      await promotePeer(peerId);
      incCounter('peersPromoted');
      log.info(`auto-promoted ${peerId.slice(0, 8)}: ${result.reason}`);
    } else if (result.shouldDemote) {
      await demotePeer(peerId);
      incCounter('peersDemoted');
      log.info(`auto-demoted ${peerId.slice(0, 8)}: ${result.reason}`);
    }
  }
}

export function cleanupPeerClassifier(peerId: string): void {
  // Persist final reputation before cleanup
  const pk = peerPublicKeys.get(peerId);
  const rep = peerReputation.get(peerId);
  if (pk && rep !== undefined) {
    saveReputationToRedis(pk, rep).catch(() => {});
  }
  peerReputation.delete(peerId);
  peerEventsServed.delete(peerId);
  peerPublicKeys.delete(peerId);
}
