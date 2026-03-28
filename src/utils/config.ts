import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../../.env') });

export const config = {
  nexusPort: parseInt(process.env.NEXUS_PORT || '8888', 10),
  strfryHost: process.env.STRFRY_HOST || '127.0.0.1',
  strfryPort: parseInt(process.env.STRFRY_PORT || '7777', 10),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
  peerTtl: parseInt(process.env.PEER_TTL || '120', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export function strfryWsUrl(): string {
  return `ws://${config.strfryHost}:${config.strfryPort}`;
}
