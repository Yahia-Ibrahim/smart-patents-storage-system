const prisma = require('../../config/prisma');
const { ROLES } = require('../../utils/roles');
const { forbidden, notFound } = require('../../utils/errors');
const { STATUS } = require('./lifecycle');

/**
 * Who may see and touch which patents.
 *
 * This is the only place that answers that question. `requireUser` on a route
 * proves the caller is logged in and nothing more — it does not stop them
 * reading someone else's draft — so every read and every write path in the
 * patents module goes through a function defined here.
 */

/** Relations every patent response needs. One definition, so DTOs never guess. */
const PATENT_INCLUDE = {
  submitter: { select: { id: true, name: true, email: true } },
  categories: { include: { category: true } },
  inventors: { include: { inventor: true }, orderBy: { inventorOrder: 'asc' } },
};

const isAdmin = (user) => user?.role === ROLES.ADMIN;

/**
 * What this caller is allowed to see.
 *
 * Admins see everything. Everyone else sees their own patents in any state,
 * plus other people's only once approved — an unapproved patent is private to
 * its submitter.
 */
const visibilityWhere = (user) =>
  isAdmin(user) ? {} : { OR: [{ submittedBy: user.userId }, { status: STATUS.APPROVED }] };

/**
 * Builds the `where` for a patent listing.
 *
 * Composed with `AND`, never object spread. `visibilityWhere` and the search
 * filter both produce an `OR`, and spreading them into one object lets the
 * second silently replace the first — which drops the visibility rule and
 * exposes every user's drafts. This was a real bug; the shape here is what
 * prevents it recurring.
 */
const buildListFilter = ({ status, categoryId, submittedBy, jurisdiction, search }, user) => ({
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
});

/**
 * For reads. Throws 404 — not 403 — when the patent exists but is invisible to
 * this caller, because a 403 would confirm the id exists.
 */
const findVisiblePatent = async (id, user) => {
  const patent = await prisma.patent.findFirst({
    where: { AND: [{ id }, visibilityWhere(user)] },
    include: PATENT_INCLUDE,
  });

  if (!patent) throw notFound('Patent not found');

  return patent;
};

/**
 * For writes. 403 here is deliberate and differs from `findVisiblePatent`: the
 * caller already knows the id refers to something, so there is nothing left to
 * conceal, and "you cannot edit this" is more useful than "no such patent".
 */
const findOwnedPatent = async (id, user) => {
  const patent = await prisma.patent.findUnique({ where: { id }, include: PATENT_INCLUDE });

  if (!patent) throw notFound('Patent not found');

  if (patent.submittedBy !== user.userId && !isAdmin(user)) {
    throw forbidden('You can only modify patents you submitted');
  }

  return patent;
};

module.exports = {
  PATENT_INCLUDE,
  isAdmin,
  visibilityWhere,
  buildListFilter,
  findVisiblePatent,
  findOwnedPatent,
};
