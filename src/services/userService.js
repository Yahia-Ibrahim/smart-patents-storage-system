const prisma = require('../config/prisma');
const { ROLES } = require('../utils/roles');
const { unauthorized, conflict, notFound, badRequest } = require('../utils/errors');
const {
  hashPassword,
  verifyPassword,
  burnPasswordComparison,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} = require('../utils/helpers');

/**
 * Issues an access/refresh pair and records the refresh token's hash.
 * Every path that establishes a session goes through here so that token
 * lifetime and storage rules exist in exactly one place.
 */
const issueSession = async (user, client = prisma) => {
  const refreshToken = generateRefreshToken();

  await client.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
    },
  });

  return {
    accessToken: signAccessToken({ userId: user.id, role: user.role }),
    refreshToken,
  };
};

/**
 * Self-service registration. Always creates a `user`; the caller has no say in
 * the role. Admins come from the seed or from createAdmin below.
 */
const signupUser = async ({ name, email, password }) => {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    throw conflict('Email is already registered');
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: ROLES.USER,
    },
  });

  return { user, tokens: await issueSession(user) };
};

/**
 * Authenticates by email + password.
 *
 * Both "no such user" and "wrong password" return the same error, and the
 * no-user branch still performs a bcrypt comparison against a dummy hash.
 * Without that, a missing account would answer in ~1ms while a real one takes
 * ~250ms, and the timing difference alone would reveal which emails are
 * registered.
 */
const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await burnPasswordComparison();
    throw unauthorized('Invalid email or password');
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw unauthorized('Invalid email or password');
  }

  return { user, tokens: await issueSession(user) };
};

/**
 * Exchanges a refresh token for a new pair, rotating the old one.
 *
 * Reuse detection: a token that was already rotated must never be accepted
 * again. Seeing one means it leaked (the legitimate client would have moved on
 * to the new token), so every session for that user is revoked rather than
 * just rejecting the request.
 */
const refreshSession = async (refreshToken) => {
  const tokenHash = hashRefreshToken(refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) {
    throw unauthorized('Invalid refresh token');
  }

  // Reuse detection. A token that was already rotated is being presented again,
  // which means it leaked: the legitimate client would have moved on to its
  // replacement. Revoke every session for the user and reject.
  //
  // This revocation runs on its own, NOT inside the transaction below: the
  // rejection throws, and a throw rolls its transaction back — which would
  // silently undo the very revocation that protects the account.
  if (stored.rotatedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Refresh token has already been used; all sessions have been revoked');
  }

  if (stored.revokedAt) {
    throw unauthorized('Refresh token has been revoked');
  }

  if (stored.expiresAt <= new Date()) {
    throw unauthorized('Refresh token has expired');
  }

  return prisma.$transaction(async (tx) => {
    // Conditional rotation: only proceed if the token is still un-rotated. Two
    // concurrent requests carrying the same token cannot both succeed — the
    // loser sees count 0 and is rejected rather than minting a second session.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: stored.id, rotatedAt: null },
      data: { rotatedAt: new Date(), revokedAt: new Date() },
    });

    if (count === 0) {
      throw unauthorized('Invalid refresh token');
    }

    return { user: stored.user, tokens: await issueSession(stored.user, tx) };
  });
};

/**
 * Revokes one session, or every session for the user when no token is given.
 * Idempotent: logging out twice is not an error worth surfacing.
 */
const logoutUser = async ({ userId, refreshToken }) => {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return;
  }

  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { inventorProfile: true },
  });

  if (!user) {
    throw notFound('User not found');
  }

  return user;
};

const updateProfile = async (userId, { name, email }) => {
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing && existing.id !== userId) {
      throw conflict('Email is already registered');
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
    },
    include: { inventorProfile: true },
  });
};

/**
 * Changing a password revokes every session.
 *
 * The point of a password change is often "someone else may have my
 * credentials". Leaving existing refresh tokens alive would let the attacker
 * keep their session indefinitely despite the new password.
 */
const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw notFound('User not found');
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw unauthorized('Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
};

/**
 * Admin-only admin creation. `createdBy` records which admin did it, which is
 * the audit trail; the FK is Restrict, so that record cannot be erased by
 * deleting the creator.
 */
const createAdmin = async ({ name, email, password }, createdByUserId) => {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    throw conflict('Email is already registered');
  }

  return prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: ROLES.ADMIN,
      createdBy: createdByUserId,
    },
  });
};

const listUsers = async ({ page = 1, limit = 20, role, search }) => {
  const where = {
    ...(role ? { role } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { users, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getUserById = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { inventorProfile: true },
  });

  if (!user) {
    throw notFound('User not found');
  }

  return user;
};

module.exports = {
  signupUser,
  loginUser,
  refreshSession,
  logoutUser,
  getProfile,
  updateProfile,
  changePassword,
  createAdmin,
  listUsers,
  getUserById,
};
