import { createClient, RedisClientType } from 'redis';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const log = logger('redis');

let client: RedisClientType;

export async function connectRedis(): Promise<RedisClientType> {
  client = createClient({ url: config.redisUrl }) as RedisClientType;
  client.on('error', (err) => log.error('connection error', err));
  await client.connect();
  log.info(`connected to ${config.redisUrl}`);
  return client;
}

export function getRedis(): RedisClientType {
  return client;
}

// Peer helpers - all keys prefixed with nexus:
const PREFIX = 'nexus:';

export async function setPeer(peerId: string, data: Record<string, string>): Promise<void> {
  const key = `${PREFIX}peer:${peerId}`;
  await client.hSet(key, data);
  await client.expire(key, config.peerTtl);
}

export async function getPeer(peerId: string): Promise<Record<string, string> | null> {
  const key = `${PREFIX}peer:${peerId}`;
  const data = await client.hGetAll(key);
  return Object.keys(data).length > 0 ? data : null;
}

export async function setPeerStatus(peerId: string, status: string): Promise<void> {
  const key = `${PREFIX}peer:${peerId}`;
  await client.hSet(key, 'status', status);
}

export async function removePeer(peerId: string): Promise<void> {
  await client.del(`${PREFIX}peer:${peerId}`);
  await client.sRem(`${PREFIX}peers:all`, peerId);
  await client.sRem(`${PREFIX}peers:super`, peerId);
  await client.sRem(`${PREFIX}peers:casual`, peerId);
}

export async function refreshPeerTtl(peerId: string): Promise<boolean> {
  const key = `${PREFIX}peer:${peerId}`;
  const result = await client.expire(key, config.peerTtl);
  return !!result;
}

export async function addToSet(set: string, member: string): Promise<void> {
  await client.sAdd(`${PREFIX}${set}`, member);
}

export async function removeFromSet(set: string, member: string): Promise<void> {
  await client.sRem(`${PREFIX}${set}`, member);
}

export async function getSet(set: string): Promise<string[]> {
  return client.sMembers(`${PREFIX}${set}`);
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    log.info('disconnected');
  }
}
