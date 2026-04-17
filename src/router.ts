import { NexusClient, getClient } from './server';
import { handleSignaling, send } from './signaling/handler';
import { proxyToStrfry } from './proxy';
import { isPeerRegistered } from './peers/manager';
import { findPeersForFilter, NostrFilter } from './peers/cache-tracker';
import { MSG_PEER_OFFER } from './signaling/messages';
import { detectFeedFilter, serveFeed } from './feed-proxy';
import { logger } from './utils/logger';
import { isBlocked } from './utils/blacklist';

const log = logger('router');

export function route(client: NexusClient, msg: unknown[]): void {
  if (!Array.isArray(msg) || msg.length === 0) {
    log.warn(`malformed message from ${client.id}`);
    return;
  }

  const type = msg[0] as string;

  // Bloquear EVENTs de pubkeys na blacklist
  if (type === 'EVENT') {
    const event = msg[1] as Record<string, unknown> | undefined;
    if (event?.pubkey && isBlocked(event.pubkey as string)) {
      log.info(`Bloqueado EVENT de ${(event.pubkey as string).substring(0, 16)}...`);
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(['OK', (event.id as string) || '', false, 'blocked: blacklisted']));
      }
      return;
    }
  }

  if (typeof type === 'string' && type.startsWith('PEER_')) {
    handleSignaling(client, type, msg.slice(1));
  } else if (type === 'REQ') {
    // Verificar se e um pedido de feed algoritmico
    const filters = msg.slice(2) as Record<string, unknown>[];
    const feedType = detectFeedFilter(filters);

    if (feedType) {
      // Feed algoritmico: servir via Feed Engine
      serveFeed(client, msg).catch(err => {
        log.error('Erro ao servir feed', err);
        proxyToStrfry(client, msg);
      });
    } else if (isPeerRegistered(client.id)) {
      // Smart routing: peer registrado - tenta P2P para eventos recentes
      smartReq(client, msg);
    } else {
      // REQ normal - proxy to strfry
      proxyToStrfry(client, msg);
    }
  } else {
    // EVENT, CLOSE, AUTH, COUNT - proxy to strfry
    proxyToStrfry(client, msg);
  }
}

/**
 * Smart REQ routing for registered peers:
 * Always proxy to strfry (guaranteed response), but also check if
 * peers have cached events matching this subscription.
 * If yes, send PEER_OFFER so client can also fetch via P2P.
 *
 * This is additive - P2P supplements strfry, doesn't replace it.
 * The client decides whether to use P2P or strfry response.
 */
function smartReq(client: NexusClient, msg: unknown[]): void {
  // Always proxy to strfry first (guaranteed results)
  proxyToStrfry(client, msg);

  const subId = msg[1] as string;
  const filters = msg.slice(2) as NostrFilter[];

  const allOffers: Record<string, string[]> = {};
  let totalOffers = 0;

  for (const filter of filters) {
    if (totalOffers >= 20) break;

    const matches = findPeersForFilter(filter, client.id);

    for (const [eventId, peers] of matches) {
      if (totalOffers >= 20) break;
      if (allOffers[eventId]) continue; // already offered
      // Só oferecer peers que ainda estão conectados agora (evita race condition)
      const activePeers = peers.filter(pid => !!getClient(pid));
      if (activePeers.length === 0) continue;
      allOffers[eventId] = activePeers.slice(0, 3);
      totalOffers++;
    }
  }

  if (totalOffers > 0) {
    send(client, [MSG_PEER_OFFER, {
      subscription: subId,
      offers: allOffers,
      source: 'smart_routing',
    }]);
    log.info(`smart_req: ${client.id} sub=${subId} → ${totalOffers} events available via P2P`);
  }
}
