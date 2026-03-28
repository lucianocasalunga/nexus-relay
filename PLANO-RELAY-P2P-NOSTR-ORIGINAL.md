# 🌐 PLANO DE PROJETO: RELAY P2P NOSTR

**Data de Criação:** 27 de Março de 2026
**Proposto por:** Barak + Claude
**Status:** 📋 Planejamento (aguardando discussão pós-almoço)

---

## 🎯 VISÃO GERAL

Criar um **relay Nostr híbrido peer-to-peer** inspirado no modelo P2P do Spotify, onde clientes ajudam a distribuir eventos entre si, reduzindo carga do relay central e aumentando descentralização.

**Inspiração:** Spotify P2P (clientes compartilham música em cache, reduzindo carga dos servidores)

---

## 💡 CONCEITO

### Problema Atual
- Relays Nostr são 100% centralizados (modelo cliente-servidor)
- Relay central processa TODAS as requisições
- Alta carga em relays populares
- Métrica de descentralização no nostr.watch é baixa para relays tradicionais

### Solução Proposta
**Relay Híbrido P2P:**
- Relay central continua existindo (Seed Node)
- Clientes conectados podem compartilhar eventos entre si via WebRTC
- Relay central orquestra conexões P2P e fornece eventos faltantes
- Clientes ajudam a distribuir eventos recentes (últimas 24h em cache)

**Analogia com Spotify:**
- Spotify P2P: Clientes compartilham músicas em cache
- Nostr P2P: Clientes compartilham eventos Nostr em cache

---

## 🏗️ ARQUITETURA TÉCNICA

### Três Camadas

#### 1️⃣ Relay Seed (Servidor Central)
**Responsabilidades:**
- Armazenar TODOS os eventos (database permanente)
- Fornecer eventos históricos (>24h)
- Orquestrar descoberta de peers (ICE/STUN/TURN)
- Validar assinaturas Nostr
- Executar write-policy.py (anti-spam)
- Gerenciar reputação de peers

**Tecnologias:**
- strfry (database de eventos)
- WebSocket (protocolo Nostr tradicional)
- Signaling Server WebRTC (descoberta de peers)
- Redis (cache de peers ativos)

#### 2️⃣ Super Peers (Clientes Estáveis)
**Critérios:**
- Conectados por >30 minutos
- Bandwidth >5 Mbps
- Storage disponível >100 MB
- Baixa latência (<100ms para seed)

**Responsabilidades:**
- Cachear eventos das últimas 24h
- Compartilhar eventos via WebRTC com outros peers
- Reportar estatísticas de compartilhamento
- Ajudar na distribuição de eventos populares

#### 3️⃣ Casual Peers (Clientes Normais)
**Características:**
- Conexão instável ou temporária
- Baixo bandwidth
- Mobile (bateria limitada)

**Comportamento:**
- Recebem eventos de Super Peers quando disponível
- Fallback para Relay Seed se P2P falhar
- Podem ativar modo Super Peer se critérios forem atendidos

---

## 📡 FLUXO DE COMUNICAÇÃO

### Cenário 1: Cliente Publica Evento
```
1. Cliente → Relay Seed (WebSocket): Envia evento
2. Relay Seed: Valida assinatura + write-policy
3. Relay Seed: Armazena no strfry database
4. Relay Seed: Envia para Super Peers conectados (WebSocket)
5. Super Peers: Cacheiam evento + compartilham via WebRTC
6. Casual Peers: Recebem de Super Peers ou Relay Seed
```

### Cenário 2: Cliente Busca Eventos Recentes (<24h)
```
1. Cliente → Relay Seed: REQ (filtro de eventos)
2. Relay Seed: Verifica quais Super Peers têm os eventos
3. Relay Seed: Responde com lista de Super Peers + ICE candidates
4. Cliente ↔ Super Peer: Estabelece conexão WebRTC
5. Super Peer → Cliente: Envia eventos via P2P
6. Fallback: Se P2P falhar, Relay Seed envia via WebSocket
```

### Cenário 3: Cliente Busca Eventos Antigos (>24h)
```
1. Cliente → Relay Seed: REQ (eventos históricos)
2. Relay Seed: Busca no strfry database
3. Relay Seed → Cliente: Envia via WebSocket (sem P2P)
```

---

