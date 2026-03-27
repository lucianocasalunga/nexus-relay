# FASE 1: SIGNALING SERVER - PLANO DE EXECUCAO

> Pronto para executar na proxima sessao
> Preparado: 27/Mar/2026
> Pre-requisito: Fase 0 completa (validada)

---

## OBJETIVO

Criar o Nexus Server basico: WebSocket na porta 8888 que:
1. Recebe conexoes de clientes
2. Mensagens PEER_* → processa internamente
3. Mensagens REQ/EVENT → repassa para strfry:7777
4. Registra peers no Redis

Ao final da Fase 1, o Nexus FUNCIONA como relay normal
(proxy para strfry) E aceita registro de peers.

---

## ESTRUTURA DE PASTAS

```
/mnt/projetos/nexus-relay/
├── src/
│   ├── index.ts              # Entry point - inicia servidor
│   ├── server.ts             # WebSocket server (porta 8888)
│   ├── router.ts             # Roteia PEER_* vs REQ/EVENT
│   ├── proxy.ts              # Proxy WebSocket → strfry:7777
│   ├── signaling/
│   │   ├── handler.ts        # Processa mensagens PEER_*
│   │   └── messages.ts       # Tipos/interfaces das mensagens
│   ├── peers/
│   │   ├── manager.ts        # Gerencia peers (registro, heartbeat)
│   │   ├── classifier.ts     # Classifica casual/super
│   │   └── types.ts          # Interfaces Peer, PeerStatus, etc
│   ├── redis/
│   │   └── client.ts         # Conexao e helpers Redis
│   └── utils/
│       ├── logger.ts         # Logger formatado
│       └── config.ts         # Configuracoes (portas, limites)
├── tests/
│   ├── server.test.ts        # Testa conexao WebSocket
│   ├── router.test.ts        # Testa roteamento PEER_* vs REQ
│   ├── proxy.test.ts         # Testa proxy para strfry
│   └── peers.test.ts         # Testa registro de peers
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env
├── ARQUITETURA.md
├── MEMORIA.md
├── MONETIZACAO.md
├── PLANO.md
├── FASE1_PLANO_EXECUCAO.md   # Este arquivo
└── ramdisk/                   # 8GB tmpfs (cache)
```

---

## ORDEM DE EXECUCAO (passo a passo)

### ETAPA 1.1: Setup do projeto (15 min)

```bash
cd /mnt/projetos/nexus-relay
npm init -y
```

**Dependencias:**
```bash
npm install ws redis nostr-tools
npm install -D typescript @types/ws @types/node ts-node nodemon
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**package.json scripts:**
```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "ts-node tests/run.ts"
  }
}
```

**.env:**
```
NEXUS_PORT=8888
STRFRY_HOST=localhost
STRFRY_PORT=7777
REDIS_HOST=localhost
REDIS_PORT=6379
HEARTBEAT_INTERVAL=30000
PEER_TTL=120
LOG_LEVEL=info
```

**Validacao:** `npx tsc --noEmit` compila sem erros

---

### ETAPA 1.2: Config e Logger (10 min)

**src/utils/config.ts** - Le .env, exporta constantes tipadas
**src/utils/logger.ts** - Logger simples com timestamp e nivel

**Validacao:** `ts-node src/utils/config.ts` imprime config

---

### ETAPA 1.3: Redis Client (15 min)

**src/redis/client.ts** - Conecta no Redis existente (container libernet_redis_1)

Funcoes:
- connect() - conecta
- setPeer(peerId, data) - salva peer
- getPeer(peerId) - busca peer
- addToSet(set, member) - adiciona a set
- removeFromSet(set, member) - remove de set
- getSet(set) - lista membros

**Validacao:** Conecta no Redis, faz SET/GET, desconecta

---

### ETAPA 1.4: WebSocket Server (20 min)

**src/server.ts** - WebSocket server na porta 8888

Funcoes:
- Aceita conexoes WebSocket
- Atribui ID unico a cada conexao
- Log de connect/disconnect
- Encaminha mensagens para o Router

**Validacao:** `wscat -c ws://localhost:8888` conecta

---

### ETAPA 1.5: Router (20 min)

**src/router.ts** - Decide destino de cada mensagem

Logica:
```
mensagem[0] começa com "PEER_" → signaling handler
mensagem[0] é "REQ" ou "EVENT" ou "CLOSE" → proxy para strfry
qualquer outra → proxy para strfry (seguro)
```

