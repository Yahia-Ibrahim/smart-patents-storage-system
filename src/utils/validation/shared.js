const { body, query, param, validationResult } = require('express-validator');
const { sendError } = require('../response');
const { MAX_PASSWORD_BYTES } = require('../helpers');

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

/**
 * Ids are Postgres BIGINT. `/^\d+$/` alone accepts a 40-digit number, which
 * BigInt() happily parses and the driver then rejects at the wire — surfacing
 * as a 500 for what is plainly a bad request. Bounding it here keeps that a 400.
 */
const MAX_BIGINT = 9223372036854775807n;

const isBigIntId = (value) => {
  if (!/^\d{1,19}$/.test(String(value))) return false;
  return BigInt(value) > 0n && BigInt(value) <= MAX_BIGINT;
};

const idParamValidation = [
  param('id').custom((value) => {
    if (!isBigIntId(value)) throw new Error('Id must be a positive integer');
    return true;
  }),
  handleValidationErrors,
];

/**
 * Generic paginated search. `.toInt()` matters: without it the service receives
 * "2" and "20" as strings and Prisma's skip/take reject them at query time.
 */
const searchValidation = [
  query('search').optional({ values: 'falsy' }).trim().isLength({ min: 1, max: 255 }),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer').toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  emailField,
  passwordField,
  nameField,
  isBigIntId,
  idParamValidation,
  searchValidation,
};