## 🔧 TECNOLOGIAS NECESSÁRIAS

### Backend (Relay Seed)
| Tecnologia | Uso | Já Temos? |
|------------|-----|-----------|
| **strfry** | Database de eventos | ✅ Sim |
| **Caddy** | Reverse proxy | ✅ Sim |
| **WebSocket** | Protocolo Nostr | ✅ Sim |
| **Redis** | Cache de peers ativos | ❌ Precisa instalar |
| **Signaling Server** | WebRTC peer discovery | ❌ Precisa implementar |
| **Rust/Node.js** | Signaling Server | ❌ Escolher stack |

### Frontend (Cliente)
| Tecnologia | Uso | Complexidade |
|------------|-----|--------------|
| **WebRTC** | Conexões P2P | Alta |
| **IndexedDB** | Cache local de eventos | Média |
| **WebSocket** | Fallback para relay | Baixa |
| **nostr-tools** | Validação de assinaturas | Baixa |

---

## 📋 FASES DE IMPLEMENTAÇÃO

### FASE 0: Pesquisa e Validação (1 semana)
- [ ] Estudar NIPs existentes relacionados a P2P
- [ ] Verificar se algum relay já implementou P2P
- [ ] Validar viabilidade técnica de WebRTC em clientes Nostr
- [ ] Consultar comunidade Nostr (GitHub Discussions)
- [ ] Decidir número do NIP (sugestões: NIP-78, NIP-88, NIP-99)

**Entregável:** Documento de viabilidade técnica

### FASE 1: Prototipação (2-3 semanas)
- [ ] Implementar Signaling Server básico (Node.js + WebSocket)
- [ ] Criar cliente web de teste (vanilla JS + WebRTC)
- [ ] Testar conexão P2P entre 2 clientes via relay seed
- [ ] Implementar compartilhamento de 1 evento via WebRTC
- [ ] Medir latência P2P vs WebSocket tradicional

**Entregável:** Proof of Concept (2 clientes trocando eventos P2P)

### FASE 2: Protocolo NIP (1-2 semanas)
- [ ] Escrever especificação completa do NIP-XX
- [ ] Definir mensagens Nostr para P2P (tipos de evento, filtros)
- [ ] Especificar descoberta de peers (ICE candidates no relay)
- [ ] Documentar sistema de reputação
- [ ] Submeter NIP para revisão da comunidade

**Entregável:** NIP-XX rascunho (GitHub PR)

### FASE 3: Implementação Backend (3-4 semanas)
- [ ] Integrar Signaling Server com strfry
- [ ] Implementar cache Redis de peers ativos
- [ ] Criar sistema de classificação Super Peer vs Casual
- [ ] Implementar rate limiting P2P (evitar abuso)
- [ ] Métricas: Quantos eventos foram compartilhados P2P

**Entregável:** Relay Seed completo (rp2p.libernet.app)

### FASE 4: Implementação Frontend (4-5 semanas)
- [ ] Biblioteca JavaScript: nostr-p2p.js
- [ ] Gerenciamento de cache IndexedDB (últimas 24h)
- [ ] Lógica de fallback (P2P → WebSocket)
- [ ] UI: Indicador de "Conectado via P2P" (opcional)
- [ ] Testes em navegadores (Chrome, Firefox, Safari)

**Entregável:** Biblioteca nostr-p2p.js + exemplo de integração

### FASE 5: Integração com Clientes Existentes (2-3 semanas)
- [ ] Criar PR para Amethyst (Android)
- [ ] Criar PR para Damus (iOS)
- [ ] Integrar com LiberMedia v2 (nosso cliente web)
- [ ] Documentar API para outros desenvolvedores

**Entregável:** 3 clientes Nostr com suporte P2P

### FASE 6: Testes e Otimização (2-3 semanas)
- [ ] Testes de carga (100+ peers simultâneos)
- [ ] Otimização de bandwidth (compressão de eventos)
- [ ] Testes de mobilidade (peer desconecta e reconecta)
- [ ] Monitoramento de descentralização (nostr.watch)

**Entregável:** Relay P2P estável em produção

---

## ⏱️ ESTIMATIVA DE TEMPO

