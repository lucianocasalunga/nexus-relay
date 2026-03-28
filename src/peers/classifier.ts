import { getPeer, addToSet, removeFromSet } from '../redis/client';
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

// In-memory reputation and stats
const peerReputation = new Map<string, number>();
const peerEventsServed = new Map<string, number>();

export function initReputation(peerId: string): void {
  peerReputation.set(peerId, 70); // start at 70 (above threshold)
}

export function getReputation(peerId: string): number {
  return peerReputation.get(peerId) ?? 0;
}

export function adjustReputation(peerId: string, delta: number): number {
  const current = peerReputation.get(peerId) ?? 70;
  const next = Math.max(0, Math.min(100, current + delta));
  peerReputation.set(peerId, next);
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

export function cleanupPeerClassifier(peerId: string): void {
  peerReputation.delete(peerId);
  peerEventsServed.delete(peerId);
}
