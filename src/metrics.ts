import { getRegisteredPeerCount } from './peers/manager';
import { getSet } from './redis/client';
import { getCacheStats } from './peers/cache-tracker';
import { getConnectionStats } from './peers/connections';
import { getClientCount } from './server';
import { logger } from './utils/logger';

const log = logger('metrics');

// Counters (reset on restart - for this phase, in-memory is fine)
const counters = {
  eventsViaP2P: 0,
  eventsViaRelay: 0,
  bytesP2P: 0,
  signalsRelayed: 0,
  peersPromoted: 0,
  peersDemoted: 0,
};

export function incCounter(key: keyof typeof counters, amount = 1): void {
  counters[key] += amount;
}

export function getCounters(): typeof counters {
  return { ...counters };
}

export async function getMetrics(): Promise<Record<string, unknown>> {
  const superPeers = await getSet('peers:super');
  const casualPeers = await getSet('peers:casual');
  const cacheStats = getCacheStats();
  const connStats = getConnectionStats();

  return {
    server: {
      version: '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    peers: {
      websocket_clients: getClientCount(),
      registered_peers: getRegisteredPeerCount(),
      super_peers: superPeers.length,
      casual_peers: casualPeers.length,
    },
    p2p: {
      events_via_p2p: counters.eventsViaP2P,
      events_via_relay: counters.eventsViaRelay,
      bytes_p2p: counters.bytesP2P,
      signals_relayed: counters.signalsRelayed,
    },
    cache: {
      peers_with_cache: cacheStats.peers,
      unique_events_cached: cacheStats.events,
      meta_indexed: cacheStats.metaIndexed,
      unique_authors: cacheStats.authors,
      unique_kinds: cacheStats.kinds,
    },
    connections: {
      active_super_peers: connStats.superPeers,
      total_p2p_connections: connStats.totalConnections,
      avg_load_per_super: Math.round(connStats.avgLoad * 10) / 10,
    },
    classification: {
      promotions: counters.peersPromoted,
      demotions: counters.peersDemoted,
    },
  };
}