| Fase | Duração | Acumulado |
|------|---------|-----------|
| Fase 0: Pesquisa | 1 semana | 1 semana |
| Fase 1: PoC | 2-3 semanas | 3-4 semanas |
| Fase 2: NIP | 1-2 semanas | 4-6 semanas |
| Fase 3: Backend | 3-4 semanas | 7-10 semanas |
| Fase 4: Frontend | 4-5 semanas | 11-15 semanas |
| Fase 5: Integração | 2-3 semanas | 13-18 semanas |
| Fase 6: Testes | 2-3 semanas | 15-21 semanas |

**Tempo total estimado:** 15-21 semanas (~4-5 meses)

**Observação:** Assumindo trabalho part-time (10-15h/semana). Full-time reduz para 2-3 meses.

---

## 🎯 PROPOSTA DE NIP

### Número Sugerido: NIP-88
**Motivo:**
- NIP-77 já existe (Negentropy Syncing)
- 88 é número da sorte na cultura chinesa (simboliza prosperidade)
- Fácil de lembrar: "oitenta e oito" ou "duplo oito"

**Alternativas:**
- **NIP-78:** Sequencial após 77
- **NIP-99:** "Final do século" (sugere inovação de ponta)
- **NIP-90:** Número redondo (fácil de lembrar)

**Título Proposto:**
```
NIP-88
======

Hybrid Peer-to-Peer Relay Extension
-----------------------------------

`draft` `optional` `relay` `client`
```

---

## 📊 BENEFÍCIOS ESPERADOS

### Para o Relay
- ✅ Redução de carga em 30-50% (eventos recentes via P2P)
- ✅ Maior descentralização (nostr.watch score aumenta)
- ✅ Resiliência: Se relay cair, peers continuam trocando eventos
- ✅ Diferenciação competitiva (primeiro relay P2P do mundo)

### Para os Clientes
- ✅ Latência reduzida (conexão P2P é mais rápida que servidor)
- ✅ Menos dependência de relay central
- ✅ Contribuição para descentralização (opcional, opt-in)

### Para a Rede Nostr
- ✅ Modelo mais sustentável (relays grandes economizam bandwidth)
- ✅ Inspiração para outros relays adotarem P2P
- ✅ Prova de conceito de descentralização real

---

## ⚠️ DESAFIOS TÉCNICOS

### 1. WebRTC Complexidade
**Problema:** WebRTC é complexo (ICE, STUN, TURN, NAT traversal)
**Solução:** Usar bibliotecas prontas (simple-peer, PeerJS)
**Mitigação:** Fallback sempre disponível (WebSocket)

### 2. Peers Maliciosos
**Problema:** Peer pode enviar eventos falsos ou corrompidos
**Solução:** Cliente SEMPRE valida assinatura Schnorr antes de aceitar
**Extra:** Sistema de reputação (peers com eventos inválidos são banidos)

### 3. Mobilidade de Peers
**Problema:** Peers mobile desconectam frequentemente
**Solução:** Somente clientes estáveis viram Super Peers
**Fallback:** Casual Peers sempre usam relay seed como backup

### 4. NAT/Firewall
**Problema:** Alguns peers não conseguem estabelecer P2P
**Solução:** Implementar TURN server (relay WebRTC) como último recurso
**Custo:** TURN server pode gerar custo extra (considerar Cloudflare Calls)

### 5. Privacidade
**Problema:** Peers veem IPs uns dos outros
**Solução:** Implementar "blind relay mode" onde relay seed faz proxy
**Trade-off:** Modo blind reduz benefício de latência do P2P

---

## 🧪 MÉTRICAS DE SUCESSO

| Métrica | Meta | Como Medir |
|---------|------|------------|
| % eventos via P2P | >30% | Logs do relay seed |
| Latência P2P vs WebSocket | <50% | Testes de benchmark |
| Descentralização nostr.watch | Score >70 | nostr.watch API |
| Adoção por clientes | 3+ clientes | GitHub PRs aceitos |
| Uptime P2P | >95% | Monitoramento 24/7 |

---

## 💰 CUSTOS ESTIMADOS

### Infraestrutura Adicional
| Recurso | Necessidade | Custo Mensal |
|---------|-------------|--------------|
| **Redis** | Peers cache | R$ 0 (Docker local) |
| **TURN Server** | NAT traversal | R$ 0 (Cloudflare Calls Free Tier) |
| **Bandwidth extra** | Signaling | ~+5% (negligível) |
| **Monitoring** | Grafana/Prometheus | R$ 0 (Docker local) |

