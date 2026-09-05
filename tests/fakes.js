const { setStorageClient } = require('../src/config/storage');
const { setProducer } = require('../src/config/kafka');
const { setSearchClient } = require('../src/config/aiSearch');

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

/**
 * The AI service's search API.
 *
 * The real one is an 8.7 GB container that downloads an embedding model and
 * calls Gemini per request, so a test that touched it would be a test nobody
 * runs. Only `isConfigured` and `search` exist, because those are the only two
 * methods aiSearchService calls.
 *
 * `configured` defaults to true: the interesting default is a working AI
 * service, and the not-configured case is one test that flips it.
 */
class FakeAiSearch {
  constructor() {
    this.reset();
  }

  isConfigured() {
    return this.configured;
  }

  async search(text) {
    this.calls.push(text);

    if (this.failure) throw this.failure;

    return this.response;
  }

  /** Answer the next search with these matches. Shaped like the real body. */
  respondWith({ summary = 'Found related patents.', results = [] } = {}) {
    this.response = { summary, results };
  }

  /** Make the next search throw, standing in for a down or wedged service. */
  failWith(message) {
    this.failure = new Error(message);
  }

  reset() {
    this.configured = true;
    this.calls = [];
    this.failure = null;
    this.response = { summary: '', results: [] };
  }
}

const fakeStorage = new FakeStorage();
const fakeProducer = new FakeProducer();
const fakeAiSearch = new FakeAiSearch();

const installFakes = () => {
  setStorageClient(fakeStorage);
  setProducer(fakeProducer);
  setSearchClient(fakeAiSearch);
};

module.exports = { fakeStorage, fakeProducer, fakeAiSearch, installFakes };
