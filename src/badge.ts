/**
 * NIP-58 Badge publishing
 * Publishes a "Super Peer" badge award event when a peer is promoted.
 *
 * Badge definition (kind 30009) is published once at startup if not already present.
 * Badge award (kind 8) is published for each promoted peer.
 *
 * Relay signing key comes from RELAY_PRIVKEY env var (hex).
 */

import WebSocket from 'ws';
import { createHash } from 'crypto';
import { strfryWsUrl } from './utils/config';
import { logger } from './utils/logger';

const log = logger('badge');

const RELAY_PRIVKEY_HEX = process.env.RELAY_PRIVKEY ?? '';
const RELAY_PUBKEY = process.env.RELAY_PUBKEY ?? '';

const BADGE_ID = 'super-peer';
const BADGE_NAME = 'Super Peer';
const BADGE_DESC = 'Awarded by Nexus Relay to peers that contribute to the Nostr P2P network by routing events 24/7.';
const BADGE_IMAGE = 'https://media.libernet.app/static/img/relay-icon.png';

// Event signing via nostr-tools (already a dependency)
async function signEvent(privkeyHex: string, event: Record<string, unknown>): Promise<string> {
  const { finalizeEvent } = await import('nostr-tools/pure');
  const privBytes = Uint8Array.from(Buffer.from(privkeyHex, 'hex'));
  const finalized = finalizeEvent({
    kind: event.kind as number,
    created_at: event.created_at as number,
    tags: event.tags as string[][],
    content: event.content as string,
  }, privBytes);
  return finalized.sig;
}

async function buildEvent(kind: number, tags: string[][], content: string): Promise<Record<string, unknown>> {
  if (!RELAY_PRIVKEY_HEX || !RELAY_PUBKEY) {
    throw new Error('RELAY_PRIVKEY or RELAY_PUBKEY not configured');
  }

  const event: Record<string, unknown> = {
    pubkey: RELAY_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content,
  };

  // Compute event ID
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  event.id = createHash('sha256').update(serialized).digest('hex');

  // Sign
  event.sig = await signEvent(RELAY_PRIVKEY_HEX, event);

  return event;
}

async function publishToStrfry(event: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(strfryWsUrl());
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('publish timeout'));
    }, 10_000);

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', event]));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Publish badge award (kind 8) for a newly promoted peer.
 * Awards the "Super Peer" badge to the peer's Nostr pubkey.
 */
export async function publishBadge(peerPubkey: string): Promise<void> {
  if (!RELAY_PRIVKEY_HEX || !RELAY_PUBKEY) {
    log.debug('Badge publishing skipped — RELAY_PRIVKEY not configured');
    return;
  }

  const badgeAddr = `30009:${RELAY_PUBKEY}:${BADGE_ID}`;

  const event = await buildEvent(8, [
    ['a', badgeAddr],
    ['p', peerPubkey],
  ], '');

  await publishToStrfry(event);
  log.info(`NIP-58 badge awarded to ${peerPubkey.slice(0, 16)}...`);
}

/**
 * Publish badge definition (kind 30009) — call once at startup.
 */
export async function publishBadgeDefinition(): Promise<void> {
  if (!RELAY_PRIVKEY_HEX || !RELAY_PUBKEY) return;

  const event = await buildEvent(30009, [
    ['d', BADGE_ID],
    ['name', BADGE_NAME],
    ['description', BADGE_DESC],
    ['image', BADGE_IMAGE, '256x256'],
  ], '');

  await publishToStrfry(event);
  log.info(`NIP-58 badge definition published (${BADGE_ID})`);
}
