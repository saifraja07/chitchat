import { logger } from '../infra/logger/logger.js';
import { getRedisClient } from '../infra/redis/redisClient.js';

const STATS_INTERVAL_MS = Number.parseInt(process.env.STATS_INTERVAL_MS, 10) || 60_000;

/**
 * Logs a periodic snapshot of live counts — queue depths and rough
 * active-room count — as a single structured INFO line. This is
 * deliberately NOT a metrics platform (no Prometheus, no StatsD): it's
 * just a cheap, log-based way to see system load over time in whatever
 * log aggregation the deployment already has. `SCAN` (not `KEYS`) is
 * used for the room count so this never blocks Redis even if the
 * keyspace is large.
 *
 * Returns a stop function; call it during graceful shutdown.
 */
export function startStatsLogger() {
  const interval = setInterval(async () => {
    try {
      const redis = getRedisClient();
      const [videoQueueDepth, chatQueueDepth, roomCount] = await Promise.all([
        redis.llen('queue:video'),
        redis.llen('queue:chat'),
        countKeysByPattern(redis, 'room:*'),
      ]);

      logger.info(
        { videoQueueDepth, chatQueueDepth, activeRooms: roomCount },
        'Periodic stats snapshot'
      );
    } catch (err) {
      logger.warn({ err }, 'Stats snapshot failed (non-fatal)');
    }
  }, STATS_INTERVAL_MS);

  interval.unref(); // never keeps the process alive on its own

  return () => clearInterval(interval);
}

async function countKeysByPattern(redis, pattern) {
  let cursor = '0';
  let count = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = nextCursor;
    count += keys.length;
  } while (cursor !== '0');
  return count;
}
