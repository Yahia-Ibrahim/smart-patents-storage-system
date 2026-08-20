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

/* ------------------------------------------------------------------------ *
 * Patents
 *
 * The previous chain here validated `title` / `description` / `categoryId` —
 * fields that do not exist on the PATENT table. It predated the schema and
 * would have rejected every valid submission while accepting nonsense. These
 * match the model.
 * ------------------------------------------------------------------------ */

const titleField = (chain) =>
  chain
    .isString()
    .withMessage('Title must be a string')
    .bail()
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('Title must be between 3 and 500 characters');

const longTextField = (chain, label, max) =>
  chain
    .isString()
    .withMessage(`${label} must be a string`)
    .bail()
    .trim()
    .isLength({ min: 20, max })
    .withMessage(`${label} must be between 20 and ${max} characters`);

/**
 * The key must look like one this API issued. A client-supplied key is a
 * path-traversal and cross-user-overwrite primitive; the shape check here is
 * the cheap first gate, and storageService.keyBelongsToUser is the real one.
 */
const documentKeyField = (chain) =>
  chain
    .isString()
    .bail()
    .matches(/^patents\/\d+\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/)
    .withMessage('documentKey must be a key issued by POST /patents/uploads');

const publicationNumberField = (chain) =>
  chain
    .isString()
    .bail()
    .trim()
    .isLength({ min: 3, max: 64 })
    .withMessage('Publication number must be between 3 and 64 characters');

const jurisdictionField = (chain) =>
  chain
    .isString()
    .bail()
    .trim()
    .toUpperCase()
    .isLength({ min: 2, max: 8 })
    .withMessage('Jurisdiction must be between 2 and 8 characters');

const categoryIdsField = (chain) =>
  chain
    .isArray({ max: 20 })
    .withMessage('categoryIds must be an array of at most 20 ids')
    .bail()
    .custom((values) => {
      if (values.some((value) => !/^\d+$/.test(String(value)))) {
        throw new Error('categoryIds must contain positive integers');
      }
      return true;
    });

const inventorsField = (chain) =>
  chain
    .isArray({ max: 50 })
    .withMessage('inventors must be an array of at most 50 entries')
    .bail()
    .custom((values) => {
      values.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          throw new Error(`inventors[${index}] must be an object`);
        }
        if (!/^\d+$/.test(String(entry.inventorId))) {
          throw new Error(`inventors[${index}].inventorId must be a positive integer`);
        }
        if (entry.order !== undefined && !Number.isInteger(entry.order)) {
          throw new Error(`inventors[${index}].order must be an integer`);
        }
      });
      return true;
    });

const uploadRequestValidation = [
  body('filename')
    .isString()
    .bail()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('filename is required and must be at most 255 characters'),
  body('contentType').isString().bail().trim().notEmpty().withMessage('contentType is required'),
  handleValidationErrors,
];

const createPatentValidation = [
  titleField(body('title')),
  longTextField(body('abstract'), 'Abstract', 10000),
  longTextField(body('specification'), 'Specification', 200000),
  documentKeyField(body('documentKey')),
  publicationNumberField(body('publicationNumber').optional({ values: 'falsy' })),
  jurisdictionField(body('jurisdiction').optional({ values: 'falsy' })),
  categoryIdsField(body('categoryIds').optional()),
  inventorsField(body('inventors').optional()),
  handleValidationErrors,
];

const updatePatentValidation = [
  titleField(body('title').optional()),
  longTextField(body('abstract').optional(), 'Abstract', 10000),
  longTextField(body('specification').optional(), 'Specification', 200000),
  documentKeyField(body('documentKey').optional()),
  publicationNumberField(body('publicationNumber').optional({ values: 'falsy' })),
  jurisdictionField(body('jurisdiction').optional({ values: 'falsy' })),
  categoryIdsField(body('categoryIds').optional()),
  inventorsField(body('inventors').optional()),
  body().custom((value) => {
    const editable = [
      'title',
      'abstract',
      'specification',
      'documentKey',
      'publicationNumber',
      'jurisdiction',
      'categoryIds',
      'inventors',
    ];
    if (!value || !editable.some((field) => value[field] !== undefined)) {
      throw new Error(`Provide at least one of: ${editable.join(', ')}`);
    }
    return true;
  }),
  handleValidationErrors,
];

const approvePatentValidation = [
  body('comments').optional({ values: 'falsy' }).isString().trim().isLength({ max: 5000 }),
  handleValidationErrors,
];

/**
 * Comments are required on a decline and optional on an approve: a rejected
 * submitter needs to know what to fix, and "declined, no reason given" is the
 * least useful thing this API could return.
 */
const declinePatentValidation = [
  body('comments')
    .isString()
    .bail()
    .trim()
    .isLength({ min: 5, max: 5000 })
    .withMessage('A reason is required when declining a patent (5-5000 characters)'),
  handleValidationErrors,
];

const listPatentsValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100').toInt(),
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['draft', 'pending_ai', 'pending_admin', 'approved', 'declined'])
    .withMessage('Unknown status'),
  query('categoryId')
    .optional({ values: 'falsy' })
    .matches(/^\d+$/)
    .withMessage('categoryId must be a positive integer'),
  query('submittedBy')
    .optional({ values: 'falsy' })
    .matches(/^\d+$/)
    .withMessage('submittedBy must be a positive integer'),
  query('jurisdiction')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .toUpperCase()
    .isLength({ min: 2, max: 8 }),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 255 }),
  handleValidationErrors,
];

/* ------------------------------------------------------------------------ *
 * Categories and inventors
 * ------------------------------------------------------------------------ */

const categoryValidation = [
  body('name')
    .isString()
    .withMessage('Category name must be a string')
    .bail()
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('Category name must be between 2 and 255 characters'),
  handleValidationErrors,
];

const listCategoriesValidation = [
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 255 }),
  handleValidationErrors,
];

const createInventorValidation = [
  nameField('fullName'),
  emailField(),
  body('organization').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
  body('linkToMe').optional().isBoolean().withMessage('linkToMe must be a boolean').toBoolean(),
  handleValidationErrors,
];

const updateInventorValidation = [
  nameField('fullName').optional(),
  emailField().optional(),
  body('organization').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
  body().custom((value) => {
    if (
      !value ||
      (value.fullName === undefined && value.email === undefined && value.organization === undefined)
    ) {
      throw new Error('Provide at least one of: fullName, email, organization');
    }
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
  signupValidation,
  loginValidation,
  refreshValidation,
  logoutValidation,
  updateProfileValidation,
  changePasswordValidation,
  createAdminValidation,
  listUsersValidation,
  idParamValidation,
  searchValidation,
  uploadRequestValidation,
  createPatentValidation,
  updatePatentValidation,
  approvePatentValidation,
  declinePatentValidation,
  listPatentsValidation,
  categoryValidation,
  listCategoriesValidation,
  createInventorValidation,
  updateInventorValidation,
};
