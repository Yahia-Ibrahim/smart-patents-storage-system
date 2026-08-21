const storageService = require('../../src/services/storageService');
const { canSeeEmailOf, toPatentDto, toUserDto } = require('../../src/utils/dto');
const {
  signAccessToken,
  verifyAccessToken,
  hashRefreshToken,
  generateRefreshToken,
  hashPassword,
  verifyPassword,
  MAX_PASSWORD_BYTES,
} = require('../../src/utils/helpers');
const { ROLES } = require('../../src/utils/roles');

/**
 * Boundaries where a mistake is a security bug rather than a broken feature:
 * object-key ownership, which emails leave the process, and token handling.
 */

describe('object keys', () => {
  it('namespaces a key under the issuing user', () => {
    expect(storageService.buildObjectKey(7n, 'spec.pdf')).toMatch(/^patents\/7\/[0-9a-f-]{36}\/spec\.pdf$/);
  });

  it('gives two uploads of the same filename different keys', () => {
    const a = storageService.buildObjectKey(7n, 'spec.pdf');
    const b = storageService.buildObjectKey(7n, 'spec.pdf');

    // Otherwise one upload silently overwrites another.
    expect(a).not.toBe(b);
  });

  describe('filename sanitisation', () => {
    const cases = [
      ['../../../etc/passwd', /\/passwd$/],
      ['..\\..\\windows\\system32', /\/[A-Za-z0-9._-]+$/],
      ['name with spaces.pdf', /\/name_with_spaces\.pdf$/],
      ['../.././evil', /\/evil$/],
      ['....pdf', /\/pdf$/],
      ['%2e%2e%2fetc', /\/[A-Za-z0-9._-]+$/],
    ];

    it.each(cases)('neutralises %s', (filename, expected) => {
      const key = storageService.buildObjectKey(7n, filename);

      expect(key).toMatch(expected);
      // Nothing may escape the user's own prefix.
      expect(key.startsWith('patents/7/')).toBe(true);
      expect(key).not.toMatch(/\.\./);
      expect(key.split('/')).toHaveLength(4);
    });

    it('falls back to a placeholder when nothing usable survives', () => {
      expect(storageService.buildObjectKey(7n, '')).toMatch(/\/document$/);
      expect(storageService.buildObjectKey(7n, '.')).toMatch(/\/document$/);
      expect(storageService.buildObjectKey(7n, '...')).toMatch(/\/document$/);
    });

    it('caps a pathological filename length', () => {
      const key = storageService.buildObjectKey(7n, `${'a'.repeat(5000)}.pdf`);

      expect(key.split('/')[3].length).toBeLessThanOrEqual(120);
    });
  });

  describe('keyBelongsToUser', () => {
    const key = (id) => `patents/${id}/2f1c0000-0000-4000-8000-000000000000/spec.pdf`;

    it('accepts the owner', () => {
      expect(storageService.keyBelongsToUser(key(7), 7n)).toBe(true);
    });

    it('rejects another user', () => {
      expect(storageService.keyBelongsToUser(key(8), 7n)).toBe(false);
    });

    /** The trailing slash is what stops user 1 claiming user 12's keys. */
    it('does not confuse a user id with one that starts with it', () => {
      expect(storageService.keyBelongsToUser(key(12), 1n)).toBe(false);
      expect(storageService.keyBelongsToUser(key(1), 12n)).toBe(false);
    });

    it('rejects anything that is not a plausible key', () => {
      [null, undefined, 42, {}, [], '', 'patents/', '../patents/7/x'].forEach((value) => {
        expect(storageService.keyBelongsToUser(value, 7n)).toBe(false);
      });
    });
  });
});

