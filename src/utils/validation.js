const { body, query, param, validationResult } = require('express-validator');
const { sendError } = require('./response');
const { MAX_PASSWORD_BYTES } = require('./helpers');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Validation failed',
      errors.array().map(({ path, msg }) => ({ field: path, message: msg })),
    );
  }

  next();
};

/**
 * Trim + lowercase only.
 *
 * express-validator's normalizeEmail() is deliberately not used: by default it
 * strips dots and subaddressing for Gmail, so j.o.h.n@gmail.com and
 * john+patents@gmail.com both collapse to john@gmail.com. Those are distinct
 * real mailboxes, and collapsing them means the second person to register hits
 * the unique constraint and can never sign up. Lowercasing is enough to make
 * lookups case-insensitive, which is the actual goal.
 */
const emailField = (field = 'email') =>
  body(field)
    .isString()
    .withMessage('Email must be a string')
    .bail()
    .trim()
    .toLowerCase()
    .isEmail()
    .withMessage('Email must be a valid email address')
    .bail()
    .isLength({ max: 255 })
    .withMessage('Email must be at most 255 characters');

/**
 * bcrypt only reads the first 72 bytes, so anything longer is silently
 * truncated and two different passwords could authenticate interchangeably.
 * The limit is measured in bytes, not characters: one emoji is 4 bytes.
 */
const passwordField = (field = 'password') =>
  body(field)
    .isString()
    .withMessage('Password must be a string')
    .bail()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .bail()
    .custom((value) => {
      if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
        throw new Error(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
      }
      return true;
    })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number');

const nameField = (field = 'name') =>
  body(field)
    .isString()
    .withMessage('Name must be a string')
    .bail()
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('Name must be between 2 and 255 characters');

/**
 * `role` is intentionally absent.
 *
 * It used to be an accepted, validated field here, which meant the signup
 * contract explicitly permitted role: "admin" from an untrusted body — a
 * self-service path to admin the moment the service layer passed req.body to
 * Prisma. Role is now assigned server-side; admins are created only by other
 * admins via POST /users/admins, or by the seed.
 */
const signupValidation = [
  nameField(),
  emailField(),
  passwordField(),
  handleValidationErrors,
];

const loginValidation = [
  emailField(),
  body('password').isString().notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

const refreshValidation = [
  body('refreshToken').isString().notEmpty().withMessage('Refresh token is required'),
  handleValidationErrors,
];

// Logout accepts an optional token: omitting it revokes the whole session set
// for the caller, which is what "log out everywhere" needs.
const logoutValidation = [
  body('refreshToken').optional().isString().notEmpty().withMessage('Refresh token must be a non-empty string'),
  handleValidationErrors,
];

const updateProfileValidation = [
  nameField().optional(),
  emailField().optional(),
  body().custom((value) => {
    if (!value || (value.name === undefined && value.email === undefined)) {
      throw new Error('Provide at least one of: name, email');
    }
    return true;
  }),
  handleValidationErrors,
];

const changePasswordValidation = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
  passwordField('newPassword'),
  body('newPassword').custom((value, { req }) => {
    if (value === req.body.currentPassword) {
      throw new Error('New password must be different from the current password');
    }
    return true;
  }),
  handleValidationErrors,
];

const createAdminValidation = [
  nameField(),
  emailField(),
  passwordField(),
  handleValidationErrors,
];

const listUsersValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100').toInt(),
  query('role').optional().isIn(['user', 'admin']).withMessage('Role must be either user or admin'),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 255 }),
  handleValidationErrors,
];

const idParamValidation = [
  param('id').matches(/^\d+$/).withMessage('Id must be a positive integer'),
  handleValidationErrors,
];

const patentSubmissionValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('categoryId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Category ID must be a positive integer'),
  handleValidationErrors,
];

const searchValidation = [
  query('query')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 1 })
    .withMessage('Search query must be at least 1 character long'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors,
];

const categoryValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be between 2 and 100 characters'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  signupValidation,
  loginValidation,
  refreshValidation,
  logoutValidation,
  updateProfileValidation,
  changePasswordValidation,
  createAdminValidation,
  listUsersValidation,
  idParamValidation,
  patentSubmissionValidation,
  searchValidation,
  categoryValidation,
};
