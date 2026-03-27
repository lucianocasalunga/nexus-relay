# PLANO DE IMPLEMENTACAO - NEXUS RELAY

> NIP-95: Hybrid Peer-to-Peer Relay Protocol
> Versao: 1.0
> Data: 27/Mar/2026
> Autores: Barak + Claude

---

## REGRA DE OURO

**NAO AVANCAR PARA A PROXIMA FASE SEM COMPLETAR E VALIDAR A ATUAL.**
**CADA FASE TERMINA COM VALIDACAO DO BARAK.**

---

## VISAO GERAL DAS FASES

| Fase | Nome | Objetivo | Entregavel |
|------|------|----------|------------|
| 0 | Arquitetura | Desenhar tudo no papel | Documento de arquitetura |
| 1 | Signaling Server | Servidor de sinalizacao WebRTC | Servidor funcional |
| 2 | Proof of Concept | 2 clientes trocando 1 evento P2P | Demo funcional |
| 3 | Protocolo NIP-95 | Implementar mensagens PEER_* | Relay com NIP-95 |
| 4 | Cache e Super Peers | Sistema de cache e classificacao | Peers funcionando |
| 5 | Biblioteca Cliente | nostr-p2p.js | NPM package |
| 6 | Integracao | Integrar com LiberMedia e clientes | Producao |
| 7 | Testes e Lancamento | Carga, estabilidade, documentacao | Release 1.0 |

---

## FASE 0: ARQUITETURA E DESIGN
**Status:** [x] COMPLETA - Validada por Barak em 27/Mar/2026
**Objetivo:** Definir TODAS as decisoes tecnicas antes de escrever codigo

### 0.1 Decisoes de Stack

- [x] **Linguagem do Signaling Server:** Node.js/TypeScript
  - Node v24 ja instalado, mesmo ecossistema do cliente, dev rapido

- [x] **Biblioteca WebRTC (servidor):** Apenas signaling puro (WebSocket)
  - Servidor NAO precisa de WebRTC, so troca sinais ICE entre peers

- [x] **Biblioteca WebRTC (cliente):** `simple-peer`
  - Leve, popular (7k stars), abstrai complexidade do WebRTC nativo

- [x] **Cache de Peers:** Redis (ja rodando: container libernet_redis_1)
  - Zero setup novo, rapido, pub/sub disponivel

- [x] **Relacao com strfry:** HIBRIDO (Opcao C)
  - relay.libernet.app → strfry:7777 (relay classico, intocado)
  - nexus.libernet.app → nexus:8888 (overlay P2P)
  - Nexus consulta strfry internamente quando nenhum peer tem o evento
  - Clientes sem NIP-95 usam Nexus como relay normal (transparente)
  - Clientes com NIP-95 ganham P2P automaticamente
  - Se Nexus cair, relay classico continua funcionando

- [x] **Cache do cliente (browser):** IndexedDB
  - Persistente, sem limite de 5MB, TTL 24h

- [x] **Cache do servidor (RAM):** tmpfs 8GB
  - Montado em /mnt/projetos/nexus-relay/ramdisk
  - Persistente no boot (/etc/fstab)
  - Velocidade de RAM para cache de peers e eventos hot

- [x] **Protocolo P2P:** WebRTC Data Channel CONFIAVEL (ordered, reliable)
  - Eventos Nostr sao JSON assinados com Schnorr - perder 1 byte invalida tudo
  - Confiavel garante integridade, essencial para validacao de assinatura

### 0.2 Arquitetura de Componentes

Precisamos desenhar:

- [x] **Diagrama de componentes:** Nexus:8888, strfry:7777, Redis:6379, Ramdisk 8GB
- [x] **Diagrama de fluxo:** 4 cenarios (publicar, buscar recente, buscar antigo, sem NIP-95)
- [x] **Diagrama de estados:** 6 estados (desconhecido, casual, super, demovido, banido, desconectado)
- [x] **Formato das mensagens:** 14 tipos (11 WebSocket + 3 WebRTC)
- [x] **Modelo de dados:** 9 chaves Redis (~2MB/100 peers, ~200MB/10k peers)

### 0.3 Seguranca

