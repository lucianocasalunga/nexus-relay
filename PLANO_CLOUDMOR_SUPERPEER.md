# PLANO: Cloudmor como Super Peer Permanente

> Data: 29/Mar/2026
> Status: APROVADO - Aguardando implementacao
> Prioridade: Alta
> Estimativa: 1 sessao

---

## OBJETIVO

Transformar o servidor cloudmor (fabrica) em um **Super Peer permanente** do Nexus Relay,
funcionando como repetidor P2P 24/7. Primeiro peer "real" da rede.

---

## POR QUE

- O P2P do Nexus tem 0 eventos trocados (nenhum peer fica online tempo suficiente)
- Cloudmor esta ocioso (so faz backup)
- Se libernet cair, cloudmor mantem os eventos cacheados
- Quando libernet voltar, cloudmor sincroniza de volta
- Prova de conceito real do NIP-95 funcionando

---

## ARQUITETURA

```
                    Internet (Cloudflare)
                          |
                   nexus.libernet.app
                          |
                    [Nexus Relay]
                     /    |    \
                    /     |     \
          [Cloudmor]  [Browser]  [Browser]
          Super Peer   Casual     Casual
          (24/7)       (temp)     (temp)
              |
         Cache 24h
         eventos
```

Cloudmor conecta via Tailscale ou Cloudflare Tunnel (outbound - Fortigate nao bloqueia).

---

## COMPONENTE: nexus-peer-node

**Tipo:** Cliente headless Node.js
**Local no cloudmor:** /opt/nexus-peer/
**Servico:** systemd (nexus-peer.service)

