/**
 * blacklist.ts — Compartilha a mesma blacklist do strfry
 *
 * Carrega /opt/strfry/plugins/blacklist.txt e recarrega a cada 60s.
 * Exporta isBlocked(pubkey) para uso no proxy e broadcast.
 */

import { readFileSync } from 'fs';
import { logger } from './logger';

const log = logger('blacklist');
const BLACKLIST_PATH = '/opt/strfry/plugins/blacklist.txt';
const RELOAD_INTERVAL_MS = 60_000;

let blocked = new Set<string>();

function load(): void {
  try {
    const raw = readFileSync(BLACKLIST_PATH, 'utf-8');
    const pubkeys = raw
      .split('\n')
      .map(l => l.trim().toLowerCase())
      .filter(l => l && !l.startsWith('#'));
    blocked = new Set(pubkeys);
    log.info(`Blacklist carregada: ${blocked.size} pubkeys`);
  } catch {
    log.warn('Blacklist nao encontrada, aceitando tudo');
    blocked = new Set();
  }
}

export function isBlocked(pubkey: string): boolean {
  return blocked.has(pubkey.toLowerCase());
}

// Carrega ao importar + refresh periodico
load();
setInterval(load, RELOAD_INTERVAL_MS);
