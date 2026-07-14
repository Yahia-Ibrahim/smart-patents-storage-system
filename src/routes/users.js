const express = require('express');
const { signupUser, loginUser, createUser, getAllUsers, getUserById, updateUser, deleteUser } = require('../controllers/userController');
const { signupValidation, loginValidation } = require('../utils/validation');

const router = express.Router();

/**
 * @openapi
 * /users/signup:
 *   post:
 *     summary: Sign up a user
 *     tags: [Users]
 *     responses:
 *       201:
 *         description: User signed up
 */
router.post('/signup', signupValidation, signupUser);

/**
 * @openapi
 * /users/login:
 *   post:
 *     summary: Log in a user
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: User logged in
 */
router.post('/login', loginValidation, loginUser);
router.post('/', createUser);
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
