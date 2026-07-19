const express = require('express');
const {
  signupUser,
  loginUser,
  refreshSession,
  logoutUser,
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  createAdmin,
  getAllUsers,
  getUserById,
} = require('../controllers/userController');
const {
  signupValidation,
  loginValidation,
  refreshValidation,
  logoutValidation,
  updateProfileValidation,
  changePasswordValidation,
  createAdminValidation,
  listUsersValidation,
  idParamValidation,
} = require('../utils/validation');
const { requireAuth, requireUser, requireAdmin } = require('../middlewares/auth');
const { loginLimiter, signupLimiter, refreshLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @openapi
 * /users/signup:
 *   post:
 *     summary: Register a new user account
 *     description: >
 *       Always creates an account with the `user` role. Roles cannot be set by
 *       the client; admins are created via POST /users/admins or the seed.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Ada Lovelace }
 *               email: { type: string, format: email, example: ada@example.com }
 *               password: { type: string, format: password, example: Passw0rd123 }
 *     responses:
 *       201: { description: Account created; returns the user and a token pair }
 *       400: { description: Validation failed }
 *       409: { description: Email is already registered }
 *       429: { description: Too many signups from this IP }
 */
router.post('/signup', signupLimiter, signupValidation, signupUser);

/**
 * @openapi
 * /users/login:
 *   post:
 *     summary: Log in and receive a token pair
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: Authenticated; returns the user and a token pair }
 *       400: { description: Validation failed }
 *       401: { description: Invalid email or password }
 *       429: { description: Too many failed attempts }
 */
router.post('/login', loginLimiter, loginValidation, loginUser);

/**
 * @openapi
 * /users/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new token pair
 *     description: >
 *       Refresh tokens rotate: the presented token is revoked and a new one
 *       issued. Presenting an already-rotated token is treated as theft and
 *       revokes every session for that user.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: New token pair issued }
 *       401: { description: Refresh token is invalid, expired, revoked, or reused }
 */
router.post('/refresh', refreshLimiter, refreshValidation, refreshSession);

/* -------------------------------------------------------------------------- */
/* Authenticated (any role)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @openapi
 * /users/logout:
 *   post:
 *     summary: Revoke the current session, or all sessions
 *     description: Omit `refreshToken` to revoke every session for the caller.
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: Logged out }
 *       401: { description: Authentication required }
 */
router.post('/logout', requireAuth, logoutValidation, logoutUser);

/**
 * @openapi
 * /users/me:
 *   get:
 *     summary: Get the authenticated user's profile
 *     tags: [Profile]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The caller's profile, including any linked inventor record }
 *       401: { description: Authentication required }
 */
router.get('/me', requireUser, getMyProfile);

/**
 * @openapi
 * /users/me:
 *   patch:
 *     summary: Update the authenticated user's profile
 *     description: Provide at least one of `name` or `email`.
 *     tags: [Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Updated profile }
 *       400: { description: Validation failed }
 *       401: { description: Authentication required }
 *       409: { description: Email is already registered }
 */
router.patch('/me', requireUser, updateProfileValidation, updateMyProfile);

/**
 * @openapi
 * /users/me/password:
 *   put:
 *     summary: Change the authenticated user's password
 *     description: Revokes every session on success; the client must log in again.
 *     tags: [Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password }
 *               newPassword: { type: string, format: password }
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Validation failed }
 *       401: { description: Current password is incorrect }
 */
router.put('/me/password', requireUser, changePasswordValidation, changeMyPassword);

/* -------------------------------------------------------------------------- */
/* Admin only                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @openapi
 * /users/admins:
 *   post:
 *     summary: Create a new admin account (admin only)
 *     description: Records the creating admin in `createdBy` as an audit trail.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       201: { description: Admin created }
 *       400: { description: Validation failed }
 *       401: { description: Authentication required }
 *       403: { description: Caller is not an admin }
 *       409: { description: Email is already registered }
 */
router.post('/admins', requireAdmin, createAdminValidation, createAdmin);

/**
 * @openapi
 * /users:
 *   get:
 *     summary: List users (admin only)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: role, schema: { type: string, enum: [user, admin] } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches name or email }
 *     responses:
 *       200: { description: Paginated users }
 *       401: { description: Authentication required }
 *       403: { description: Caller is not an admin }
 */
router.get('/', requireAdmin, listUsersValidation, getAllUsers);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get a user by id (admin only)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The user }
 *       401: { description: Authentication required }
 *       403: { description: Caller is not an admin }
 *       404: { description: User not found }
 */
// Registered after /me so that the literal path is not swallowed by :id.
router.get('/:id', requireAdmin, idParamValidation, getUserById);

module.exports = router;
