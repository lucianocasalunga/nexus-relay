# Nexus Relay

**NIP-95: Hybrid Peer-to-Peer Nostr Relay**

The world's first hybrid P2P Nostr relay. Clients share events directly with each other via WebRTC, reducing relay load by 30-50% and surviving outages.

![Nexus Logo](public/logo.png)

**Live:** [nexus.libernet.app](https://nexus.libernet.app)
**NIP-95 PR:** [nostr-protocol/nips#2293](https://github.com/nostr-protocol/nips/pull/2293)
**Version:** 1.0.0

---

## How It Works

```
Traditional:    Client --> Relay --> Client
Nexus:          Client <--> Client (P2P via WebRTC)
                     |
                   Relay (fallback)
```

1. Client connects to Nexus via WebSocket (like any Nostr relay)
2. Registers as a P2P peer (opt-in)
3. Events received from the relay are cached locally (IndexedDB, 24h TTL)
4. When another peer requests a cached event, Nexus matches them
5. Peers establish a WebRTC Data Channel and exchange events directly (~4ms)
6. If P2P fails, the relay serves normally (transparent fallback)

### Three Layers

| Layer | Who | Role |
|-------|-----|------|
| **Seed Node** | Nexus Relay | Stores everything, orchestrates P2P, fallback |
| **Super Peer** | Stable clients | Serve events via P2P (max 10 connections) |
| **Casual Peer** | Regular clients | Receive via P2P, don't serve |

### Automatic Promotion

Casual -> Super Peer when:
- Online > 30 minutes
- Bandwidth > 5 Mbps
- Storage > 100 MB
- Reputation >= 50/100
- Cache >= 1 event

---

## Architecture

```
                    +---------------------+
                    |   Cloudflare Tunnel  |
                    | nexus.libernet.app   |
                    +----------+----------+
                               |
                    +----------v----------+
                    |   Nexus Server      |
                    |   port 8889         |
                    |                     |
                    |  +--------------+   |
                    |  |   Router     |   |
                    |  | PEER_* -> P2P|   |
                    |  | REQ -> proxy |   |
                    |  +--------------+   |
                    |         |           |
                    |  +------v-------+   |
                    |  | strfry:7777  |   |
                    |  | (relay core) |   |
                    |  +--------------+   |
                    |                     |
                    |  +--------------+   |
                    |  | Redis:6379   |   |
                    |  | (peers/cache)|   |
                    |  +--------------+   |
                    +---------------------+
```

### Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js / TypeScript |
| Relay core | strfry (C++, LMDB database) |
| P2P | WebRTC via simple-peer |
| Server cache | Redis |
| Client cache | IndexedDB (24h TTL) |
| Proxy | Cloudflare Tunnel (QUIC) |
| Deploy | systemd |

---

## NIP-95 Protocol

### Client -> Nexus

| Message | Payload | Description |
|---------|---------|-------------|
| `PEER_REGISTER` | `{ bandwidth, storage, publicKey }` | Register as P2P peer |
| `PEER_HEARTBEAT` | - | Keep-alive (30s) |
| `PEER_REQUEST` | `{ event_ids: [...] }` | Request events with P2P preference |
| `PEER_SIGNAL` | `{ target_peer, signal_data }` | Relay ICE/SDP to another peer |
| `PEER_CACHE_HAVE` | `{ event_ids: [...] }` | Announce cached event IDs |
| `PEER_STATS` | `{ events_served, bytes_transferred }` | Report sharing statistics |

### Nexus -> Client

| Message | Payload | Description |
|---------|---------|-------------|
| `PEER_REGISTERED` | `{ peer_id, status }` | Registration confirmed |
| `PEER_OFFER` | `{ offers: { event_id: [peer_ids] } }` | Peers that have requested events |
| `PEER_SIGNAL` | `{ from_peer, signal_data }` | Relayed ICE/SDP from another peer |
| `PEER_PROMOTED` | `{ peer_id, reason }` | Promoted to Super Peer |
| `PEER_DEMOTED` | `{ peer_id, reason }` | Demoted to Casual |
| `PEER_STATS_OK` | `{ reputation, total_events_served }` | Stats acknowledged |
| `PEER_HEARTBEAT_ACK` | `{ peer_id, ts }` | Heartbeat confirmed |
| `PEER_EVENT_NEW` | `{ event_id, kind, size }` | New event to cache (broadcast) |
| `PEER_RECONNECT` | `{ disconnected_peer }` | Super Peer disconnected |
| `PEER_ERROR` | `{ message }` | Error |

### P2P Messages (WebRTC Data Channel)

| Message | Description |
|---------|-------------|
| `P2P_REQUEST` | Request a specific event |
| `P2P_EVENTS` | Send an event |
| `P2P_HEARTBEAT` | P2P keep-alive |

---

## Live Endpoints

| URL | Description |
|-----|-------------|
| `wss://nexus.libernet.app` | WebSocket (relay + P2P) |
| `https://nexus.libernet.app` | P2P test page (PoC) |
| `https://nexus.libernet.app/client.html` | Full P2P client |
| `https://nexus.libernet.app/dashboard.html` | Real-time metrics dashboard |
| `https://nexus.libernet.app/stats` | Metrics API (JSON) |
| `https://nexus.libernet.app` (Accept: nostr+json) | NIP-11 relay info |

---

## Project Structure

```
nexus-relay/
├── src/                          # TypeScript server source
│   ├── index.ts                  # Entry point (v1.0.0)
│   ├── server.ts                 # HTTP + WebSocket server + NIP-11
│   ├── router.ts                 # Smart routing (PEER_* vs REQ)
│   ├── proxy.ts                  # Bidirectional proxy -> strfry
│   ├── broadcast.ts              # strfry subscription -> Super Peers
│   ├── metrics.ts                # Centralized metrics
│   ├── signaling/
│   │   ├── handler.ts            # Handles all PEER_* messages
│   │   └── messages.ts           # Message constants
│   ├── peers/
│   │   ├── manager.ts            # Registration, heartbeat, disconnect
│   │   ├── classifier.ts         # Promotion/demotion + reputation
│   │   ├── cache-tracker.ts      # Which peers have which events
│   │   ├── connections.ts        # Per-Super Peer connection limits
│   │   └── types.ts              # TypeScript interfaces
│   ├── redis/
│   │   └── client.ts             # Redis helpers (nexus: prefix)
│   └── utils/
│       ├── config.ts             # .env loader
│       └── logger.ts             # Formatted logger
├── lib/                          # nostr-p2p.js client library
│   ├── src/
│   │   ├── index.ts              # Exports
│   │   ├── client.ts             # NexusClient class
│   │   ├── p2p.ts                # P2PManager (WebRTC)
│   │   ├── cache.ts              # EventCache (IndexedDB)
│   │   └── types.ts              # Types and EventEmitter
│   ├── package.json              # npm: nostr-p2p
│   └── README.md                 # Library docs
├── public/                       # Web pages
│   ├── test.html                 # Phase 2 PoC (2 peers)
│   ├── client.html               # Full P2P client
│   ├── dashboard.html            # Metrics dashboard
│   └── logo.png                  # Project logo
├── tests/                        # Automated tests (97 total)
│   ├── test-signaling-flow.ts    # Signaling: 23 tests
│   ├── test-fase3.ts             # NIP-95 protocol: 25 tests
│   ├── test-fase4.ts             # Cache/metrics: 26 tests
│   ├── test-load.ts              # Load: 60 simultaneous peers
│   └── test-resilience.ts        # Resilience: 12 tests
├── .env                          # Configuration
├── package.json                  # Dependencies
└── tsconfig.json                 # TypeScript config
```

---

## Installation

### Requirements

- Node.js >= 20
- Redis
- strfry running on port 7777

### Setup

```bash
git clone https://github.com/lucianocasalunga/nexus-relay.git
cd nexus-relay
npm install
cp .env.example .env  # edit configuration
npx tsc               # compile TypeScript
```

### Run (development)

```bash
npm run dev
```

### Deploy (production)

```bash
npx tsc
sudo systemctl start nexus-relay
sudo systemctl enable nexus-relay
```

### Verify

```bash
# Service status
sudo systemctl status nexus-relay

# NIP-11
curl -H "Accept: application/nostr+json" https://nexus.libernet.app

# Metrics
curl https://nexus.libernet.app/stats

# Run all tests (97 total)
npx ts-node tests/test-signaling-flow.ts
npx ts-node tests/test-fase3.ts
npx ts-node tests/test-fase4.ts
npx ts-node tests/test-load.ts
npx ts-node tests/test-resilience.ts
```

---

## Integration

### Option 1: Add as a regular relay

Any Nostr client can use `wss://nexus.libernet.app` as a relay.
Works identically to a traditional relay (transparent proxy to strfry).
No code changes needed.

### Option 2: Use the nostr-p2p.js library

```javascript
import { NexusClient } from 'nostr-p2p';

const nexus = new NexusClient({
  url: 'wss://nexus.libernet.app',
});

nexus.on('relayEvent', ({ event }) => console.log(event));
nexus.on('p2pEvent', (event) => console.log('Via P2P!', event));

await nexus.connect();
nexus.subscribe('feed', { kinds: [1], limit: 20 });
```

### Option 3: Drop-in integration script

Include `nexus-p2p.js` in your page. It self-configures:
- Detects nexus.libernet.app in the relay pool
- Auto-registers as a peer
- Caches events, serves via P2P
- Shows status badge (green aura = active, red = inactive)

---

## Metrics

**Dashboard:** [nexus.libernet.app/dashboard.html](https://nexus.libernet.app/dashboard.html)

**JSON API:** [nexus.libernet.app/stats](https://nexus.libernet.app/stats)

```json
{
  "server": { "version": "1.0.0", "uptime_seconds": 3600, "memory_mb": 45 },
  "peers": { "websocket_clients": 5, "registered_peers": 3, "super_peers": 1, "casual_peers": 2 },
  "p2p": { "events_via_p2p": 42, "events_via_relay": 150, "signals_relayed": 8 },
  "cache": { "peers_with_cache": 3, "unique_events_cached": 120 },
  "connections": { "active_super_peers": 1, "total_p2p_connections": 4, "avg_load_per_super": 4.0 },
  "classification": { "promotions": 1, "demotions": 0 }
}
```

---

## Performance

Tested with 60 simultaneous peers:

| Operation | Time |
|-----------|------|
| Connect 60 peers | 46ms |
| Register 60 peers | 19ms |
| Cache 300 events | 503ms |
| 59 cross-peer requests | 6ms |
| 20 signal relays | 2ms |
| P2P transfer (WebRTC) | **4ms** |

Server RAM: ~45MB (dev), ~11MB (production compiled)

---

## Why P2P for Nostr?

Traditional Nostr relays are 100% client-server. If the relay goes down, everyone loses access. Nexus solves this:

- **Resilience:** If the relay goes offline, peers continue exchanging cached events
- **Performance:** P2P transfer is ~4ms vs ~300ms through relay
- **Scalability:** Super Peers offload 30-50% of relay traffic
- **Decentralization:** Real decentralization, not just multiple centralized servers
- **Backward compatible:** Clients without NIP-95 support use Nexus as a normal relay

Inspired by [Spotify's P2P architecture](https://www.csc.kth.se/~gkreitz/spotify-p2p10/) where clients share cached music to reduce server load.

---

## License

MIT - [LiberNet](https://libernet.app) 2026

Built by Barak (Luciano) + Claude
