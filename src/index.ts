import { config } from './utils/config';
import { logger } from './utils/logger';
import { connectRedis, disconnectRedis } from './redis/client';
import { startServer } from './server';

const log = logger('nexus');

async function main(): Promise<void> {
  log.info('Nexus Relay v0.1.0 starting...');
  log.info(`config: port=${config.nexusPort} strfry=${config.strfryHost}:${config.strfryPort} redis=${config.redisUrl}`);

  // 1. Connect Redis
  await connectRedis();

  // 2. Start WebSocket server
  const wss = startServer();

  // Graceful shutdown
  const shutdown = async () => {
    log.info('shutting down...');
    wss.close();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('fatal error', err);
  process.exit(1);
});
