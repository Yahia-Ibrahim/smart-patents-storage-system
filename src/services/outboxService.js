const prisma = require('../config/prisma');

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
 * Claims a batch of unpublished events for one relay pass.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes it safe to run more than one relay
 * process: each pass locks its own rows and skips rows another relay is
 * already holding, so no event is published twice by concurrent relays and
 * neither process blocks the other.
 *
 * `ORDER BY id` preserves publication order within a patent, which matters
 * because consumers apply versions in sequence.
 */
const claimBatch = (tx, batchSize) =>
  tx.$queryRawUnsafe(
    `SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts
       FROM "OUTBOX_EVENT"
      WHERE published_at IS NULL
      ORDER BY id
      LIMIT ${Number(batchSize)}
      FOR UPDATE SKIP LOCKED`,
  );

const markPublished = (tx, id) =>
  tx.outboxEvent.update({ where: { id }, data: { publishedAt: new Date(), lastError: null } });

const markFailed = (tx, id, error) =>
  tx.outboxEvent.update({
    where: { id },
    data: { attempts: { increment: 1 }, lastError: String(error).slice(0, 2000) },
  });

/** Backlog stats, used by the readiness probe and by operators. */
const stats = async () => {
  // One round trip rather than two counts: the readiness probe is called
  // often, and both numbers come from the same scan of the unpublished rows.
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS pending,
           COUNT(*) FILTER (WHERE attempts >= 5)::int AS stuck
      FROM "OUTBOX_EVENT"
     WHERE published_at IS NULL`;

  return { pending: row.pending, stuck: row.stuck };
};

module.exports = { enqueue, claimBatch, markPublished, markFailed, stats };
