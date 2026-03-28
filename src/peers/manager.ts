import { setPeer, removePeer, refreshPeerTtl, addToSet, removeFromSet } from '../redis/client';
import { closeUpstream } from '../proxy';
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

  log.info(`registered peer ${clientId} (bw: ${capabilities.bandwidth ?? '?'}Mbps, storage: ${capabilities.storage ?? '?'}MB)`);
}

export async function handleHeartbeat(clientId: string): Promise<boolean> {
  if (!registeredPeers.has(clientId)) return false;

  const refreshed = await refreshPeerTtl(clientId);
  if (!refreshed) {
    // Key expired - peer was cleaned up by Redis TTL
    registeredPeers.delete(clientId);
    return false;
  }

  return true;
}

export async function handleDisconnect(clientId: string): Promise<void> {
  closeUpstream(clientId);

  if (!registeredPeers.has(clientId)) return;

  await removePeer(clientId);
  registeredPeers.delete(clientId);
  log.info(`unregistered peer ${clientId}`);
}

export function isPeerRegistered(clientId: string): boolean {
  return registeredPeers.has(clientId);
}

export function getRegisteredPeerCount(): number {
  return registeredPeers.size;
}
