import { logger } from '../utils/logger';

const log = logger('cache-tracker');

// === Types ===

export interface EventMeta {
  id: string;
  pubkey: string;     // author
  kind: number;
  created_at: number; // unix timestamp
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  [key: string]: unknown;
}

// === Primary indices (existing) ===

// peer_id -> Set of event_ids this peer has cached
const peerEvents = new Map<string, Set<string>>();

// event_id -> Set of peer_ids that have this event
const eventPeers = new Map<string, Set<string>>();

// === Secondary indices (new) ===

// event_id -> metadata (author, kind, created_at)
const eventMeta = new Map<string, EventMeta>();

// pubkey (author) -> Set of event_ids
const authorEvents = new Map<string, Set<string>>();

// kind -> Set of event_ids
const kindEvents = new Map<number, Set<string>>();

// === Core functions ===

export function addEventToPeer(peerId: string, eventId: string, meta?: EventMeta): void {
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

  // Index metadata (only if provided and not already indexed)
  if (meta && !eventMeta.has(eventId)) {
    eventMeta.set(eventId, meta);

    // author index
    let byAuthor = authorEvents.get(meta.pubkey);
    if (!byAuthor) {
      byAuthor = new Set();
      authorEvents.set(meta.pubkey, byAuthor);
    }
    byAuthor.add(eventId);

    // kind index
    let byKind = kindEvents.get(meta.kind);
    if (!byKind) {
      byKind = new Set();
      kindEvents.set(meta.kind, byKind);
    }
    byKind.add(eventId);
  }
}

export function getEventMeta(eventId: string): EventMeta | undefined {
  return eventMeta.get(eventId);
}

export function getPeersWithEvent(eventId: string): string[] {
  const peers = eventPeers.get(eventId);
  return peers ? Array.from(peers) : [];
}

export function getEventsOfPeer(peerId: string): string[] {
  const events = peerEvents.get(peerId);
  return events ? Array.from(events) : [];
}

// === Filter matching (heart of P2P routing) ===

/**
 * Find peers that have events matching a Nostr filter.
 * Returns Map<eventId, peerId[]> of matches.
 * Only matches events that have metadata indexed.
 */
export function findPeersForFilter(filter: NostrFilter, excludePeerId?: string): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Strategy: find candidate event IDs, then map to peers

  let candidateIds: Set<string> | null = null;

  // Filter by ids (direct lookup — existing behavior)
  if (filter.ids && filter.ids.length > 0) {
    candidateIds = new Set(filter.ids.filter(id => eventPeers.has(id)));
  }

  // Filter by authors
  if (filter.authors && filter.authors.length > 0) {
    const byAuthors = new Set<string>();
    for (const author of filter.authors) {
      const events = authorEvents.get(author);
      if (events) {
        for (const eid of events) byAuthors.add(eid);
      }
    }
    candidateIds = candidateIds ? intersectSets(candidateIds, byAuthors) : byAuthors;
  }

  // Filter by kinds
  if (filter.kinds && filter.kinds.length > 0) {
    const byKinds = new Set<string>();
    for (const kind of filter.kinds) {
      const events = kindEvents.get(kind);
      if (events) {
        for (const eid of events) byKinds.add(eid);
      }
    }
    candidateIds = candidateIds ? intersectSets(candidateIds, byKinds) : byKinds;
  }

  // No indexable filter found — don't do full scan
  if (candidateIds === null) {
    return result;
  }

  // Filter by since/until using metadata
  const since = filter.since as number | undefined;
  const until = filter.until as number | undefined;

  for (const eventId of candidateIds) {
    // Time filtering
    if (since || until) {
      const meta = eventMeta.get(eventId);
      if (meta) {
        if (since && meta.created_at < since) continue;
        if (until && meta.created_at > until) continue;
      } else {
        // No metadata — can't verify time, skip for time-filtered queries
        if (since || until) continue;
      }
    }

    // Get peers that have this event
    const peers = eventPeers.get(eventId);
    if (!peers || peers.size === 0) continue;

    const peerList = Array.from(peers).filter(pid => pid !== excludePeerId);
    if (peerList.length > 0) {
      result.set(eventId, peerList);
    }
  }

  return result;
}

// === Cleanup ===

export function removePeerFromCache(peerId: string): void {
  const events = peerEvents.get(peerId);
  if (events) {
    for (const eventId of events) {
      const peers = eventPeers.get(eventId);
      if (peers) {
        peers.delete(peerId);
        if (peers.size === 0) {
          // No peers have this event anymore — clean up metadata indices
          eventPeers.delete(eventId);
          removeEventMetadata(eventId);
        }
      }
    }
    peerEvents.delete(peerId);
    log.debug(`removed peer ${peerId} from cache tracker (${events.size} events)`);
  }
}

function removeEventMetadata(eventId: string): void {
  const meta = eventMeta.get(eventId);
  if (meta) {
    // Remove from author index
    const byAuthor = authorEvents.get(meta.pubkey);
    if (byAuthor) {
      byAuthor.delete(eventId);
      if (byAuthor.size === 0) authorEvents.delete(meta.pubkey);
    }

    // Remove from kind index
    const byKind = kindEvents.get(meta.kind);
    if (byKind) {
      byKind.delete(eventId);
      if (byKind.size === 0) kindEvents.delete(meta.kind);
    }

    eventMeta.delete(eventId);
  }
}

/**
 * Remove events older than 24h from all indices.
 * Call periodically (every 10 minutes) to keep memory bounded.
 */
export function pruneOldEvents(): void {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  let pruned = 0;

  for (const [eventId, meta] of eventMeta) {
    if (meta.created_at < cutoff) {
      // Remove from all peer sets
      const peers = eventPeers.get(eventId);
      if (peers) {
        for (const peerId of peers) {
          const peerEvts = peerEvents.get(peerId);
          if (peerEvts) {
            peerEvts.delete(eventId);
            if (peerEvts.size === 0) peerEvents.delete(peerId);
          }
        }
        eventPeers.delete(eventId);
      }

      // Remove metadata indices
      removeEventMetadata(eventId);
      pruned++;
    }
  }

  if (pruned > 0) {
    log.info(`pruned ${pruned} old events from cache tracker`);
  }
}

// === Stats ===

export function getCacheStats(): {
  peers: number;
  events: number;
  authors: number;
  kinds: number;
  metaIndexed: number;
} {
  return {
    peers: peerEvents.size,
    events: eventPeers.size,
    authors: authorEvents.size,
    kinds: kindEvents.size,
    metaIndexed: eventMeta.size,
  };
}

// === Helpers ===

function intersectSets(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  // Iterate over the smaller set for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) result.add(item);
  }
  return result;
}