### O que faz:
1. Conecta ao Nexus via WebSocket (wss://nexus.libernet.app)
2. Envia PEER_REGISTER com capabilities altas (server, nao browser)
3. Envia PEER_HEARTBEAT a cada 30s
4. Escuta eventos novos (PEER_EVENT_NEW) e cacheia localmente
5. Responde PEER_CACHE_HAVE com lista de eventos que tem
6. Serve eventos via WebRTC Data Channel quando solicitado
7. Reconecta automaticamente se cair

### O que NAO faz:
- NAO e um relay (nao aceita REQ/EVENT de clientes)
- NAO armazena permanentemente (cache expira em 24h)
- NAO precisa de strfry ou Redis

---

## ESTRUTURA DE ARQUIVOS

```
/opt/nexus-peer/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Entry point + reconnect loop
│   ├── connection.ts     # WebSocket para nexus.libernet.app
│   ├── peer-protocol.ts  # REGISTER, HEARTBEAT, CACHE_HAVE, etc
│   ├── cache.ts          # Cache de eventos em memoria (Map, TTL 24h)
│   ├── webrtc.ts         # Responder P2P requests via WebRTC
│   └── config.ts         # URL do relay, capabilities, intervalos
└── dist/                 # Compilado
```

---

## PROTOCOLO (fluxo detalhado)

### 1. Conexao inicial
```
cloudmor → wss://nexus.libernet.app (WebSocket)
cloudmor → ["PEER_REGISTER", { bandwidth: 100, storage: 5000, publicKey: "...", nodeType: "server" }]
nexus    ← ["PEER_REGISTERED", { peer_id: "xxx", status: "registered", heartbeat_interval: 30000 }]
```

### 2. Heartbeat (a cada 30s)
```
cloudmor → ["PEER_HEARTBEAT"]
nexus    ← ["PEER_HEARTBEAT_ACK", { peer_id: "xxx", ts: 123456 }]
```

### 3. Receber eventos novos (Nexus broadcast)
```
nexus    → ["PEER_EVENT_NEW", { event: {...nostr event...} }]
cloudmor: armazena em cache local (Map com TTL 24h)
cloudmor → ["PEER_CACHE_HAVE", { event_ids: ["abc123", "def456"] }]
```

### 4. Promocao automatica (apos ~30min)
```
nexus    → ["PEER_PROMOTED", { peer_id: "xxx", reason: "meets all criteria", max_connections: 10 }]
```

### 5. Servir eventos via P2P (WebRTC)
```
outro_peer → PEER_SIGNAL (via Nexus signaling)
cloudmor  ↔ WebRTC Data Channel estabelecido
outro_peer → P2P_REQUEST { event_ids: [...] }
cloudmor  → P2P_EVENTS { events: [...] }
```

### 6. Reconexao automatica
```
Se WebSocket desconecta:
  - Espera 5s
  - Reconecta
  - Re-registra (PEER_REGISTER)
  - Re-anuncia cache (PEER_CACHE_HAVE)
  - Backoff exponencial: 5s, 10s, 20s, 40s, max 60s
```

---

## DEPENDENCIAS NO CLOUDMOR

```bash
# Node.js (verificar se tem, senao instalar)
node --version  # precisa v18+

# Pacotes npm
ws              # WebSocket client
wrtc            # WebRTC nativo para Node.js (nao precisa browser)
```

**IMPORTANTE:** O pacote `wrtc` permite WebRTC em Node.js sem browser.
Alternativa se `wrtc` der problema: `node-datachannel` (mais leve, pure C++).

---

## MUDANCAS NO NEXUS (servidor)

### 1. Reconhecer "server peers" vs "browser peers"
No PEER_REGISTER, aceitar campo `nodeType: "server"`:
- Servers ganham capabilities boosted (nao dependem de self-report)
- Servers podem ter mais conexoes (max_connections: 50 em vez de 10)

### 2. Broadcast de eventos novos para peers registrados
Atualmente o Nexus NAO envia PEER_EVENT_NEW quando recebe um evento.
Precisamos adicionar: quando strfry aceita um evento, broadcast para todos os peers registrados.

**Arquivo:** `src/proxy.ts` ou novo `src/broadcast.ts`
```typescript
// Quando evento chega via proxy e strfry aceita:
broadcastToPeers(["PEER_EVENT_NEW", { event: nostrEvent }]);
```

### 3. Landing page com stats do Super Peer
Mostrar na pagina do nexus.libernet.app:
- "1 Super Peer ativo (cloudmor)"
- Eventos cacheados
- Uptime do peer

---

## CONFIGURACAO SYSTEMD (cloudmor)

```ini
[Unit]
Description=Nexus P2P Super Peer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cloudadmin
WorkingDirectory=/opt/nexus-peer
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NEXUS_URL=wss://nexus.libernet.app
Environment=PEER_BANDWIDTH=100
Environment=PEER_STORAGE=5000
Environment=NODE_TYPE=server

[Install]
WantedBy=multi-user.target
```

---

## FASES DE IMPLEMENTACAO

### Fase 1 - Cliente headless basico (cloudmor)
- [ ] Verificar Node.js no cloudmor
- [ ] Criar projeto /opt/nexus-peer/
- [ ] Implementar connection.ts (WebSocket + reconnect)
- [ ] Implementar peer-protocol.ts (REGISTER, HEARTBEAT)
- [ ] Implementar cache.ts (Map com TTL)
- [ ] Testar conexao cloudmor → nexus
- [ ] Verificar que Nexus registra e promove

### Fase 2 - Broadcast no Nexus (servidor libernet)
- [ ] Adicionar broadcast de PEER_EVENT_NEW no proxy
- [ ] Cloudmor recebe eventos e cacheia
- [ ] Cloudmor anuncia cache (PEER_CACHE_HAVE)
- [ ] Verificar stats mostrando cache populado

### Fase 3 - WebRTC P2P (cloudmor serve eventos)
- [ ] Instalar wrtc ou node-datachannel
- [ ] Implementar webrtc.ts (responder signals, criar data channel)
- [ ] Servir eventos via P2P quando outro peer solicita
- [ ] Testar: browser pede evento → Nexus oferece cloudmor → P2P funciona

### Fase 4 - Producao e monitoring
- [ ] Criar systemd service no cloudmor
- [ ] Logs estruturados
- [ ] Atualizar landing page com stats do Super Peer
- [ ] Monitorar por 24h
- [ ] Documentar na MEMORIA.md do projeto

---

## RISCOS E MITIGACOES

| Risco | Mitigacao |
|-------|-----------|
| wrtc nao compila no cloudmor | Usar node-datachannel como alternativa |
| Fortigate bloqueia WebSocket | Usar Tailscale (100.106.162.45) como fallback |
| Cloudmor sem Node.js | Instalar via nvm ou apt |
| Muitos eventos sobrecarregam cache | Limite de 10.000 eventos, LRU eviction |
| WebRTC falha servidor-servidor | Fallback: servir via WebSocket relay (sem P2P direto) |

---

## RESULTADO ESPERADO

Apos implementacao:
- 1 Super Peer permanente (cloudmor) com cache de 24h
- Eventos do strfry replicados automaticamente para cloudmor
- Qualquer peer conectado pode receber eventos via P2P do cloudmor
- Se libernet cair, cloudmor ainda tem os eventos recentes
- Stats reais: events_via_p2p > 0, bytes_p2p > 0
- Prova de conceito funcional para o PR da NIP-95

---

**Autor:** Claude (sessao com Barak, 29/Mar/2026)
**Implementacao:** Prevista para 30/Mar/2026 (Barak na fabrica)