**Validacao:** Enviar PEER_REGISTER → vai pro handler. Enviar REQ → vai pro proxy.

---

### ETAPA 1.6: Proxy para strfry (25 min)

**src/proxy.ts** - Proxy bidirecional WebSocket

Para cada cliente conectado no Nexus:
1. Abre conexao WebSocket com strfry:7777
2. Mensagem do cliente → repassa para strfry
3. Resposta do strfry → repassa para cliente
4. Cliente desconecta → fecha conexao com strfry

**Validacao:**
- Conectar no Nexus:8888
- Enviar REQ de eventos
- Receber eventos do strfry via Nexus
- Comparar com conexao direta ao strfry:7777 (mesmo resultado)

---

### ETAPA 1.7: Peer Manager (25 min)

**src/peers/manager.ts** - Registro e gerenciamento

Funcoes:
- registerPeer(ws, capabilities) → salva no Redis, retorna peer_id
- unregisterPeer(peerId) → remove do Redis
- handleHeartbeat(peerId) → atualiza TTL no Redis
- getPeerStatus(peerId) → retorna status atual

**src/peers/types.ts** - Interfaces TypeScript

**Validacao:** PEER_REGISTER → peer aparece no Redis → PEER_REGISTERED retorna

---

### ETAPA 1.8: Signaling Handler (20 min)

**src/signaling/handler.ts** - Processa mensagens PEER_*

Mensagens implementadas nesta fase:
- PEER_REGISTER → registra peer, responde PEER_REGISTERED
- PEER_HEARTBEAT → atualiza TTL, responde PEER_HEARTBEAT_ACK

Mensagens NAO implementadas nesta fase (futuro):
- PEER_REQUEST (Fase 2)
- PEER_STATS (Fase 4)

**Validacao:** Cliente envia PEER_REGISTER, recebe PEER_REGISTERED com peer_id

---

### ETAPA 1.9: Entry Point (10 min)

**src/index.ts** - Junta tudo

```typescript
// 1. Carrega config
// 2. Conecta Redis
// 3. Inicia WebSocket server
// 4. Log: "Nexus Relay v0.1.0 listening on port 8888"
```

**Validacao:** `npm run dev` inicia sem erros

---

### ETAPA 1.10: Testes (20 min)

**Teste 1:** Conectar via wscat, enviar REQ, receber eventos do strfry
**Teste 2:** Enviar PEER_REGISTER, receber PEER_REGISTERED
**Teste 3:** Enviar PEER_HEARTBEAT, receber ACK
**Teste 4:** Verificar peer no Redis (redis-cli)
**Teste 5:** Desconectar, verificar peer removido do Redis
**Teste 6:** Conectar via cliente Nostr real (ex: Primal) no Nexus:8888

---

## TEMPO ESTIMADO TOTAL

| Etapa | Tempo |
|-------|-------|
| 1.1 Setup | 15 min |
| 1.2 Config/Logger | 10 min |
| 1.3 Redis | 15 min |
| 1.4 WebSocket | 20 min |
| 1.5 Router | 20 min |
| 1.6 Proxy strfry | 25 min |
| 1.7 Peer Manager | 25 min |
| 1.8 Signaling | 20 min |
| 1.9 Entry Point | 10 min |
| 1.10 Testes | 20 min |
| **TOTAL** | **~3 horas** |

---

## CRITERIOS DE SUCESSO (Fase 1 completa quando)

- [ ] Nexus rodando na porta 8888
- [ ] Cliente Nostr normal (Primal) funciona via Nexus (proxy strfry)
- [ ] PEER_REGISTER funciona (peer salvo no Redis)
- [ ] PEER_HEARTBEAT funciona (TTL atualizado)
- [ ] Desconexao limpa (peer removido do Redis)
- [ ] Zero impacto no relay classico (relay.libernet.app intocado)
- [ ] **VALIDACAO DO BARAK**

---

## DEPENDENCIAS JA PRONTAS

- [x] Node.js v24 instalado
- [x] Redis rodando (container libernet_redis_1)
- [x] strfry rodando (porta 7777)
- [x] Ramdisk 8GB montada
- [x] DNS nexus.libernet.app configurado
- [x] Tunnel Cloudflare ativo

**Tudo pronto para codar. So precisa: `npm init` e comecar.**
