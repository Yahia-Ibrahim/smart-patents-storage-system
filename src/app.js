const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const config = require('./config/env');
const prisma = require('./config/prisma');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares');
const { requestContext } = require('./middlewares/requestContext');
const storageService = require('./services/storageService');
const outboxService = require('./services/outboxService');
const { setupSwagger } = require('./swagger');

const app = express();

/**
 * An empty CORS_ORIGINS means "reflect any origin", which is fine locally and
 * unacceptable in production — config/env.js refuses to boot a production
 * process without an explicit allowlist, so reaching the permissive branch
 * here means someone is on a dev machine.
 */
app.use(
  cors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  }),
);
app.use(helmet());
app.use(compression());
app.use(requestContext);
app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.jsonBodyLimit }));

if (!config.isTest) {
  morgan.token('id', (req) => req.id);
  app.use(
    morgan(
      config.isProduction
        ? ':id :remote-addr :method :url :status :res[content-length] - :response-time ms'
        : 'dev',
    ),
  );
}

/**
 * Liveness: is the process up? Deliberately does not touch the database — a
 * liveness probe that fails on a slow query gets the container killed during
 * exactly the incident where you least want it restarted.
 */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Readiness: should this instance receive traffic? This one *does* check
 * dependencies, because an instance that cannot reach Postgres or object
 * storage cannot serve a request even though its process is healthy.
 *
 * Kafka is not checked: the API never publishes directly. Writes go to the
 * outbox table, so a broker outage must not take the API out of rotation —
 * that decoupling is the whole point of the outbox. The backlog is reported
 * for visibility instead.
 */
app.get('/ready', async (_req, res) => {
  const checks = {};
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (error) {
    checks.database = `error: ${error.message}`;
    healthy = false;
  }

  try {
    await storageService.checkHealth();
    checks.storage = 'ok';
  } catch (error) {
    checks.storage = `error: ${error.message}`;
    healthy = false;
  }

  try {
    checks.outbox = await outboxService.stats();
  } catch (error) {
    checks.outbox = `error: ${error.message}`;
  }

  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'degraded', checks });
});

app.use('/api', routes);
setupSwagger(app);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
