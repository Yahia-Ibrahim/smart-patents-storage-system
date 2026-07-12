const express = require('express');
const { searchInventors, createInventor, getAllInventors, getInventorById, updateInventor, deleteInventor } = require('../controllers/inventorController');
const { searchValidation } = require('../utils/validation');
const { protectUser } = require('../middlewares/auth');

const router = express.Router();

router.get('/search', protectUser, searchValidation, searchInventors);
router.post('/', createInventor);
router.get('/', getAllInventors);
router.get('/:id', getInventorById);
router.put('/:id', updateInventor);
router.delete('/:id', deleteInventor);

module.exports = router;
