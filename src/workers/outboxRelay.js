const prisma = require('../config/prisma');
const config = require('../config/env');
const { connectProducer, disconnectProducer, getProducer } = require('../config/kafka');
const outboxService = require('../services/outboxService');

/**
 * Moves committed outbox rows onto Kafka.
 *
 * Runs as its own process (`npm run relay`), not inside the API. Two reasons:
 * every API replica would otherwise poll the same table, and a stalled relay
 * would be invisible in API metrics. `SKIP LOCKED` makes concurrency safe
 * either way, but a separate process is also the shape Debezium would take if
 * it replaces this later.
 */

/**
 * Publishing failures do NOT skip ahead to the next row.
 *
 * Head-of-line blocking is the correct behaviour here: events for one patent
 * must reach consumers in version order, and skipping a failed row would
 * deliver v2 before v1. Throughput is not the constraint at this scale;
 * ordering is. Stuck rows surface through outboxService.stats() rather than
 * being quietly dropped.
 */
const publishBatch = async () => {
  const producer = getProducer();

  return prisma.$transaction(async (tx) => {
    const events = await outboxService.claimBatch(tx, config.outbox.batchSize);
    let published = 0;

    for (const event of events) {
      try {
        await producer.send({
          topic: config.kafka.patentEventsTopic,
          messages: [
            {
              // Keyed by aggregate id so every version of one patent lands on
              // one partition — Kafka only guarantees ordering within a
              // partition, and per-patent ordering is exactly what consumers
              // need.
              key: String(event.aggregate_id),
              value: JSON.stringify(event.payload),
              headers: {
                'event-type': event.event_type,
                'aggregate-type': event.aggregate_type,
              },
            },
          ],
        });

        await outboxService.markPublished(tx, event.id);
        published += 1;
      } catch (error) {
        await outboxService.markFailed(tx, event.id, error.message);
        // Stop the batch: see the head-of-line note above.
        break;
      }
    }

    return { claimed: events.length, published };
  });
};

const start = async () => {
  await connectProducer();

  let running = true;
  let timer = null;

  const loop = async () => {
    if (!running) return;

    try {
      const { claimed, published } = await publishBatch();

      if (published > 0) {
        console.log(`[outbox-relay] published ${published}/${claimed} event(s)`);
      }

      // A full batch means there is probably more waiting, so drain without
      // sleeping. An empty or partial batch means idle: back off to the poll
      // interval instead of hammering Postgres.
      const delay = claimed === config.outbox.batchSize ? 0 : config.outbox.pollIntervalMs;
      timer = setTimeout(loop, delay);
    } catch (error) {
      console.error('[outbox-relay] pass failed:', error.message);
      timer = setTimeout(loop, config.outbox.pollIntervalMs);
    }
  };

  loop();

  const stop = async () => {
    running = false;
    if (timer) clearTimeout(timer);
    await disconnectProducer();
    await prisma.$disconnect();
  };

  return { stop };
};

module.exports = { publishBatch, start };
