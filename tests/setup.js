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

// Keep hashing honest but fast enough that the suite is not dominated by KDF
// cost. Login timing behaviour is asserted separately, not via wall-clock.
jest.setTimeout(30000);

const prisma = require('../src/config/prisma');

/**
 * A truncate between tests, rather than a transaction rollback, because the
 * refresh-token flow uses prisma.$transaction itself and nesting would
 * deadlock. RESTART IDENTITY keeps ids predictable across tests.
 */
global.resetDatabase = async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "REFRESH_TOKEN", "PATENT_CATEGORY", "PATENT_INVENTOR", "PATENT_REVIEW", "PATENT", "INVENTOR", "CATEGORY", "USER" RESTART IDENTITY CASCADE',
  );
};

beforeEach(async () => {
  await global.resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
