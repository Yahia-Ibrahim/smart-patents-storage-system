/**
 * Boot-time configuration guards.
 *
 * These decide whether a misconfigured process starts at all, so the failure
 * they prevent is a deploy that runs and is quietly wrong — a forgeable JWT
 * secret, a wide-open CORS policy. They are only reachable at module load, so
 * each case re-evaluates the module in an isolated registry with a doctored
 * environment.
 */

const ORIGINAL_ENV = process.env;

/** Loads a module fresh under a given environment, then restores the real one. */
const loadWith = (env, modulePath) => {
  let loaded;
  let thrown;

  jest.isolateModules(() => {
    process.env = { ...ORIGINAL_ENV, ...env };
    try {
      loaded = require(modulePath);
    } catch (error) {
      thrown = error;
    } finally {
      process.env = ORIGINAL_ENV;
    }
  });

  return { loaded, thrown };
};

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/db',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'patents',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  KAFKA_BROKERS: '127.0.0.1:29092',
};

describe('config/env', () => {
  it('accepts a complete environment', () => {
    const { loaded, thrown } = loadWith(BASE, '../../src/config/env');

    expect(thrown).toBeUndefined();
    expect(loaded.storage.bucket).toBe('patents');
    expect(loaded.kafka.brokers).toEqual(['127.0.0.1:29092']);
  });

  it('refuses to start without a database URL', () => {
    const { thrown } = loadWith({ ...BASE, DATABASE_URL: '' }, '../../src/config/env');

    expect(thrown.message).toMatch(/DATABASE_URL is required/);
  });

  /**
   * Reporting every problem at once matters: fixing environment variables one
   * restart at a time is how a five-minute deploy becomes an hour.
   */
  it('reports every missing value in one message, not just the first', () => {
    const { thrown } = loadWith(
      { ...BASE, DATABASE_URL: '', S3_BUCKET: '', KAFKA_BROKERS: '' },
      '../../src/config/env',
    );

    expect(thrown.message).toMatch(/DATABASE_URL/);
    expect(thrown.message).toMatch(/S3_BUCKET/);
    expect(thrown.message).toMatch(/KAFKA_BROKERS/);
  });

  it('rejects a non-numeric port instead of silently using NaN', () => {
    const { thrown } = loadWith({ ...BASE, PORT: 'eighty' }, '../../src/config/env');

    expect(thrown.message).toMatch(/PORT must be an integer/);
  });

  /** An empty allowlist reflects any origin, which is fine locally only. */
  it('requires an explicit CORS allowlist in production', () => {
    const { thrown } = loadWith(
      { ...BASE, NODE_ENV: 'production', CORS_ORIGINS: '' },
      '../../src/config/env',
    );

    expect(thrown.message).toMatch(/CORS_ORIGINS is required in production/);
  });

  it('allows an empty allowlist outside production', () => {
    const { thrown, loaded } = loadWith({ ...BASE, CORS_ORIGINS: '' }, '../../src/config/env');

    expect(thrown).toBeUndefined();
    expect(loaded.corsOrigins).toEqual([]);
  });

  it('parses and trims a comma-separated origin list', () => {
    const { loaded } = loadWith(
      { ...BASE, CORS_ORIGINS: 'http://a.test, http://b.test ,' },
      '../../src/config/env',
    );

    expect(loaded.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  /**
   * Tests substitute in-memory fakes for storage and Kafka, so requiring real
   * credentials there would make the suite depend on a full compose stack.
   */
  it('does not demand storage or broker credentials under test', () => {
    const { thrown } = loadWith(
      { NODE_ENV: 'test', DATABASE_URL: BASE.DATABASE_URL },
      '../../src/config/env',
    );

    expect(thrown).toBeUndefined();
  });

  it('applies documented defaults when optional values are absent', () => {
    const { loaded } = loadWith(BASE, '../../src/config/env');

    expect(loaded.port).toBe(5000);
    expect(loaded.outbox.batchSize).toBe(50);
    expect(loaded.outbox.maxAttempts).toBe(10);
    expect(loaded.storage.forcePathStyle).toBe(true);
    expect(loaded.storage.allowedUploadTypes).toEqual(['application/pdf', 'text/plain']);
  });
});

describe('helpers: JWT secret resolution', () => {
  /**
   * A production process that signs tokens with a baked-in default is
   * catastrophic and silent: every token becomes forgeable by anyone who has
   * read the source. It must fail to boot instead.
   */
  it('refuses to fall back to a default secret in production', () => {
    const { thrown } = loadWith(
      { ...BASE, NODE_ENV: 'production', JWT_SECRET: '' },
      '../../src/utils/helpers',
    );

    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/JWT_SECRET must be set in production/);
  });

  it('starts in production when a secret is supplied', () => {
    const { thrown } = loadWith(
      { ...BASE, NODE_ENV: 'production', JWT_SECRET: 'a-real-secret' },
      '../../src/utils/helpers',
    );

    expect(thrown).toBeUndefined();
  });

  it('allows a development default so a fresh checkout runs', () => {
    const { thrown, loaded } = loadWith(
      { ...BASE, NODE_ENV: 'development', JWT_SECRET: '' },
      '../../src/utils/helpers',
    );

    expect(thrown).toBeUndefined();
    expect(loaded.BCRYPT_COST).toBe(12);
  });
});

describe('helpers: bcrypt cost', () => {
  it('uses the production factor outside tests, ignoring any override', () => {
    const { loaded } = loadWith(
      { ...BASE, NODE_ENV: 'production', JWT_SECRET: 's', BCRYPT_COST: '4' },
      '../../src/utils/helpers',
    );

    // A stray environment variable must not weaken production hashing.
    expect(loaded.BCRYPT_COST).toBe(12);
  });

  it('honours the override under test, with a floor bcrypt accepts', () => {
    const cheap = loadWith({ ...BASE, NODE_ENV: 'test', BCRYPT_COST: '5' }, '../../src/utils/helpers');
    const floored = loadWith({ ...BASE, NODE_ENV: 'test', BCRYPT_COST: '1' }, '../../src/utils/helpers');

    expect(cheap.loaded.BCRYPT_COST).toBe(5);
    // bcrypt throws below 4, so the floor is what stops a "fast" setting from
    // breaking every signup.
    expect(floored.loaded.BCRYPT_COST).toBe(4);
  });
});

/**
 * Presigned URLs are followed by somebody else's browser, not by this process.
 *
 * In compose the backend reaches MinIO as `http://minio:9000`, which resolves
 * only inside patents-net. Signing an upload URL with that host produces
 * something correctly signed and completely unusable — and the failure looks
 * like a CORS or credentials problem rather than an addressing one, which is
 * why it is worth pinning down here.
 */
describe('config/storage: signing endpoint', () => {
  const PUBLIC = 'https://files.example.com';

  it('reuses one client when the two endpoints agree', () => {
    const { loaded } = loadWith(BASE, '../../src/config/storage');

    // The common case — a host-run backend, or real S3. No second pool.
    expect(loaded.getPresignClient()).toBe(loaded.getStorageClient());
  });

  it('signs with a separate client when the public endpoint differs', async () => {
    const { loaded } = loadWith(
      { ...BASE, S3_PUBLIC_ENDPOINT: PUBLIC },
      '../../src/config/storage',
    );

    const internal = loaded.getStorageClient();
    const presign = loaded.getPresignClient();

    expect(presign).not.toBe(internal);
    await expect(presign.config.endpoint()).resolves.toMatchObject({
      hostname: 'files.example.com',
    });
    await expect(internal.config.endpoint()).resolves.toMatchObject({ hostname: '127.0.0.1' });
  });

  /**
   * The suite installs one fake for the whole process. If the setter reached
   * only one of the two clients, the other would quietly dial a real endpoint
   * from inside a unit test.
   */
  it('substitutes both clients from the one setter', () => {
    const { loaded } = loadWith(
      { ...BASE, S3_PUBLIC_ENDPOINT: PUBLIC },
      '../../src/config/storage',
    );

    const fake = { send: async () => ({}) };
    loaded.setStorageClient(fake);

    expect(loaded.getStorageClient()).toBe(fake);
    expect(loaded.getPresignClient()).toBe(fake);
  });

  it('signs download URLs with the public client, not the internal one', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env = { ...ORIGINAL_ENV, ...BASE, S3_PUBLIC_ENDPOINT: PUBLIC };

      try {
        const storageConfig = require('../../src/config/storage');
        const storageService = require('../../src/services/storageService');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

        getSignedUrl.mockClear();
        await storageService.presignDownload('patents/1/abc/spec.pdf');

        const [clientUsed] = getSignedUrl.mock.calls[0];

        expect(clientUsed).toBe(storageConfig.getPresignClient());
        expect(clientUsed).not.toBe(storageConfig.getStorageClient());
      } finally {
        process.env = ORIGINAL_ENV;
      }
    });
  });
});
