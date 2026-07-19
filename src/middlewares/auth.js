const { verifyAccessToken } = require('../utils/helpers');
const { ROLES } = require('../utils/roles');
const { unauthorized, forbidden } = require('../utils/errors');

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    throw unauthorized('Bearer token is required');
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    throw unauthorized('Bearer token is required');
  }

  return token;
};

/**
 * Verifies the access token and attaches { userId, role } to the request.
 *
 * userId is a BigInt because every Prisma id in this schema is BigInt; passing
 * a string into a where clause throws at query time rather than silently
 * missing, so the conversion happens once, here.
 */
const requireAuth = (req, _res, next) => {
  try {
    const token = extractBearerToken(req);

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (error) {
      // jsonwebtoken's messages ("jwt expired", "invalid signature") are safe
      // to surface and help clients know whether to refresh.
      throw unauthorized(error.message);
    }

    if (!decoded.sub || !decoded.role) {
      throw unauthorized('Token is missing required claims');
    }

    let userId;
    try {
      userId = BigInt(decoded.sub);
    } catch {
      throw unauthorized('Token subject is not a valid user id');
    }

    req.user = { userId, role: decoded.role };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role gate. Runs after requireAuth, which guarantees req.user exists.
 * Kept separate from requireAuth so route definitions read as
 * "authenticated, and also an admin" rather than hiding the rule in one guard.
 */
const requireRole = (...allowedRoles) => (req, _res, next) => {
  if (!req.user) {
    return next(unauthorized('Authentication is required'));
  }

  if (!allowedRoles.includes(req.user.role)) {
    return next(forbidden('You do not have permission to perform this action'));
  }

  next();
};

const requireAdmin = [requireAuth, requireRole(ROLES.ADMIN)];
const requireUser = [requireAuth, requireRole(ROLES.USER, ROLES.ADMIN)];

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requireUser,
};
