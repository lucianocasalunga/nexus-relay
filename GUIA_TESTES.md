# Guia de Testes - Nexus Relay

## 1. Teste Rapido (30 segundos)

### Verificar se esta rodando
```bash
sudo systemctl status nexus-relay
curl -s https://nexus.libernet.app/stats | python3 -m json.tool
```

### Verificar NIP-11
```bash
curl -s -H "Accept: application/nostr+json" https://nexus.libernet.app
```
Deve retornar JSON com `"name": "Nexus Relay"` e `"version": "1.0.0"`.

---

## 2. Teste no Browser (2 minutos)

### Teste PoC (2 abas)
1. Abra 2 abas em `https://nexus.libernet.app`
2. **Aba 1 (Peer A):** Conectar → Registrar → Cachear Evento
3. **Aba 2 (Peer B):** Conectar → Registrar → Pedir Evento P2P
4. **Resultado esperado:** Evento transferido via P2P em ~4ms, Schnorr VALIDA

### Teste Cliente Completo
1. Abra `https://nexus.libernet.app/client.html`
2. Clique "Conectar" - deve mostrar "Casual" no badge
3. Clique "Assinar feed" - eventos do relay aparecem no log
4. Observe "Cache: Eventos: X" aumentando (IndexedDB funcionando)

### Teste no LiberMedia
1. Abra `https://media.libernet.app/feed` (precisa estar logado)
2. Olhe no canto inferior direito - badge "P2P" (verde) ou "P2P off"
3. Clique no badge para ativar/desativar
4. Abra o Console do browser (F12) - procure logs `[NEXUS-P2P]`
5. Deve ver: "Hooked into relay pool", "Registrado: xxx"

### Dashboard
1. Abra `https://nexus.libernet.app/dashboard.html`
2. Numeros atualizam a cada 3 segundos
3. Confira: peers conectados, eventos cacheados, P2P ratio

---

## 3. Teste com 2 Usuarios (5 minutos)

Este e o teste mais importante - prova que P2P funciona de verdade.

### Preparacao
- Usuario A: um browser (Chrome, Firefox, etc)
- Usuario B: outro browser OU outro dispositivo

### Passo a Passo
1. **Ambos** abrem `https://nexus.libernet.app/client.html`
2. **Ambos** clicam "Conectar" - devem ver "Casual" no badge
3. **Usuario A** clica "Assinar feed" - eventos aparecem, cache cresce
4. **Espera 5 segundos** (cache do A e anunciado ao Nexus)
5. **Usuario B** clica "Assinar feed" com filtro que inclua IDs especificos
   - Ou: No PoC (`/`), A cacheia evento e B pede via P2P

### O que observar
- No log do B: "PEER_OFFER" aparece = Nexus sabe que A tem o evento
- "WebRTC CONECTADO!" = conexao P2P estabelecida
- "P2P_EVENTS recebido!" = evento transferido sem passar pelo servidor
- "Assinatura Schnorr VALIDA!" = integridade confirmada

### Se nao funcionar
- Verifique se ambos estao na mesma rede (WebRTC pode falhar entre NATs diferentes)
- Tente em janela normal (nao anonima - WebRTC pode ser bloqueado)
- Verifique o Console (F12) por erros

---

## 4. Testes Automatizados (1 minuto)

```bash
cd /mnt/projetos/nexus-relay

# Todos os testes (97 total)
npx ts-node tests/test-signaling-flow.ts  # 23 testes - signaling
npx ts-node tests/test-fase3.ts            # 25 testes - NIP-95
npx ts-node tests/test-fase4.ts            # 26 testes - cache/metrics
npx ts-node tests/test-load.ts             # 60 peers simultaneos
npx ts-node tests/test-resilience.ts       # 12 testes - resiliencia
```

---

## 5. Monitoramento Diario

### Comandos rapidos
```bash
# Status
sudo systemctl status nexus-relay

# Metricas
curl -s https://nexus.libernet.app/stats | python3 -m json.tool

# Logs
sudo journalctl -u nexus-relay --since "1 hour ago" --no-pager | tail -20

# Restart (se necessario)
sudo systemctl restart nexus-relay
```

### Dashboard visual
`https://nexus.libernet.app/dashboard.html`

---

## 6. Troubleshooting

### Nexus nao inicia
```bash
sudo journalctl -u nexus-relay -e  # ver logs de erro
docker ps | grep redis              # Redis rodando?
docker ps | grep strfry             # strfry rodando?
ss -tlnp | grep 8889               # porta ocupada?
```

### P2P nao conecta no browser
- WebRTC precisa de HTTPS (funciona via nexus.libernet.app, nao localhost)
- Verifique se SimplePeer carregou (Console: "[NEXUS-P2P] SimplePeer carregado")
- Alguns firewalls corporativos bloqueiam WebRTC

### Badge nao aparece no LiberMedia
- Hard refresh: Ctrl+Shift+R
- Verificar se nexus-p2p.js carregou: Console deve ter "[NEXUS-P2P]"
- Verificar feed-v2.js tem nexus: `curl https://media.libernet.app/static/js/feed-v2.js | grep nexus`

### Rebuild e redeploy
```bash
cd /mnt/projetos/nexus-relay
npx tsc
sudo systemctl restart nexus-relay
```
