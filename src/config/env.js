/**
 * Configuration, validated once at boot.
 *
 * The rule this module enforces: a misconfigured process must fail loudly at
 * startup, not halfway through the first request that happens to need the
 * missing value. `JWT_SECRET` already worked this way (utils/helpers.js);
 * this generalises it to everything else and reports *all* problems at once,
 * because fixing env vars one restart at a time is miserable.
 */

const parseList = (value, fallback = []) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;

const parseInteger = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

const build = () => {
  const problems = [];
  const env = process.env;
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const require_ = (name) => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value;
  };

  const integer = (name, fallback) => {
    const parsed = parseInteger(env[name], fallback);
    if (Number.isNaN(parsed)) problems.push(`${name} must be an integer`);
    return parsed;
  };

  // Storage and Kafka are only *required* where something would actually use
  // them. Tests substitute fakes and must not need a live MinIO or broker, so
  // the requirement is lifted there rather than every test file carrying
  // credentials for services it never touches.
  const externalsRequired = !isTest;

  const config = {
    nodeEnv,
    isProduction,
    isTest,
    port: integer('PORT', 5000),

    databaseUrl: require_('DATABASE_URL'),

    corsOrigins: parseList(env.CORS_ORIGINS),

    // Specifications are long-form text; 1 MB of JSON is roughly 500k
    // characters, comfortably more than a real patent body and small enough
    // that a malicious body cannot exhaust memory.
    jsonBodyLimit: env.JSON_BODY_LIMIT || '1mb',

    storage: {
      endpoint: externalsRequired ? require_('S3_ENDPOINT') : env.S3_ENDPOINT,
      region: env.S3_REGION || 'us-east-1',
      bucket: externalsRequired ? require_('S3_BUCKET') : env.S3_BUCKET || 'patents',
      accessKeyId: externalsRequired ? require_('S3_ACCESS_KEY_ID') : env.S3_ACCESS_KEY_ID,
      secretAccessKey: externalsRequired
        ? require_('S3_SECRET_ACCESS_KEY')
        : env.S3_SECRET_ACCESS_KEY,
      // MinIO serves buckets as a path segment, not a subdomain. Left true by
      // default because that is the dev target; real S3 wants false.
      forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, true),
      uploadUrlTtlSeconds: integer('UPLOAD_URL_TTL_SECONDS', 900),
      downloadUrlTtlSeconds: integer('DOWNLOAD_URL_TTL_SECONDS', 300),
      maxUploadBytes: integer('UPLOAD_MAX_BYTES', 50 * 1024 * 1024),
      allowedUploadTypes: parseList(env.ALLOWED_UPLOAD_TYPES, [
        'application/pdf',
        'text/plain',
      ]),
    },

    kafka: {
      brokers: parseList(env.KAFKA_BROKERS, externalsRequired ? [] : ['localhost:29092']),
      clientId: env.KAFKA_CLIENT_ID || 'patents-backend',
      patentEventsTopic: env.PATENT_EVENTS_TOPIC || 'patents.events',

      // The AI service's contract. These names are hardcoded on its side
      // (KafkaPatentConsumer.TOPIC_HANDLERS and NotificationProducer), so they
      // are only configurable in the sense that both sides move together.
      aiSubmittedTopic: env.AI_SUBMITTED_TOPIC || 'Patents.submitted',
      aiApprovedTopic: env.AI_APPROVED_TOPIC || 'Patents.approved',
      aiRejectedTopic: env.AI_REJECTED_TOPIC || 'Patents.rejected',
      aiReportTopic: env.AI_REPORT_TOPIC || 'Notifications.similarity-report',
      aiReportGroupId: env.AI_REPORT_GROUP_ID || 'patents-backend-ai-reports',
    },

    /**
     * The AI service's HTTP half, added when it grew a FastAPI search API
     * alongside its Kafka consumer.
     *
     * Optional on purpose, and the only integration point that is. The Kafka
     * half works with no HTTP configuration at all, so a backend without
     * AI_SEARCH_URL reports semantic search as unavailable rather than
     * refusing to boot -- which is what makes `npm test`, and a deployment
     * that has not stood the AI up yet, still work.
     */
    ai: {
      // Trailing slashes stripped so joining the path cannot produce `//`.
      searchUrl: (env.AI_SEARCH_URL || '').replace(/\/+$/, ''),
      // Generous: the request embeds the query, queries Qdrant, and then waits
      // on an LLM round trip. Short enough that a wedged AI service cannot pin
      // a request handler indefinitely.
      searchTimeoutMs: integer('AI_SEARCH_TIMEOUT_MS', 25000),
    },

    outbox: {
      pollIntervalMs: integer('OUTBOX_POLL_INTERVAL_MS', 1000),
      batchSize: integer('OUTBOX_BATCH_SIZE', 50),
      maxAttempts: integer('OUTBOX_MAX_ATTEMPTS', 10),
    },
  };

  if (externalsRequired && config.kafka.brokers.length === 0) {
    problems.push('KAFKA_BROKERS is required (comma-separated host:port list)');
  }

  if (isProduction && config.corsOrigins.length === 0) {
    problems.push('CORS_ORIGINS is required in production (comma-separated origin list)');
  }

  if (problems.length) {
    throw new Error(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n` +
        'See .env.example for the full list of expected values.',
    );
  }

  return config;
};

module.exports = build();
