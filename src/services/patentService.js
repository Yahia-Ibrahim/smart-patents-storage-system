const prisma = require('../config/prisma');
const { conflict, notFound } = require('../utils/errors');
const outboxService = require('./outboxService');
const {
  AGGREGATE_TYPE,
  patentVersionUpserted,
  patentVersionWithdrawn,
} = require('../events/patentEvents');

const access = require('./patents/access');
const documents = require('./patents/documents');
const relations = require('./patents/relations');
const {
  STATUS,
  EDITABLE_STATUSES,
  assertTransition,
  applyTransition,
} = require('./patents/lifecycle');

/**
 * Patent workflow.
 *
 * This module orchestrates; it does not decide. The rules live in siblings so
 * each has one reason to change and can be tested without an HTTP request:
 *
 *   patents/access.js     — who may see or modify what
 *   patents/lifecycle.js  — which status transitions are legal
 *   patents/documents.js  — uploads, downloads, and document ownership
 *   patents/relations.js  — category and inventor link validation
 */

const { PATENT_INCLUDE } = access;

/** Content fields. Changing any of these bumps `version`; nothing else does. */
const CONTENT_FIELDS = ['title', 'abstract', 'specification', 'documentKey'];
const METADATA_FIELDS = ['publicationNumber', 'jurisdiction'];

/**
 * `publicationNumber` is unique, so this is belt-and-braces: a concurrent
 * create can still lose the race and hit the constraint, which the error
 * handler maps to a 409 anyway. The point of checking first is the message —
 * "that publication number is taken" instead of a generic conflict.
 */
const assertPublicationNumberFree = async (publicationNumber, exceptId = null) => {
  if (!publicationNumber) return;

  const clash = await prisma.patent.findUnique({ where: { publicationNumber } });

  if (clash && clash.id !== exceptId) {
    throw conflict('A patent with that publication number already exists');
  }
};

const createPatent = async (input, user) => {
  const { title, abstract, specification, documentKey, publicationNumber, jurisdiction } = input;

  await documents.verifyDocument(documentKey, user.userId);

  const inventorLinks = await relations.resolveInventorLinks(input.inventors);
  const categoryIds = await relations.resolveCategoryIds(input.categoryIds);

  await assertPublicationNumberFree(publicationNumber);

  return prisma.patent.create({
    data: {
      title,
      abstract,
      specification,
      documentKey,
      publicationNumber: publicationNumber || null,
      jurisdiction: jurisdiction || null,
      // Set explicitly rather than relying on the column default: where a
      // patent starts is a business rule, and business rules belong somewhere
      // a reader will look.
      status: STATUS.DRAFT,
      version: 1,
      submittedBy: user.userId,
      categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      inventors: { create: inventorLinks },
    },
    include: PATENT_INCLUDE,
  });
};

