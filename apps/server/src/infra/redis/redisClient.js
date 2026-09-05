import Redis from 'ioredis';
import { config } from '../../config/env.js';
import { logger } from '../logger/logger.js';
import { registerMatchmakingCommands } from './luaCommands.js';

/**
 * Single shared Redis client, created lazily and reused across the app.
 *
 * Retry strategy: ioredis calls this after every failed connection
 * attempt with the number of attempts so far, and we return the number
 * of milliseconds to wait before the next attempt (capped, with backoff).
 * Returning a number keeps ioredis retrying forever, which is what we
 * want for a dependency we can't function fully without but shouldn't
 * crash the process over.
 */
function retryStrategy(attempt) {
  const delay = Math.min(attempt * 200, 5000);
  logger.warn({ attempt, delayMs: delay }, 'Redis connection retry scheduled');
  return delay;
}

let client = null;

export function getRedisClient() {
  if (client) return client;

  client = new Redis(config.redisUrl, {
    retryStrategy,
    maxRetriesPerRequest: 3,
    connectTimeout: config.redisConnectTimeoutMs,
    // Don't queue commands indefinitely while disconnected — fail fast
    // so callers (e.g. matchmaking in later phases) can respond to the
    // client instead of hanging.
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on('connect', () => logger.info('Redis connecting'));
  client.on('ready', () => logger.info('Redis connection ready'));
  client.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  client.on('close', () => logger.warn('Redis connection closed'));
  client.on('reconnecting', () => logger.info('Redis reconnecting'));
  client.on('end', () => logger.warn('Redis connection ended (no more retries)'));

  registerMatchmakingCommands(client);

  return client;
}

export async function connectRedis() {
  const redis = getRedisClient();
  if (redis.status === 'ready' || redis.status === 'connecting') return redis;
  await redis.connect();
  return redis;
}

export async function isRedisHealthy() {
  if (!client) return false;
  try {
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error({ err }, 'Redis health check failed');
    return false;
  }
}

export async function disconnectRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch (err) {
    // quit() can fail if the connection is already down; force-close instead.
    logger.warn({ err }, 'Redis quit failed, disconnecting forcibly');
    client.disconnect();
  } finally {
    client = null;
  }
}