describe('email visibility', () => {
  const admin = { userId: 1n, role: ROLES.ADMIN };
  const owner = { userId: 7n, role: ROLES.USER };
  const stranger = { userId: 9n, role: ROLES.USER };

  it('shows an admin any address', () => {
    expect(canSeeEmailOf(admin, 7n)).toBe(true);
  });

  it('shows a user their own address', () => {
    expect(canSeeEmailOf(owner, 7n)).toBe(true);
  });

  it('hides one user`s address from another', () => {
    expect(canSeeEmailOf(stranger, 7n)).toBe(false);
  });

  it('hides addresses when there is no viewer at all', () => {
    expect(canSeeEmailOf(undefined, 7n)).toBe(false);
    expect(canSeeEmailOf(null, 7n)).toBe(false);
  });

  /**
   * A record with no owner (an inventor not linked to any account) must not
   * become visible to everyone through a null-equals-null comparison.
   */
  it('does not treat an unowned record as everyone`s own', () => {
    expect(canSeeEmailOf(owner, null)).toBe(false);
    expect(canSeeEmailOf(owner, undefined)).toBe(false);
    expect(canSeeEmailOf(admin, null)).toBe(true);
  });

  it('omits the key entirely rather than sending an empty one', () => {
    const patent = {
      id: 1n,
      submittedBy: 7n,
      submitter: { id: 7n, name: 'Ada', email: 'ada@example.com' },
      categories: [],
      inventors: [],
      version: 1,
    };

    expect(toPatentDto(patent, stranger).submitter).not.toHaveProperty('email');
    expect(toPatentDto(patent, owner).submitter.email).toBe('ada@example.com');
  });
});

describe('DTO serialisation', () => {
  it('stringifies BigInt ids, which JSON cannot encode', () => {
    const dto = toUserDto({
      id: 9007199254740993n,
      name: 'Ada',
      email: 'a@b.c',
      role: ROLES.USER,
    });

    expect(dto.id).toBe('9007199254740993');
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('never carries a password hash, even when the record has one', () => {
    const dto = toUserDto({
      id: 1n,
      name: 'Ada',
      email: 'a@b.c',
      role: ROLES.USER,
      passwordHash: '$2b$12$something',
    });

    expect(JSON.stringify(dto)).not.toMatch(/passwordHash|\$2b\$/);
  });
});

describe('tokens', () => {
  it('round-trips the user id and role', () => {
    const decoded = verifyAccessToken(signAccessToken({ userId: 7n, role: ROLES.ADMIN }));

    expect(decoded.sub).toBe('7');
    expect(decoded.role).toBe(ROLES.ADMIN);
  });

  it('rejects a token signed with a different secret', () => {
    const [header, payload] = signAccessToken({ userId: 7n, role: ROLES.USER }).split('.');

    expect(() => verifyAccessToken(`${header}.${payload}.forged`)).toThrow();
  });

  it('rejects a tampered payload', () => {
    const token = signAccessToken({ userId: 7n, role: ROLES.USER });
    const [header, , signature] = token.split('.');
    const escalated = Buffer.from(JSON.stringify({ sub: '7', role: 'admin' })).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${escalated}.${signature}`)).toThrow();
  });

  it('hashes refresh tokens to a fixed-width digest that fits the column', () => {
    const hash = hashRefreshToken(generateRefreshToken());

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, so a presented token can be looked up', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('generates unguessable, distinct refresh tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateRefreshToken));

    expect(tokens.size).toBe(50);
    expect(generateRefreshToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Passw0rdTest');

    expect(await verifyPassword('Passw0rdTest', hash)).toBe(true);
    expect(await verifyPassword('Passw0rdTes', hash)).toBe(false);
  });

  it('produces a different hash each time, so equal passwords are not equal hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('Passw0rdTest'), hashPassword('Passw0rdTest')]);

    expect(a).not.toBe(b);
  });

  /**
   * bcrypt silently ignores input past 72 bytes. Validation rejects longer
   * passwords precisely so this truncation can never authenticate two
   * different passwords interchangeably; this pins why that limit exists.
   */
  it('demonstrates the truncation the 72-byte limit exists to prevent', async () => {
    const prefix = 'a'.repeat(MAX_PASSWORD_BYTES);
    const hash = await hashPassword(`${prefix}FIRST`);

    expect(await verifyPassword(`${prefix}SECOND`, hash)).toBe(true);
  });
});