**Total:** R$ 0/mês (mantendo Free Tier)

---

## 🛤️ ROADMAP VISUAL

```
📅 2026

Q2 (Abr-Jun):
├─ Semana 1-2: Pesquisa + Validação ✅
├─ Semana 3-5: Prototipação (PoC)
├─ Semana 6-7: Escrever NIP-88
└─ Semana 8-11: Backend (Signaling Server)

Q3 (Jul-Set):
├─ Semana 12-16: Frontend (nostr-p2p.js)
├─ Semana 17-19: Integração com clientes
└─ Semana 20-21: Testes + otimização

Q4 (Out-Dez):
├─ Semana 22: Deploy em produção (rp2p.libernet.app)
├─ Semana 23-24: Marketing + documentação
└─ Semana 25+: Monitoramento + bugfixes
```

---

## 🚀 PRÓXIMOS PASSOS IMEDIATOS

### Após Discussão Pós-Almoço

1. **Decisão GO/NO-GO:**
   - Validar se projeto faz sentido para LiberNet
   - Avaliar disponibilidade de tempo (10-15h/semana?)
   - Confirmar interesse em liderar inovação Nostr

2. **Se GO, Fase 0 Inicia:**
   - [ ] Ler NIPs existentes sobre relays (NIP-01, NIP-11, NIP-42)
   - [ ] Pesquisar se alguém já tentou P2P no Nostr
   - [ ] Testar bibliotecas WebRTC (simple-peer vs PeerJS)
   - [ ] Criar issue no GitHub nostr-protocol/nips para discussão

3. **Configurar Ambiente de Desenvolvimento:**
   - [ ] Criar repo Git: `/mnt/projetos/relay-p2p-nostr/`
   - [ ] Setup Node.js + TypeScript para Signaling Server
   - [ ] Criar página HTML de teste (2 clientes WebRTC)

4. **Domínio de Teste:**
   - [ ] Renomear relay-directo.libernet.app → rp2p.libernet.app
   - [ ] Configurar Caddy para servir Signaling Server (porta 8888)
   - [ ] DNS: A record para rp2p.libernet.app

---

## 📚 REFERÊNCIAS TÉCNICAS

### WebRTC
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [simple-peer](https://github.com/feross/simple-peer) - Biblioteca WebRTC simplificada
- [PeerJS](https://peerjs.com/) - Alternativa com signaling incluso

### Nostr
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) - Protocolo básico
- [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) - Relay Information Document
- [NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md) - Negentropy Syncing

### Inspiração P2P
- [Spotify P2P](https://www.csc.kth.se/~gkreitz/spotify-p2p10/) - Paper acadêmico
- [WebTorrent](https://webtorrent.io/) - Torrent no browser via WebRTC
- [IPFS](https://ipfs.tech/) - Sistema de arquivos P2P

---

## 🤔 PERGUNTAS PARA DISCUSSÃO

1. **Prioridade:** Este projeto tem prioridade sobre outros (LiberMedia, Sofia)?
2. **Tempo:** Temos 10-15h/semana para dedicar nos próximos 4-5 meses?
3. **Comunidade:** Devemos anunciar no GitHub desde o início ou trabalhar em silêncio?
4. **Monetização:** Relay P2P poderia gerar receita (donations, NIP-57 zaps)?
5. **Nome do Projeto:** "LiberRelay P2P", "NostrP2P", "HybridRelay"?
6. **Domínio:** rp2p.libernet.app está ok ou prefere outro?

---

**✨ POTENCIAL DE IMPACTO:**

Se bem-sucedido, este projeto pode:
- 🏆 Colocar LiberNet como **pioneiro** em inovação Nostr
- 📈 Aumentar visibilidade do relay (nostr.watch ranking)
- 🌍 Influenciar arquitetura de futuros relays
- 💡 Inspirar novo padrão de descentralização no Nostr

---

**Preparado por:** Claude (IA Engenheira LiberNet)
**Data:** 27 de Março de 2026
**Status:** Aguardando discussão pós-almoço 🍽️

---

**💬 "O futuro do Nostr é híbrido: relays inteligentes + clientes colaborativos."**
