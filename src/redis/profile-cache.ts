/**
 * profile-cache.ts — Cache Redis de perfis Nostr (kind:0) no Nexus
 *
 * Intercepta kind:0 que passam pelo proxy e cacheia no Redis.
 * Quando um cliente pede perfis, serve do Redis (~1ms) em vez
 * de ir ao strfry (~20ms).
 *
 * Padrão inspirado no Primal Cache Server (server-side caching).
 */

import { getRedis } from './client';
import { logger } from '../utils/logger';

const log = logger('profile-cache');

const PREFIX = 'nexus:profile:';
const PROFILE_TTL = 3600; // 1 hora (re-fetch do strfry quando expira)
const MAX_BATCH = 50; // Máximo de perfis por batch lookup

export interface CachedProfile {
  pubkey: string;
  name: string;
  display_name: string;
  picture: string;
  about: string;
  nip05: string;
  lud16: string;
  created_at: number;
  cached_at: number;
}

/**
 * Cachear um perfil (kind:0) no Redis.
 * Só atualiza se o evento é mais recente que o cacheado.
 */
export async function cacheProfile(event: { pubkey: string; content: string; created_at: number }): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;

    const key = `${PREFIX}${event.pubkey}`;

    // Verificar se já temos uma versão mais recente
    const existing = await redis.hGet(key, 'created_at');
    if (existing && parseInt(existing) >= event.created_at) {
      return; // Cache já tem versão mais recente
    }

    const profile = JSON.parse(event.content);

    const data: Record<string, string> = {
      pubkey: event.pubkey,
      name: profile.name || profile.display_name || '',
      display_name: profile.display_name || profile.name || '',
      picture: profile.picture || '',
      about: profile.about || '',
      nip05: profile.nip05 || '',
      lud16: profile.lud16 || '',
      created_at: String(event.created_at),
      cached_at: String(Math.floor(Date.now() / 1000))
    };

    await redis.hSet(key, data);
    await redis.expire(key, PROFILE_TTL);

    log.debug(`cached profile: ${data.name || data.display_name || event.pubkey.substring(0, 12)}`);
  } catch (err) {
    // Silencioso — cache miss não é erro
    log.debug(`cache error for ${event.pubkey.substring(0, 12)}: ${(err as Error).message}`);
  }
}

/**
 * Buscar um perfil do Redis cache.
 * Retorna null se não encontrado ou expirado.
 */
export async function getCachedProfile(pubkey: string): Promise<CachedProfile | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;

    const key = `${PREFIX}${pubkey}`;
    const data = await redis.hGetAll(key);

    if (!data || Object.keys(data).length === 0) return null;

    return {
      pubkey: data.pubkey,
      name: data.name,
      display_name: data.display_name,
      picture: data.picture,
      about: data.about,
      nip05: data.nip05,
      lud16: data.lud16,
      created_at: parseInt(data.created_at) || 0,
      cached_at: parseInt(data.cached_at) || 0
    };
  } catch {
    return null;
  }
}

/**
 * Buscar múltiplos perfis do Redis cache (batch).
 * Retorna Map<pubkey, CachedProfile> com os encontrados.
 */
export async function getCachedProfiles(pubkeys: string[]): Promise<Map<string, CachedProfile>> {
  const result = new Map<string, CachedProfile>();

  try {
    const redis = getRedis();
    if (!redis) return result;

    // Limitar batch
    const batch = pubkeys.slice(0, MAX_BATCH);

    // Pipeline para buscar todos de uma vez
    const pipeline = redis.multi();
    for (const pubkey of batch) {
      pipeline.hGetAll(`${PREFIX}${pubkey}`);
    }
    const responses = await pipeline.exec();

    for (let i = 0; i < batch.length; i++) {
      const data = responses[i] as unknown as Record<string, string> | null;
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        result.set(batch[i], {
          pubkey: data.pubkey || batch[i],
          name: data.name || '',
          display_name: data.display_name || '',
          picture: data.picture || '',
          about: data.about || '',
          nip05: data.nip05 || '',
          lud16: data.lud16 || '',
          created_at: parseInt(data.created_at) || 0,
          cached_at: parseInt(data.cached_at) || 0
        });
      }
    }
  } catch {
    // Retorna o que conseguiu
  }

  return result;
}

/**
 * Construir um evento Nostr kind:0 a partir do cache.
 * Para enviar ao cliente como se viesse do strfry.
 */
export function profileToEvent(profile: CachedProfile): unknown {
  return {
    id: `cache-${profile.pubkey.substring(0, 16)}-${profile.created_at}`,
    pubkey: profile.pubkey,
    kind: 0,
    content: JSON.stringify({
      name: profile.name,
      display_name: profile.display_name,
      picture: profile.picture,
      about: profile.about,
      nip05: profile.nip05,
      lud16: profile.lud16
    }),
    created_at: profile.created_at,
    tags: [],
    sig: ''
  };
}

/**
 * Verificar se um pubkey tem perfil em cache.
 */
export async function hasProfile(pubkey: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false;
    return await redis.exists(`${PREFIX}${pubkey}`) > 0;
  } catch {
    return false;
  }
}

/**
 * Stats do cache de perfis.
 */
export async function getProfileCacheStats(): Promise<{ count: number }> {
  try {
    const redis = getRedis();
    if (!redis) return { count: 0 };

    const keys = await redis.keys(`${PREFIX}*`);
    return { count: keys.length };
  } catch {
    return { count: 0 };
  }
}
