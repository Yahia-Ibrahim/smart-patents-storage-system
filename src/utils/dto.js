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

module.exports = { toUserDto, toAdminUserDto, toInventorDto, toProfileDto };
