import { logger } from '../utils/logger';

const log = logger('cache-tracker');

// peer_id -> Set of event_ids this peer has cached
const peerEvents = new Map<string, Set<string>>();

// event_id -> Set of peer_ids that have this event
const eventPeers = new Map<string, Set<string>>();

export function addEventToPeer(peerId: string, eventId: string): void {
  // peer -> events
  let events = peerEvents.get(peerId);
  if (!events) {
    events = new Set();
    peerEvents.set(peerId, events);
  }
  events.add(eventId);

  // event -> peers
  let peers = eventPeers.get(eventId);
  if (!peers) {
    peers = new Set();
    eventPeers.set(eventId, peers);
  }
  peers.add(peerId);
}

export function getPeersWithEvent(eventId: string): string[] {
  const peers = eventPeers.get(eventId);
  return peers ? Array.from(peers) : [];
}

export function getEventsOfPeer(peerId: string): string[] {
  const events = peerEvents.get(peerId);
  return events ? Array.from(events) : [];
}

export function removePeerFromCache(peerId: string): void {
  const events = peerEvents.get(peerId);
  if (events) {
    for (const eventId of events) {
      const peers = eventPeers.get(eventId);
      if (peers) {
        peers.delete(peerId);
        if (peers.size === 0) eventPeers.delete(eventId);
      }
    }
    peerEvents.delete(peerId);
    log.debug(`removed peer ${peerId} from cache tracker (${events.size} events)`);
  }
}

export function getCacheStats(): { peers: number; events: number } {
  return { peers: peerEvents.size, events: eventPeers.size };
}
