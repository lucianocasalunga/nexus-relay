# Nexus Relay

**NIP-95: Hybrid Peer-to-Peer Nostr Relay**

O primeiro relay Nostr hibrido P2P do mundo. Clientes compartilham eventos entre si via WebRTC, reduzindo carga do relay e aumentando descentralizacao.

![Nexus Logo](public/logo.png)

**URL:** [nexus.libernet.app](https://nexus.libernet.app)
**NIP-95 PR:** [nostr-protocol/nips#2293](https://github.com/nostr-protocol/nips/pull/2293)
**Versao:** 1.0.0

---

## Como Funciona

```
Modo tradicional:    Cliente → Relay → Cliente
Modo Nexus:          Cliente ←→ Cliente (P2P via WebRTC)
                         ↕
                       Relay (fallback)
```

1. Cliente conecta ao Nexus via WebSocket (como qualquer relay Nostr)
2. Registra-se como peer P2P (opt-in)
3. Eventos recebidos do relay sao cacheados localmente (IndexedDB, 24h)
4. Quando outro peer pede um evento, o Nexus verifica quem tem em cache
5. Peers estabelecem WebRTC Data Channel e trocam eventos diretamente (~4ms)
6. Se P2P falha, relay serve normalmente (fallback transparente)

### Tres Camadas

| Camada | Quem | Funcao |
|--------|------|--------|
| **Seed Node** | Nexus Relay | Armazena tudo, orquestra P2P, fallback |
| **Super Peer** | Clientes estaveis | Servem eventos via P2P (max 10 conexoes) |
| **Casual Peer** | Clientes normais | Recebem via P2P, nao servem |

### Promocao Automatica

Casual → Super Peer quando:
- Online >30 minutos
- Bandwidth >5 Mbps
- Storage >100 MB
- Reputacao >= 50/100
- Cache >= 1 evento

---

## Arquitetura

```
                    ┌─────────────────────┐
                    │   Cloudflare Tunnel  │
                    │ nexus.libernet.app   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Nexus Server      │
                    │   porta 8889        │
                    │                     │
                    │  ┌──────────────┐   │
                    │  │   Router     │   │
                    │  │ PEER_* → P2P │   │
                    │  │ REQ → proxy  │   │
                    │  └──────────────┘   │
                    │         │           │
                    │  ┌──────▼───────┐   │
                    │  │ strfry:7777  │   │
                    │  │ (relay core) │   │
                    │  └──────────────┘   │
                    │                     │
                    │  ┌──────────────┐   │
                    │  │ Redis:6379   │   │
                    │  │ (peers/cache)│   │
                    │  └──────────────┘   │
                    └─────────────────────┘
```

### Portas

| Porta | Servico |
|-------|---------|
| 8889 | Nexus (WebSocket + HTTP) |
| 7777 | strfry (Nostr classico) |
| 6379 | Redis (cache de peers) |

### Stack

- **Backend:** Node.js / TypeScript
- **Relay core:** strfry (C++, database LMDB)
- **P2P:** WebRTC via simple-peer
- **Cache server:** Redis
- **Cache client:** IndexedDB (TTL 24h)
- **Proxy:** Cloudflare Tunnel (QUIC)
- **Deploy:** systemd

---

## Protocolo NIP-95

### Mensagens Cliente → Nexus

| Mensagem | Payload | Descricao |
|----------|---------|-----------|
| `PEER_REGISTER` | `{ bandwidth, storage, publicKey }` | Registrar como peer P2P |
| `PEER_HEARTBEAT` | - | Keep-alive (30s) |
| `PEER_REQUEST` | `{ event_ids: [...] }` | Pedir eventos com preferencia P2P |
| `PEER_SIGNAL` | `{ target_peer, signal_data }` | Relay ICE/SDP para outro peer |
| `PEER_CACHE_HAVE` | `{ event_ids: [...] }` | Anunciar eventos em cache |
| `PEER_STATS` | `{ events_served, bytes_transferred }` | Reportar estatisticas |

### Mensagens Nexus → Cliente

| Mensagem | Payload | Descricao |
|----------|---------|-----------|
| `PEER_REGISTERED` | `{ peer_id, status }` | Confirmacao de registro |
| `PEER_OFFER` | `{ offers: { event_id: [peer_ids] } }` | Peers que tem eventos |
| `PEER_SIGNAL` | `{ from_peer, signal_data }` | ICE/SDP de outro peer |
| `PEER_PROMOTED` | `{ peer_id, reason }` | Promovido a Super Peer |
| `PEER_DEMOTED` | `{ peer_id, reason }` | Demovido a Casual |
| `PEER_STATS_OK` | `{ reputation, total_events_served }` | Stats recebidas |
| `PEER_HEARTBEAT_ACK` | `{ peer_id, ts }` | Heartbeat confirmado |
| `PEER_EVENT_NEW` | `{ event_id, kind, size }` | Novo evento para cachear |
| `PEER_RECONNECT` | `{ disconnected_peer }` | Super Peer desconectou |
| `PEER_ERROR` | `{ message }` | Erro |

### Mensagens P2P (WebRTC Data Channel)

| Mensagem | Descricao |
|----------|-----------|
| `P2P_REQUEST` | Pedir evento especifico |
| `P2P_EVENTS` | Enviar evento |
| `P2P_HEARTBEAT` | Keep-alive P2P |

---

## URLs

| URL | Descricao |
|-----|-----------|
| `wss://nexus.libernet.app` | WebSocket (relay + P2P) |
| `https://nexus.libernet.app` | Pagina de teste PoC |
| `https://nexus.libernet.app/client.html` | Cliente P2P completo |
| `https://nexus.libernet.app/dashboard.html` | Dashboard de metricas |
| `https://nexus.libernet.app/stats` | API de metricas (JSON) |
| `https://nexus.libernet.app` (Accept: nostr+json) | NIP-11 info |

---

## Estrutura do Projeto

```
nexus-relay/
├── src/                          # Codigo TypeScript do servidor
│   ├── index.ts                  # Entry point (v1.0.0)
│   ├── server.ts                 # HTTP + WebSocket server + NIP-11
│   ├── router.ts                 # Smart routing (PEER_* vs REQ)
│   ├── proxy.ts                  # Proxy bidirecional → strfry
│   ├── broadcast.ts              # Subscription strfry → Super Peers
│   ├── metrics.ts                # Metricas centralizadas
│   ├── signaling/
│   │   ├── handler.ts            # Processa todas as mensagens PEER_*
│   │   └── messages.ts           # Constantes de mensagens
│   ├── peers/
│   │   ├── manager.ts            # Registro, heartbeat, disconnect
│   │   ├── classifier.ts         # Promocao/democao + reputacao
│   │   ├── cache-tracker.ts      # Quais peers tem quais eventos
│   │   ├── connections.ts        # Limite conexoes por Super Peer
│   │   └── types.ts              # Interfaces TypeScript
│   ├── redis/
│   │   └── client.ts             # Redis helpers (prefixo nexus:)
│   └── utils/
│       ├── config.ts             # .env loader
│       └── logger.ts             # Logger formatado
├── lib/                          # Biblioteca nostr-p2p.js
│   ├── src/
│   │   ├── index.ts              # Exports
│   │   ├── client.ts             # NexusClient class
│   │   ├── p2p.ts                # P2PManager (WebRTC)
│   │   ├── cache.ts              # EventCache (IndexedDB)
│   │   └── types.ts              # Tipos e EventEmitter
│   ├── package.json              # npm: nostr-p2p
│   └── README.md                 # Docs da biblioteca
├── public/                       # Paginas web
│   ├── test.html                 # PoC Fase 2 (2 peers)
│   ├── client.html               # Cliente P2P completo
│   ├── dashboard.html            # Dashboard metricas
│   └── logo.png                  # Logo do projeto
├── tests/                        # Testes automatizados
│   ├── test-signaling-flow.ts    # Fase 2: 23 testes
│   ├── test-fase3.ts             # Fase 3: 25 testes
│   ├── test-fase4.ts             # Fase 4: 26 testes
│   ├── test-load.ts              # Carga: 60 peers
│   └── test-resilience.ts        # Resiliencia: 12 testes
├── .env                          # Configuracao
├── package.json                  # Dependencias
├── tsconfig.json                 # TypeScript config
├── PLANO.md                      # Plano de 7 fases
├── ARQUITETURA.md                # Arquitetura tecnica
├── MONETIZACAO.md                # Modelo de monetizacao
└── MEMORIA.md                    # Historico do projeto
```

---

## Instalacao e Deploy

### Requisitos

- Node.js >= 20
- Redis rodando
- strfry rodando na porta 7777
- Cloudflare Tunnel configurado

### Setup

```bash
cd /mnt/projetos/nexus-relay
npm install
cp .env.example .env  # editar configuracoes
npx tsc               # compilar TypeScript
```

### Executar (dev)

```bash
npm run dev
```

### Deploy (producao)

```bash
npx tsc
sudo systemctl start nexus-relay
sudo systemctl enable nexus-relay
```

### Verificar

```bash
# Status do servico
sudo systemctl status nexus-relay

# NIP-11
curl -H "Accept: application/nostr+json" https://nexus.libernet.app

# Metricas
curl https://nexus.libernet.app/stats

# Testes
npx ts-node tests/test-signaling-flow.ts
npx ts-node tests/test-fase3.ts
npx ts-node tests/test-fase4.ts
npx ts-node tests/test-load.ts
npx ts-node tests/test-resilience.ts
```

---

## Integracao com Clientes Nostr

### Opcao 1: Adicionar como relay normal

Qualquer cliente Nostr pode usar `wss://nexus.libernet.app` como relay.
Funciona identicamente a um relay tradicional (proxy transparente para strfry).

### Opcao 2: Usar biblioteca nostr-p2p.js

```javascript
import { NexusClient } from 'nostr-p2p';

const nexus = new NexusClient({
  url: 'wss://nexus.libernet.app',
});

nexus.on('relayEvent', ({ event }) => console.log(event));
nexus.on('p2pEvent', (event) => console.log('P2P!', event));

await nexus.connect();
nexus.subscribe('feed', { kinds: [1], limit: 20 });
```

### Opcao 3: Script de integracao (como LiberMedia)

Incluir `nexus-p2p.js` na pagina. Se auto-configura:
- Detecta conexao com nexus.libernet.app no relay pool
- Registra como peer automaticamente
- Cacheia eventos, serve via P2P
- Badge no canto inferior direito

---

## Metricas

Dashboard: `https://nexus.libernet.app/dashboard.html`

API JSON: `https://nexus.libernet.app/stats`

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

Testado com 60 peers simultaneos:

| Operacao | Tempo |
|----------|-------|
| Conectar 60 peers | 46ms |
| Registrar 60 peers | 19ms |
| Cachear 300 eventos | 503ms |
| 59 cross-peer requests | 6ms |
| 20 signal relays | 2ms |
| Transfer P2P (WebRTC) | **4ms** |

RAM: ~45MB (servidor), ~11MB (producao compilado)

---

## Licenca

MIT - LiberNet 2026

Desenvolvido por Barak (Luciano) + Claude
