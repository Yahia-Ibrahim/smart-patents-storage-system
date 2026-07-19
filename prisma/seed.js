require('dotenv/config');

const prisma = require('../src/config/prisma');
const { hashPassword, MAX_PASSWORD_BYTES } = require('../src/utils/helpers');
const { ROLES } = require('../src/utils/roles');

/**
 * Creates the initial administrator.
 *
 * Credentials come from the environment, never from source: a hardcoded default
 * admin password is the kind of thing that survives into production and is
 * identical across every deployment of the project.
 *
 * Idempotent, so it is safe to re-run after every migration. An existing
 * account is promoted to admin rather than duplicated, but its password is
 * never overwritten — re-running the seed must not silently reset a live
 * admin's credentials back to whatever is in the environment.
 */

const readAdminCredentials = () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';

  const missing = [
    !email && 'ADMIN_EMAIL',
    !password && 'ADMIN_PASSWORD',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Cannot seed the admin account: ${missing.join(' and ')} must be set.\n` +
        'Set them in your .env (see .env.example) and re-run `npm run prisma:seed`.',
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`ADMIN_EMAIL is not a valid email address: ${email}`);
  }

  // Mirrors the API's own password rules so the seeded admin could not be
  // weaker than an account created through the endpoint.
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters long');
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`ADMIN_PASSWORD must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }

  return { email, password, name };
};

const seedAdmin = async () => {
  const { email, password, name } = readAdminCredentials();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === ROLES.ADMIN) {
      console.log(`Admin already exists: ${email} (no changes made)`);
      return;
    }

    await prisma.user.update({ where: { id: existing.id }, data: { role: ROLES.ADMIN } });
    console.log(`Promoted existing user to admin: ${email}`);
    return;
  }

  const admin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: ROLES.ADMIN,
      // Null by design: the root admin has no creator. Every admin created
      // afterwards records the admin who created them.
      createdBy: null,
    },
  });

  console.log(`Created admin: ${admin.email} (id ${admin.id})`);
};

seedAdmin()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
