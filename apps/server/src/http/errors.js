/**
 * Base class for errors we deliberately raise (as opposed to unexpected
 * bugs/exceptions). `statusCode` and `expose` let the error handler decide
 * what's safe to send to the client.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, { expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}
