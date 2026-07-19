const { execSync } = require('child_process');
const { Client } = require('pg');

require('dotenv/config');

/**
 * Creates the test database if it does not exist, then applies migrations.
 *
 * Runs once before the whole suite so `npm test` works from a clean checkout
 * without a documented manual setup step that everyone forgets.
 */
module.exports = async () => {
  const testUrl =
    process.env.TEST_DATABASE_URL ||
    'postgresql://patents:patents@localhost:5433/patents_test?schema=public';

  const url = new URL(testUrl);
  const dbName = url.pathname.slice(1);

  if (!dbName) {
    throw new Error(`TEST_DATABASE_URL has no database name: ${testUrl}`);
  }

  // Refuse to run against the dev database: the suite truncates every table.
  if (process.env.DATABASE_URL) {
    const devName = new URL(process.env.DATABASE_URL).pathname.slice(1);
    if (devName === dbName) {
      throw new Error(
        `TEST_DATABASE_URL points at the same database as DATABASE_URL ("${dbName}").\n` +
          'The test suite truncates every table. Point TEST_DATABASE_URL at a separate database.',
      );
    }
  }

  // Connect to the maintenance database to issue CREATE DATABASE.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  const client = new Client({ connectionString: adminUrl.toString() });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach Postgres at ${adminUrl.host}. Start it with \`docker compose up -d postgres\`.\n` +
        `Original error: ${error.message}`,
    );
  }

  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);

  if (rowCount === 0) {
    // Identifier cannot be parameterised; dbName comes from our own env var.
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  }

  await client.end();

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
};
