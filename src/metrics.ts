import { getRegisteredPeerCount, getRegisteredPeerIds } from './peers/manager';
import { getPeer } from './redis/client';
import { getCacheStats } from './peers/cache-tracker';
import { getConnectionStats } from './peers/connections';
import { getClientCount } from './server';
import { logger } from './utils/logger';
import { getRelayAvgLatency } from './proxy';

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

// P2P latency tracking (offer_ts → data channel open)
const p2pLatencySamples: number[] = [];
const LATENCY_MAX_SAMPLES = 200;

export function recordP2PLatency(ms: number): void {
  if (ms < 0 || ms > 60_000) return; // sanity: ignore outliers > 60s
  p2pLatencySamples.push(ms);
  if (p2pLatencySamples.length > LATENCY_MAX_SAMPLES) {
    p2pLatencySamples.shift();
  }
}

export function getP2PAvgLatency(): number | null {
  if (p2pLatencySamples.length === 0) return null;
  return Math.round(p2pLatencySamples.reduce((a, b) => a + b, 0) / p2pLatencySamples.length);
}

export function incCounter(key: keyof typeof counters, amount = 1): void {
  counters[key] += amount;
}

export function getCounters(): typeof counters {
  return { ...counters };
}

export async function getMetrics(): Promise<Record<string, unknown>> {
  // Count super/casual from actual registered peers (not stale Redis sets)
  const peerIds = getRegisteredPeerIds();
  let superCount = 0;
  let casualCount = 0;
  for (const id of peerIds) {
    const peer = await getPeer(id);
    if (peer?.status === 'super') superCount++;
    else casualCount++;
  }

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
      super_peers: superCount,
      casual_peers: casualCount,
    },
    p2p: {
      events_via_p2p: counters.eventsViaP2P,
      events_via_relay: counters.eventsViaRelay,
      bytes_p2p: counters.bytesP2P,
      signals_relayed: counters.signalsRelayed,
      p2p_avg_latency_ms: getP2PAvgLatency(),
      relay_avg_latency_ms: getRelayAvgLatency(),
      latency_samples: p2pLatencySamples.length,
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
