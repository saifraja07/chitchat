import Redis from 'ioredis';
import { config } from '../../config/env.js';
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
  return Math.min(attempt * 200, 5000);
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

  // Required: an 'error' event with zero listeners crashes the process
  // (standard Node EventEmitter behavior) — this isn't optional logging,
  // it's what keeps a transient Redis blip from taking the whole server
  // down. ioredis retries the connection on its own via retryStrategy
  // above regardless of whether this listener does anything else.
  client.on('error', (err) => console.error('Redis connection error:', err));

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
  } catch {
    return false;
  }
}

export async function disconnectRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // quit() can fail if the connection is already down; force-close instead.
    client.disconnect();
  } finally {
    client = null;
  }
}
