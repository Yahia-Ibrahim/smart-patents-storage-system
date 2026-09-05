require('dotenv/config');

/**
 * Runs before every test file, and critically before src/config/prisma.js is
 * required: that module reads DATABASE_URL at import time, so pointing it at
 * the test database has to happen first.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-in-production';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://patents:patents@localhost:5433/patents_test?schema=public';

/**
 * The presigner is mocked at the module level rather than spied on.
 *
 * storageService destructures `getSignedUrl` at require time, so replacing the
 * property on the module object afterwards would rebind nothing — the service
 * would keep calling the real one, which then tries to sign with the fake
 * client's absent credentials. Mocking the module is the only interception
 * point that actually works here.
 */
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (_client, command) => {
    const verb = command.constructor.name === 'PutObjectCommand' ? 'put' : 'get';
    return `https://fake-storage.test/${verb}/${encodeURIComponent(command.input.Key)}`;
  }),
}));

// Keep hashing honest but fast enough that the suite is not dominated by KDF
// cost. Login timing behaviour is asserted separately, not via wall-clock.
jest.setTimeout(30000);

const prisma = require('../src/config/prisma');
const { fakeStorage, fakeProducer, fakeAiSearch, installFakes } = require('./fakes');

// Storage and Kafka are swapped for in-memory fakes for the whole suite, so
// `npm test` needs Postgres and nothing else.
installFakes();

/**
 * A truncate between tests, rather than a transaction rollback, because the
 * refresh-token flow uses prisma.$transaction itself and nesting would
 * deadlock. RESTART IDENTITY keeps ids predictable across tests.
 */
global.resetDatabase = async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "IDEMPOTENCY_KEY", "OUTBOX_EVENT", "REFRESH_TOKEN", "PATENT_CATEGORY", "PATENT_INVENTOR", "PATENT_REVIEW", "PATENT", "INVENTOR", "CATEGORY", "USER" RESTART IDENTITY CASCADE',
  );
};

beforeEach(async () => {
  await global.resetDatabase();
  fakeStorage.reset();
  fakeProducer.reset();
  fakeAiSearch.reset();
});

afterAll(async () => {
  await prisma.$disconnect();
});
