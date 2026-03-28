/**
 * NexusClient - NIP-95 P2P Nostr Relay Client
 *
 * Drop-in relay client that transparently adds P2P capabilities.
 * Compatible with nostr-tools. Events are served from peers when
 * available, with automatic fallback to the relay.
 *
 * Usage:
 *   const nexus = new NexusClient({ url: 'wss://nexus.libernet.app' });
 *   nexus.on('relayEvent', (event) => console.log(event));
 *   nexus.on('p2pEvent', (event) => console.log('via P2P!', event));
 *   await nexus.connect();
 *   nexus.subscribe('feed', { kinds: [1], limit: 20 });
 */

import { NexusOptions, NexusEventType, NexusEventHandler, NexusEventEmitter } from './types';
import { EventCache } from './cache';
import { P2PManager } from './p2p';

export class NexusClient {
  private ws: WebSocket | null = null;
  private emitter = new NexusEventEmitter();
  private cache: EventCache;
  private p2p: P2PManager | null = null;
  private options: Required<NexusOptions>;
  private peerId: string | null = null;
  private peerStatus: 'disconnected' | 'casual' | 'super' = 'disconnected';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NexusOptions) {
    this.options = {
      url: options.url,
      bandwidth: options.bandwidth ?? 10,
      storage: options.storage ?? 500,
      publicKey: options.publicKey ?? '',
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      p2p: options.p2p ?? true,
      cacheTtlMs: options.cacheTtlMs ?? 24 * 60 * 60 * 1000,
      statsInterval: options.statsInterval ?? 60000,
    };

    this.cache = new EventCache({ ttlMs: this.options.cacheTtlMs });
  }

  // --- Public API ---

  /** Register an event handler */
  on(event: NexusEventType, handler: NexusEventHandler): void {
    this.emitter.on(event, handler);
  }

  /** Remove an event handler */
  off(event: NexusEventType, handler: NexusEventHandler): void {
    this.emitter.off(event, handler);
  }

  /** Connect to the Nexus relay and register as P2P peer */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.emitter.emit('connected');

        if (this.options.p2p) {
          // Init P2P manager
          this.p2p = new P2PManager(
            (target, signal) => this._send(['PEER_SIGNAL', { target_peer: target, signal_data: signal }]),
            this.cache,
            this.emitter,
          );

          // Register as peer
          this._send(['PEER_REGISTER', {
            bandwidth: this.options.bandwidth,
            storage: this.options.storage,
            publicKey: this.options.publicKey,
          }]);

          // Start heartbeat
          this.heartbeatTimer = setInterval(() => {
            this._send(['PEER_HEARTBEAT']);
          }, this.options.heartbeatInterval);

          // Start stats reporting
          if (this.options.statsInterval > 0) {
            this.statsTimer = setInterval(() => this._sendStats(), this.options.statsInterval);
          }

          // Start cache cleanup
          this.cleanupTimer = setInterval(() => this.cache.cleanup(), 5 * 60 * 1000);
        }

        resolve();
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          this._handleMessage(msg);
        } catch { /* ignore */ }
      };

      this.ws.onclose = () => {
        this._cleanup();
        this.emitter.emit('disconnected');
      };

      this.ws.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  /** Disconnect from the relay and cleanup */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
    this._cleanup();
  }

  /** Subscribe to events (standard Nostr REQ) */
  subscribe(subscriptionId: string, ...filters: Record<string, unknown>[]): void {
    this._send(['REQ', subscriptionId, ...filters]);
  }

  /** Close a subscription */
  closeSubscription(subscriptionId: string): void {
    this._send(['CLOSE', subscriptionId]);
  }

  /** Publish an event (standard Nostr EVENT) */
  publish(event: Record<string, unknown>): void {
    this._send(['EVENT', event]);
    // Also cache it locally
    if (event.id) {
      this.cache.put(event as { id: string }).then(() => {
        this._send(['PEER_CACHE_HAVE', { event_ids: [event.id] }]);
      });
    }
  }

  /** Request specific events with P2P preference */
  requestP2P(eventIds: string[]): void {
    this._send(['PEER_REQUEST', { event_ids: eventIds }]);
  }

  /** Get current peer status */
  get status(): string { return this.peerStatus; }

  /** Get peer ID assigned by the relay */
  get id(): string | null { return this.peerId; }

  /** Get the event cache instance */
  get eventCache(): EventCache { return this.cache; }

  /** Get P2P statistics */
  get p2pStats() { return this.p2p?.getStats() ?? { served: 0, received: 0, bytesOut: 0, bytesIn: 0, connections: 0 }; }

  /** Get number of active P2P connections */
  get p2pConnectionCount(): number { return this.p2p?.connectionCount ?? 0; }

  // --- Private ---

  private _send(msg: unknown[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _handleMessage(msg: unknown[]): void {
    if (!Array.isArray(msg)) return;
    const [type, payload] = msg;

    switch (type) {
      case 'PEER_REGISTERED':
        this.peerId = (payload as any).peer_id;
        this.peerStatus = 'casual';
        this.emitter.emit('registered', payload);
        this._announceCache();
        break;

      case 'PEER_PROMOTED':
        this.peerStatus = 'super';
        this.emitter.emit('promoted', payload);
        break;

      case 'PEER_DEMOTED':
        this.peerStatus = 'casual';
        this.emitter.emit('demoted', payload);
        break;

      case 'PEER_OFFER':
        this._handleOffer(payload as any);
        break;

      case 'PEER_SIGNAL':
        if (this.p2p) {
          const { from_peer, signal_data } = payload as any;
          this.p2p.handleSignal(from_peer, signal_data);
        }
        break;

      case 'PEER_RECONNECT': {
        const { disconnected_peer } = payload as any;
        if (this.p2p) {
          this.p2p.disconnect(disconnected_peer);
        }
        this.emitter.emit('reconnect', payload);
        break;
      }

      case 'PEER_EVENT_NEW':
        // New event notification from relay - could pre-fetch
        break;

      case 'PEER_HEARTBEAT_ACK':
      case 'PEER_STATS_OK':
        // Silent
        break;

      case 'PEER_ERROR':
        this.emitter.emit('error', payload);
        break;

      case 'EVENT': {
        const event = msg[2] as Record<string, unknown>;
        if (event?.id) {
          this.emitter.emit('relayEvent', { subscriptionId: payload, event });
          // Auto-cache and announce
          this.cache.put(event as { id: string }).then(() => {
            this._send(['PEER_CACHE_HAVE', { event_ids: [event.id] }]);
          });
        }
        break;
      }

      case 'EOSE':
        this.emitter.emit('eose', payload);
        break;

      case 'OK':
      case 'NOTICE':
        // Standard relay messages - pass through
        break;
    }
  }

  private _handleOffer(payload: { offers: Record<string, string[]> }): void {
    if (!this.p2p) return;

    const offers = payload.offers || {};
    for (const [eventId, peerIds] of Object.entries(offers)) {
      const targetPeerId = peerIds[0];
      if (targetPeerId) {
        this.p2p.connect(targetPeerId, eventId);
      }
    }
  }

  private async _announceCache(): Promise<void> {
    await this.cache.cleanup();
    const ids = await this.cache.getAllIds();
    if (ids.length > 0) {
      this._send(['PEER_CACHE_HAVE', { event_ids: ids }]);
    }
  }

  private _sendStats(): void {
    const stats = this.p2p?.getStats();
    if (stats) {
      this._send(['PEER_STATS', {
        events_served: stats.served,
        bytes_transferred: stats.bytesOut + stats.bytesIn,
        peers_connected: stats.connections,
      }]);
    }
  }

  private _cleanup(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.p2p?.destroyAll();
    this.peerStatus = 'disconnected';
    this.peerId = null;
    this.ws = null;
  }
}
