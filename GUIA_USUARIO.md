# Guia do Usuario - Nexus P2P

## O que e o Nexus P2P?

O Nexus e uma tecnologia que permite que usuarios do LiberMedia compartilhem
posts entre si diretamente, sem depender 100% do servidor. Funciona como
um torrent: quando voce le um post, ele fica guardado no seu navegador por
24 horas. Se outro usuario pedir esse mesmo post, voce envia direto pra ele.

**Resultado:** Posts carregam mais rapido e o sistema fica mais resistente.

## Como usar

### No LiberMedia (media.libernet.app)

1. Abra o feed normalmente
2. No canto inferior direito, voce vera um badge:
   - **"P2P"** (verde) = conectado como peer casual
   - **"P2P Super"** (laranja) = voce e um Super Peer (serve posts para outros)
   - **"P2P off"** (cinza) = P2P desativado
3. Clique no badge para ativar/desativar o P2P

**Nao precisa fazer mais nada.** O sistema funciona automaticamente.

### O que acontece por tras

- Seus posts ficam guardados no navegador por 24h (cache local)
- Quando outro usuario precisa de um post que voce tem, o sistema
  conecta voces diretamente (WebRTC) e transfere o post em ~4ms
- Se a conexao direta nao funcionar, o servidor envia normalmente
- Voce nunca perde posts - o servidor e sempre o fallback

### Super Peer

Depois de 30 minutos conectado com boa conexao, voce pode ser
promovido a **Super Peer**. Isso significa que voce ajuda a servir
posts para ate 10 outros usuarios ao mesmo tempo.

**Nao consome dados significativos** - posts Nostr sao textos pequenos.

### Privacidade

- Outros peers podem ver seu IP (como em qualquer conexao WebRTC)
- Os posts compartilhados sao publicos (ja estao no relay de qualquer forma)
- Nenhum dado privado e compartilhado via P2P
- Voce pode desativar a qualquer momento clicando no badge

### Como adicionar em outros clientes Nostr

Qualquer cliente Nostr pode usar o Nexus como relay:

**URL:** `wss://nexus.libernet.app`

Adicione nas configuracoes de relays do seu cliente (Amethyst, Damus, Primal, etc).
Funciona como relay normal, mas se o cliente suportar NIP-95, ganha P2P automaticamente.

---

## FAQ

**P: O P2P gasta muita bateria no celular?**
R: Nao. O sistema detecta se voce esta em conexao instavel e te classifica
como "Casual Peer" - voce recebe via P2P mas nao serve para outros.

**P: Posso desativar?**
R: Sim, clique no badge "P2P" no canto inferior direito. Preferencia salva.

**P: O que acontece se o servidor cair?**
R: Os peers que estiverem conectados entre si continuam trocando posts
que tem em cache. Quando o servidor voltar, tudo sincroniza.

**P: Meus dados ficam seguros?**
R: Todos os posts sao assinados criptograficamente (Schnorr/secp256k1).
Ninguem pode falsificar um post - a assinatura e verificada antes de aceitar.

**P: Preciso instalar algo?**
R: Nao. Funciona direto no navegador, sem extensoes ou apps extras.
