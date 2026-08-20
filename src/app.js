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
app.get('/ready', async (req, res) => {
  const checks = {};
  let healthy = true;

  // The probe is unauthenticated, so it reports status only. Driver error
  // messages carry hosts, ports, database names, bucket names and sometimes a
  // credential id; those go to the log, keyed by request id, not to the caller.
  const check = async (name, fn) => {
    try {
      checks[name] = (await fn()) ?? 'ok';
    } catch (error) {
      console.error(`[ready] ${name} check failed (request ${req.id}):`, error.message);
      checks[name] = 'error';
      healthy = false;
    }
  };

  await check('database', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  });
  await check('storage', async () => {
    await storageService.checkHealth();
    return 'ok';
  });

  // Backlog is reported but never fails the probe: events queueing up is the
  // outbox working as designed while the broker is away, not a reason to pull
  // this instance out of rotation.
  try {
    checks.outbox = await outboxService.stats();
  } catch (error) {
    console.error(`[ready] outbox stats failed (request ${req.id}):`, error.message);
    checks.outbox = 'error';
  }

  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'degraded', checks });
});

app.use('/api', routes);
setupSwagger(app);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
