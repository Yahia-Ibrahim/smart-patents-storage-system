const express = require('express');
const { searchInventors, createInventor, getAllInventors, getInventorById, updateInventor, deleteInventor } = require('../controllers/inventorController');
const { searchValidation } = require('../utils/validation');
const { requireUser } = require('../middlewares/auth');

const router = express.Router();

/**
 * @openapi
 * /inventors/search:
 *   get:
 *     summary: Search inventors
 *     tags: [Inventors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inventor search results
 */
router.get('/search', requireUser, searchValidation, searchInventors);
router.post('/', createInventor);
router.get('/', getAllInventors);
router.get('/:id', getInventorById);
router.put('/:id', updateInventor);
router.delete('/:id', deleteInventor);

module.exports = router;
