const express = require('express');
const {
  createInventor,
  getAllInventors,
  getInventorById,
  updateInventor,
  deleteInventor,
} = require('../controllers/inventorController');
const {
  searchValidation,
  createInventorValidation,
  updateInventorValidation,
  idParamValidation,
} = require('../utils/validation');
const { requireUser, requireAdmin } = require('../middlewares/auth');

const router = express.Router();

/**
 * @openapi
 * /inventors:
 *   get:
 *     summary: List or search inventors
 *     tags: [Inventors]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Paginated inventors }
 */
router.get('/', requireUser, searchValidation, getAllInventors);

/**
 * @openapi
 * /inventors/{id}:
 *   get:
 *     summary: Get an inventor by id
 *     tags: [Inventors]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Inventor }
 *       404: { description: Not found }
 */
router.get('/:id', requireUser, idParamValidation, getInventorById);

/**
 * @openapi
 * /inventors:
 *   post:
 *     summary: Create an inventor
 *     description: >
 *       An inventor need not have an account here. Set linkToMe to attach the
 *       profile to the calling user; one account maps to at most one inventor.
 *     tags: [Inventors]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string }
 *               organization: { type: string }
 *               linkToMe: { type: boolean }
 *     responses:
 *       201: { description: Created }
 *       409: { description: Email already used, or account already linked }
 */
router.post('/', requireUser, createInventorValidation, createInventor);

/**
 * @openapi
 * /inventors/{id}:
 *   patch:
 *     summary: Update an inventor (admin, or the linked user)
 *     tags: [Inventors]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       403: { description: Not an admin and not the linked user }
 */
router.patch('/:id', requireUser, idParamValidation, updateInventorValidation, updateInventor);

/**
 * @openapi
 * /inventors/{id}:
 *   delete:
 *     summary: Delete an inventor (admin)
 *     description: Refused while the inventor is credited on any patent.
 *     tags: [Inventors]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: Inventor is credited on patents }
 */
router.delete('/:id', requireAdmin, idParamValidation, deleteInventor);

module.exports = router;
