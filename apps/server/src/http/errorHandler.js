import { logger } from '../infra/logger/logger.js';
import { AppError } from './errors.js';

/**
 * Catches anything thrown/rejected in route handlers. Must be registered
 * last, after all other middleware and routes.
 */
export function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;

  logger.error(
    { err, path: req.path, method: req.method, statusCode },
    'Request error'
  );

  const message = isAppError && err.expose ? err.message : 'Internal server error';

  res.status(statusCode).json({
    error: {
      message,
      // Never expose internal infrastructure details (stack traces,
      // dependency errors, file paths) in the response body.
    },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: 'Not found' } });
}
