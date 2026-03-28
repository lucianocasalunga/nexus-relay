import { logger } from '../utils/logger';

const log = logger('connections');

const MAX_PEERS_PER_SUPER = 10;

// super_peer_id -> Set of connected peer_ids
const superPeerConnections = new Map<string, Set<string>>();

// peer_id -> super_peer_id they're connected to
const peerToSuper = new Map<string, string>();

export function registerConnection(superPeerId: string, peerId: string): boolean {
  let connections = superPeerConnections.get(superPeerId);
  if (!connections) {
    connections = new Set();
    superPeerConnections.set(superPeerId, connections);
  }

  if (connections.size >= MAX_PEERS_PER_SUPER) {
    log.warn(`super peer ${superPeerId.slice(0, 8)} full (${connections.size}/${MAX_PEERS_PER_SUPER})`);
    return false;
  }

  connections.add(peerId);
  peerToSuper.set(peerId, superPeerId);
  log.debug(`connection: ${peerId.slice(0, 8)} → ${superPeerId.slice(0, 8)} (${connections.size}/${MAX_PEERS_PER_SUPER})`);
  return true;
}

export function removeConnection(peerId: string): void {
  const superPeerId = peerToSuper.get(peerId);
  if (superPeerId) {
    const connections = superPeerConnections.get(superPeerId);
    if (connections) {
      connections.delete(peerId);
      if (connections.size === 0) superPeerConnections.delete(superPeerId);
    }
    peerToSuper.delete(peerId);
  }
}

export function getSuperPeerLoad(superPeerId: string): number {
  return superPeerConnections.get(superPeerId)?.size ?? 0;
}

export function isSuperPeerFull(superPeerId: string): boolean {
  return getSuperPeerLoad(superPeerId) >= MAX_PEERS_PER_SUPER;
}

export function getConnectedPeers(superPeerId: string): string[] {
  const connections = superPeerConnections.get(superPeerId);
  return connections ? Array.from(connections) : [];
}

export function getSuperPeerOf(peerId: string): string | undefined {
  return peerToSuper.get(peerId);
}

/**
 * When a Super Peer disconnects, return list of orphaned peers
 * that need to be reassigned to another Super Peer.
 */
export function handleSuperPeerDisconnect(superPeerId: string): string[] {
  const orphans = getConnectedPeers(superPeerId);

  // Clean up all connections
  for (const peerId of orphans) {
    peerToSuper.delete(peerId);
  }
  superPeerConnections.delete(superPeerId);

  if (orphans.length > 0) {
    log.info(`super peer ${superPeerId.slice(0, 8)} disconnected, ${orphans.length} orphaned peers`);
  }

  return orphans;
}

export function cleanupPeerConnections(peerId: string): void {
  // Remove as connected peer
  removeConnection(peerId);

  // Remove as super peer (orphan connected peers)
  handleSuperPeerDisconnect(peerId);
}

export function getConnectionStats(): { superPeers: number; totalConnections: number; avgLoad: number } {
  const superPeers = superPeerConnections.size;
  let totalConnections = 0;
  for (const connections of superPeerConnections.values()) {
    totalConnections += connections.size;
  }
  return {
    superPeers,
    totalConnections,
    avgLoad: superPeers > 0 ? totalConnections / superPeers : 0,
  };
}
