/**
 * One response shape for the whole API.
 *
 * Success: { success: true, data: ... }
 * Failure: { success: false, error: { code, message, details? } }
 *
 * Clients can branch on `success` alone and always find the human-readable
 * text at the same path, rather than checking `message` on some routes and
 * `error` on others.
 */

const sendSuccess = (res, status, data) => res.status(status).json({ success: true, data });

const sendError = (res, status, code, message, details) =>
  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });

module.exports = { sendSuccess, sendError };
