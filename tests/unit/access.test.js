const { visibilityWhere, buildListFilter, isAdmin } = require('../../src/services/patents/access');
const { STATUS } = require('../../src/services/patents/lifecycle');
const { ROLES } = require('../../src/utils/roles');

/**
 * The patent visibility rule, tested as a pure function.
 *
 * A bug here is a data leak, and the one that already happened — a search
 * filter silently replacing the visibility clause via object spread — was
 * invisible end-to-end because both `where`s were individually valid. Asserting
 * on the query shape catches that class directly.
 */

const admin = { userId: 1n, role: ROLES.ADMIN };
const user = { userId: 7n, role: ROLES.USER };

describe('isAdmin', () => {
  it('recognises an admin', () => {
    expect(isAdmin(admin)).toBe(true);
  });

  it('treats a plain user, and a missing user, as not an admin', () => {
    expect(isAdmin(user)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({})).toBe(false);
  });

  /** A forged or unexpected role string must never be read as admin. */
  it('does not accept a lookalike role', () => {
    expect(isAdmin({ role: 'Admin' })).toBe(false);
    expect(isAdmin({ role: 'administrator' })).toBe(false);
    expect(isAdmin({ role: 'admin ' })).toBe(false);
  });
});

describe('visibilityWhere', () => {
  it('places no restriction on an admin', () => {
    expect(visibilityWhere(admin)).toEqual({});
  });

  it('limits a user to their own patents plus approved ones', () => {
    expect(visibilityWhere(user)).toEqual({
      OR: [{ submittedBy: 7n }, { status: STATUS.APPROVED }],
    });
  });
});

describe('buildListFilter', () => {
  /** The heart of it: the visibility clause must survive every other filter. */
  it('keeps the visibility clause when a search term is also given', () => {
    const where = buildListFilter({ search: 'cooling' }, user);

    expect(where.AND[0]).toEqual(visibilityWhere(user));
    expect(where.AND).toHaveLength(2);
    // Two ORs coexisting as separate conjuncts is precisely what the bug lost.
    expect(where.AND[1].OR.map((clause) => Object.keys(clause)[0])).toEqual([
      'title',
      'abstract',
      'publicationNumber',
    ]);
  });

  it('keeps the visibility clause under every filter at once', () => {
    const where = buildListFilter(
      {
        status: STATUS.APPROVED,
        jurisdiction: 'US',
        submittedBy: '9',
        categoryId: '3',
        search: 'cooling',
      },
      user,
    );

    expect(where.AND[0]).toEqual(visibilityWhere(user));
    expect(where.AND).toHaveLength(6);
  });

  it('adds nothing for filters that were not supplied', () => {
    expect(buildListFilter({}, user).AND).toHaveLength(1);
  });

  it('ignores empty-string filters rather than matching on them', () => {
    const where = buildListFilter(
      { status: '', jurisdiction: '', submittedBy: '', categoryId: '', search: '' },
      user,
    );

    expect(where.AND).toHaveLength(1);
  });

  it('converts id filters to BigInt so Prisma does not reject them', () => {
    const where = buildListFilter({ submittedBy: '9', categoryId: '3' }, user);

    expect(where.AND).toContainEqual({ submittedBy: 9n });
    expect(where.AND).toContainEqual({ categories: { some: { categoryId: 3n } } });
  });

  it('searches case-insensitively', () => {
    const where = buildListFilter({ search: 'CoOlInG' }, user);

    where.AND[1].OR.forEach((clause) => {
      expect(Object.values(clause)[0].mode).toBe('insensitive');
    });
  });

  it('leaves an admin unrestricted while still applying their filters', () => {
    const where = buildListFilter({ status: STATUS.DRAFT }, admin);

    expect(where.AND[0]).toEqual({});
    expect(where.AND).toContainEqual({ status: STATUS.DRAFT });
  });
});
