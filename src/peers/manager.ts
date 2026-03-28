import { setPeer, removePeer, refreshPeerTtl, addToSet, removeFromSet, getPeer } from '../redis/client';
import { closeUpstream } from '../proxy';
import { removePeerFromCache } from './cache-tracker';
import { initReputation, cleanupPeerClassifier } from './classifier';
import { cleanupPeerConnections, handleSuperPeerDisconnect } from './connections';
import { getClient } from '../server';
import { MSG_PEER_RECONNECT } from '../signaling/messages';
import { logger } from '../utils/logger';
import { PeerCapabilities } from './types';

const log = logger('peers');

// Track which client IDs are registered as peers
const registeredPeers = new Set<string>();

export async function registerPeer(
  clientId: string,
  ip: string,
  capabilities: PeerCapabilities
): Promise<void> {
  const now = new Date().toISOString();

  await setPeer(clientId, {
    id: clientId,
    ip,
    status: 'casual',
    connectedAt: now,
    lastHeartbeat: now,
    bandwidth: String(capabilities.bandwidth ?? 0),
    storage: String(capabilities.storage ?? 0),
    publicKey: capabilities.publicKey ?? '',
  });

  await addToSet('peers:all', clientId);
  await addToSet('peers:casual', clientId);
  registeredPeers.add(clientId);
  initReputation(clientId);

  log.info(`registered peer ${clientId} (bw: ${capabilities.bandwidth ?? '?'}Mbps, storage: ${capabilities.storage ?? '?'}MB)`);
}

export async function handleHeartbeat(clientId: string): Promise<boolean> {
  if (!registeredPeers.has(clientId)) return false;

  const refreshed = await refreshPeerTtl(clientId);
  if (!refreshed) {
    registeredPeers.delete(clientId);
    return false;
  }

  return true;
}

export async function handleDisconnect(clientId: string): Promise<void> {
  closeUpstream(clientId);

  if (!registeredPeers.has(clientId)) return;

  // Check if this was a Super Peer - notify orphaned peers
  const peer = await getPeer(clientId);
  if (peer?.status === 'super') {
    const orphans = handleSuperPeerDisconnect(clientId);
    notifyOrphans(orphans, clientId);
  }

  await removePeer(clientId);
  removePeerFromCache(clientId);
  cleanupPeerClassifier(clientId);
  cleanupPeerConnections(clientId);
  registeredPeers.delete(clientId);
  log.info(`unregistered peer ${clientId}`);
}

/**
 * Notify orphaned peers that their Super Peer disconnected.
 * They should close the broken WebRTC connection and re-request events.
 */
function notifyOrphans(orphanIds: string[], disconnectedSuperPeerId: string): void {
  for (const orphanId of orphanIds) {
    const client = getClient(orphanId);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify([MSG_PEER_RECONNECT, {
        reason: 'super_peer_disconnected',
        disconnected_peer: disconnectedSuperPeerId,
      }]));
    }
  }

  if (orphanIds.length > 0) {
    log.info(`notified ${orphanIds.length} orphans of super peer ${disconnectedSuperPeerId.slice(0, 8)} disconnect`);
  }
}

export function isPeerRegistered(clientId: string): boolean {
  return registeredPeers.has(clientId);
}

export function getRegisteredPeerCount(): number {
  return registeredPeers.size;
}
