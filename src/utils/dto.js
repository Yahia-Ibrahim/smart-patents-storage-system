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

/**
 * Email is personal data, and every one of these records is readable by any
 * signed-up user: approved patents are public to the platform, and the
 * inventor directory is searchable. Returning addresses on all of them turns
 * "create an account" into "download the user and admin email directory".
 *
 * So an address goes out only to someone with a reason to have it: an admin,
 * or the person it belongs to. `viewer` is `req.user` — omitted means no
 * viewer, and no email.
 */
const canSeeEmailOf = (viewer, subjectUserId) => {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  return subjectUserId !== null && subjectUserId !== undefined && viewer.userId === subjectUserId;
};

const partyDto = (party, viewer) =>
  party
    ? {
        id: String(party.id),
        name: party.name,
        ...(canSeeEmailOf(viewer, party.id) ? { email: party.email } : {}),
      }
    : null;

const toCategoryDto = (category) => ({
  id: String(category.id),
  name: category.name,
});

/**
 * Inventor with its optional linked account.
 *
 * The inventor's own email is shown to an admin or to the user the profile is
 * linked to. Everyone else gets name and organization, which is enough to pick
 * the right person off a search; search still *matches* on email server-side,
 * so nothing about the workflow breaks.
 */
const toInventorDetailDto = (inventor, viewer, { includeEmail = false } = {}) => {
  const { email, ...rest } = toInventorDto(inventor) || {};
  // includeEmail is for the create response only: the caller just supplied the
  // address, so withholding it from the echo is pointless friction rather than
  // privacy. Every read path leaves it false.
  const visible = includeEmail || canSeeEmailOf(viewer, inventor.userId ?? null);

  return {
    ...rest,
    ...(visible ? { email } : {}),
    linkedUser: partyDto(inventor.user, viewer),
    createdAt: inventor.createdAt,
  };
};

const toPatentInventorDto = (link) => ({
  ...toInventorDto(link.inventor),
  order: link.inventorOrder,
});

/**
 * List shape. Deliberately omits `specification`: it is the largest field on
 * the record, and a 20-item page carrying twenty full patent bodies is a
 * response nobody asked for.
 */
const toPatentDto = (patent, viewer) => ({
  id: String(patent.id),
  title: patent.title,
  abstract: patent.abstract,
  status: patent.status,
  version: patent.version,
  publicationNumber: patent.publicationNumber,
  jurisdiction: patent.jurisdiction,
  submittedBy: String(patent.submittedBy),
  submitter: patent.submitter ? partyDto(patent.submitter, viewer) : undefined,
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
const toPatentDetailDto = (patent, viewer) => ({
  ...toPatentDto(patent, viewer),
  specification: patent.specification,
  documentKey: patent.documentKey,
});

/**
 * A semantic search hit: the live patent, plus the AI's prose for why it came
 * back. Kept as two fields rather than merged onto the patent, so nothing can
 * mistake a generated sentence for a stored one.
 */
const toPatentSearchMatchDto = ({ patent, explanation }, viewer) => ({
  patent: toPatentDto(patent, viewer),
  explanation: explanation ?? null,
});

const toPatentReviewDto = (review, viewer) => ({
  id: String(review.id),
  patentId: String(review.patentId),
  stage: review.reviewStage,
  decision: review.decision,
  aiConfidenceScore: decimalToNumber(review.aiConfidenceScore),
  comments: review.comments,
  reviewer: partyDto(review.reviewer, viewer),
  createdAt: review.createdAt,
});

module.exports = {
  canSeeEmailOf,
  toUserDto,
  toAdminUserDto,
  toInventorDto,
  toProfileDto,
  toCategoryDto,
  toInventorDetailDto,
  toPatentDto,
  toPatentDetailDto,
  toPatentReviewDto,
  toPatentSearchMatchDto,
};
