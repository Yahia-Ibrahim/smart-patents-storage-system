/**
 * Mirrors the Role enum in prisma/schema.prisma. Kept as constants so route
 * definitions and guards never pass bare strings that a typo could weaken
 * into a check that silently never matches.
 */
const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

module.exports = { ROLES, ALL_ROLES };
