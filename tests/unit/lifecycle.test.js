const {
  STATUS,
  TRANSITIONS,
  EDITABLE_STATUSES,
  assertTransition,
  applyTransition,
} = require('../../src/services/patents/lifecycle');

/**
 * The state machine, tested directly.
 *
 * These are pure assertions about the transition table. Reaching them through
 * HTTP needs a user, a login, an upload and a patent per case, which is why the
 * illegal combinations were never enumerated before — the setup cost hid them.
 */

const patentWith = (status) => ({ id: 1n, status });

const ACTIONS = Object.keys(TRANSITIONS);
const ALL_STATUSES = Object.values(STATUS);

describe('transition table', () => {
  it('never targets a status outside the enum', () => {
    ACTIONS.forEach((action) => {
      expect(ALL_STATUSES).toContain(TRANSITIONS[action].to);
      TRANSITIONS[action].from.forEach((from) => expect(ALL_STATUSES).toContain(from));
    });
  });

  /**
   * AI pre-screening belongs to another service. If a transition ever targets
   * pending_ai, a patent can reach a state nothing in this codebase moves it
   * out of — so this asserts the gap stays deliberate.
   */
  it('leaves pending_ai unreachable', () => {
    ACTIONS.forEach((action) => {
      expect(TRANSITIONS[action].to).not.toBe(STATUS.PENDING_AI);
      expect(TRANSITIONS[action].from).not.toContain(STATUS.PENDING_AI);
    });
  });

  it('allows editing only before review and after rejection', () => {
    expect([...EDITABLE_STATUSES].sort()).toEqual([STATUS.DECLINED, STATUS.DRAFT].sort());
    expect(EDITABLE_STATUSES).not.toContain(STATUS.PENDING_ADMIN);
    expect(EDITABLE_STATUSES).not.toContain(STATUS.APPROVED);
  });
});

describe('assertTransition', () => {
  const legal = [
    ['submit', STATUS.DRAFT, STATUS.PENDING_ADMIN],
    ['submit', STATUS.DECLINED, STATUS.PENDING_ADMIN],
    ['approve', STATUS.PENDING_ADMIN, STATUS.APPROVED],
    ['decline', STATUS.PENDING_ADMIN, STATUS.DECLINED],
    ['decline', STATUS.APPROVED, STATUS.DECLINED],
  ];

  it.each(legal)('%s from %s reaches %s', (action, from, to) => {
    expect(assertTransition(patentWith(from), action)).toBe(to);
  });

  /** Every combination the table does not list must be refused. */
  const illegal = ACTIONS.flatMap((action) =>
    ALL_STATUSES.filter((status) => !TRANSITIONS[action].from.includes(status)).map((status) => [
      action,
      status,
    ]),
  );

  it.each(illegal)('refuses %s from %s', (action, status) => {
    expect(() => assertTransition(patentWith(status), action)).toThrow(/Cannot/);
  });

  it('reports the current status and the legal ones in the error', () => {
    expect(() => assertTransition(patentWith(STATUS.DRAFT), 'approve')).toThrow(
      /status "draft".*pending_admin/,
    );
  });

  it('raises a 409, not a 400 — the request is fine, the state is not', () => {
    try {
      assertTransition(patentWith(STATUS.APPROVED), 'approve');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.status).toBe(409);
      expect(error.expose).toBe(true);
    }
  });
});

describe('applyTransition', () => {
  /** Builds a Prisma-shaped stub that reports how many rows a write matched. */
  const txWith = ({ count, current }) => ({
    patent: {
      updateMany: jest.fn(async () => ({ count })),
      findUnique: jest.fn(async () => current),
    },
  });

  it('scopes the write by the expected statuses, not by id alone', async () => {
    const tx = txWith({ count: 1, current: { id: 1n, status: STATUS.APPROVED } });

    await applyTransition(tx, 1n, 'approve', { reviewedAt: new Date() }, {});

    const [args] = tx.patent.updateMany.mock.calls[0];
    // The status predicate is what makes concurrent approvals safe.
    expect(args.where).toMatchObject({ id: 1n, status: { in: [STATUS.PENDING_ADMIN] } });
    expect(args.data.status).toBe(STATUS.APPROVED);
  });

  it('rejects the loser of a race, reporting the status that won', async () => {
    const tx = txWith({ count: 0, current: { status: STATUS.APPROVED } });

    await expect(applyTransition(tx, 1n, 'approve', {}, {})).rejects.toThrow(/status "approved"/);
  });

  it('does not crash when the row vanished mid-transition', async () => {
    const tx = txWith({ count: 0, current: null });

    await expect(applyTransition(tx, 1n, 'approve', {}, {})).rejects.toThrow(/unknown/);
  });

  it('merges caller data into the write without letting it override status', async () => {
    const tx = txWith({ count: 1, current: {} });
    const submittedAt = new Date();

    await applyTransition(tx, 1n, 'submit', { submittedAt }, {});

    const [args] = tx.patent.updateMany.mock.calls[0];
    expect(args.data).toEqual({ status: STATUS.PENDING_ADMIN, submittedAt });
  });
});
