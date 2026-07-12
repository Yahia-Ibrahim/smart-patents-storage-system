const express = require('express');
const { signupUser, loginUser, createUser, getAllUsers, getUserById, updateUser, deleteUser } = require('../controllers/userController');
const { signupValidation, loginValidation } = require('../utils/validation');

const router = express.Router();

router.post('/signup', signupValidation, signupUser);
router.post('/login', loginValidation, loginUser);
router.post('/', createUser);
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
