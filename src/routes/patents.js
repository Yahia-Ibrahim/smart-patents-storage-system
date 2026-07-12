const express = require('express');
const { submitPatent, approvePatent, declinePatent, getPatent, searchPatents, createPatent, getAllPatents, getPatentById, updatePatent, deletePatent } = require('../controllers/patentController');
const { patentSubmissionValidation, searchValidation } = require('../utils/validation');
const { protectUser, protectAdmin } = require('../middlewares/auth');

const router = express.Router();

router.post('/submit', protectUser, patentSubmissionValidation, submitPatent);
router.post('/approve', protectAdmin, approvePatent);
router.post('/decline', protectAdmin, declinePatent);
router.get('/get', protectUser, searchValidation, getPatent);
router.get('/search', protectUser, searchValidation, searchPatents);
router.post('/', createPatent);
router.get('/', getAllPatents);
router.get('/:id', getPatentById);
router.put('/:id', updatePatent);
router.delete('/:id', deletePatent);

module.exports = router;
