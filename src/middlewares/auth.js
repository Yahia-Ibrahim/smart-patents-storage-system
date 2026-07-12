const { verifyToken, decryptValue } = require('../utils/helpers');

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    const error = new Error('Bearer token is required');
    error.status = 401;
    throw error;
  }

  return authHeader.slice(7).trim();
};

const attachAuthenticatedUser = (req, requiredRole) => {
  const token = extractBearerToken(req);
  const decoded = verifyToken(token);
  const role = decoded.role;

  if (!role) {
    const error = new Error('User role is missing from token');
    error.status = 401;
    throw error;
  }

  if (requiredRole && role !== requiredRole) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  req.user = {
    ...decoded,
    userId: decryptValue(decoded.sub || decoded.userId || decoded.id),
  };

  return req.user;
};

const protectUser = (req, _res, next) => {
  try {
    const user = attachAuthenticatedUser(req);

    if (!['user', 'admin'].includes(user.role)) {
      const error = new Error('Forbidden');
      error.status = 403;
      throw error;
    }

    next();
  } catch (error) {
    error.status = error.status || 401;
    next(error);
  }
};

const protectAdmin = (req, _res, next) => {
  try {
    attachAuthenticatedUser(req, 'admin');
    next();
  } catch (error) {
    error.status = error.status || 401;
    next(error);
  }
};

module.exports = {
  protectUser,
  protectAdmin,
};
