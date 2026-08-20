require('dotenv').config();

const app = require('./app');
const config = require('./config/env');
const prisma = require('./config/prisma');
const storageService = require('./services/storageService');

/**
 * Create the bucket before accepting traffic.
 *
 * Doing it lazily on the first upload means /ready reports storage as broken
 * until someone happens to submit a patent — which is exactly backwards for a
 * probe whose job is to say whether this instance can serve requests. A
 * failure here is logged rather than fatal: the database is the source of
 * truth, and an instance that can still serve reads is better than one that
 * refuses to boot because MinIO was slow to come up.
 */
storageService
  .ensureBucket()
  .catch((error) => console.error('[storage] could not provision bucket:', error.message));

const server = app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

/**
 * Graceful shutdown.
 *
 * `server.close` stops accepting new connections and waits for in-flight
 * requests, so a rolling deploy does not sever a request mid-write. The hard
 * timeout exists because a hung keep-alive connection would otherwise hold the
 * process open until the orchestrator SIGKILLs it, which is a worse ending.
 */
const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down`);

  const force = setTimeout(() => {
    console.error('Shutdown timed out; forcing exit');
    process.exit(1);
  }, 10000);
  force.unref();

  server.close(async () => {
    await prisma.$disconnect();
    clearTimeout(force);
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
