const { body, query } = require('express-validator');
const { handleValidationErrors, isBigIntId } = require('./shared');

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
      if (values.some((value) => !isBigIntId(value))) {
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
        if (!isBigIntId(entry.inventorId)) {
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
  publicationNumberField(body('publicationNumber').optional({ values: 'null' })),
  jurisdictionField(body('jurisdiction').optional({ values: 'null' })),
  categoryIdsField(body('categoryIds').optional()),
  inventorsField(body('inventors').optional()),
  handleValidationErrors,
];

const updatePatentValidation = [
  titleField(body('title').optional()),
  longTextField(body('abstract').optional(), 'Abstract', 10000),
  longTextField(body('specification').optional(), 'Specification', 200000),
  documentKeyField(body('documentKey').optional()),
  publicationNumberField(body('publicationNumber').optional({ values: 'null' })),
  jurisdictionField(body('jurisdiction').optional({ values: 'null' })),
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
  body('comments').optional({ values: 'null' }).isString().trim().isLength({ max: 5000 }),
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
    .custom((value) => {
      if (!isBigIntId(value)) throw new Error('categoryId must be a positive integer');
      return true;
    }),
  query('submittedBy')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (!isBigIntId(value)) throw new Error('submittedBy must be a positive integer');
      return true;
    }),
  query('jurisdiction')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .toUpperCase()
    .isLength({ min: 2, max: 8 }),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 255 }),
  handleValidationErrors,
];

module.exports = {
  uploadRequestValidation,
  createPatentValidation,
  updatePatentValidation,
  approvePatentValidation,
  declinePatentValidation,
  listPatentsValidation,
};
