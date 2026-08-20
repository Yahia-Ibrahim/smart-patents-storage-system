const { Prisma } = require('@prisma/client');
const { sendError } = require('../utils/response');

exports.notFound = (_req, res) => sendError(res, 404, 'NOT_FOUND', 'Route not found');

/**
 * Translates the few Prisma failures that represent a client mistake rather
 * than a server fault. Without this a duplicate email surfaces as a 500 with
 * an internal message; with it, the caller gets an actionable 409.
 */
const mapPrismaError = (err) => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (err.code) {
    case 'P2002':
      return { status: 409, code: 'CONFLICT', message: 'A record with that value already exists' };
    case 'P2025':
      return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' };
    case 'P2003':
      return { status: 409, code: 'CONFLICT', message: 'Operation violates a database constraint' };
    default:
      return null;
  }
};

// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
exports.errorHandler = (err, _req, res, _next) => {
  const mapped = mapPrismaError(err);
  const status = mapped?.status || err.status || 500;

  // Never let an unexpected error's message reach the client: it may carry a
  // connection string, a query, or a file path. Only errors explicitly marked
  // safe (utils/errors.js) or deliberately mapped above are forwarded.
  const isSafeToExpose = mapped || err.expose === true;
  const message = isSafeToExpose ? mapped?.message || err.message : 'Internal Server Error';
  // err.code is only forwarded when the error is safe to expose. An unmapped
  // Prisma error would otherwise leak its code (P2000, P2011, ...) in the body
  // of an otherwise-generic 500, telling the caller which constraint they hit.
  const code = isSafeToExpose
    ? mapped?.code || err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR')
    : 'INTERNAL_ERROR';

  if (status >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(err);
  }

  sendError(res, status, code, message, err.details);
};
