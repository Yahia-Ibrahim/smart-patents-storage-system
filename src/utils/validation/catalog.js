const { body, query } = require('express-validator');
const { handleValidationErrors, emailField, nameField } = require('./shared');

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
  body('organization').optional({ values: 'null' }).isString().trim().isLength({ max: 255 }),
  body('linkToMe').optional().isBoolean().withMessage('linkToMe must be a boolean').toBoolean(),
  handleValidationErrors,
];

const updateInventorValidation = [
  nameField('fullName').optional(),
  emailField().optional(),
  body('organization').optional({ values: 'null' }).isString().trim().isLength({ max: 255 }),
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

module.exports = {
  categoryValidation,
  listCategoriesValidation,
  createInventorValidation,
  updateInventorValidation,
};
