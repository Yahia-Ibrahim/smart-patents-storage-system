const { Prisma } = require('@prisma/client');
const { errorHandler, notFound } = require('../../src/middlewares');
const errors = require('../../src/utils/errors');

/**
 * The error handler decides what leaves the process when something goes wrong.
 *
 * Its whole job is refusing to forward messages that were not deliberately
 * made safe — a connection string, a query fragment, a file path. That is a
 * disclosure boundary, so it is tested directly rather than inferred from a
 * handful of endpoint responses.
 */

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const handle = (error) => {
  const res = mockRes();
  errorHandler(error, {}, res, () => {});
  return res;
};

const prismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError('internal detail that must not escape', {
    code,
    clientVersion: '7.0.0',
  });

describe('AppError factories', () => {
  const cases = [
    ['badRequest', 400, 'BAD_REQUEST'],
    ['unauthorized', 401, 'UNAUTHORIZED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['notFound', 404, 'NOT_FOUND'],
    ['conflict', 409, 'CONFLICT'],
    ['tooManyRequests', 429, 'TOO_MANY_REQUESTS'],
  ];

  it.each(cases)('%s builds an exposable %i', (factory, status, code) => {
    const error = errors[factory]('a message');

    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.expose).toBe(true);
    expect(error).toBeInstanceOf(errors.AppError);
    expect(error.stack).toBeTruthy();
  });

  it('gives the no-argument factories a sensible default message', () => {
    expect(errors.unauthorized().message).toMatch(/Authentication/i);
    expect(errors.forbidden().message).toMatch(/Forbidden/i);
    expect(errors.notFound().message).toMatch(/not found/i);
  });

  it('carries details through when given', () => {
    expect(errors.badRequest('bad', [{ field: 'x' }]).details).toEqual([{ field: 'x' }]);
  });
});

describe('errorHandler', () => {
  it('forwards a message that was explicitly marked safe', () => {
    const res = handle(errors.conflict('Email is already registered'));

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'Email is already registered' },
    });
  });

  /** The core rule: an unexpected error's message never reaches the client. */
  it('replaces an unmarked error with a generic 500', () => {
    const leaky = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');

    const res = handle(leaky);

    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toBe('Internal Server Error');
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|10\.0\.0\.5/);
  });

  it('does not leak an unmapped Prisma code in the response body', () => {
    const res = handle(prismaError('P2000'));

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/P2000|internal detail/);
  });

  it('maps a unique-constraint violation to an actionable 409', () => {
    const res = handle(prismaError('P2002'));

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/already exists/);
    expect(res.body.error.message).not.toMatch(/internal detail/);
  });

  it('maps a missing record to 404', () => {
    const res = handle(prismaError('P2025'));

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('maps a foreign-key violation to 409', () => {
    const res = handle(prismaError('P2003'));

    expect(res.statusCode).toBe(409);
  });

  it('includes validation details when present', () => {
    const res = handle(errors.badRequest('Validation failed', [{ field: 'email' }]));

    expect(res.body.error.details).toEqual([{ field: 'email' }]);
  });

  it('omits the details key entirely when there are none', () => {
    const res = handle(errors.badRequest('nope'));

    expect(res.body.error).not.toHaveProperty('details');
  });

  /**
   * A thrown non-Error (a bare string, a rejected value) must not crash the
   * handler itself — that would turn a small bug into a dropped connection.
   */
  it('survives a thrown non-Error value', () => {
    const res = handle('just a string');

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('honours a status set on an exposable error without a mapped code', () => {
    const custom = Object.assign(new Error('teapot'), { status: 418, expose: true });

    const res = handle(custom);

    expect(res.statusCode).toBe(418);
    expect(res.body.error.message).toBe('teapot');
  });
});

describe('notFound', () => {
  it('answers an unmatched route with the standard envelope', () => {
    const res = mockRes();

    notFound({}, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });
});
