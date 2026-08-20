/**
 * Response mappers.
 *
 * Two problems are solved here, and both are the reason controllers must never
 * hand a Prisma record straight to res.json():
 *
 *  1. Every id in this schema is BigInt, and JSON.stringify throws on BigInt
 *     ("Do not know how to serialize a BigInt"). Ids go out as strings, which
 *     also keeps them safe past 2^53 for any client parsing them as numbers.
 *  2. The user record carries passwordHash. Mapping by allowlist means a column
 *     added to the schema later cannot leak by default — the opposite of
 *     deleting fields off the record, where forgetting one exposes it.
 */

const toUserDto = (user) => ({
  id: String(user.id),
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * Admin-facing view. Adds the audit trail that regular users have no need to
 * see, and only when the caller explicitly asked for the relation.
 */
const toAdminUserDto = (user) => ({
  ...toUserDto(user),
  createdBy: user.createdBy === null || user.createdBy === undefined ? null : String(user.createdBy),
});

const toInventorDto = (inventor) =>
  inventor
    ? {
        id: String(inventor.id),
        fullName: inventor.fullName,
        email: inventor.email,
        organization: inventor.organization,
      }
    : null;

/**
 * The profile is the account plus the inventor identity linked to it, if any.
 * They stay separate resources because an Inventor can exist for someone who
 * never had an account — see the schema notes in CLAUDE.md.
 */
const toProfileDto = (user) => ({
  ...toUserDto(user),
  inventorProfile: toInventorDto(user.inventorProfile),
});

/**
 * Prisma returns Decimal for DECIMAL columns, and JSON.stringify turns those
 * into an object rather than a number. PATENT_REVIEW.ai_confidence_score is
 * the only one in this schema; mapping it here keeps the surprise contained.
 */
const decimalToNumber = (value) => (value === null || value === undefined ? null : Number(value));

const toCategoryDto = (category) => ({
  id: String(category.id),
  name: category.name,
});

/** Inventor with its optional linked account, for the inventors endpoints. */
const toInventorDetailDto = (inventor) => ({
  ...toInventorDto(inventor),
  linkedUser: inventor.user
    ? { id: String(inventor.user.id), name: inventor.user.name, email: inventor.user.email }
    : null,
  createdAt: inventor.createdAt,
});

const toPatentInventorDto = (link) => ({
  ...toInventorDto(link.inventor),
  order: link.inventorOrder,
});

/**
 * List shape. Deliberately omits `specification`: it is the largest field on
 * the record, and a 20-item page carrying twenty full patent bodies is a
 * response nobody asked for.
 */
const toPatentDto = (patent) => ({
  id: String(patent.id),
  title: patent.title,
  abstract: patent.abstract,
  status: patent.status,
  version: patent.version,
  publicationNumber: patent.publicationNumber,
  jurisdiction: patent.jurisdiction,
  submittedBy: String(patent.submittedBy),
  submitter: patent.submitter
    ? { id: String(patent.submitter.id), name: patent.submitter.name, email: patent.submitter.email }
    : undefined,
  categories: (patent.categories || []).map((link) => toCategoryDto(link.category)),
  inventors: (patent.inventors || []).map(toPatentInventorDto),
  hasDocument: Boolean(patent.documentKey),
  submittedAt: patent.submittedAt,
  reviewedAt: patent.reviewedAt,
  createdAt: patent.createdAt,
  updatedAt: patent.updatedAt,
});

/**
 * Detail shape. Adds the full specification and the object key.
 *
 * `documentKey` is safe to expose to a caller who can already see the patent:
 * it is unguessable and useless on its own — reading the object still requires
 * a presigned URL from GET /patents/:id/document.
 */
const toPatentDetailDto = (patent) => ({
  ...toPatentDto(patent),
  specification: patent.specification,
  documentKey: patent.documentKey,
});

const toPatentReviewDto = (review) => ({
  id: String(review.id),
  patentId: String(review.patentId),
  stage: review.reviewStage,
  decision: review.decision,
  aiConfidenceScore: decimalToNumber(review.aiConfidenceScore),
  comments: review.comments,
  reviewer: review.reviewer
    ? { id: String(review.reviewer.id), name: review.reviewer.name, email: review.reviewer.email }
    : null,
  createdAt: review.createdAt,
});

module.exports = {
  toUserDto,
  toAdminUserDto,
  toInventorDto,
  toProfileDto,
  toCategoryDto,
  toInventorDetailDto,
  toPatentDto,
  toPatentDetailDto,
  toPatentReviewDto,
};
