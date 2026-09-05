import { Router } from 'express';
import { isRedisHealthy } from '../infra/redis/redisClient.js';

export const healthRouter = Router();

/**
 * Liveness: is the process up and able to respond at all. Used by
 * orchestrators to decide whether to restart the container.
 */
healthRouter.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Readiness: is the process able to actually serve traffic, i.e. are its
 * dependencies reachable. Used by load balancers to decide whether to
 * route traffic to this instance.
 */
healthRouter.get('/health/ready', async (req, res) => {
  const redisHealthy = await isRedisHealthy();
  const healthy = redisHealthy;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    dependencies: {
      redis: redisHealthy ? 'up' : 'down',
    },
  });
});
