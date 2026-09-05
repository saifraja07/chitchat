import pino from 'pino';
import { config } from '../../config/env.js';

/**
 * Central structured logger. Import this everywhere instead of using
 * console.* directly, so log format/level/redaction stays consistent.
 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
    remove: true,
  },
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

export default logger;
