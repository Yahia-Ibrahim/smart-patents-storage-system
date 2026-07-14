const express = require('express');
const { submitPatent, approvePatent, declinePatent, getPatent, searchPatents, requestPatentUrl, createPatent, getAllPatents, getPatentById, updatePatent, deletePatent } = require('../controllers/patentController');
const { patentSubmissionValidation, searchValidation } = require('../utils/validation');
const { protectUser, protectAdmin } = require('../middlewares/auth');

const router = express.Router();

/**
 * @openapi
 * /patents/submit:
 *   post:
 *     summary: Submit a new patent
 *     tags: [Patents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description]
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               categoryId:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Patent submitted
 */
router.post('/submit', protectUser, patentSubmissionValidation, submitPatent);

/**
 * @openapi
 * /patents/requesturl:
 *   post:
 *     summary: Create a patent request URL placeholder endpoint
 *     tags: [Patents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Patent request URL endpoint placeholder
 */
router.post('/requesturl', protectUser, requestPatentUrl);

/**
 * @openapi
 * /patents/approve:
 *   post:
 *     summary: Approve a patent
 *     tags: [Patents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Patent approved
 */
router.post('/approve', protectAdmin, approvePatent);

/**
 * @openapi
 * /patents/decline:
 *   post:
 *     summary: Decline a patent
 *     tags: [Patents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Patent declined
 */
router.post('/decline', protectAdmin, declinePatent);

/**
 * @openapi
 * /patents/get:
 *   get:
 *     summary: Get a patent by query or identifier
 *     tags: [Patents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Patent retrieved
 */
router.get('/get', protectUser, searchValidation, getPatent);

/**
 * @openapi
 * /patents/search:
 *   get:
 *     summary: Search patents with pagination
 *     tags: [Patents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated patent search results
 */
router.get('/search', protectUser, searchValidation, searchPatents);

/**
 * @openapi
 * /patents:
 *   post:
 *     summary: Create a patent (placeholder)
 *     tags: [Patents]
 *     responses:
 *       201:
 *         description: Patent created
 */
router.post('/', createPatent);

/**
 * @openapi
 * /patents:
 *   get:
 *     summary: List patents (placeholder)
 *     tags: [Patents]
 *     responses:
 *       200:
 *         description: List of patents
 */
router.get('/', getAllPatents);

/**
 * @openapi
 * /patents/{id}:
 *   get:
 *     summary: Get a patent by id (placeholder)
 *     tags: [Patents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Patent found
 */
router.get('/:id', getPatentById);

/**
 * @openapi
 * /patents/{id}:
 *   put:
 *     summary: Update a patent (placeholder)
 *     tags: [Patents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Patent updated
 */
router.put('/:id', updatePatent);

/**
 * @openapi
 * /patents/{id}:
 *   delete:
 *     summary: Delete a patent (placeholder)
 *     tags: [Patents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Patent deleted
 */
router.delete('/:id', deletePatent);

module.exports = router;
