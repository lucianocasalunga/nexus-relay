# MEMORIA DO PROJETO NEXUS RELAY

> Relay Nostr Hibrido P2P - NIP-95
> Criado: 27 de Marco de 2026
> Ultima atualizacao: 27/Mar/2026

---

## IDENTIDADE DO PROJETO

**Nome:** Nexus Relay
**Dominio:** nexus.libernet.app
**NIP:** 95 (Hybrid Peer-to-Peer Relay Protocol)
**PR oficial:** https://github.com/nostr-protocol/nips/pull/2293
**Repo NIP:** https://github.com/lucianocasalunga/nips (branch: nip-95-p2p-relay)
**Codigo:** /mnt/projetos/nexus-relay/
**Inspiracao:** Spotify P2P (clientes compartilham conteudo em cache)

---

## CONCEITO

Relay Nostr hibrido onde clientes ajudam a distribuir eventos entre si via WebRTC.
Tres camadas: Seed Node (relay central) + Super Peers (clientes estaveis) + Casual Peers (clientes moveis).

**Problema que resolve:**
- Relays Nostr sao 100% cliente-servidor (ponto unico de falha)
- Se o relay cai, todos perdem acesso (como na queda de energia de 27/Mar)
- Alta carga em relays populares
- Descentralizacao baixa no nostr.watch

**Solucao:**
- Peers cacheiam eventos recentes (<24h) e compartilham via P2P
- Se o relay cai, peers continuam trocando eventos entre si
- Reducao de 30-50% na carga do relay
- Aumento real de descentralizacao

---

## INFRAESTRUTURA RESERVADA

- DNS: nexus.libernet.app → CNAME tunnel (Cloudflare, proxied)
- Tunnel: relay-libernet-app (114c9613-ede3-4f67-b34b-372c3c8781ce)
- Projeto: /mnt/projetos/nexus-relay/
- Database: /mnt/storage/databases/nexus/ (A CRIAR - clausula petrea)
- NIP-95 PR: nostr-protocol/nips#2293

---

## STATUS ATUAL

**Fase:** 6 - COMPLETA | Proxima: Fase 7 - Testes e Lancamento
**Progresso:** Fase 6 Integracao LiberMedia + Deploy producao (28/Mar/2026)
**Porta:** 8889 (8888 ocupada pelo relay-moderation-api)

---

## REGISTRO DE SESSOES

### 2026-03-27 - Criacao do Projeto

