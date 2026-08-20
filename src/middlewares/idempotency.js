const crypto = require('crypto');
const prisma = require('../config/prisma');
const { conflict } = require('../utils/errors');

/**
 * Replay protection for mutating requests.
 *
 * The case this exists for: a client POSTs a patent, the connection drops
 * before the response arrives, the client retries. Without a key the retry
 * creates a second patent and the user has no way to tell.
 *
 * That retry is usually **concurrent** with the original — the first request is
 * still running when the client gives up on it. So a look-then-insert would not
 * help: both requests would find no row and both would create a patent. Instead
 * the key is *reserved* up front with a single insert, and the unique primary
 * key makes the database decide which request owns it.
 *
 * Storage is keyed by (userId, endpoint, key) so one caller's key cannot
 * collide with another's, and `requestHash` catches a client reusing a key with
 * a different body — returning the first request's answer for that would be
 * worse than an error.
 *
 * The header is optional. Making it mandatory would break every naive client
 * for a guarantee most requests do not need.
 */

/** A reserved-but-unfinished request. No HTTP status is 0, so it cannot collide. */
const IN_FLIGHT = 0;

const hashBody = (body) =>
  crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

const idempotency = () => async (req, res, next) => {
  const key = req.headers['idempotency-key'];

  if (!key || !req.user) return next();

  if (typeof key !== 'string' || key.length > 255) {
    return next(conflict('Idempotency-Key must be a string of at most 255 characters'));
  }

  const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
  const requestHash = hashBody(req.body);
  const id = { userId: req.user.userId, endpoint, key };

  // Reserve the key. Winning this insert is what grants the right to run the
  // handler; losing it means someone else already owns this key.
  try {
    await prisma.idempotencyKey.create({
      data: { ...id, requestHash, responseStatus: IN_FLIGHT, responseBody: {} },
    });
  } catch (error) {
    if (error.code !== 'P2002') return next(error);

    const existing = await prisma.idempotencyKey.findUnique({
      where: { userId_endpoint_key: id },
    });

    // Vanishingly rare: the row was deleted between the failed insert and this
    // read. Treat it as unreserved rather than crashing.
    if (!existing) return next();

    if (existing.requestHash !== requestHash) {
      return next(conflict('This Idempotency-Key was already used with a different request body'));
    }

    if (existing.responseStatus === IN_FLIGHT) {
      // 409 rather than blocking: the original request is still running, and
      // holding this connection open until it finishes would tie up a
      // connection per retry for as long as the first request takes.
      return next(
        conflict('A request with this Idempotency-Key is still in progress; retry shortly'),
      );
    }

    res.setHeader('Idempotent-Replay', 'true');
    return res.status(existing.responseStatus).json(existing.responseBody);
  }

  // Record the outcome before sending, so a client that retries the instant it
  // sees the response always finds the record already written.
  //
  // A non-2xx releases the reservation instead of storing it: a failed request
  // must stay retryable, and caching a 500 would pin the caller to it forever.
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const settle =
      res.statusCode >= 200 && res.statusCode < 300
        ? prisma.idempotencyKey.update({
            where: { userId_endpoint_key: id },
            data: { responseStatus: res.statusCode, responseBody: body },
          })
        : prisma.idempotencyKey.delete({ where: { userId_endpoint_key: id } });

    settle
      .catch((error) => console.error('[idempotency] failed to settle key:', error.message))
      .finally(() => originalJson(body));

    return res;
  };

  return next();
};

module.exports = { IN_FLIGHT, idempotency };
