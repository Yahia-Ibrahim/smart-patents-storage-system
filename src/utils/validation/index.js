/**
 * express-validator chains, grouped by the thing they validate.
 *
 * Split out of a single 438-line module: the chains for four unrelated domains
 * shared a file only because they shared a technology. Routes still import
 * `../utils/validation`, which resolves here, so nothing downstream had to
 * change.
 *
 *   shared.js   — primitives (email, password, name, id, pagination) and the
 *                 handleValidationErrors terminator every chain ends with
 *   users.js    — signup, login, sessions, profile, admin management
 *   patents.js  — uploads, create/update, review decisions, listing
 *   catalog.js  — categories and inventors
 */
module.exports = {
  ...require('./shared'),
  ...require('./users'),
  ...require('./patents'),
  ...require('./catalog'),
};
