const config = require('../config/env');
const { getConsumer } = require('../config/kafka');
const aiReportService = require('../services/aiReportService');

/**
 * Consumes similarity reports from the AI service.
 *
 * Runs as its own process (`npm run consumer`), for the same reasons the relay
 * does: every API replica would otherwise join the consumer group and compete
 * for partitions, and a stalled consumer inside the API would be invisible in
 * API metrics. The API neither produces nor consumes — that symmetry is what
 * keeps request latency independent of broker health.
 *
 * Unlike the relay, this **can** be scaled horizontally: Kafka assigns each
 * partition to one consumer in the group, so instances divide the work rather
 * than duplicating it.
 *
 * One caveat worth knowing, because it is on the other team's side: the AI
 * service publishes reports **without a message key**
 * (`NotificationProducer.publish_similarity_report`), so reports round-robin
 * across partitions instead of being partitioned by patent. On a
 * single-partition topic — the default, and what compose creates — ordering per
 * patent holds. On a multi-partition topic, two reports for one patent could be
 * handled concurrently by different instances and the last write would win
 * arbitrarily. Recorded as follow-up rather than fixed here: fixing it properly
 * means keying the produce call in their service.
 */

/**
 * A malformed or unknown-patent report is acknowledged, not retried.
 *
 * The opposite of the relay's head-of-line blocking, and deliberately so. There
 * the payload is ours and a failure means our bug; here the payload arrives
 * from another team's service and a bad one will still be bad on every retry.
 * Blocking the partition on it would stop every later report for every patent.
 */
const handleMessage = async ({ message }) => {
  const raw = message.value?.toString('utf8');

  if (!raw) return { status: 'ignored', reason: 'empty message' };

  let payload;

  try {
    payload = JSON.parse(raw);
  } catch {
    console.warn('[ai-reports] discarding message that is not valid JSON');
    return { status: 'ignored', reason: 'invalid json' };
  }

  const result = await aiReportService.recordSimilarityReport(payload);

  if (result.status === 'ignored') {
    console.warn(`[ai-reports] discarded a report: ${result.reason}`);
  } else {
    console.log(`[ai-reports] ${result.status} report for patent ${result.patentId}`);
  }

  return result;
};

const start = async () => {
  const consumer = getConsumer();

  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.aiReportTopic, fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await handleMessage(payload);
      } catch (error) {
        // A database failure is ours and *is* transient, so it must not be
        // swallowed: throwing leaves the offset uncommitted so the message is
        // redelivered. recordSimilarityReport is idempotent, so redelivery is
        // safe.
        console.error('[ai-reports] failed to record a report:', error.message);
        throw error;
      }
    },
  });

  const stop = async () => {
    await consumer.disconnect();
  };

  return { stop };
};

module.exports = { handleMessage, start };
