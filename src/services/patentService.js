const prisma = require('../config/prisma');
const config = require('../config/env');
const { ROLES } = require('../utils/roles');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const storageService = require('./storageService');
const outboxService = require('./outboxService');
const {
  AGGREGATE_TYPE,
  EVENT_TYPES,
  patentVersionUpserted,
  patentVersionWithdrawn,
} = require('../events/patentEvents');

/**
 * Patent lifecycle and the source of truth for corpus membership.
 *
 * Two rules live here and nowhere else:
 *
 *  1. **Visibility is data-scoped, not just role-scoped.** `requireUser` only
 *     proves someone is logged in. It does not stop them reading another
 *     user's draft, so every read goes through `visibilityWhere`.
 *  2. **Status transitions are validated server-side.** The client never sends
 *     a status; it calls an action, and the service decides whether that
 *     action is legal from the current state.
 */

const STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_AI: 'pending_ai',
  PENDING_ADMIN: 'pending_admin',
  APPROVED: 'approved',
  DECLINED: 'declined',
});

/**
 * Legal transitions. `pending_ai` is reachable by nothing: the AI pre-screen
 * is a separate service owned by another engineer, so the enum value is
 * reserved and deliberately unused rather than faked.
 */
const TRANSITIONS = Object.freeze({
  submit: { from: [STATUS.DRAFT, STATUS.DECLINED], to: STATUS.PENDING_ADMIN },
  approve: { from: [STATUS.PENDING_ADMIN], to: STATUS.APPROVED },
  decline: { from: [STATUS.PENDING_ADMIN, STATUS.APPROVED], to: STATUS.DECLINED },
});

/** Content fields; changing any of these bumps `version`. See the schema note. */
const CONTENT_FIELDS = ['title', 'abstract', 'specification', 'documentKey'];

const PATENT_INCLUDE = {
  submitter: { select: { id: true, name: true, email: true } },
  categories: { include: { category: true } },
  inventors: { include: { inventor: true }, orderBy: { inventorOrder: 'asc' } },
};

const isAdmin = (user) => user.role === ROLES.ADMIN;

/**
 * What this caller is allowed to see.
 *
 * Admins see everything. Everyone else sees their own patents in any state,
 * plus other people's only once approved — an unapproved patent is private to
 * its submitter.
 */
const visibilityWhere = (user) =>
  isAdmin(user) ? {} : { OR: [{ submittedBy: user.userId }, { status: STATUS.APPROVED }] };

const findVisiblePatent = async (id, user) => {
  const patent = await prisma.patent.findFirst({
    where: { id, ...visibilityWhere(user) },
    include: PATENT_INCLUDE,
  });

  // 404 rather than 403 for an invisible patent: a 403 would confirm that the
  // id exists, which is itself a small information leak.
  if (!patent) throw notFound('Patent not found');

  return patent;
};

const findOwnedPatent = async (id, user) => {
  const patent = await prisma.patent.findUnique({ where: { id }, include: PATENT_INCLUDE });

  if (!patent) throw notFound('Patent not found');

  if (patent.submittedBy !== user.userId && !isAdmin(user)) {
    throw forbidden('You can only modify patents you submitted');
  }

  return patent;
};

const assertTransition = (patent, action) => {
  const rule = TRANSITIONS[action];

  if (!rule.from.includes(patent.status)) {
    throw conflict(
      `Cannot ${action} a patent with status "${patent.status}"; expected one of: ${rule.from.join(', ')}`,
    );
  }

  return rule.to;
};

/**
 * Confirms the uploaded object exists, belongs to this user, and is within the
 * size limit.
 *
 * The size check happens here rather than on the presigned URL because a
 * presigned PUT cannot express a maximum content length on its own — the only
 * reliable moment to enforce it is after the upload, before the row is written.
 */
const verifyDocument = async (objectKey, userId) => {
  if (!storageService.keyBelongsToUser(objectKey, userId)) {
    throw badRequest('documentKey was not issued to you; request one from POST /patents/uploads');
  }

  const head = await storageService.headObject(objectKey);

  if (!head) {
    throw badRequest('No uploaded document found for that documentKey');
  }

  if (head.size > config.storage.maxUploadBytes) {
    await storageService.deleteObject(objectKey);
    throw badRequest(
      `Uploaded document is ${head.size} bytes; the maximum is ${config.storage.maxUploadBytes}`,
    );
  }

  return head;
};

/**
 * Validates the inventor list: ids must exist, appear once, and carry a
 * contiguous 1..N ordering. Sloppy ordering is accepted silently by the
 * database (it is just an integer) and then confuses every consumer, so it is
 * rejected here.
 */
