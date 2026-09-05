import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from '../config/env.js';
import { logger } from '../infra/logger/logger.js';
import { healthRouter } from './healthRoutes.js';
import { errorHandler, notFoundHandler } from './errorHandler.js';

export function createApp() {
  const app = express();

  // Behind a load balancer in production; needed for correct client IPs
  // in logs/rate-limiting without trusting spoofable headers blindly.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: false,
    })
  );

  app.use(express.json({ limit: config.requestBodyLimit }));

  app.use(
    pinoHttp({
      logger,
      // Avoid logging full request/response bodies or headers that
      // could contain sensitive data.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    })
  );

  const globalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(globalLimiter);

  app.use(healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
