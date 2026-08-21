const prisma = require('../../config/prisma');
const { badRequest } = require('../../utils/errors');

/**
 * Turns the id lists a client sends into link rows, rejecting anything that
 * would produce a patent nobody can make sense of later.
 *
 * The database would accept most of this quite happily — an inventor order of
 * `[1, 7, 7]` is just three integers — so these rules only exist if something
 * enforces them, and this is that something.
 */

/** Reports which of the requested ids do not exist, rather than just "some". */
const findMissingIds = async (model, ids) => {
  const found = await model.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const known = new Set(found.map((row) => String(row.id)));

  return ids.map(String).filter((id) => !known.has(id));
};

const findDuplicates = (values) => {
  const seen = new Set();
  const duplicates = new Set();

  values.forEach((value) => (seen.has(value) ? duplicates.add(value) : seen.add(value)));

  return [...duplicates];
};

/**
 * Inventor order must be a contiguous 1..N.
 *
 * Ordering is the credit order on a patent, so gaps and ties are not a
 * stylistic matter — `[1, 3]` leaves a consumer unable to say who the second
 * inventor was. Callers may omit `order` entirely, in which case array
 * position is used; mixing the two is rejected, because "some explicit, some
 * positional" has no single obvious reading.
 */
const resolveInventorLinks = async (inventors) => {
  if (!inventors?.length) return [];

  const ids = inventors.map((entry) => String(entry.inventorId));
  const duplicateIds = findDuplicates(ids);

  if (duplicateIds.length) {
    throw badRequest(`The same inventor cannot be listed twice on a patent: ${duplicateIds.join(', ')}`);
  }

  const missing = await findMissingIds(prisma.inventor, ids.map(BigInt));

  if (missing.length) throw badRequest(`Unknown inventor id(s): ${missing.join(', ')}`);

  const explicit = inventors.filter((entry) => entry.order !== undefined).length;

  if (explicit !== 0 && explicit !== inventors.length) {
    throw badRequest('Either give every inventor an explicit order, or none of them');
  }

  const orders = inventors.map((entry, index) => entry.order ?? index + 1);
  const contiguous = [...orders].sort((a, b) => a - b).every((value, index) => value === index + 1);

  if (!contiguous) {
    throw badRequest(`inventor order must be a contiguous sequence starting at 1, got: ${orders.join(', ')}`);
  }

  return inventors.map((entry, index) => ({
    inventorId: BigInt(entry.inventorId),
    inventorOrder: entry.order ?? index + 1,
  }));
};

/**
 * Categories are a set, but a repeated id is rejected rather than quietly
 * deduplicated: it means the client built its request wrong, and silently
 * accepting it hides that until someone notices a mismatched count.
 */
const resolveCategoryIds = async (categoryIds) => {
  if (!categoryIds?.length) return [];

  const ids = categoryIds.map(String);
  const duplicates = findDuplicates(ids);

  if (duplicates.length) {
    throw badRequest(`Duplicate category id(s): ${duplicates.join(', ')}`);
  }

  const missing = await findMissingIds(prisma.category, ids.map(BigInt));

  if (missing.length) throw badRequest(`Unknown category id(s): ${missing.join(', ')}`);

  return ids.map(BigInt);
};

module.exports = { resolveInventorLinks, resolveCategoryIds };
