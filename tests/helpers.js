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

module.exports = { api, app, prisma, createUser, createAdmin, login, authHeader, VALID_PASSWORD, ROLES };
