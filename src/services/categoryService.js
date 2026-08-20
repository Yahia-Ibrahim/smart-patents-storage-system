const prisma = require('../config/prisma');
const { conflict, notFound } = require('../utils/errors');

/**
 * Categories are admin-managed reference data: a small, shared vocabulary that
 * patents are tagged with. Deliberately not free-text tags — the Search
 * Service filters on these, and free text would make that filter useless.
 */

/**
 * Names are stored as typed but compared case-insensitively.
 *
 * The unique constraint on CATEGORY.name is case-*sensitive*, so "Software"
 * and "software" would both be accepted and then split the taxonomy in two.
 * This check closes that gap before the constraint ever sees the row.
 */
const findByName = (name, excludeId = null) =>
  prisma.category.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });

const createCategory = async ({ name }) => {
  if (await findByName(name)) throw conflict('A category with that name already exists');

  return prisma.category.create({ data: { name } });
};

const listCategories = async ({ search } = {}) =>
  prisma.category.findMany({
    where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
    orderBy: { name: 'asc' },
  });

const getCategoryById = async (id) => {
  const category = await prisma.category.findUnique({ where: { id } });

  if (!category) throw notFound('Category not found');

  return category;
};

const updateCategory = async (id, { name }) => {
  await getCategoryById(id);

  if (await findByName(name, id)) throw conflict('A category with that name already exists');

  return prisma.category.update({ where: { id }, data: { name } });
};

/**
 * Deleting a category detaches it from every patent (PATENT_CATEGORY cascades)
 * but never touches the patents themselves — losing a taxonomy entry must not
 * lose submissions.
 */
const deleteCategory = async (id) => {
  await getCategoryById(id);
  await prisma.category.delete({ where: { id } });
};

module.exports = {
  createCategory,
  listCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
