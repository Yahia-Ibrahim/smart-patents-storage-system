const express = require('express');
const { createCategory, getAllCategories, getCategoryById, updateCategory, deleteCategory } = require('../controllers/categoryController');

const router = express.Router();

router.post('/', createCategory);
router.get('/', getAllCategories);
router.get('/:id', getCategoryById);
router.put('/:id', updateCategory);
router.delete('/:id', deleteCategory);

module.exports = router;
