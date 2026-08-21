const { body, query } = require('express-validator');
const { handleValidationErrors, emailField, passwordField, nameField } = require('./shared');

/**
 * Account and session request shapes.
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

module.exports = {
  signupValidation,
  loginValidation,
  refreshValidation,
  logoutValidation,
  updateProfileValidation,
  changePasswordValidation,
  createAdminValidation,
  listUsersValidation,
};
