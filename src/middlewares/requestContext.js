const crypto = require('crypto');

/**
 * Attaches a request id and echoes it back.
 *
 * The point is traceability: when a user reports "I got a 500", the error
 * response carries an id that appears in exactly one log line. Without it, the
 * only way to find the failure is guessing from timestamps.
 *
 * An inbound X-Request-Id is honoured so a gateway or client-side trace id
 * survives into this service's logs rather than being replaced at the edge.
 */
const requestContext = (req, res, next) => {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && inbound.length <= 128 && /^[A-Za-z0-9._-]+$/.test(inbound)
      ? inbound
      : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

module.exports = { requestContext };
