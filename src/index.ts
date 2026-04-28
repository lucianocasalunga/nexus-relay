import { config } from './utils/config';
import { logger } from './utils/logger';
import { connectRedis, disconnectRedis, cleanupStaleSets } from './redis/client';
import { startServer } from './server';
import { startBroadcastListener, stopBroadcastListener } from './broadcast';
import { pruneOldEvents } from './peers/cache-tracker';
import { classifyAllPeers } from './peers/classifier';
import { publishBadgeDefinition } from './badge';

const log = logger('nexus');

async function main(): Promise<void> {
  log.info('Nexus Relay v1.0.0 starting...');
  log.info(`config: port=${config.nexusPort} strfry=${config.strfryHost}:${config.strfryPort} redis=${config.redisUrl}`);

  // 1. Connect Redis
  await connectRedis();

  // 2. Cleanup stale peer sets from previous runs
  await cleanupStaleSets();

  // 3. Start WebSocket server (HTTP + WS)
  const wss = startServer();

  // 4. Start broadcast listener (subscribe to strfry for new events)
  startBroadcastListener();

  // 4b. Publish NIP-58 badge definition (idempotent — replaceable event kind 30009)
  publishBadgeDefinition().catch(err => log.warn(`badge definition: ${err.message}`));

  // 5. Prune old events from cache tracker every 10 minutes
  const pruneTimer = setInterval(pruneOldEvents, 10 * 60 * 1000);

  // 6. Classify peers every 60s (promote/demote based on criteria)
  const classifyTimer = setInterval(classifyAllPeers, 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    log.info('shutting down...');
    clearInterval(pruneTimer);
    clearInterval(classifyTimer);
    stopBroadcastListener();
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