- [x] **Validacao de eventos P2P:** Cliente valida Schnorr antes de aceitar
- [x] **Sistema de reputacao:** 0-100 pontos, demove <30, bane <0
- [x] **Rate limiting P2P:** Max 10 peers por Super Peer, ban progressivo 1h/24h/7d
- [x] **Privacidade:** P2P direto (fase 1), blind mode (futuro se necessario)
- [x] **Opt-in:** PEER_REGISTER explicito, sem registro = relay normal

### 0.4 Entregavel

- [x] Arquitetura completa em ARQUITETURA.md
- [x] Diagramas: componentes, fluxo (4), estados (6), mensagens (14), Redis (9)
- [x] Todas as decisoes tomadas e justificadas
- [x] **VALIDADO POR BARAK em 27/Mar/2026**

---

## FASE 1: SIGNALING SERVER
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 0 completa e validada

### 1.1 Objetivo
Criar o servidor que coordena a descoberta de peers via WebSocket.
NAO implementa WebRTC - apenas troca sinais (ICE candidates, SDP offers/answers).

### 1.2 Tarefas

- [ ] Setup do projeto (package.json, tsconfig, estrutura de pastas)
- [ ] WebSocket server basico (recebe conexoes)
- [ ] Registro de peers (PEER_REGISTER)
- [ ] Classificacao de peers (Super vs Casual)
- [ ] Troca de sinais ICE entre peers
- [ ] Health check de peers (heartbeat)
- [ ] Testes unitarios

### 1.3 Entregavel

- [ ] Signaling Server rodando em porta dedicada
- [ ] Testes passando
- [ ] Log de peers conectados/desconectados
- [ ] **VALIDACAO DO BARAK**

---

## FASE 2: PROOF OF CONCEPT
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 1 completa e validada

### 2.1 Objetivo
Dois clientes web trocando UM evento Nostr via WebRTC, coordenados pelo Signaling Server.

### 2.2 Tarefas

- [ ] Pagina HTML de teste (cliente A e cliente B)
- [ ] Cliente A: Conecta ao signaling, vira Super Peer
- [ ] Cliente A: Cacheia 1 evento Nostr
- [ ] Cliente B: Conecta ao signaling, solicita evento
- [ ] Signaling: Oferece Super Peer A para Cliente B
- [ ] A ↔ B: Estabelecem WebRTC Data Channel
- [ ] A → B: Envia evento via P2P
- [ ] B: Valida assinatura Schnorr do evento
- [ ] Medir latencia P2P vs WebSocket

### 2.3 Entregavel

- [ ] Demo funcional: 2 abas do navegador trocando evento P2P
- [ ] Comparativo de latencia (P2P vs relay direto)
- [ ] **VALIDACAO DO BARAK**

---

## FASE 3: PROTOCOLO NIP-95 NO RELAY
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 2 completa e validada

### 3.1 Objetivo
Integrar o Signaling Server com o strfry para que o relay suporte mensagens PEER_*.

### 3.2 Tarefas

- [ ] Definir como Signaling Server se comunica com strfry
- [ ] Implementar interceptacao de mensagens PEER_*
- [ ] PEER_REGISTER: Registrar peer com capacidades
- [ ] PEER_REQUEST: Buscar eventos com preferencia P2P
- [ ] PEER_OFFER: Responder com lista de peers
- [ ] PEER_PROMOTED / PEER_DEMOTED: Gerenciar status
- [ ] PEER_STATS: Receber estatisticas
- [ ] Fallback automatico para WebSocket se P2P falhar
- [ ] NIP-11: Anunciar suporte a NIP-95
- [ ] Testes de integracao

### 3.3 Entregavel

- [ ] Relay com suporte NIP-95 funcional
- [ ] Fallback WebSocket funcionando
- [ ] NIP-11 atualizado
- [ ] **VALIDACAO DO BARAK**

---

## FASE 4: CACHE E SUPER PEERS
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 3 completa e validada

### 4.1 Objetivo
Sistema completo de cache local e gerenciamento de Super Peers.

### 4.2 Tarefas

- [ ] IndexedDB: Armazenar eventos (TTL 24h)
- [ ] Logica de promocao/democao automatica
- [ ] Heartbeat e deteccao de peers mortos
- [ ] Redistribuicao quando Super Peer desconecta
- [ ] Metricas: eventos servidos via P2P vs relay
- [ ] Limite de peers por Super Peer (max 10)
- [ ] Compressao de eventos para P2P

