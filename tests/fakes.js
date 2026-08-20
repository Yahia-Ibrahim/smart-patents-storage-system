const { setStorageClient } = require('../src/config/storage');
const { setProducer } = require('../src/config/kafka');

/**
 * In-memory stand-ins for MinIO and Kafka.
 *
 * The alternative — pointing the suite at real containers — makes `npm test`
 * depend on a full compose stack, which is the fastest way to end up with a
 * test suite nobody runs. Both fakes implement only the commands the services
 * actually issue, so if production code starts using a new one, the fake fails
 * loudly rather than silently returning undefined.
 */

class FakeStorage {
  constructor() {
    this.objects = new Map();
    this.buckets = new Set();
  }

  /**
   * Mimics the S3 client's `send(command)` shape. Dispatch is on the command's
   * constructor name, which is what the AWS SDK v3 gives us to work with.
   */
  async send(command) {
    const name = command.constructor.name;
    const input = command.input || {};

    switch (name) {
      case 'HeadBucketCommand': {
        if (this.buckets.has(input.Bucket)) return {};
        const error = new Error('NotFound');
        error.name = 'NotFound';
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }

      case 'CreateBucketCommand':
        this.buckets.add(input.Bucket);
        return {};

      case 'HeadObjectCommand': {
        const object = this.objects.get(input.Key);
        if (object) return { ContentLength: object.size, ContentType: object.contentType };
        const error = new Error('NotFound');
        error.name = 'NotFound';
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }

      case 'DeleteObjectCommand':
        this.objects.delete(input.Key);
        return {};

      case 'PutObjectCommand':
      case 'GetObjectCommand':
        // Only ever reached through the presigner in production code.
        return {};

      default:
        throw new Error(`FakeStorage received an unhandled command: ${name}`);
    }
  }

  /** Simulates a client completing an upload to a presigned URL. */
  putObject(key, { size = 1024, contentType = 'application/pdf' } = {}) {
    this.objects.set(key, { size, contentType });
    return key;
  }

  reset() {
    this.objects.clear();
    this.buckets.clear();
  }
}

class FakeProducer {
  constructor() {
    this.messages = [];
    this.connected = false;
    this.failNext = 0;
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async send({ topic, messages }) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('simulated broker failure');
    }

    messages.forEach((message) => {
      this.messages.push({
        topic,
        key: message.key,
        headers: message.headers,
        value: JSON.parse(message.value),
      });
    });
  }

  reset() {
    this.messages = [];
    this.failNext = 0;
  }
}

const fakeStorage = new FakeStorage();
const fakeProducer = new FakeProducer();

const installFakes = () => {
  setStorageClient(fakeStorage);
  setProducer(fakeProducer);
};

module.exports = { fakeStorage, fakeProducer, installFakes };
