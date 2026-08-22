const config = require('../config/env');
const { connectProducer, disconnectProducer, getProducer } = require('../config/kafka');
const outboxService = require('../services/outboxService');

/**
 * Moves committed outbox rows onto Kafka.
 *
 * Runs as its own process (`npm run relay`), not inside the API. Every API
 * replica would otherwise poll the same table, and a stalled relay inside the
 * API process would be invisible in API metrics.
 *
 * **Run exactly one.** Claiming (see outboxService.claimBatch) stops two relays
 * doing the same work, so a second instance is safe in the "no duplicates"
 * sense — but it is *not* safe for ordering: relay B can publish patent 7 v2
 * while relay A is still publishing v1, and Kafka only orders within a
 * partition by arrival. If you need horizontal scale, partition the claim by
 * aggregate id rather than adding instances.
 */

/**
 * Kafka's default max request size is 1 MB. A specification is capped at
 * 200k characters, which in a multi-byte encoding can exceed that once wrapped
 * in a fat event — and an oversized event fails forever, which with
 * head-of-line blocking would wedge every later event behind it. Oversized
 * payloads are dead-lettered immediately instead of retried.
 */
const MAX_PAYLOAD_BYTES = 900 * 1024;

/**
 * Publishing failures do NOT skip ahead to the next row.
 *
 * Head-of-line blocking is deliberate: events for one patent must reach
 * consumers in order, and skipping a failed row would deliver v2 before v1.
 * The escape hatch is `OUTBOX_MAX_ATTEMPTS` — after that many failures a row is
 * dead-lettered (excluded from claiming) so a permanently poisonous event
 * cannot block the queue forever. `/ready` reports the count.
 */
const publishBatch = async () => {
  const producer = getProducer();
  const events = await outboxService.claimBatch(config.outbox.batchSize);
  let published = 0;

  for (const event of events) {
    // The relay stamps the outbox row id onto the payload as `sequence`.
    //
    // It has to happen here rather than at enqueue time, because the id does
    // not exist until the row is written. `sequence` is monotonic per patent
    // and across the whole log, which is what lets a consumer tell a genuine
    // re-approval from a redelivery — `(patent_id, version)` cannot, since an
    // approve → decline → re-approve cycle repeats the same version.
    const payload = { ...event.payload, sequence: String(event.id) };
    const value = JSON.stringify(payload);

    try {
      if (Buffer.byteLength(value, 'utf8') > MAX_PAYLOAD_BYTES) {
        throw new Error(
          `Event payload is ${Buffer.byteLength(value, 'utf8')} bytes, over the ${MAX_PAYLOAD_BYTES} limit`,
        );
      }

      await producer.send({
        // A row carries its own destination; null means the default topic,
        // which is what every row written before the AI integration meant.
        topic: event.topic || config.kafka.patentEventsTopic,
        messages: [
          {
            // Keyed by aggregate id so every version of one patent lands on
            // one partition — Kafka only guarantees ordering within a
            // partition, and per-patent ordering is what consumers need.
            key: String(event.aggregate_id),
            value,
            headers: {
              'event-type': event.event_type,
              'aggregate-type': event.aggregate_type,
            },
          },
        ],
      });

      await outboxService.markPublished(event.id);
      published += 1;
    } catch (error) {
      await outboxService.markFailed(event.id, error.message);
      // Stop the batch: see the head-of-line note above.
      break;
    }
  }

  return { claimed: events.length, published };
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
      } else if (claimed > 0) {
        console.warn(`[outbox-relay] claimed ${claimed} event(s) but published none`);
      }

      // Drain without sleeping only when the batch was both full *and*
      // entirely successful. Keying this on `claimed` alone would busy-loop at
      // 100% CPU against a full batch whose head event always fails, rewriting
      // the same row thousands of times a second.
      const drained = published === config.outbox.batchSize;
      timer = setTimeout(loop, drained ? 0 : config.outbox.pollIntervalMs);
    } catch (error) {
      console.error('[outbox-relay] pass failed:', error.message);
      timer = setTimeout(loop, config.outbox.pollIntervalMs);
    }
  };

  loop();

  /**
   * Stops the loop and releases the producer. Deliberately does NOT disconnect
   * Prisma: the worker does not own the process, and tearing down a shared
   * client from inside a library function is the sort of thing that works in
   * production and breaks everything else. src/relay.js owns that.
   */
  const stop = async () => {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    await disconnectProducer();
  };

  return { stop };
};

module.exports = { MAX_PAYLOAD_BYTES, publishBatch, start };
