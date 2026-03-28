# ARQUITETURA NEXUS RELAY - NIP-95

> Documento de referencia tecnica
> Aprovado: 27/Mar/2026
> Versao: 1.0

---

## STACK

| Componente | Tecnologia | Justificativa |
|------------|-----------|---------------|
| Signaling Server | Node.js/TypeScript | Mesmo ecossistema do cliente, Node v24 instalado |
| WebRTC (servidor) | Signaling puro (WebSocket) | Servidor so troca sinais, nao faz WebRTC |
| WebRTC (cliente) | simple-peer | Leve, popular, abstrai complexidade |
| Cache de peers | Redis (container existente) | Zero setup, rapido, pub/sub |
| Cache de eventos (servidor) | tmpfs 8GB ramdisk | Velocidade de RAM |
| Cache de eventos (cliente) | IndexedDB | Persistente, sem limite 5MB |
| Protocolo P2P | WebRTC Data Channel confiavel | Eventos Nostr precisam integridade total |
| Container | Docker | Padrao do servidor |

## ARQUITETURA HIBRIDA

```
relay.libernet.app → strfry:7777    (relay classico, INTOCADO)
nexus.libernet.app → nexus:8888     (overlay P2P)
                        │
                        └──→ strfry:7777 (consulta interna)
```

- Clientes sem NIP-95: usam Nexus como relay normal (transparente)
- Clientes com NIP-95: ganham P2P automaticamente
- Se Nexus cair, relay classico continua

## PORTAS

| Porta | Servico |
|-------|---------|
| 7777 | strfry (Nostr classico) |
| 8889 | Nexus (signaling + proxy) |
| 6379 | Redis (cache peers) |

## FLUXOS

1. **Publicar evento:** Cliente → Nexus → strfry (valida+armazena) → Nexus → Super Peers (cache)
2. **Buscar recente (<24h):** PEER_REQUEST → Nexus oferece peers → P2P via WebRTC → fallback strfry
3. **Buscar antigo (>24h):** REQ normal → Nexus repassa → strfry responde
4. **Cliente sem NIP-95:** REQ/EVENT normal → Nexus repassa → strfry (transparente)

## ESTADOS DO PEER

Desconhecido → Casual → Super Peer → Demovido → Banido

| Estado | Recebe P2P | Envia P2P | Transicao |
|--------|-----------|-----------|-----------|
| Desconhecido | Nao | Nao | → Casual (REGISTER) |
| Casual | Sim | Nao | → Super (criterios) |
| Super Peer | Sim | Sim (max 10) | → Demovido (problemas) |
| Demovido | Sim | Nao | → Casual (imediato) |
| Banido | Nao | Nao | → Casual (apos TTL) |

Criterios Super Peer: online >30min, bandwidth >5Mbps, storage >100MB, latencia <100ms, reputacao >=50

## MENSAGENS (14 tipos)

### Cliente → Nexus (WebSocket)
- PEER_REGISTER: registrar no P2P
- PEER_REQUEST: buscar eventos com preferencia P2P
- PEER_STATS: relatorio de estatisticas
- PEER_HEARTBEAT: keep-alive (30s)

### Nexus → Cliente (WebSocket)
- PEER_REGISTERED: confirmacao de registro
- PEER_OFFER: lista de peers com eventos
- PEER_PROMOTED: promovido a Super Peer
- PEER_DEMOTED: demovido
- PEER_BANNED: banido
- PEER_STATS_OK: confirmacao stats
- PEER_HEARTBEAT_ACK: confirmacao heartbeat

### Peer ↔ Peer (WebRTC Data Channel)
- P2P_EVENTS: enviar eventos
- P2P_REQUEST: pedir eventos
- P2P_HEARTBEAT: keep-alive P2P

## REDIS (9 chaves)

| Chave | Tipo | TTL | Uso |
|-------|------|-----|-----|
| peer:{id} | HASH | 120s | Info do peer |
| peers:super | SET | - | Lista Super Peers |
| peers:casual | SET | - | Lista Casual |
| peers:all | SET | - | Todos peers |
| peer:cache:{id} | SET | 24h | Eventos do peer |
| event:peers:{evt} | SET | 24h | Peers com evento |
| ban:{ip} | STRING | 1h-7d | IPs banidos |
| stats:global | HASH | - | Stats totais |
| stats:hourly:{h} | HASH | 7d | Stats por hora |

## SEGURANCA

- Validacao Schnorr obrigatoria em todo evento P2P
- Reputacao: 0-100, demove <30, bane <0
- Ban progressivo: 1h → 24h → 7d
- Opt-in explicito (PEER_REGISTER)
- Fallback WebSocket sempre disponivel

## INFRAESTRUTURA

- DNS: nexus.libernet.app → CNAME tunnel (proxied)
- Ramdisk: /mnt/projetos/nexus-relay/ramdisk (8GB tmpfs)
- Database: /mnt/storage/databases/nexus/ (clausula petrea)
- Codigo: /mnt/projetos/nexus-relay/
