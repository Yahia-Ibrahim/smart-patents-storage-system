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
npm run prisma:migrate   # prisma migrate dev
npm run prisma:generate  # prisma generate (also runs on postinstall)
npm run prisma:studio    # prisma studio
docker compose up        # backend + postgres (host :5433) + minio (:9000/:9001)
```

There is no test runner wired up yet.

## Architecture

Request flow: `routes/` → validation chain → auth guard → `controllers/` → `services/` → Prisma.

- `src/routes/` — express routers plus the `@openapi` JSDoc blocks that generate the Swagger spec.
- `src/controllers/` — thin HTTP layer; unwraps req/res and delegates.
- `src/services/` — business logic and all database access. **Currently TODO stubs**; the
  controllers return `"... not implemented yet"` placeholders.
- `src/middlewares/auth.js` — `protectUser` / `protectAdmin` guards, read the JWT `role` claim.
- `src/utils/validation.js` — express-validator chains. Each exported chain ends with
  `handleValidationErrors`, so routes just spread it in: `router.post('/x', protectUser, xValidation, handler)`.
- `src/utils/helpers.js` — JWT sign/verify and hashing helpers.
- `src/swagger.js` — builds the spec from `./src/routes/*.js`; served at `/api-docs`.

## Things that will trip you up

- **Prisma 7**: the datasource URL lives in `prisma.config.ts`, *not* in `schema.prisma`.
  The missing `url = env("DATABASE_URL")` in the schema is correct — don't "fix" it.
- **`JWT_SECRET` is required in production.** `helpers.js` throws on startup if it's unset
  when `NODE_ENV=production`, and only falls back to a dev default outside production.
  `docker-compose.yml` requires it via `${JWT_SECRET:?...}`.
- Postgres is published on host port **5433**, not 5432 (`DATABASE_URL` in `.env` reflects this;
  the backend container talks to `postgres:5432` internally).
- `.env` is gitignored. Copy `.env.example` and fill it in.

## Known issues

- `PATENT.submitted_by` is `NOT NULL` but its FK is `ON DELETE SET NULL`
  (`prisma/schema.prisma`). Deleting a user who has patents will raise a runtime FK
  error in Postgres. Needs an `onDelete` decision + a new migration.
- `helpers.hashValue` is unsalted SHA-256. Not yet wired to anything — swap for bcrypt/argon2
  before implementing signup/login.
- An old `JWT_SECRET` and `DATABASE_URL` are still present in git history (commit `b767bd7`).
  The secret has since been rotated, so the leaked values are inert.
