const { randomUUID } = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { hashPassword } = require('../src/utils/helpers');
const { ROLES } = require('../src/utils/roles');

const api = () => request(app);

const VALID_PASSWORD = 'Passw0rdTest';

/**
 * Creates a user directly in the database, bypassing the API. Tests for
 * authorization should not depend on the signup endpoint working.
 */
const createUser = async ({
  name = 'Test User',
  email = 'user@example.com',
  password = VALID_PASSWORD,
  role = ROLES.USER,
  createdBy = null,
} = {}) =>
  prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role,
      createdBy,
    },
  });

const createAdmin = (overrides = {}) =>
  createUser({ name: 'Admin', email: 'admin@example.com', role: ROLES.ADMIN, ...overrides });

/** Logs in through the real endpoint and returns the token pair. */
const login = async (email, password = VALID_PASSWORD) => {
  const res = await api().post('/api/users/login').send({ email, password });

  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
};

const authHeader = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

const { fakeStorage } = require('./fakes');

/**
 * Walks the real upload flow: ask for a presigned target, then simulate the
 * client PUTting bytes to it. Returns the documentKey to pass to POST /patents.
 *
 * Tests go through the endpoint rather than fabricating a key, because the key
 * format and the ownership check are part of what is under test.
 */
const uploadDocument = async (accessToken, { filename = 'spec.pdf', contentType = 'application/pdf', size = 2048 } = {}) => {
  const res = await api()
    .post('/api/patents/uploads')
    .set(authHeader(accessToken))
    .send({ filename, contentType });

  if (res.status !== 201) {
    throw new Error(`upload request failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  fakeStorage.putObject(res.body.data.objectKey, { size, contentType });
  return res.body.data.objectKey;
};

const PATENT_BODY = {
  title: 'A self-cooling beverage container',
  abstract: 'An apparatus for cooling a beverage container using an endothermic reaction chamber.',
  specification: 'The invention comprises an inner vessel, an outer shell, and a rupturable membrane separating two reagents which, on mixing, absorb heat from the contents.',
};

/** Creates a draft patent through the API and returns its DTO. */
const createDraftPatent = async (accessToken, overrides = {}) => {
  const documentKey = overrides.documentKey || (await uploadDocument(accessToken));
  const res = await api()
    .post('/api/patents')
    .set(authHeader(accessToken))
    .send({ ...PATENT_BODY, documentKey, ...overrides });

  if (res.status !== 201) {
    throw new Error(`patent creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
};

/** Draft -> pending_admin -> approved, the full happy path. */
const approvedPatent = async (userToken, adminToken, overrides = {}) => {
  const patent = await createDraftPatent(userToken, overrides);
  await api().post(`/api/patents/${patent.id}/submit`).set(authHeader(userToken)).send();
  const res = await api()
    .post(`/api/patents/${patent.id}/approve`)
    .set(authHeader(adminToken))
    .send({});

  if (res.status !== 200) {
    throw new Error(`approval failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
};

const createCategory = (name) => prisma.category.create({ data: { name } });

const createInventor = (overrides = {}) =>
  prisma.inventor.create({
    data: {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      organization: 'Analytical Engines Ltd',
      ...overrides,
    },
  });

/**
 * Writes an outbox row directly.
 *
 * Relay mechanics — claiming, ordering, retries, head-of-line blocking,
 * dead-lettering — have nothing to do with which business action produced a
 * row. Driving those tests through the API coupled them to how many events a
 * submit or an approval happens to emit, so adding the AI contract broke a
 * dozen tests that were not about the AI contract at all. Seeding states the
 * fixture the test actually needs.
 */
const seedOutboxEvent = ({ patentId = 1n, eventType = 'PatentVersionUpserted', payload, topic = null } = {}) =>
  prisma.outboxEvent.create({
    data: {
      aggregateType: 'patent',
      aggregateId: BigInt(patentId),
      eventType,
      topic,
      payload: payload ?? {
        event_type: eventType,
        event_id: randomUUID(),
        patent_id: String(patentId),
        version: 1,
        title: 'A seeded event',
        occurred_at: new Date().toISOString(),
      },
    },
  });

module.exports = {
  api,
  app,
  prisma,
  seedOutboxEvent,
  createUser,
  createAdmin,
  login,
  authHeader,
  uploadDocument,
  createDraftPatent,
  approvedPatent,
  createCategory,
  createInventor,
  PATENT_BODY,
  VALID_PASSWORD,
  ROLES,
};
