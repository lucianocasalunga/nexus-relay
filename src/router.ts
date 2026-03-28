import { NexusClient } from './server';
import { handleSignaling, send } from './signaling/handler';
import { proxyToStrfry } from './proxy';
import { isPeerRegistered } from './peers/manager';
import { getPeersWithEvent } from './peers/cache-tracker';
import { MSG_PEER_OFFER } from './signaling/messages';
import { logger } from './utils/logger';

const log = logger('router');

export function route(client: NexusClient, msg: unknown[]): void {
  if (!Array.isArray(msg) || msg.length === 0) {
    log.warn(`malformed message from ${client.id}`);
    return;
  }

  const type = msg[0] as string;

  if (typeof type === 'string' && type.startsWith('PEER_')) {
    handleSignaling(client, type, msg.slice(1));
  } else if (type === 'REQ' && isPeerRegistered(client.id)) {
    // Smart routing: peer registrado - tenta P2P para eventos recentes
    smartReq(client, msg);
  } else {
    // REQ (non-peer), EVENT, CLOSE, AUTH, COUNT - proxy to strfry
    proxyToStrfry(client, msg);
  }
}

/**
 * Smart REQ routing for registered peers:
 * Always proxy to strfry (guaranteed response), but also check if
 * Super Peers have cached events matching this subscription.
 * If yes, send PEER_OFFER so client can also fetch via P2P.
 *
 * This is additive - P2P supplements strfry, doesn't replace it.
 * The client decides whether to use P2P or strfry response.
 */
function smartReq(client: NexusClient, msg: unknown[]): void {
  // Always proxy to strfry first (guaranteed results)
  proxyToStrfry(client, msg);

  // Check if we have any cached events that match
  // For now, we check if the REQ has specific IDs filter
  const subId = msg[1] as string;
  const filters = msg.slice(2) as Record<string, unknown>[];

  for (const filter of filters) {
    // If filter has specific event IDs, check P2P cache
    const ids = filter.ids as string[] | undefined;
    if (ids && Array.isArray(ids) && ids.length > 0) {
      const offers: Record<string, string[]> = {};

      for (const eventId of ids) {
        const peers = getPeersWithEvent(eventId).filter(pid => pid !== client.id);
        if (peers.length > 0) {
          offers[eventId] = peers;
        }
      }

      if (Object.keys(offers).length > 0) {
        send(client, [MSG_PEER_OFFER, {
          subscription: subId,
          offers,
          source: 'smart_routing',
        }]);
        log.debug(`smart_req: ${client.id} sub=${subId} → ${Object.keys(offers).length} events available via P2P`);
      }
    }
  }
}
