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

**Fase:** 1 - COMPLETA | Proxima: Fase 2 - WebRTC P2P
**Progresso:** Fase 1 implementada e testada (28/Mar/2026)
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

## BUGS E SOLUCOES

(Nenhum - Fase 1 limpa)
