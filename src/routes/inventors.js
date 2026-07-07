const express = require('express');
const { createInventor, getAllInventors, getInventorById, updateInventor, deleteInventor } = require('../controllers/inventorController');

const router = express.Router();

router.post('/', createInventor);
router.get('/', getAllInventors);
router.get('/:id', getInventorById);
router.put('/:id', updateInventor);
router.delete('/:id', deleteInventor);

module.exports = router;