const listPatents = async ({ page = 1, limit = 20, ...filters }, user) => {
  const where = access.buildListFilter(filters, user);

  const [total, patents] = await prisma.$transaction([
    prisma.patent.count({ where }),
    prisma.patent.findMany({
      where,
      include: PATENT_INCLUDE,
      // Tie-broken by id: `createdAt` alone is not unique, and rows sharing a
      // timestamp can otherwise appear on two pages or on neither.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { patents, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getPatentById = (id, user) => access.findVisiblePatent(id, user);

/**
 * Edits are allowed only before review and after rejection.
 *
 * A content change bumps `version`; category, inventor and metadata edits do
 * not. `version` identifies content downstream, so bumping it for a category
 * fix would make the Search Service re-embed text that never changed.
 */
const updatePatent = async (id, updates, user) => {
  const patent = await access.findOwnedPatent(id, user);

  if (!EDITABLE_STATUSES.includes(patent.status)) {
    throw conflict(`A patent with status "${patent.status}" cannot be edited`);
  }

  const replacingDocument = updates.documentKey && updates.documentKey !== patent.documentKey;

  if (replacingDocument) {
    // Verified against the *caller*, not the submitter: an admin editing
    // someone else's patent uploads under their own id, so checking the
    // submitter's namespace would reject every admin document replacement.
    await documents.verifyDocument(updates.documentKey, user.userId, { allowPatentId: id });
  }

  await assertPublicationNumberFree(updates.publicationNumber, id);

  const inventorLinks =
    updates.inventors !== undefined ? await relations.resolveInventorLinks(updates.inventors) : null;
  const categoryIds =
    updates.categoryIds !== undefined
      ? await relations.resolveCategoryIds(updates.categoryIds)
      : null;

  const scalar = {};
  for (const field of [...CONTENT_FIELDS, ...METADATA_FIELDS]) {
    if (updates[field] !== undefined) scalar[field] = updates[field];
  }

  const contentChanged = CONTENT_FIELDS.some(
    (field) => updates[field] !== undefined && updates[field] !== patent[field],
  );

  const updated = await prisma.$transaction(async (tx) => {
    // Re-assert editability inside the transaction. Without the status in the
    // WHERE clause an edit could land on a patent submitted for review a
    // millisecond earlier, silently mutating something under review.
    const { count } = await tx.patent.updateMany({
      where: { id, status: { in: EDITABLE_STATUSES } },
      data: { ...scalar, ...(contentChanged ? { version: { increment: 1 } } : {}) },
    });

    if (count === 0) {
      const current = await tx.patent.findUnique({ where: { id }, select: { status: true } });
      throw conflict(`A patent with status "${current?.status}" cannot be edited`);
    }

    if (categoryIds) {
      await tx.patentCategory.deleteMany({ where: { patentId: id } });
      await tx.patentCategory.createMany({
        data: categoryIds.map((categoryId) => ({ patentId: id, categoryId })),
      });
    }

    if (inventorLinks) {
      await tx.patentInventor.deleteMany({ where: { patentId: id } });
      await tx.patentInventor.createMany({
        data: inventorLinks.map((link) => ({ patentId: id, ...link })),
      });
    }

    return tx.patent.findUnique({ where: { id }, include: PATENT_INCLUDE });
  });

  // Only once the row is committed: the old object is unreferenced now, and
  // leaving it would accumulate an orphan per document replacement.
  if (replacingDocument) await documents.discardObject(patent.documentKey);

  return updated;
};

const submitForReview = async (id, user) => {
  const patent = await access.findOwnedPatent(id, user);

  assertTransition(patent, 'submit');

  if (!patent.documentKey) {
    throw conflict('A patent cannot be submitted without an uploaded document');
  }

  return prisma.$transaction((tx) =>
    applyTransition(tx, id, 'submit', { submittedAt: new Date() }, PATENT_INCLUDE),
  );
};

/**
 * Records an admin decision and, when the decision changes corpus membership,
 * enqueues the event describing it — all in one transaction, so the event can
 * never diverge from the status that produced it.
 */
const review = async (id, action, { decision, comments }, admin, buildEvent) => {
  const patent = await prisma.patent.findUnique({ where: { id }, include: PATENT_INCLUDE });

  if (!patent) throw notFound('Patent not found');

  assertTransition(patent, action);

  return prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: whether this decision changes corpus
    // membership depends on the status the write actually landed on, not on
    // what a read before the transaction happened to see.
    const before = await tx.patent.findUnique({ where: { id }, select: { status: true } });
    const updated = await applyTransition(
      tx,
      id,
      action,
      { reviewedAt: new Date() },
      PATENT_INCLUDE,
    );

    await tx.patentReview.create({
      data: {
        patentId: id,
        reviewerId: admin.userId,
        reviewStage: 'admin_review',
        decision,
        comments: comments || null,
      },
    });

    const event = buildEvent(updated, before.status);

    if (event) {
      await outboxService.enqueue(tx, {
        aggregateType: AGGREGATE_TYPE,
        aggregateId: id,
        eventType: event.event_type,
        payload: event,
      });
    }

    return updated;
  });
};

/** Approval is the moment a patent joins the corpus, so it always emits. */
const approvePatent = (id, { comments }, admin) =>
  review(id, 'approve', { decision: 'pass', comments }, admin, (patent) =>
    patentVersionUpserted(patent),
  );

/**
 * Declining an *approved* patent withdraws it from the corpus. Declining one
 * that was only pending emits nothing — it never entered the corpus, so there
 * is nothing downstream to remove.
 */
const declinePatent = (id, { comments }, admin) =>
  review(id, 'decline', { decision: 'fail', comments }, admin, (patent, previousStatus) =>
    previousStatus === STATUS.APPROVED ? patentVersionWithdrawn(patent, 'declined') : null,
  );

/**
 * Hard delete, drafts only. Anything that has been through review is retained:
 * a review trail its subject can erase is not a review trail.
 */
const deletePatent = async (id, user) => {
  const patent = await access.findOwnedPatent(id, user);

  if (patent.status !== STATUS.DRAFT) {
    throw conflict(`Only a draft can be deleted; this patent is "${patent.status}"`);
  }

  await prisma.$transaction(async (tx) => {
    // Status in the WHERE clause, so a delete cannot race a submit and remove
    // a patent that is already under review.
    const { count } = await tx.patent.deleteMany({ where: { id, status: STATUS.DRAFT } });

    if (count === 0) {
      const current = await tx.patent.findUnique({ where: { id }, select: { status: true } });
      throw conflict(`Only a draft can be deleted; this patent is "${current?.status}"`);
    }
  });

  // Safe now: documentKey is unique, so nothing else points at this object.
  await documents.discardObject(patent.documentKey);
};

/**
 * Owner-or-admin, not merely "can see the patent": comments are internal
 * examiner notes and every row names the reviewing admin.
 */
const listReviews = async (id, user) => {
  await access.findOwnedPatent(id, user);

  return prisma.patentReview.findMany({
    where: { patentId: id },
    include: { reviewer: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

const getDocumentUrl = async (id, user) =>
  documents.presignDownload(await access.findVisiblePatent(id, user));

const requestUpload = (input, user) => documents.requestUpload(input, user);

module.exports = {
  STATUS,
  PATENT_INCLUDE,
  visibilityWhere: access.visibilityWhere,
  requestUpload,
  createPatent,
  listPatents,
  getPatentById,
  updatePatent,
  submitForReview,
  approvePatent,
  declinePatent,
  deletePatent,
  listReviews,
  getDocumentUrl,
};
