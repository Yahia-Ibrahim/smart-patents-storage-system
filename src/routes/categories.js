const express = require('express');
const {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');
const {
  categoryValidation,
  listCategoriesValidation,
  idParamValidation,
} = require('../utils/validation');
const { requireUser, requireAdmin } = require('../middlewares/auth');

const router = express.Router();

/**
 * @openapi
 * /categories:
 *   get:
 *     summary: List categories
 *     tags: [Categories]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Categories, alphabetical }
 */
router.get('/', requireUser, listCategoriesValidation, getAllCategories);

/**
 * @openapi
 * /categories/{id}:
 *   get:
 *     summary: Get a category by id
 *     tags: [Categories]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Category }
 *       404: { description: Not found }
 */
router.get('/:id', requireUser, idParamValidation, getCategoryById);

/**
 * @openapi
 * /categories:
 *   post:
 *     summary: Create a category (admin)
 *     tags: [Categories]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201: { description: Created }
 *       409: { description: Name already exists }
 */
router.post('/', requireAdmin, categoryValidation, createCategory);

/**
 * @openapi
 * /categories/{id}:
 *   patch:
 *     summary: Rename a category (admin)
 *     tags: [Categories]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       409: { description: Name already exists }
 */
router.patch('/:id', requireAdmin, idParamValidation, categoryValidation, updateCategory);

/**
 * @openapi
 * /categories/{id}:
 *   delete:
 *     summary: Delete a category (admin)
 *     description: Detaches the category from patents; never deletes patents.
 *     tags: [Categories]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/:id', requireAdmin, idParamValidation, deleteCategory);

module.exports = router;
