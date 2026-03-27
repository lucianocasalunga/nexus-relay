# MONETIZACAO E INCENTIVOS - NEXUS RELAY

> Sistema de recompensas para usuarios que contribuem com a rede
> Data: 27/Mar/2026
> Versao: 1.0

---

## CONCEITO

Usuarios que ajudam o Nexus (como Super Peers ou divulgando) recebem
recompensas em sats via Lightning. Incentiva crescimento organico e
cria um modelo sustentavel onde quem contribui é recompensado.

**Inspiracao:** X (Twitter) exige 5 milhoes de impressoes para monetizar.
Usuarios levam meses postando 100+ vezes por dia para atingir.
Nos recompensamos o esforço de divulgacao antes do X pagar.

---

## PRE-REQUISITO PARA MONETIZACAO

**REGRA DE OURO: 1 mes como Super Peer ininterrupto.**

Antes de receber QUALQUER recompensa (infra ou divulgacao), o usuario
DEVE ter sido Super Peer por 30 dias consecutivos. Isso garante que:

- So quem realmente contribui com a rede é recompensado
- Elimina oportunistas e bots
- Cria base solida de peers comprometidos
- 1 mes é tempo suficiente para provar estabilidade

**Apos atingir 1 mes:** Desbloqueia AMBAS as trilhas de recompensa.
**Se perder status Super Peer:** Recompensas pausam. Contador reinicia.

---

## DUAS TRILHAS DE RECOMPENSA

> Ambas so desbloqueiam apos 1 mes como Super Peer

### TRILHA 1: INFRAESTRUTURA (Super Peers)
Recompensa quem ajuda a rede P2P funcionando.

| Meta | Descricao | Recompensa | Frequencia |
|------|-----------|-----------|------------|
| Eventos 1K | Compartilhar 1.000 eventos P2P | 500 sats | Por milestone |
| Eventos 10K | Compartilhar 10.000 eventos P2P | 2.000 sats | Por milestone |
| Eventos 100K | Compartilhar 100.000 eventos P2P | 10.000 sats | Por milestone |
| Recrutador | Trazer 5 novos peers para a rede | 1.000 sats | Por milestone |
| Reputacao 100 | Atingir reputacao maxima | 2.000 sats | Uma vez |
| Veterano 3M | Super Peer por 3 meses | 15.000 sats | Uma vez |
| Veterano 6M | Super Peer por 6 meses | 50.000 sats | Uma vez |

### TRILHA 2: DIVULGACAO (Marketing)
Recompensa quem divulga o Nexus no X e Nostr.

| Meta | Descricao | Recompensa | Frequencia |
|------|-----------|-----------|------------|
| Primeiro Post | Postar sobre Nexus com #NexusRelay | 100 sats | Uma vez |
| Posts 100 | 100 posts sobre Nexus | 2.000 sats | Por milestone |
| Posts 1K | 1.000 posts sobre Nexus | 10.000 sats | Por milestone |
| Impressoes 100K | 100K impressoes acumuladas | 5.000 sats | Por milestone |
| Impressoes 1M | 1M impressoes acumuladas | 20.000 sats | Por milestone |
| Impressoes 5M | 5M impressoes (meta monetizacao X) | 100.000 sats | Uma vez |
| Viral | Post com 10K+ impressoes | 5.000 sats | Por ocorrencia |

**Nota sobre 5M impressoes:** No X, 5 milhoes de impressoes é o minimo
para comecar a monetizar. Leva ~5 meses postando 100+ vezes por dia.
Nos recompensamos esse esforço em sats antes do X pagar em dolares.

---

## COMO VERIFICAR

### Trilha Infraestrutura
- Automatico via Nexus Server
- Sistema de reputacao ja rastreia tudo
- Redis tem stats:global e stats por peer
- Pagamento automatico quando meta é atingida

### Trilha Divulgacao
- Posts Nostr: Buscar eventos kind:1 com tags #NexusRelay #NIP95
  (automatico via strfry query)
- Posts X: Verificar via API do X ou self-report com link do post
  (semi-automatico, pode precisar validacao)
- Impressoes X: Self-report com screenshot ou API
  (manual inicialmente, automatizar depois)

---

## FONTE DE RECURSOS

### Fase Inicial (Bootstrap)
- Fundo proprio da LiberNet (pequeno, ~50K sats/mes)
- Doações via zaps para o relay
- Zaps no perfil Sofia no Nostr

### Fase Crescimento
- Planos premium para relay:
  - Free: relay normal + P2P basico
  - Pro: prioridade na rede P2P, mais storage, badge verificado
  - Enterprise: relay dedicado, SLA, suporte
- Marketplace de badges NIP-58 (LiberMedia)
- Patrocinios de relays parceiros

### Fase Madura
- % das recompensas de monetizacao X dos usuarios (comissao por indicacao)
- Modelo sustentavel: rede P2P economiza bandwidth = economiza dinheiro = reinveste em recompensas

---

## PAGAMENTO

- **Metodo:** Lightning Network (zaps NIP-57)
- **Carteira:** Blink (barak@blink.sv) ou LNbits local
- **Automatizacao:** Bot que verifica metas e zapa automaticamente
- **Minimo para saque:** 1.000 sats acumulados
- **Lightning Address:** Usuario cadastra no perfil Nostr (campo lud16)

---

## IMPLEMENTACAO

Este modulo sera implementado APOS a Fase 4 do Nexus (quando peers
ja estiverem funcionando e metricas sendo coletadas).

Depende de:
- Sistema de reputacao funcionando (Fase 4)
- Metricas por peer no Redis (Fase 4)
- Integracao Lightning/NIP-57 (Fase 6+)
- Dashboard de metricas (Fase 6+)

---

## ANTI-FRAUDE

- Verificacao de assinatura Schnorr em posts Nostr (prova que é o usuario)
- Rate limiting: max 1 recompensa de divulgacao por dia
- Impressoes X: validacao manual ate automatizar
- Peers: metricas reais do Redis (nao podem ser falsificadas)
- Multi-conta: detectar por IP/fingerprint
- Cooldown: apos ban, perde recompensas acumuladas

---

**"Quem ajuda a rede, a rede ajuda de volta."**
