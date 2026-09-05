const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { sendError } = require('../utils/response');

const limitHandler = (_req, res) =>
  sendError(res, 429, 'TOO_MANY_REQUESTS', 'Too many requests, please try again later');

// Disabled under test: the suite deliberately fires many failed logins in a
// row, and a limiter would make assertions depend on execution order.
const skip = () => process.env.NODE_ENV === 'test';

const baseOptions = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
  skip,
};

/**
 * Brute-force protection for login.
 *
 * Keyed on IP *and* email, so an attacker spraying one password across many
 * accounts is throttled per target, and a shared office NAT does not lock
 * everyone out because one colleague fatfingered their password.
 *
 * skipSuccessfulRequests means a legitimate user typing one wrong password
 * then the right one never burns quota.
 */
/**
 * Named and exported rather than inlined, because it is the whole of the
 * brute-force policy and express-rate-limit does not expose it back off the
 * middleware — so inline, it could not be tested.
 *
 * Keyed on IP *and* email: an attacker spraying one password across many
 * accounts is throttled per target, and a shared office NAT does not lock
 * everyone out because one colleague fatfingered their password. The email is
 * lowercased and trimmed so varying case cannot buy a fresh quota.
 *
 * ipKeyGenerator collapses an IPv6 address to its /64 prefix; using req.ip raw
 * would let an IPv6 client rotate through addresses it already controls.
 */
const loginRateLimitKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';

  return `${ipKeyGenerator(req.ip)}:${email}`;
};

const loginLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: loginRateLimitKey,
});

// Signup is IP-keyed only: there is no account to target yet, so this is about
// stopping bulk account creation.
const signupLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

// Refresh is called routinely by every logged-in client, so the ceiling is
// high enough to be invisible in normal use and only catches token grinding.
const refreshLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

/**
 * Semantic search, which is the one endpoint that costs money per call.
 *
 * Every request embeds the query, hits Qdrant, and then waits on an LLM round
 * trip billed per token, so an unthrottled loop here is a bill rather than a
 * load problem. Keyed on the authenticated user rather than the IP, which the
 * route makes possible by mounting this *after* `requireUser`: quota should
 * follow the account, and an office behind one NAT should not share one.
 *
 * The IP fallback is unreachable through the route as mounted and exists so a
 * future unauthenticated mount degrades to IP keying rather than collapsing
 * every caller onto a single bucket.
 */
const aiSearchLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) =>
    req.user?.userId ? `user:${req.user.userId}` : `ip:${ipKeyGenerator(req.ip)}`,
});

module.exports = {
  loginRateLimitKey,
  loginLimiter,
  signupLimiter,
  refreshLimiter,
  aiSearchLimiter,
};
