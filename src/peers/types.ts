export type PeerStatus = 'casual' | 'super' | 'demoted' | 'banned';

export interface PeerInfo {
  id: string;
  ip: string;
  status: PeerStatus;
  connectedAt: string;   // ISO timestamp
  lastHeartbeat: string;  // ISO timestamp
  bandwidth: string;      // reported by client, e.g. "10"
  storage: string;        // reported by client, e.g. "500"
}

export interface PeerCapabilities {
  bandwidth?: number;          // Mbps
  storage?: number;            // MB available
  publicKey?: string;          // nostr pubkey hex (64 chars)
  lightningAddress?: string;   // Lightning Address for payments
}
