# Smart Patents Storage System

Express + Prisma backend for submitting, reviewing, and retrieving patents.

## Commit conventions

- **Do not add Claude/AI attribution to commits in any form.** No `Co-Authored-By: Claude`,
  no "Generated with Claude Code" footers, no mention in commit bodies or PR descriptions.
  Commits are authored solely by the human developer.
- Do not push without being asked.

## Commands

```bash
npm run dev              # nodemon on src/server.js
npm start                # node src/server.js
npm test                 # jest + supertest against TEST_DATABASE_URL
npm run prisma:migrate   # prisma migrate dev
npm run prisma:generate  # prisma generate (also runs on postinstall)
npm run prisma:seed      # seed the initial admin from env vars
npm run prisma:studio    # prisma studio
docker compose up        # backend + postgres (host :5433) + minio (:9000/:9001)
```

Tests use jest + supertest against a **real** Postgres (`TEST_DATABASE_URL`, a separate DB the
suite truncates between tests). `npm test` creates that DB and runs migrations on first run;
Postgres must be up (`docker compose up -d postgres`).

## Architecture (backend)

Request flow: `routes/` → rate limiter → validation chain → auth guard → `controllers/` → `services/` → Prisma.

- `src/routes/` — express routers plus the `@openapi` JSDoc blocks that generate the Swagger spec.
- `src/controllers/` — thin HTTP layer; unwraps req/res, calls a service, maps the result to a
  DTO. No business logic or Prisma here. (The Users Module is fully implemented; patents,
  inventors, categories are still `"... not implemented yet"` stubs.)
- `src/services/` — business logic and all database access.
- `src/middlewares/auth.js` — `requireAuth` verifies the access token and sets
  `req.user = { userId: BigInt, role }`; `requireRole(...roles)` gates by role. Convenience
  arrays `requireUser` (user|admin) and `requireAdmin` are what routes actually spread in.
- `src/middlewares/rateLimit.js` — `loginLimiter` / `signupLimiter` / `refreshLimiter`
  (disabled when `NODE_ENV=test`).
- `src/middlewares/index.js` — `notFound` + `errorHandler`. The handler only exposes messages
  from errors marked safe (see `utils/errors.js`) or mapped Prisma errors; everything else
  becomes a generic 500.
- `src/utils/validation.js` — express-validator chains, each ending in `handleValidationErrors`.
- `src/utils/helpers.js` — bcrypt password hashing, access-token sign/verify, refresh-token
  generation + hashing. **No SHA-256 password hashing, no AES `sub` encryption** (both removed).
- `src/utils/errors.js` — typed `AppError` factories (`badRequest`, `unauthorized`, …) with an
  `expose` flag the error handler honours.
- `src/utils/response.js` — `sendSuccess` / `sendError`; the single response envelope.
- `src/utils/dto.js` — response mappers. Always map Prisma records through these: they stringify
  BigInt ids and allowlist fields so `passwordHash` can't leak.
- `src/utils/roles.js` — `ROLES` constants mirroring the Prisma `Role` enum.
- `src/swagger.js` — builds the spec from `./src/routes/*.js`; served at `/api-docs`.
- `prisma/seed.js` — idempotent admin seed from `ADMIN_*` env vars (registered in
  `prisma.config.ts`, not `package.json` — Prisma 7).

## Things that will trip you up

- **Prisma 7**: the datasource URL lives in `prisma.config.ts`, *not* in `schema.prisma`.
  The missing `url = env("DATABASE_URL")` in the schema is correct — don't "fix" it.
- **`JWT_SECRET` is required in production.** `helpers.js` throws on startup if it's unset
  when `NODE_ENV=production`, and only falls back to a dev default outside production.
  `docker-compose.yml` requires it via `${JWT_SECRET:?...}`.
- Postgres is published on host port **5433**, not 5432 (`DATABASE_URL` in `.env` reflects this;
  the backend container talks to `postgres:5432` internally).
- `.env` is gitignored. Copy `.env.example` and fill it in.

## Users Module conventions

- **Roles are assigned server-side, never from the request body.** Signup always creates a
  `user`; admins come from the seed or `POST /users/admins`. `role` is deliberately absent from
  the signup validator — don't add it back.
- **bcrypt caps passwords at 72 bytes**; validation rejects longer input so nothing is silently
  truncated. `MAX_PASSWORD_BYTES` in `helpers.js` is the single source of truth.
- **Email is trimmed + lowercased only.** Do not use express-validator's `normalizeEmail()` — it
  collapses distinct Gmail addresses and blocks real signups. See the note in `validation.js`.
- **Refresh reuse detection revokes outside the transaction.** In `userService.refreshSession`,
  the "revoke all sessions" write for a reused token must not sit inside the `$transaction` that
  then throws, or the rollback undoes the revocation. (This was a real bug a test caught.)

## Known issues

- `PATENT.submitted_by` is `NOT NULL` but its FK is `ON DELETE SET NULL`
  (`prisma/schema.prisma`). Deleting a user who has patents would raise a runtime FK error.
  Left as-is by decision: the Users Module has **no account-deletion endpoint**, so this is
  dormant. Revisit if hard delete is ever added.
- No `isActive` / account-deactivation flag on `User` (considered, deferred). A compromised or
  departing user's account can't be disabled — only their refresh tokens revoked.
- An old `JWT_SECRET` and `DATABASE_URL` are still present in git history (commit `b767bd7`).
  The secret has since been rotated, so the leaked values are inert.
