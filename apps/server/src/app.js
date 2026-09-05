import http from 'node:http';
import { config, assertProductionConfig } from './config/env.js';
import { logger } from './infra/logger/logger.js';
import { createApp } from './http/app.js';
import { createSocketServer } from './ws/socketServer.js';
import { startStatsLogger } from './ws/statsLogger.js';
import { connectRedis, disconnectRedis } from './infra/redis/redisClient.js';

async function main() {
  assertProductionConfig();

  const app = createApp();
  const httpServer = http.createServer(app);

  // Redis is a hard dependency as of matchmaking: sessions, queues, and
  // rooms all live there, and the Socket.IO cross-instance adapter needs
  // a live connection to attach. Unlike Phase 1 (where Redis was only
  // used for a health-check nicety), failing to connect here means the
  // app genuinely can't do its job — so we fail fast and let the process
  // manager restart us, rather than starting in a half-working state.
  try {
    await connectRedis();
  } catch (err) {
    logger.error({ err }, 'Initial Redis connection failed; exiting (Redis is required)');
    process.exit(1);
  }

  const io = await createSocketServer(httpServer);
  const stopStatsLogger = startStatsLogger();

  httpServer.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Server listening');
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutdown initiated');

    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExitTimer.unref();

    try {
      stopStatsLogger();
      io.close();
      await new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await disconnectRedis();
      clearTimeout(forceExitTimer);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
