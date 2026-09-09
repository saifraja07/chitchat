import http from 'node:http';
import { config, assertProductionConfig } from './config/env.js';
import { createApp } from './http/app.js';
import { createSocketServer } from './ws/socketServer.js';
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
    console.error('Initial Redis connection failed; exiting (Redis is required):', err);
    process.exit(1);
  }

  const io = await createSocketServer(httpServer);

  httpServer.listen(config.port, () => {
    console.log(`Server listening on port ${config.port} (${config.nodeEnv})`);
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceExitTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExitTimer.unref();

    try {
      io.close();
      await new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await disconnectRedis();
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    console.error('Unhandled promise rejection:', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
