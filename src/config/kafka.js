const { Kafka, Partitioners, logLevel } = require('kafkajs');
const config = require('./env');

/**
 * The Kafka producer, behind a setter — same reasoning as config/storage.js.
 *
 * Tests substitute a fake producer so the suite never needs a live broker.
 * Only the relay and the readiness probe ever connect; request handlers write
 * to the outbox table instead and never touch Kafka, which is what keeps the
 * API available when the broker is down.
 */

let producer = null;
let connected = false;
let consumer = null;

const buildKafka = () =>
  new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: config.isTest ? logLevel.NOTHING : logLevel.WARN,
    retry: { initialRetryTime: 300 },
  });

const buildProducer = () => {
  const kafka = buildKafka();

  return kafka.producer({
    allowAutoTopicCreation: true,
    // Idempotent so a retried send cannot append the same record twice at the
    // broker. Note this does NOT make end-to-end delivery exactly-once: the
    // relay can still re-send an event whose publish succeeded but whose
    // mark-published write did not. Consumers must stay idempotent on
    // (patent_id, version).
    idempotent: true,
    // An idempotent producer must be free to retry indefinitely; capping
    // retries can break its ordering/dedup guarantee, and KafkaJS warns about
    // exactly that. The relay is a background worker, so blocking on retries
    // costs nothing a user can see.
    retry: { retries: Number.MAX_SAFE_INTEGER },
    // Pinned explicitly rather than relying on the default, which changed in
    // KafkaJS v2. Partition assignment decides which events stay ordered
    // together, so it should not shift under a dependency bump.
    createPartitioner: Partitioners.DefaultPartitioner,
  });
};

const getProducer = () => {
  if (!producer) producer = buildProducer();
  return producer;
};

const setProducer = (replacement) => {
  producer = replacement;
  connected = false;
};

const connectProducer = async () => {
  const instance = getProducer();
  if (connected) return instance;

  await instance.connect();
  connected = true;
  return instance;
};

const disconnectProducer = async () => {
  if (!producer || !connected) return;

  await producer.disconnect();
  connected = false;
};

/**
 * The consumer for the AI service's similarity reports.
 *
 * Behind a setter for the same reason as the producer: the suite substitutes a
 * fake so no test needs a live broker. Only the report consumer process
 * (`npm run consumer`) ever calls this — the API never consumes, exactly as it
 * never produces.
 */
const getConsumer = () => {
  if (!consumer) {
    consumer = buildKafka().consumer({ groupId: config.kafka.aiReportGroupId });
  }

  return consumer;
};

const setConsumer = (replacement) => {
  consumer = replacement;
};

module.exports = {
  getProducer,
  setProducer,
  connectProducer,
  disconnectProducer,
  getConsumer,
  setConsumer,
};
