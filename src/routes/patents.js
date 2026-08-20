const express = require('express');
const {
  requestUpload,
  createPatent,
  listPatents,
  getPatentById,
  updatePatent,
  submitPatent,
  approvePatent,
  declinePatent,
  deletePatent,
  listReviews,
  getDocumentUrl,
} = require('../controllers/patentController');
const {
  uploadRequestValidation,
  createPatentValidation,
  updatePatentValidation,
  approvePatentValidation,
  declinePatentValidation,
  listPatentsValidation,
  idParamValidation,
} = require('../utils/validation');
const { requireUser, requireAdmin } = require('../middlewares/auth');
const { idempotency } = require('../middlewares/idempotency');

const router = express.Router();

/**
 * @openapi
 * /patents/uploads:
 *   post:
 *     summary: Request a presigned URL for uploading a patent document
 *     description: >
 *       Returns a short-lived URL the client PUTs the document to directly.
 *       The returned objectKey is then passed as documentKey to POST /patents.
 *       Uploads never pass through this API.
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [filename, contentType]
 *             properties:
 *               filename: { type: string }
 *               contentType: { type: string, example: application/pdf }
 *     responses:
 *       201: { description: Presigned upload target }
 *       400: { description: Unsupported content type }
 */
router.post('/uploads', requireUser, uploadRequestValidation, requestUpload);

/**
 * @openapi
 * /patents:
 *   post:
 *     summary: Create a patent as a draft
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema: { type: string }
 *         description: Optional. A repeated key returns the original response.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, abstract, specification, documentKey]
 *             properties:
 *               title: { type: string }
 *               abstract: { type: string }
 *               specification: { type: string }
 *               documentKey: { type: string }
 *               publicationNumber: { type: string }
 *               jurisdiction: { type: string, example: US }
 *               categoryIds:
 *                 type: array
 *                 items: { type: string }
 *               inventors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     inventorId: { type: string }
 *                     order: { type: integer }
 *     responses:
 *       201: { description: Draft patent created }
 *       400: { description: Validation failed or document missing }
 *       409: { description: Duplicate publication number }
 */
router.post('/', requireUser, createPatentValidation, idempotency(), createPatent);

/**
 * @openapi
 * /patents:
 *   get:
 *     summary: List patents visible to the caller
 *     description: >
 *       Non-admins see their own patents in any state plus everyone's approved
 *       patents. Admins see everything.
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, pending_ai, pending_admin, approved, declined] } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: submittedBy, schema: { type: string } }
 *       - { in: query, name: jurisdiction, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated patents }
 */
router.get('/', requireUser, listPatentsValidation, listPatents);

/**
 * @openapi
 * /patents/{id}:
 *   get:
 *     summary: Get a patent by id
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Patent }
 *       404: { description: Not found or not visible to the caller }
 */
router.get('/:id', requireUser, idParamValidation, getPatentById);

/**
 * @openapi
 * /patents/{id}:
 *   patch:
 *     summary: Edit a draft or declined patent
 *     description: Content changes increment the patent version.
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated patent }
 *       409: { description: Patent is not in an editable state }
 */
router.patch('/:id', requireUser, idParamValidation, updatePatentValidation, updatePatent);

/**
 * @openapi
 * /patents/{id}:
 *   delete:
 *     summary: Delete a draft patent
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: Only drafts can be deleted }
 */
router.delete('/:id', requireUser, idParamValidation, deletePatent);

/**
 * @openapi
 * /patents/{id}/submit:
 *   post:
 *     summary: Submit a draft for admin review
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Patent moved to pending_admin }
 *       409: { description: Illegal state transition }
 */
router.post('/:id/submit', requireUser, idParamValidation, submitPatent);

/**
 * @openapi
 * /patents/{id}/document:
 *   get:
 *     summary: Get a presigned download URL for the patent document
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Presigned download URL }
 *       404: { description: Patent not visible, or has no document }
 */
router.get('/:id/document', requireUser, idParamValidation, getDocumentUrl);

/**
 * @openapi
 * /patents/{id}/reviews:
 *   get:
 *     summary: Review history for a patent
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Reviews, newest first }
 */
router.get('/:id/reviews', requireUser, idParamValidation, listReviews);

/**
 * @openapi
 * /patents/{id}/approve:
 *   post:
 *     summary: Approve a patent (admin)
 *     description: >
 *       Moves the patent to approved, records a review, and enqueues a
 *       PatentVersionUpserted event in the same transaction. This is the point
 *       at which a patent enters the searchable corpus.
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Approved }
 *       409: { description: Patent is not pending review }
 */
router.post('/:id/approve', requireAdmin, idParamValidation, approvePatentValidation, approvePatent);

/**
 * @openapi
 * /patents/{id}/decline:
 *   post:
 *     summary: Decline a patent (admin)
 *     description: >
 *       Comments are required. Declining a previously approved patent also
 *       enqueues a PatentVersionWithdrawn event so downstream projections drop it.
 *     tags: [Patents]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [comments]
 *             properties:
 *               comments: { type: string }
 *     responses:
 *       200: { description: Declined }
 *       409: { description: Illegal state transition }
 */
router.post('/:id/decline', requireAdmin, idParamValidation, declinePatentValidation, declinePatent);

module.exports = router;
