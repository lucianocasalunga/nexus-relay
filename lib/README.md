# nostr-p2p

NIP-95 P2P extension for Nostr relays. Adds WebRTC peer-to-peer event sharing on top of any Nostr relay connection.

## Install

```bash
npm install nostr-p2p
```

Requires `simple-peer` loaded in the browser (CDN or bundle):
```html
<script src="https://unpkg.com/simple-peer@9.11.1/simplepeer.min.js"></script>
```

## Quick Start

```javascript
import { NexusClient } from 'nostr-p2p';

const nexus = new NexusClient({
  url: 'wss://nexus.libernet.app',
  bandwidth: 10,   // Mbps (self-reported)
  storage: 500,    // MB available for caching
});

// Events
nexus.on('connected', () => console.log('Connected'));
nexus.on('registered', (data) => console.log('Peer ID:', data.peer_id));
nexus.on('promoted', () => console.log('Promoted to Super Peer!'));
nexus.on('relayEvent', ({ subscriptionId, event }) => {
  console.log(`[${subscriptionId}]`, event.content);
});
nexus.on('p2pEvent', (event) => {
  console.log('Via P2P!', event.content);
});

// Connect and subscribe
await nexus.connect();
nexus.subscribe('feed', { kinds: [1], limit: 20 });

// Publish
nexus.publish(signedEvent);

// Request specific events via P2P
nexus.requestP2P(['event_id_1', 'event_id_2']);

// Disconnect
nexus.disconnect();
```

## How It Works

1. Client connects to a Nexus relay via WebSocket
2. Registers as a P2P peer (casual by default)
3. Events received from the relay are cached locally (IndexedDB, TTL 24h)
4. Cached events are announced to the relay (`PEER_CACHE_HAVE`)
5. When another peer requests an event, the relay checks if any peer has it
6. If yes, it sends a `PEER_OFFER` with the peer's ID
7. Both peers establish a WebRTC Data Channel via signaling through the relay
8. The event is transferred directly peer-to-peer (typically <10ms)
9. If P2P fails, the relay serves the event normally (transparent fallback)

## API

### `new NexusClient(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | required | WebSocket URL of the Nexus relay |
| `bandwidth` | number | 10 | Self-reported bandwidth (Mbps) |
| `storage` | number | 500 | Self-reported storage (MB) |
| `publicKey` | string | '' | Nostr public key (hex) |
| `heartbeatInterval` | number | 30000 | Heartbeat interval (ms) |
| `p2p` | boolean | true | Enable P2P |
| `cacheTtlMs` | number | 86400000 | Cache TTL (ms, default 24h) |
| `statsInterval` | number | 60000 | Stats report interval (ms) |

### Events

| Event | Data | Description |
|-------|------|-------------|
| `connected` | - | WebSocket connected |
| `disconnected` | - | WebSocket disconnected |
| `registered` | `{ peer_id, status }` | Registered as P2P peer |
| `promoted` | `{ peer_id, reason }` | Promoted to Super Peer |
| `demoted` | `{ peer_id, reason }` | Demoted to Casual |
| `peerConnected` | `peerId` | WebRTC connection established |
| `peerDisconnected` | `peerId` | WebRTC connection closed |
| `p2pEvent` | `event` | Event received via P2P |
| `eventServed` | `{ eventId, peerId }` | Event served to another peer |
| `relayEvent` | `{ subscriptionId, event }` | Event received from relay |
| `eose` | `subscriptionId` | End of stored events |
| `error` | `{ message }` | Error from relay |
| `reconnect` | `{ disconnected_peer }` | Super Peer disconnected |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | string | 'disconnected', 'casual', or 'super' |
| `id` | string | Peer ID assigned by relay |
| `p2pStats` | object | `{ served, received, bytesOut, bytesIn, connections }` |
| `p2pConnectionCount` | number | Active P2P connections |
| `eventCache` | EventCache | Access to the IndexedDB cache |

### `EventCache`

```javascript
const cache = nexus.eventCache;
await cache.put(event);           // Store an event
await cache.get('event_id');      // Get an event (null if expired)
await cache.has('event_id');      // Check if event exists
await cache.getAllIds();           // Get all cached event IDs
await cache.count();              // Count cached events
await cache.cleanup();            // Remove expired events
await cache.clear();              // Clear all events
```

## Compatibility

Works with any Nostr client that uses WebSocket. The library handles NIP-95 messages transparently - standard Nostr messages (REQ, EVENT, CLOSE) are proxied to the underlying relay.

## Protocol

See [NIP-95](https://github.com/nostr-protocol/nips/pull/2293) for the full specification.

## License

MIT - LiberNet 2026
