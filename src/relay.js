require('dotenv').config();

const prisma = require('./config/prisma');
const { start } = require('./workers/outboxRelay');

/**
 * Entrypoint for the outbox relay process (`npm run relay`).
 * Deployed as its own container alongside the API — see docker-compose.yml.
 */
start()
  .then(({ stop }) => {
    console.log('[outbox-relay] started');

    // The entrypoint owns the process, so releasing the database pool is its
    // job rather than the worker's.
    const shutdown = async (signal) => {
      console.log(`[outbox-relay] ${signal} received, stopping`);
      await stop();
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((error) => {
    console.error('[outbox-relay] failed to start:', error);
    process.exit(1);
  });
