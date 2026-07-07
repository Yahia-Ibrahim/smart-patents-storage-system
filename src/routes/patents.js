const express = require('express');
const { createPatent, getAllPatents, getPatentById, updatePatent, deletePatent } = require('../controllers/patentController');

const router = express.Router();

router.post('/', createPatent);
router.get('/', getAllPatents);
router.get('/:id', getPatentById);
router.put('/:id', updatePatent);
router.delete('/:id', deletePatent);

module.exports = router;