const resolveInventorLinks = async (inventors) => {
  if (!inventors || inventors.length === 0) return [];

  const ids = inventors.map((entry) => BigInt(entry.inventorId));
  const unique = new Set(ids.map(String));

  if (unique.size !== ids.length) {
    throw badRequest('The same inventor cannot be listed twice on a patent');
  }

  const found = await prisma.inventor.findMany({ where: { id: { in: ids } }, select: { id: true } });

  if (found.length !== ids.length) {
    const known = new Set(found.map((row) => String(row.id)));
    const missing = ids.map(String).filter((id) => !known.has(id));
    throw badRequest(`Unknown inventor id(s): ${missing.join(', ')}`);
  }

  const orders = inventors.map((entry, index) => entry.order ?? index + 1);
  const sorted = [...orders].sort((a, b) => a - b);
  const contiguous = sorted.every((value, index) => value === index + 1);

  if (!contiguous) {
    throw badRequest('inventor order must be a contiguous sequence starting at 1');
  }

  return inventors.map((entry, index) => ({
    inventorId: BigInt(entry.inventorId),
    inventorOrder: entry.order ?? index + 1,
  }));
};

const resolveCategoryIds = async (categoryIds) => {
  if (!categoryIds || categoryIds.length === 0) return [];

  const ids = [...new Set(categoryIds.map(String))].map(BigInt);
  const found = await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true } });

  if (found.length !== ids.length) {
    const known = new Set(found.map((row) => String(row.id)));
    const missing = ids.map(String).filter((id) => !known.has(id));
    throw badRequest(`Unknown category id(s): ${missing.join(', ')}`);
  }

  return ids;
};

const createPatent = async (
  { title, abstract, specification, documentKey, publicationNumber, jurisdiction, categoryIds, inventors },
  user,
) => {
  await verifyDocument(documentKey, user.userId);

  const inventorLinks = await resolveInventorLinks(inventors);
  const resolvedCategoryIds = await resolveCategoryIds(categoryIds);

  if (publicationNumber) {
    const clash = await prisma.patent.findUnique({ where: { publicationNumber } });
    if (clash) throw conflict('A patent with that publication number already exists');
  }

  return prisma.patent.create({
    data: {
      title,
      abstract,
      specification,
      documentKey,
      publicationNumber: publicationNumber || null,
      jurisdiction: jurisdiction || null,
      // Always set explicitly rather than relying on the column default: the
      // status a patent starts in is a business rule, and business rules
      // belong in the service where they can be read.
      status: STATUS.DRAFT,
      version: 1,
      submittedBy: user.userId,
      categories: { create: resolvedCategoryIds.map((categoryId) => ({ categoryId })) },
      inventors: { create: inventorLinks },
    },
    include: PATENT_INCLUDE,
  });
};