### 4.3 Entregavel

- [ ] Sistema de cache funcional
- [ ] Super Peers promovidos/demovidos automaticamente
- [ ] Dashboard de metricas (simples)
- [ ] **VALIDACAO DO BARAK**

---

## FASE 5: BIBLIOTECA CLIENTE (nostr-p2p.js)
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 4 completa e validada

### 5.1 Objetivo
Biblioteca JavaScript/TypeScript que qualquer cliente Nostr pode usar para suportar NIP-95.

### 5.2 Tarefas

- [ ] API publica limpa e documentada
- [ ] Compativel com nostr-tools
- [ ] Gerenciamento automatico de conexoes P2P
- [ ] Fallback transparente (P2P → WebSocket)
- [ ] Eventos: onPeerConnected, onPeerDisconnected, onP2PEvent
- [ ] Build: ESM + CJS + browser bundle
- [ ] README com exemplos
- [ ] Publicar no npm

### 5.3 Entregavel

- [ ] Pacote npm publicado
- [ ] Documentacao completa
- [ ] Exemplo de integracao
- [ ] **VALIDACAO DO BARAK**

---

## FASE 6: INTEGRACAO
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 5 completa e validada

### 6.1 Objetivo
Integrar NIP-95 com clientes reais.

### 6.2 Tarefas

- [ ] Integrar com LiberMedia v2 (nosso cliente web)
- [ ] UI: Indicador "Conectado via P2P"
- [ ] UI: Toggle opt-in/opt-out
- [ ] Testar com Amethyst (se possivel)
- [ ] Documentar API para desenvolvedores externos
- [ ] Deploy em nexus.libernet.app

### 6.3 Entregavel

- [ ] LiberMedia com suporte P2P
- [ ] nexus.libernet.app em producao
- [ ] **VALIDACAO DO BARAK**

---

## FASE 7: TESTES E LANCAMENTO
**Status:** [ ] Nao iniciada
**Pre-requisito:** Fase 6 completa e validada

### 7.1 Objetivo
Garantir estabilidade e lancar oficialmente.

### 7.2 Tarefas

- [ ] Teste de carga (50+ peers simultaneos)
- [ ] Teste de resiliencia (derrubar relay, peers continuam)
- [ ] Teste de mobilidade (peer desconecta/reconecta)
- [ ] Monitorar nostr.watch (score de descentralizacao)
- [ ] Atualizar NIP-95 PR com base no feedback
- [ ] Criar release no GitHub
- [ ] Anunciar na comunidade Nostr

### 7.3 Entregavel

- [ ] Nexus Relay v1.0 estavel
- [ ] NIP-95 finalizada
- [ ] Documentacao publica
- [ ] **VALIDACAO DO BARAK**

---

## CRONOGRAMA ESTIMADO

| Fase | Duracao Estimada | Inicio | Fim |
|------|-----------------|--------|-----|
| 0 - Arquitetura | 1 semana | 27/Mar | 03/Abr |
| 1 - Signaling | 2 semanas | 03/Abr | 17/Abr |
| 2 - PoC | 1-2 semanas | 17/Abr | 01/Mai |
| 3 - Protocolo | 2-3 semanas | 01/Mai | 22/Mai |
| 4 - Cache/Peers | 2-3 semanas | 22/Mai | 12/Jun |
| 5 - Biblioteca | 3-4 semanas | 12/Jun | 10/Jul |
| 6 - Integracao | 2-3 semanas | 10/Jul | 31/Jul |
| 7 - Lancamento | 2 semanas | 31/Jul | 14/Ago |

**Total estimado:** ~20 semanas (~5 meses)
**Meta de lancamento:** Agosto 2026

---

## REGRAS DO PROJETO

1. **Fase a fase:** Nao pular. Nao atropelar.
2. **Validacao:** Cada fase termina com OK do Barak.
3. **Documentacao:** Atualizar MEMORIA.md ao final de cada sessao.
4. **Commits:** Frequentes e descritivos.
5. **Testes:** Antes de avancar fase, testes da fase anterior passando.
6. **Database em /mnt/storage:** Clausula petrea dos 3 HDs.
7. **Plano vivo:** Este documento sera atualizado conforme decisoes forem tomadas.
