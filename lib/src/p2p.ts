/**
 * P2P Manager - handles WebRTC connections for NIP-95.
 * Creates and manages SimplePeer connections, serves/receives events.
 */

import type { EventCache } from './cache';
import type { NexusEventEmitter } from './types';

// SimplePeer is loaded globally in browser (from CDN or bundle)
declare const SimplePeer: any;

export class P2PManager {
  private peers = new Map<string, any>(); // peerId -> SimplePeer instance
  private sendSignal: (targetPeer: string, signalData: unknown) => void;
  private cache: EventCache;
  private emitter: NexusEventEmitter;
  private stats = { served: 0, received: 0, bytesOut: 0, bytesIn: 0 };

  constructor(
    sendSignal: (targetPeer: string, signalData: unknown) => void,
    cache: EventCache,
    emitter: NexusEventEmitter,
  ) {
    this.sendSignal = sendSignal;
    this.cache = cache;
    this.emitter = emitter;
  }

  /** Initiate a P2P connection to fetch an event from a peer */
  connect(targetPeerId: string, eventId: string): void {
    if (this.peers.has(targetPeerId)) return;
    this._createPeer(targetPeerId, true, eventId);
  }

  /** Handle an incoming relayed signal from another peer */
  handleSignal(fromPeerId: string, signalData: unknown): void {
    const existing = this.peers.get(fromPeerId);
    if (existing) {
      existing.signal(signalData);
      return;
    }

    // Create responder peer
    const peer = this._createPeer(fromPeerId, false, null);
    // Feed signal on next tick to ensure peer is set up
    setTimeout(() => peer.signal(signalData), 0);
  }

  /** Destroy a specific P2P connection */
  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.destroy();
      this.peers.delete(peerId);
      this.emitter.emit('peerDisconnected', peerId);
    }
  }

  /** Destroy all P2P connections */
  destroyAll(): void {
    for (const [id, peer] of this.peers) {
      peer.destroy();
    }
    this.peers.clear();
  }

  /** Get number of active P2P connections */
  get connectionCount(): number {
    return this.peers.size;
  }

  /** Get P2P stats */
  getStats() {
    return { ...this.stats, connections: this.peers.size };
  }

  private _createPeer(targetPeerId: string, initiator: boolean, eventId: string | null): any {
    const peer = new SimplePeer({ initiator, trickle: true });
    this.peers.set(targetPeerId, peer);

    peer.on('signal', (data: unknown) => {
      this.sendSignal(targetPeerId, data);
    });

    peer.on('connect', () => {
      this.emitter.emit('peerConnected', targetPeerId);

      // If initiator, request the event
      if (initiator && eventId) {
        const msg = JSON.stringify({ type: 'P2P_REQUEST', event_id: eventId });
        peer.send(msg);
        this.stats.bytesOut += msg.length;
      }
    });

    peer.on('data', (data: Buffer | string) => {
      const raw = data.toString();
      this.stats.bytesIn += raw.length;

      try {
        const msg = JSON.parse(raw);
        this._handleP2PMessage(targetPeerId, peer, msg);
      } catch {
        // ignore
      }
    });

    peer.on('error', () => {
      this.peers.delete(targetPeerId);
      this.emitter.emit('peerDisconnected', targetPeerId);
    });

    peer.on('close', () => {
      this.peers.delete(targetPeerId);
      this.emitter.emit('peerDisconnected', targetPeerId);
    });

    return peer;
  }

  private async _handleP2PMessage(fromPeerId: string, peer: any, msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'P2P_REQUEST': {
        const eventId = msg.event_id as string;
        const event = await this.cache.get(eventId);
        if (event) {
          const response = JSON.stringify({ type: 'P2P_EVENTS', event });
          peer.send(response);
          this.stats.served++;
          this.stats.bytesOut += response.length;
          this.emitter.emit('eventServed', { eventId, peerId: fromPeerId });
        }
        break;
      }

      case 'P2P_EVENTS': {
        const event = msg.event as Record<string, unknown>;
        if (event?.id) {
          this.stats.received++;
          this.emitter.emit('p2pEvent', event);
          // Cache automatically
          await this.cache.put(event as { id: string });
        }
        break;
      }
    }
  }
}
