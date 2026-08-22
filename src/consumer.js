require('dotenv').config();

const prisma = require('./config/prisma');
const { start } = require('./workers/reportConsumer');

/**
 * Entrypoint for the AI report consumer process (`npm run consumer`).
 * Deployed as its own container alongside the API and the relay — see
 * docker-compose.yml.
 */
start()
  .then(({ stop }) => {
    console.log('[ai-reports] started');

    // The entrypoint owns the process, so releasing the database pool is its
    // job rather than the worker's.
    const shutdown = async (signal) => {
      console.log(`[ai-reports] ${signal} received, stopping`);
      await stop();
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((error) => {
    console.error('[ai-reports] failed to start:', error);
    process.exit(1);
  });
