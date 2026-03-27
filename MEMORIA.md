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

**Fase:** 0 - COMPLETA | Proxima: Fase 1 - Signaling Server
**Progresso:** Fase 0 concluida e validada por Barak
**Plano Fase 1:** FASE1_PLANO_EXECUCAO.md (10 etapas, ~3h, pronto para executar)

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

- Backend: Node.js/TypeScript (porta 8888)
- Cliente: TypeScript + simple-peer (WebRTC)
- Cache peers: Redis (container existente)
- Cache eventos servidor: tmpfs 8GB ramdisk
- Cache eventos cliente: IndexedDB (TTL 24h)
- Protocolo P2P: WebRTC Data Channel confiavel
- Relacao strfry: Hibrido (Nexus separado, consulta strfry internamente)
- Monetizacao: Pre-requisito 1 mes Super Peer, depois desbloqueia recompensas em sats

---

## BUGS E SOLUCOES

(Nenhum ainda - projeto em planejamento)
