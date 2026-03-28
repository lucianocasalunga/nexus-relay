/** Connection options for NexusClient */
export interface NexusOptions {
  /** WebSocket URL of the Nexus relay (e.g. wss://nexus.libernet.app) */
  url: string;
  /** Self-reported bandwidth in Mbps (helps with peer classification) */
  bandwidth?: number;
  /** Self-reported storage in MB available for caching */
  storage?: number;
  /** Nostr public key (hex) */
  publicKey?: string;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Enable P2P (default: true). Set false to use as normal relay only. */
  p2p?: boolean;
  /** Cache TTL in ms (default: 24h) */
  cacheTtlMs?: number;
  /** Auto-send stats interval in ms (default: 60000, 0 to disable) */
  statsInterval?: number;
}

/** Event types emitted by NexusClient */
export type NexusEventType =
  | 'connected'
  | 'disconnected'
  | 'registered'
  | 'promoted'
  | 'demoted'
  | 'peerConnected'
  | 'peerDisconnected'
  | 'p2pEvent'
  | 'eventServed'
  | 'relayEvent'
  | 'eose'
  | 'error'
  | 'reconnect';

export type NexusEventHandler = (data?: unknown) => void;

/** Simple event emitter for NexusClient */
export class NexusEventEmitter {
  private handlers = new Map<string, Set<NexusEventHandler>>();

  on(event: NexusEventType, handler: NexusEventHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  off(event: NexusEventType, handler: NexusEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: NexusEventType, data?: unknown): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch { /* ignore */ }
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
