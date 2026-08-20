const prisma = require('../config/prisma');
const config = require('../config/env');

/**
 * The transactional outbox.
 *
 * The problem it solves: "update the row, then publish an event" is a dual
 * write. Crash between the two and the database and the event log disagree
 * forever, with no way to tell which happened. Writing the event *as a row, in
 * the same transaction* makes it atomic — either both land or neither does.
 *
 * The relay then moves rows to Kafka as a separate, retryable step. That step
 * can duplicate (publish succeeds, the mark-published write fails) but can
 * never lose. Hence: **at-least-once delivery, idempotent consumers required.**
 */

/**
 * Appends an event to the outbox.
 *
 * `tx` is the first parameter and is not optional by convention: the whole
 * guarantee rests on this write sharing a transaction with the state change it
 * describes. Passing the plain client here is legal JavaScript and a silent
 * correctness bug, so callers should always be inside a `$transaction`.
 */
const enqueue = (tx, { aggregateType, aggregateId, eventType, payload }) =>
  tx.outboxEvent.create({
    data: { aggregateType, aggregateId, eventType, payload },
  });

/**
 * How long a claim is honoured before another relay may take the row back.
 * Generous relative to a publish, so a slow broker does not cause two relays
 * to publish the same event; short enough that a crashed relay's backlog
 * drains without operator action.
 */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Atomically takes ownership of the next batch of unpublished events.
 *
 * This is a single `UPDATE ... RETURNING` over a `SELECT ... FOR UPDATE SKIP
 * LOCKED` subquery, and it commits on its own. That matters: publishing must
 * happen *outside* any database transaction, because a Kafka round trip held
 * inside one blows through Prisma's 5s interactive-transaction timeout under a
 * degraded broker — and when that transaction aborts, it rolls back the
 * mark-published writes for events that were already sent, so the next pass
 * re-sends them. That is an unbounded duplicate loop, not at-least-once noise.
 *
 * `SKIP LOCKED` keeps two relays from grabbing the same rows in the instant
 * this statement runs; `claimed_at` is what keeps them apart afterwards, once
 * the row lock is gone.
 *
 * Rows that have failed `OUTBOX_MAX_ATTEMPTS` times are excluded, which is what
 * lets the queue drain past a permanently poisonous event instead of retrying
 * it forever. See `deadLettered` in `stats()`.
 */
const claimBatch = async (batchSize) => {
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);

  return prisma.$queryRaw`
    UPDATE "OUTBOX_EVENT"
       SET claimed_at = NOW()
     WHERE id IN (
       SELECT id
         FROM "OUTBOX_EVENT"
        WHERE published_at IS NULL
          AND attempts < ${config.outbox.maxAttempts}
          AND (claimed_at IS NULL OR claimed_at < ${staleBefore})
        ORDER BY id
        LIMIT ${Number(batchSize)}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, aggregate_type, aggregate_id, event_type, payload, attempts`;
};

const markPublished = (id) =>
  prisma.outboxEvent.update({
    where: { id },
    data: { publishedAt: new Date(), lastError: null, claimedAt: null },
  });

/**
 * Releases the claim so the row is retried on a later pass, and records why.
 * Clearing `claimed_at` matters: leaving it set would make the row wait out
 * the full claim timeout before anyone retried it.
 */
const markFailed = (id, error) =>
  prisma.outboxEvent.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      lastError: String(error).slice(0, 2000),
      claimedAt: null,
    },
  });

/**
 * Backlog stats for the readiness probe and for operators.
 *
 * `deadLettered` is the number that needs a human: those events will never be
 * published, and whatever they described is missing downstream.
 */
const stats = async () => {
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS pending,
           COUNT(*) FILTER (WHERE attempts > 0)::int AS retrying,
           COUNT(*) FILTER (WHERE attempts >= ${config.outbox.maxAttempts})::int AS "deadLettered"
      FROM "OUTBOX_EVENT"
     WHERE published_at IS NULL`;

  return row;
};

module.exports = { CLAIM_TIMEOUT_MS, enqueue, claimBatch, markPublished, markFailed, stats };
