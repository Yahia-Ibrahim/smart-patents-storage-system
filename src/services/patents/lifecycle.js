const { conflict } = require('../../utils/errors');

/**
 * The patent state machine.
 *
 * Status is never accepted from a client. The client calls an action —
 * submit, approve, decline — and this module decides whether that action is
 * legal from the current state. Keeping the table and the two guards together
 * means there is exactly one place to read to know what can happen next.
 *
 *   draft ──submit──▶ pending_admin ──approve──▶ approved
 *     ▲                     │                       │
 *     └──────edit───────────┴──decline──▶ declined ──┘
 */

const STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_AI: 'pending_ai',
  PENDING_ADMIN: 'pending_admin',
  APPROVED: 'approved',
  DECLINED: 'declined',
});

/**
 * `pending_ai` is reachable by nothing. AI pre-screening is a separate service
 * owned by another engineer, so the enum value is reserved and deliberately
 * unused rather than faked with a stub transition.
 */
const TRANSITIONS = Object.freeze({
  submit: { from: [STATUS.DRAFT, STATUS.DECLINED], to: STATUS.PENDING_ADMIN },
  approve: { from: [STATUS.PENDING_ADMIN], to: STATUS.APPROVED },
  decline: { from: [STATUS.PENDING_ADMIN, STATUS.APPROVED], to: STATUS.DECLINED },
});

/** Statuses a patent may be edited in: not yet under review, or sent back. */
const EDITABLE_STATUSES = Object.freeze([STATUS.DRAFT, STATUS.DECLINED]);

const transitionConflict = (action, status) =>
  conflict(
    `Cannot ${action} a patent with status "${status}"; expected one of: ${TRANSITIONS[action].from.join(', ')}`,
  );

/**
 * Cheap pre-check, so an illegal request fails before any write is attempted
 * and the caller gets a precise message. Not sufficient on its own — see
 * `applyTransition`.
 */
const assertTransition = (patent, action) => {
  const rule = TRANSITIONS[action];

  if (!rule.from.includes(patent.status)) throw transitionConflict(action, patent.status);

  return rule.to;
};

/**
 * Applies a transition *conditionally, inside the caller's transaction*.
 *
 * Reading the status and then writing unconditionally is check-then-act: two
 * admins approving the same patent concurrently both read `pending_admin`,
 * both pass `assertTransition`, and both commit — two review rows and two
 * identical events. Worse, a concurrent approve and decline both commit, and
 * the outbox then holds an Upserted and a Withdrawn in an order that need not
 * match the stored status, so the corpus disagrees with the source of truth
 * permanently.
 *
 * Putting the expected statuses in the WHERE clause makes the database the
 * arbiter: the loser matches zero rows and is rejected.
 */
const applyTransition = async (tx, id, action, data, include) => {
  const rule = TRANSITIONS[action];

  const { count } = await tx.patent.updateMany({
    where: { id, status: { in: rule.from } },
    data: { status: rule.to, ...data },
  });

  if (count === 0) {
    const current = await tx.patent.findUnique({ where: { id }, select: { status: true } });
    throw transitionConflict(action, current ? current.status : 'unknown');
  }

  return tx.patent.findUnique({ where: { id }, include });
};

module.exports = {
  STATUS,
  TRANSITIONS,
  EDITABLE_STATUSES,
  transitionConflict,
  assertTransition,
  applyTransition,
};
