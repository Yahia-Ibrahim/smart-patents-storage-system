/**
 * Errors the API is willing to describe to a client.
 *
 * `expose: true` is what separates a deliberate 409 ("Email is already
 * registered") from an accidental 500 whose message might carry a connection
 * string or a query fragment. The error handler only forwards messages from
 * errors marked this way.
 */
class AppError extends Error {
  constructor(message, status, { code, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.expose = true;
    if (code) this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

const badRequest = (message, details) => new AppError(message, 400, { code: 'BAD_REQUEST', details });
const unauthorized = (message = 'Authentication is required') => new AppError(message, 401, { code: 'UNAUTHORIZED' });
const forbidden = (message = 'Forbidden') => new AppError(message, 403, { code: 'FORBIDDEN' });
const notFound = (message = 'Resource not found') => new AppError(message, 404, { code: 'NOT_FOUND' });
const conflict = (message) => new AppError(message, 409, { code: 'CONFLICT' });
const tooManyRequests = (message) => new AppError(message, 429, { code: 'TOO_MANY_REQUESTS' });

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
};
