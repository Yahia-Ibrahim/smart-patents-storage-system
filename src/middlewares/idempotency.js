const crypto = require('crypto');
const prisma = require('../config/prisma');
const { conflict } = require('../utils/errors');

/**
 * Replay protection for mutating requests.
 *
 * The case this exists for: a client POSTs a patent, the connection drops
 * before the response arrives, the client retries. Without a key the retry
 * creates a second patent and the user has no way to tell. With one, the retry
 * returns the original response.
 *
 * Storage is keyed by (userId, endpoint, key) so one caller's key cannot
 * collide with another's, and `requestHash` catches the case where a client
 * reuses a key with a different body — that is a client bug, and returning the
 * first request's answer for it would be worse than an error.
 *
 * The header is optional. Making it mandatory would break every naive client
 * for a guarantee most requests do not need.
 */

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
  const where = { userId_endpoint_key: { userId: req.user.userId, endpoint, key } };

  try {
    const existing = await prisma.idempotencyKey.findUnique({ where });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return next(
          conflict('This Idempotency-Key was already used with a different request body'),
        );
      }

      res.setHeader('Idempotent-Replay', 'true');
      return res.status(existing.responseStatus).json(existing.responseBody);
    }
  } catch (error) {
    return next(error);
  }

  // Capture the response, persist it, and only then send.
  //
  // Persisting *before* responding is deliberate. Firing the write off and
  // returning immediately would be faster, but it leaves a database write in
  // flight after the request is over: the caller can receive a 201, retry, and
  // find no record yet — which is precisely the duplicate this middleware
  // exists to prevent. (It also strands transactions past the end of a test,
  // which is how this was found.)
  //
  // Only successes are recorded: a failed request should stay retryable, and
  // caching a 500 would pin the caller to it forever.
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (res.statusCode < 200 || res.statusCode >= 300) return originalJson(body);

    prisma.idempotencyKey
      .create({
        data: {
          key,
          userId: req.user.userId,
          endpoint,
          requestHash,
          responseStatus: res.statusCode,
          responseBody: body,
        },
      })
      .catch((error) => {
        // A lost race (two concurrent identical requests) throws P2002. Both
        // are returning the same answer anyway, so it is not worth failing on.
        if (error.code !== 'P2002') {
          console.error('[idempotency] failed to record response:', error.message);
        }
      })
      .finally(() => originalJson(body));

    return res;
  };

  return next();
};

module.exports = { idempotency };
