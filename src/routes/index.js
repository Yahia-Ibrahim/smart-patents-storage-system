const express = require('express');
const patentRoutes = require('./patents');
const userRoutes = require('./users');
const inventorRoutes = require('./inventors');
const categoryRoutes = require('./categories');

const router = express.Router();

router.use('/patents', patentRoutes);
router.use('/users', userRoutes);
router.use('/inventors', inventorRoutes);
router.use('/categories', categoryRoutes);

module.exports = router;