**Realizacoes:**
- Nome definido: Nexus Relay (sugestao da esposa do Barak)
- NIP-95 escrita e PR aberto (nostr-protocol/nips#2293)
- DNS nexus.libernet.app criado (CNAME tunnel proxied)
- Ramdisk 8GB montada (/mnt/projetos/nexus-relay/ramdisk, persistente no fstab)
- Fase 0 COMPLETA: stack, arquitetura, fluxos, estados, mensagens, Redis, seguranca
- Modelo de monetizacao desenhado (1 mes Super Peer para desbloquear)
- Documentos criados: PLANO.md, ARQUITETURA.md, MONETIZACAO.md, MEMORIA.md

**Contexto:**
- Ideia surgiu apos queda de energia derrubar o relay
- Se tivessemos P2P, os peers manteriam a rede viva
- IP direto nao funcionou (bom local, ruim global)
- Voltamos para Cloudflare Tunnel otimizado

---

## DECISOES TECNICAS (Fase 0 - 27/Mar/2026)

- Backend: Node.js/TypeScript (porta 8889, mudou de 8888 que esta ocupada pelo relay-moderation-api)
- Cliente: TypeScript + simple-peer (WebRTC)
- Cache peers: Redis (container existente)
- Cache eventos servidor: tmpfs 8GB ramdisk
- Cache eventos cliente: IndexedDB (TTL 24h)
- Protocolo P2P: WebRTC Data Channel confiavel
- Relacao strfry: Hibrido (Nexus separado, consulta strfry internamente)
- Monetizacao: Pre-requisito 1 mes Super Peer, depois desbloqueia recompensas em sats

---

### 2026-03-28 - Fase 1 Implementada

**Realizacoes:**
- Setup completo: Node.js + TypeScript + dotenv + ws + redis + nostr-tools
- 10 arquivos TypeScript criados em src/ (zero erros de compilacao)
- WebSocket server na porta 8889
- Router: PEER_* → signaling handler, REQ/EVENT → proxy strfry
- Proxy bidirecional Nexus ↔ strfry:7777 (transparente)
- Peer Manager: registro, heartbeat, cleanup no Redis
- Signaling: PEER_REGISTER, PEER_HEARTBEAT com respostas
- Redis: chaves prefixadas com nexus: (peer:{id}, peers:all, peers:casual)
- Testes manuais: proxy OK, register OK, heartbeat OK, cleanup OK, modo hibrido OK

**Problema encontrado:**
- Porta 8888 ocupada pelo container relay-moderation-api
- Solucao: mudou para porta 8889

**Testes realizados:**
1. REQ via Nexus → recebeu 3 eventos do strfry (proxy OK)
2. PEER_REGISTER → recebeu PEER_REGISTERED com peer_id
3. PEER_HEARTBEAT → recebeu PEER_HEARTBEAT_ACK
4. Redis keys nexus:* aparecem enquanto peer conectado
5. Apos desconexao, keys removidas automaticamente
6. Modo hibrido: PEER_REGISTER + REQ no mesmo cliente (OK)

---

### 2026-03-28 - Fase 2 COMPLETA: WebRTC P2P PoC

**Realizacoes:**
- Signaling expandido: PEER_SIGNAL, PEER_REQUEST, PEER_OFFER, PEER_CACHE_HAVE
- Cache tracker in-memory: rastreia quais peers tem quais eventos (bidirecional)
- Relay de sinais ICE/SDP entre peers via Nexus (bidirecional, offer+answer+candidates)
- HTTP server integrado ao WebSocket para servir pagina de teste
- Pagina HTML de teste com simple-peer (WebRTC) + nostr-tools (Schnorr)
- Tunnel Cloudflare configurado: nexus.libernet.app → localhost:8889
- Teste automatizado: 23/23 testes passando (signaling flow completo)
- Teste real no browser: 2 abas trocando evento Nostr via WebRTC P2P

**Resultados do PoC:**
- Evento transferido via P2P: SIM
- Assinatura Schnorr validada: SIM
- Tempo de signaling (ICE/SDP): 323ms
- Tempo de transfer P2P: 4ms
- Evento ID: ad8ded228f4f83569960e42a1ff36ef0c2bb51df81507e53cb30a56e643f2391

**Arquivos criados/modificados:**
- src/signaling/messages.ts — novos tipos de mensagem
- src/signaling/handler.ts — handlers para SIGNAL, REQUEST, CACHE_HAVE
- src/peers/cache-tracker.ts — tracker de cache de eventos por peer (NOVO)
- src/peers/manager.ts — cleanup do cache-tracker no disconnect
- src/server.ts — HTTP server integrado para servir pagina de teste
- public/test.html — pagina de teste WebRTC P2P (NOVO)
- tests/test-signaling-flow.ts — teste automatizado 23 asserts (NOVO)

**Testes realizados:**
1. HTTP serve pagina de teste (200) via tunnel
2. WebSocket proxy para strfry funciona via tunnel
3. PEER_REGISTER funciona via tunnel
4. PEER_CACHE_HAVE registra eventos no tracker
5. PEER_REQUEST → PEER_OFFER com peers corretos (exclui requester)
6. PEER_SIGNAL relay bidirecional (offer → A, answer → B, candidates)
7. Evento inexistente → fallback strfry
8. Heartbeat ao lado de P2P
9. Proxy strfry funciona ao lado de P2P (modo hibrido)
10. WebRTC P2P real no browser: 2 abas, evento transferido, Schnorr validado

---

### 2026-03-28 - Fase 3 COMPLETA: Protocolo NIP-95 no Relay

**Realizacoes:**
- Classificador de peers: reputacao 0-100, promocao/democao automatica no heartbeat
- PEER_STATS: peers reportam eventos servidos, ganham reputacao (+1 por report, +2 a cada 5 eventos)
- PEER_PROMOTED/PEER_DEMOTED: mensagens de notificacao de mudanca de status
- Smart Routing: REQ de peers registrados recebe PEER_OFFER aditivo (P2P + strfry simultaneo)
- Broadcast: subscription interna no strfry, notifica Super Peers de novos eventos (PEER_EVENT_NEW)
- NIP-11: endpoint retorna relay info com NIP-95, p2p_enabled, versao 0.3.0
- Tunnel Cloudflare: nexus.libernet.app configurado e testado (HTTP + WS + NIP-11)
- Testes: 48/48 passando (23 Fase 2 + 25 Fase 3), zero regressao

**Criterios Super Peer:**
- Online >30min, bandwidth >5Mbps, storage >100MB, reputacao >=50, cache >=1 evento
- Democao: reputacao <30

**Arquivos criados/modificados:**
- src/peers/classifier.ts — classificador com reputacao e promocao/democao (NOVO)
- src/broadcast.ts — subscription strfry + broadcast para Super Peers (NOVO)
- src/router.ts — smart routing: REQ com P2P first para peers registrados
- src/signaling/handler.ts — PEER_STATS, classificacao no heartbeat
- src/signaling/messages.ts — PEER_PROMOTED, PEER_DEMOTED, PEER_STATS, PEER_EVENT_NEW
- src/redis/client.ts — setPeerStatus()
- src/peers/manager.ts — initReputation, cleanupPeerClassifier
- src/server.ts — NIP-11 endpoint (Accept: application/nostr+json)
- src/index.ts — v0.3.0, broadcast listener integrado
- tests/test-fase3.ts — 25 asserts (NOVO)

---

### 2026-03-28 - Fase 4 COMPLETA: Cache e Super Peers

**Realizacoes:**
- Tracker de conexoes P2P: limite 10 peers por Super Peer, load tracking
- PEER_OFFER filtra Super Peers lotados automaticamente
- Redistribuicao: quando Super Peer desconecta, orphans recebem PEER_RECONNECT
- Endpoint /stats com metricas completas (server, peers, p2p, cache, conexoes, classificacao)
- Dashboard HTML em /dashboard.html com auto-refresh 3s
- Cliente completo em /client.html com IndexedDB cache (TTL 24h), auto-announce, heartbeat, PEER_RECONNECT handling
- Metricas refletem peers conectados, cache, e limpam no disconnect
- Testes: 74 totais (23 F2 + 25 F3 + 26 F4), zero falhas

**Arquivos criados/modificados:**
- src/peers/connections.ts — tracker de conexoes P2P com limites (NOVO)
- src/metrics.ts — metricas centralizadas (NOVO)
- src/server.ts — endpoint /stats, import metrics
- src/signaling/handler.ts — PEER_OFFER filtra Super Peers lotados
- src/signaling/messages.ts — PEER_RECONNECT
- src/peers/manager.ts — redistribuicao orphans no disconnect
- public/dashboard.html — dashboard de metricas (NOVO)
- public/client.html — cliente P2P completo com IndexedDB (NOVO)
- tests/test-fase4.ts — 26 asserts (NOVO)

---

### 2026-03-28 - Fase 5 COMPLETA: Biblioteca nostr-p2p.js

**Realizacoes:**
- Biblioteca standalone em lib/ com API limpa e documentada
- NexusClient class: connect, subscribe, publish, requestP2P, eventos
- P2PManager: gerencia WebRTC automaticamente (initiator/responder)
- EventCache: IndexedDB com TTL 24h, cleanup, announce automatico
- NexusEventEmitter: sistema de eventos tipado
- Build dual: ESM (dist/esm/) + CJS (dist/cjs/) com types/declarations
- README completo com API docs, exemplos, tabelas de eventos/opcoes
- CJS import testado e funcionando no Node.js
- Compativel com nostr-tools
- Pronto para npm publish

**API publica:**
- `new NexusClient({ url, bandwidth, storage, publicKey, p2p })`
- `.connect()`, `.disconnect()`, `.subscribe()`, `.publish()`, `.requestP2P()`
- `.on('relayEvent' | 'p2pEvent' | 'promoted' | 'reconnect' | ...)`
- `.status`, `.id`, `.p2pStats`, `.eventCache`

**Arquivos criados:**
- lib/package.json — pacote npm nostr-p2p
- lib/tsconfig.esm.json — config ESM
- lib/tsconfig.cjs.json — config CJS
- lib/src/index.ts — exports
- lib/src/client.ts — NexusClient class principal
- lib/src/p2p.ts — P2PManager (WebRTC)
- lib/src/cache.ts — EventCache (IndexedDB)
- lib/src/types.ts — tipos e NexusEventEmitter
- lib/README.md — documentacao completa

---

### 2026-03-28 - Fase 6 COMPLETA: Integracao LiberMedia + Deploy

**Realizacoes:**
- nexus.libernet.app adicionado como relay no LiberMedia v2 (feed-v2.js)
- Modulo nexus-p2p.js criado: integra P2P transparente no feed existente
  - Auto-registra como peer, cacheia eventos em IndexedDB
  - Serve eventos via WebRTC, injeta P2P events no pipeline do feed
  - Badge flutuante (canto inferior direito): mostra status P2P
  - Toggle on/off com persistencia em localStorage
  - Carrega SimplePeer automaticamente via CDN
  - Intercepta handleRelayMessage para cachear eventos do Nexus
- Script incluido no template feed.html
- Nexus Relay deployado como servico systemd (nexus-relay.service)
  - Compilado para JS (dist/), roda com Node.js direto
  - Auto-restart on failure, enabled on boot
  - Rodando em producao na porta 8889
- Tunnel Cloudflare configurado e testado (HTTP, WS, NIP-11, /stats)
- LiberMedia v2 reiniciado com integracao P2P ativa

**Arquivos criados/modificados:**
- /mnt/projetos/libermedia-v2/static/js/nexus-p2p.js — modulo integracao P2P (NOVO)
- /mnt/projetos/libermedia-v2/static/js/feed-v2.js — nexus relay adicionado
- /mnt/projetos/libermedia-v2/templates/feed.html — script nexus-p2p incluido
- /etc/systemd/system/nexus-relay.service — servico systemd (NOVO)

**Deploy:**
- Nexus: systemd service, porta 8889, auto-restart
- Tunnel: nexus.libernet.app → localhost:8889 (Cloudflare Zero Trust)
- LiberMedia: feed.html carrega nexus-p2p.js, conecta ao Nexus como relay

---

## BUGS E SOLUCOES

(Nenhum - Fases 1-6 limpas)
