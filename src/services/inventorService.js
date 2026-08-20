const prisma = require('../config/prisma');
const { ROLES } = require('../utils/roles');
const { conflict, notFound, forbidden } = require('../utils/errors');

/**
 * Inventors are a separate identity from users.
 *
 * A patent's inventors are frequently people who have no account here — a
 * co-inventor at another organisation, or someone who has left. So INVENTOR is
 * standalone, with an optional link to a USER when the two happen to be the
 * same person. `INVENTOR.user_id` is unique: one account maps to at most one
 * inventor identity.
 */

const INVENTOR_INCLUDE = { user: { select: { id: true, name: true, email: true } } };

const isAdmin = (user) => user.role === ROLES.ADMIN;

const createInventor = async ({ fullName, email, organization, linkToMe }, user) => {
  const existing = await prisma.inventor.findUnique({ where: { email } });

  // 409 rather than silently returning the existing row: linking a patent to
  // an inventor someone else created should be a deliberate act (pass its id),
  // not a side effect of guessing an email.
  if (existing) throw conflict('An inventor with that email already exists');

  if (linkToMe) {
    const alreadyLinked = await prisma.inventor.findUnique({ where: { userId: user.userId } });
    if (alreadyLinked) throw conflict('Your account is already linked to an inventor profile');
  }

  return prisma.inventor.create({
    data: {
      fullName,
      email,
      organization: organization || null,
      userId: linkToMe ? user.userId : null,
    },
    include: INVENTOR_INCLUDE,
  });
};

const listInventors = async ({ page = 1, limit = 20, search }) => {
  const where = search
    ? {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { organization: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, inventors] = await prisma.$transaction([
    prisma.inventor.count({ where }),
    prisma.inventor.findMany({
      where,
      include: INVENTOR_INCLUDE,
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { inventors, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getInventorById = async (id) => {
  const inventor = await prisma.inventor.findUnique({ where: { id }, include: INVENTOR_INCLUDE });

  if (!inventor) throw notFound('Inventor not found');

  return inventor;
};

/**
 * Editable by an admin, or by the user the inventor profile is linked to.
 * An unlinked inventor is admin-only — nobody else has a claim to it.
 */
const updateInventor = async (id, updates, user) => {
  const inventor = await getInventorById(id);

  if (!isAdmin(user) && inventor.userId !== user.userId) {
    throw forbidden('You can only edit an inventor profile linked to your account');
  }

  if (updates.email && updates.email !== inventor.email) {
    const clash = await prisma.inventor.findUnique({ where: { email: updates.email } });
    if (clash) throw conflict('An inventor with that email already exists');
  }

  return prisma.inventor.update({
    where: { id },
    data: {
      ...(updates.fullName !== undefined ? { fullName: updates.fullName } : {}),
      ...(updates.email !== undefined ? { email: updates.email } : {}),
      ...(updates.organization !== undefined ? { organization: updates.organization } : {}),
    },
    include: INVENTOR_INCLUDE,
  });
};

/**
 * Admin-only, and refused while the inventor is credited on any patent.
 * PATENT_INVENTOR cascades, so without this check deleting an inventor would
 * silently rewrite the authorship of published patents.
 */
const deleteInventor = async (id) => {
  await getInventorById(id);

  const credited = await prisma.patentInventor.count({ where: { inventorId: id } });

  if (credited > 0) {
    throw conflict(
      `This inventor is credited on ${credited} patent(s) and cannot be deleted; detach them first`,
    );
  }

  await prisma.inventor.delete({ where: { id } });
};

module.exports = {
  INVENTOR_INCLUDE,
  createInventor,
  listInventors,
  getInventorById,
  updateInventor,
  deleteInventor,
};
