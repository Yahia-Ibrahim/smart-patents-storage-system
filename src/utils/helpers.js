const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const BCRYPT_COST = 12;

// bcrypt silently truncates input past 72 bytes, so two different long
// passwords sharing a 72-byte prefix would authenticate interchangeably.
// Validation rejects longer input; this constant is the shared source of truth.
const MAX_PASSWORD_BYTES = 72;

// Access tokens are bearer credentials that cannot be revoked before expiry,
// so they are deliberately short-lived; the refresh token carries longevity.
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

// Never fall back to a baked-in secret outside development: a misconfigured
// deploy would sign tokens anyone could forge, and do it silently.
const resolveJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  return 'dev-secret-change-me';
};

const JWT_SECRET = resolveJwtSecret();

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);

const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/**
 * A bcrypt comparison against a throwaway hash. Login uses this when no user
 * matches, so a missing account costs the same time as a wrong password and
 * the response cannot be used to enumerate registered emails.
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalisation', BCRYPT_COST);
const burnPasswordComparison = () => bcrypt.compare('dummy', DUMMY_HASH);

/**
 * The user id travels in `sub` as a plain string. The JWT signature already
 * makes it tamper-proof; encrypting it would add an unauthenticated cipher and
 * a silent failure mode without making the token any harder to forge.
 */
const signAccessToken = ({ userId, role }) =>
  jwt.sign({ role }, JWT_SECRET, {
    subject: String(userId),
    expiresIn: ACCESS_TOKEN_TTL,
  });

const verifyAccessToken = (token) => jwt.verify(token, JWT_SECRET);

/**
 * Refresh tokens are opaque random strings rather than JWTs: their authority
 * comes from a database lookup, so they can be revoked and rotated.
 */
const generateRefreshToken = () => crypto.randomBytes(48).toString('base64url');

/**
 * Plain SHA-256 is correct here even though it would be wrong for passwords:
 * the token is 384 bits of entropy, so there is nothing to brute-force, and a
 * fast hash keeps the per-refresh lookup cheap. Digest is 64 hex chars, which
 * matches REFRESH_TOKEN.token_hash VarChar(64).
 */
const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const refreshTokenExpiry = () =>
  new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

module.exports = {
  MAX_PASSWORD_BYTES,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  hashPassword,
  verifyPassword,
  burnPasswordComparison,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
};