const listPatents = async ({ page = 1, limit = 20, status, categoryId, submittedBy, jurisdiction, search }, user) => {
  // visibilityWhere and the search filter both produce an `OR`, and spreading
  // them into one object would let the second silently replace the first —
  // which would drop the visibility rule and expose every user's drafts. AND
  // keeps them as independent conjuncts, so both always apply.
  const where = {
    AND: [
      visibilityWhere(user),
      ...(status ? [{ status }] : []),
      ...(jurisdiction ? [{ jurisdiction }] : []),
      ...(submittedBy ? [{ submittedBy: BigInt(submittedBy) }] : []),
      ...(categoryId ? [{ categories: { some: { categoryId: BigInt(categoryId) } } }] : []),
      ...(search
        ? [
            {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { abstract: { contains: search, mode: 'insensitive' } },
                { publicationNumber: { contains: search, mode: 'insensitive' } },
              ],
            },
          ]
        : []),
    ],
  };

  const [total, patents] = await prisma.$transaction([
    prisma.patent.count({ where }),
    prisma.patent.findMany({
      where,
      include: PATENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { patents, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getPatentById = (id, user) => findVisiblePatent(id, user);

/**
 * Edits are allowed only while a patent is not under review or public.
 *
 * A content change bumps `version`; metadata-only changes (categories,
 * inventors, jurisdiction) do not. `version` is half of the downstream
 * idempotency key, so bumping it on every edit would force the Search Service
 * to re-embed a document whose text never changed.
 */
const updatePatent = async (id, updates, user) => {
  const patent = await findOwnedPatent(id, user);

  if (![STATUS.DRAFT, STATUS.DECLINED].includes(patent.status)) {
    throw conflict(`A patent with status "${patent.status}" cannot be edited`);
  }

  if (updates.documentKey && updates.documentKey !== patent.documentKey) {
    await verifyDocument(updates.documentKey, patent.submittedBy);
  }

  if (updates.publicationNumber && updates.publicationNumber !== patent.publicationNumber) {
    const clash = await prisma.patent.findUnique({
      where: { publicationNumber: updates.publicationNumber },
    });
    if (clash && clash.id !== patent.id) {
      throw conflict('A patent with that publication number already exists');
    }
  }

  const contentChanged = CONTENT_FIELDS.some(
    (field) => updates[field] !== undefined && updates[field] !== patent[field],
  );

  const inventorLinks =
    updates.inventors !== undefined ? await resolveInventorLinks(updates.inventors) : null;
  const categoryIds =
    updates.categoryIds !== undefined ? await resolveCategoryIds(updates.categoryIds) : null;

  const scalar = {};
  for (const field of [...CONTENT_FIELDS, 'publicationNumber', 'jurisdiction']) {
    if (updates[field] !== undefined) scalar[field] = updates[field];
  }

  return prisma.$transaction(async (tx) => {
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

    return tx.patent.update({
      where: { id },
      data: { ...scalar, ...(contentChanged ? { version: { increment: 1 } } : {}) },
      include: PATENT_INCLUDE,
    });
  });
};

const submitForReview = async (id, user) => {
  const patent = await findOwnedPatent(id, user);
  const to = assertTransition(patent, 'submit');

  if (!patent.documentKey) {
    throw badRequest('A patent cannot be submitted without an uploaded document');
  }

  return prisma.patent.update({
    where: { id },
    data: { status: to, submittedAt: new Date() },
    include: PATENT_INCLUDE,
  });
};

/**
 * Approval is the moment a patent joins the corpus, so this is where the
 * event is emitted — status update, review row, and outbox row in one
 * transaction (FR7). If any of the three fails, none of them happened.
 */
const approvePatent = async (id, { comments }, admin) => {
  const patent = await prisma.patent.findUnique({ where: { id }, include: PATENT_INCLUDE });
  if (!patent) throw notFound('Patent not found');

  const to = assertTransition(patent, 'approve');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.patent.update({
      where: { id },
      data: { status: to, reviewedAt: new Date() },
      include: PATENT_INCLUDE,
    });

    await tx.patentReview.create({
      data: {
        patentId: id,
        reviewerId: admin.userId,
        reviewStage: 'admin_review',
        decision: 'pass',
        comments: comments || null,
      },
    });

    await outboxService.enqueue(tx, {
      aggregateType: AGGREGATE_TYPE,
      aggregateId: id,
      eventType: EVENT_TYPES.UPSERTED,
      payload: patentVersionUpserted(updated),
    });

    return updated;
  });
};

/**
 * Declining an *approved* patent also withdraws it from the corpus, so a
 * consumer that already indexed it removes it. Declining one that was only
 * pending emits nothing — it never entered the corpus in the first place.
 */
const declinePatent = async (id, { comments }, admin) => {
  const patent = await prisma.patent.findUnique({ where: { id }, include: PATENT_INCLUDE });
  if (!patent) throw notFound('Patent not found');

  const to = assertTransition(patent, 'decline');
  const wasApproved = patent.status === STATUS.APPROVED;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.patent.update({
      where: { id },
      data: { status: to, reviewedAt: new Date() },
      include: PATENT_INCLUDE,
    });

    await tx.patentReview.create({
      data: {
        patentId: id,
        reviewerId: admin.userId,
        reviewStage: 'admin_review',
        decision: 'fail',
        comments,
      },
    });

    if (wasApproved) {
      await outboxService.enqueue(tx, {
        aggregateType: AGGREGATE_TYPE,
        aggregateId: id,
        eventType: EVENT_TYPES.WITHDRAWN,
        payload: patentVersionWithdrawn(updated, 'declined'),
      });
    }

    return updated;
  });
};

/**
 * Hard delete, drafts only. Anything that has been through review is retained:
 * a review trail that can be erased by its subject is not a review trail.
 */
const deletePatent = async (id, user) => {
  const patent = await findOwnedPatent(id, user);

  if (patent.status !== STATUS.DRAFT) {
    throw conflict(`Only a draft can be deleted; this patent is "${patent.status}"`);
  }

  await prisma.patent.delete({ where: { id } });
  await storageService.deleteObject(patent.documentKey);
};

const listReviews = async (id, user) => {
  await findVisiblePatent(id, user);

  return prisma.patentReview.findMany({
    where: { patentId: id },
    include: { reviewer: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

const getDocumentUrl = async (id, user) => {
  const patent = await findVisiblePatent(id, user);

  if (!patent.documentKey) throw notFound('This patent has no attached document');

  return {
    downloadUrl: await storageService.presignDownload(patent.documentKey),
    expiresAt: new Date(Date.now() + config.storage.downloadUrlTtlSeconds * 1000),
  };
};

const requestUpload = ({ filename, contentType }, user) =>
  storageService.presignUpload({ userId: user.userId, filename, contentType });

module.exports = {
  STATUS,
  PATENT_INCLUDE,
  visibilityWhere,
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
