const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

/**
 * An explicit pg Pool, rather than handing the adapter a bare connection
 * string.
 *
 * With a connection string the adapter manages its own connection, and
 * concurrent queries — `Promise.all([...])`, or two requests arriving at once —
 * end up multiplexed onto one client. pg warns about exactly that
 * ("Calling client.query() when the client is already executing a query"), and
 * the practical symptom is intermittent "Server has closed the connection"
 * failures under load. A real pool hands each query its own connection.
 *
 * `max` is deliberately modest: Postgres connections are expensive, and this
 * process is one of several (API replicas plus the relay) sharing the server's
 * connection budget.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// An idle client erroring out (a network blip, a server restart) emits on the
// pool. Without a listener Node treats it as an unhandled 'error' event and
// kills the process.
pool.on('error', (error) => {
  console.error('[postgres] idle client error:', error.message);
});

// disposeExternalPool ties the pool's lifetime to the Prisma client's. Without
// it the adapter leaves an externally-supplied pool open on $disconnect, so
// graceful shutdown never releases its Postgres connections and Jest hangs
// after the last test complaining about an open handle.
const adapter = new PrismaPg(pool, { disposeExternalPool: true });

const prisma = global.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

module.exports = prisma;
