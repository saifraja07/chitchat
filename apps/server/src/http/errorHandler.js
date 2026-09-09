import { AppError } from './errors.js';

/**
 * Catches anything thrown/rejected in route handlers. Must be registered
 * last, after all other middleware and routes.
 */
export function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;

  // Only an unexpected (non-AppError) failure is worth printing — an
  // AppError is an intentionally-raised, already-understood condition
  // (e.g. a 404), not a bug to investigate.
  if (!isAppError) {
    console.error(`Request error [${req.method} ${req.path}]:`, err);
  }

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
