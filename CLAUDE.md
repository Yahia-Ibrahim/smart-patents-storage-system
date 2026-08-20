# Smart Patents Storage System

Express + Prisma backend for submitting, reviewing, and retrieving patents.

This is the **Patent Management Service**: source of truth for users, patents, and documents.
It owns Postgres and MinIO and publishes domain events to Kafka via a transactional outbox.
Embeddings, vector search, similarity scoring, and AI pre-screening are **out of scope** —
a separate service consumes `patents.events`. `pending_ai` and `ReviewStage.ai_filter` are
reserved in the schema and deliberately unused in code; don't implement them here.

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
npm run relay            # outbox -> Kafka relay (its own process; see Messaging below)
npm run relay:dev        # same, under nodemon
npm run connect:register -- <template>   # register/update a Kafka Connect connector, see kafka-connect/README.md
docker compose up        # backend + relay + postgres (:5433) + minio (:9000/:9001) + kafka (:29092) + kafka-connect (:8083) + kafka-ui (:8080)
```

**Use `127.0.0.1`, not `localhost`, in host-facing URLs.** Docker publishes on `0.0.0.0`
(IPv4 only) and Node resolves `localhost` to `::1` first. The symptom is intermittent
`ECONNRESET` / connect timeouts against Postgres, MinIO, and Kafka that look like flaky
infrastructure but are not. `.env.example` already uses `127.0.0.1`.

Tests use jest + supertest against a **real** Postgres (`TEST_DATABASE_URL`, a separate DB the
suite truncates between tests). `npm test` creates that DB and runs migrations on first run;
**Postgres is the only service it needs** — object storage and Kafka are in-memory fakes
(`tests/fakes.js`), swapped in via `setStorageClient` / `setProducer`. Keep any new external
dependency injectable the same way; a suite that needs a full compose stack stops being run.

Two harness details that will confuse you if you don't know them:

- **bcrypt cost drops to 4 under `NODE_ENV=test`** (`BCRYPT_COST` in `helpers.js`). At 12 the
  patent tests spend most of their wall time in the KDF and trip their own timeouts. Assert
  against `BCRYPT_COST`, never a literal `12`.
- **`globalSetup` sets `synchronous_commit = off` on the test database.** The Postgres data
  directory is a bind mount and fsync on Windows/macOS is brutally slow — this took the patent
  suite from 265s to 25s. Scoped to the test DB only.
- **New tables must be added to the `TRUNCATE` list in `tests/setup.js`**, which is hardcoded.
  Forgetting leaks state across tests in ways that are painful to debug.

## Frontend (`frontend/`)

React 18 + TypeScript + Vite SPA in `frontend/`, talking to this API. It has its own
`package.json`, `README.md`, and `.env.example`. Run it with `npm run dev` from `frontend/`
(Vite proxies `/api` → `:5000`, so start the backend too). See `frontend/README.md` for the full
architecture; the short version:

- **Design system first.** All colour/type/spacing/radius/shadow live as CSS custom properties in
  `frontend/src/styles/tokens.css`; light + dark themes re-map the semantic layer there. Components
  never hardcode colours or branch on theme. A live showcase is at `/design-system`.
- `frontend/src/components/ui/` — the reusable component library (Button, Input, Modal, Table,
  Badge, Toast, …), each with co-located CSS. Import from `@/components/ui`.
- `frontend/src/services/` — typed API client with automatic access-token refresh; `@/` aliases `src/`.
- **Design language:** IBM Plex superfamily (Serif headings, Sans UI, Mono for every id/reference);
  a blueprint-indigo primary with a brass "certification seal" accent; status/role rendered as
  ink-stamp badges. Grounded in the patent-drawing / legal-document subject on purpose.
- **Gotcha that already bit once:** never call `tokenStore.clear()` in a `catch` without first
  ruling out `AbortError`. Aborted requests (StrictMode re-runs, unmounts, navigation) are not auth
  failures — clearing tokens there logs the user out of a valid session. See `AuthContext.hydrate`.

## Infrastructure (Kafka / CDC)

`docker-compose.yml` also runs Kafka (KRaft mode, no ZooKeeper) + Kafka Connect running Debezium
+ Kafka UI, for Postgres change-data-capture. **No connector is registered by default** — the
Postgres service gained `wal_level=logical` and Debezium's plugin is loaded on the Connect
worker, but no connector config exists until you register one, because a connector config
necessarily names real tables. See `INFRASTRUCTURE.md` for the full explanation of every piece
and config choice, and `kafka-connect/README.md` for the connector template + registration
script (`npm run connect:register`).

## Architecture (backend)

Request flow: `routes/` → rate limiter → validation chain → auth guard → `controllers/` → `services/` → Prisma.

- `src/routes/` — express routers plus the `@openapi` JSDoc blocks that generate the Swagger spec.
- `src/controllers/` — thin HTTP layer; unwraps req/res, calls a service, maps the result to a
  DTO. No business logic or Prisma here. Users, patents, inventors, and categories are all
  implemented; there are no stubs left.
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
- `src/config/env.js` — all configuration, validated at boot. A missing required value stops
  the process with the full list of problems. Add new config here, not with bare `process.env`
  reads scattered through services.
- `src/config/prisma.js` — Prisma with an **explicit `pg.Pool`**. Handing the adapter a bare
  connection string multiplexes concurrent queries onto one client, which produces intermittent
  "Server has closed the connection" failures. `disposeExternalPool: true` ties the pool's
  lifetime to `$disconnect`.
- `src/config/storage.js` / `src/config/kafka.js` — S3 client and Kafka producer, each behind a
  setter so tests can substitute a fake.
- `src/services/storageService.js` — presigned upload/download. **Documents never pass through
  this API.**
- `src/services/outboxService.js`, `src/workers/outboxRelay.js`, `src/relay.js` — the outbox
  and its relay process.
- `src/events/patentEvents.js` — the event contract with the Search Service. Treat it as a
  published interface.
- `src/middlewares/idempotency.js` — `Idempotency-Key` replay protection on `POST /patents`.
- `src/middlewares/requestContext.js` — `X-Request-Id` generation/propagation.
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

## Patents Module conventions

- **Status is never accepted from the client.** The client calls an action
  (`/submit`, `/approve`, `/decline`) and `patentService` decides whether it is legal from the
  current state. The table of legal transitions is `TRANSITIONS` in that file.
- **Visibility is data-scoped.** `requireUser` only proves someone is logged in. Every read
  goes through `visibilityWhere(user)`; a non-admin sees their own patents plus approved ones.
  An invisible patent is a **404, not a 403** — a 403 confirms the id exists.
- **`listPatents` builds its filter with `AND`, not object spread.** `visibilityWhere` and the
  search filter both produce an `OR`, and spreading them into one object silently drops the
  visibility rule — which exposes every user's drafts. This was a real bug; don't reintroduce it.
- **`version` bumps only on content change** (title/abstract/specification/document), never on
  category or inventor edits. It is half the downstream idempotency key.
- **Object keys are derived server-side** and namespaced by user id. A client-supplied key is a
  path-traversal and cross-user-overwrite primitive; `keyBelongsToUser` is the real check.
- **Upload size is enforced after upload**, in `verifyDocument`. A presigned PUT cannot express
  a maximum content length.
- **The S3 client sets `requestChecksumCalculation: 'WHEN_REQUIRED'`.** Since AWS SDK v3.729 the
  default bakes an `x-amz-checksum-crc32` of an *empty* body into presigned PUT URLs. MinIO
  tolerates the mismatch; real S3 rejects it.

## Messaging conventions

- **Never publish to Kafka from a request handler.** Handlers write an `OUTBOX_EVENT` row inside
  the same transaction as the state change; the relay publishes. That is what keeps the API up
  when the broker is down, and what makes it impossible for an event to diverge from committed
  data.
- `outboxService.enqueue(tx, ...)` **takes the transaction client as its first argument** on
  purpose. Passing the plain `prisma` client is legal JavaScript and a silent correctness bug.
- **Delivery is at-least-once.** Consumers must be idempotent on `(patent_id, version)`.
- **Events are keyed by patent id** so all versions of one patent share a partition; Kafka only
  orders within a partition.
- **A failed publish stops the batch** rather than skipping ahead. Head-of-line blocking is
  deliberate — delivering v2 before v1 is worse than delivering late.
- Only **approval** emits `PatentVersionUpserted`; declining a previously approved patent emits
  `PatentVersionWithdrawn`. Creating, submitting, and editing emit nothing.
- **Debezium remains unregistered.** The infra is staged in compose, but the hand-written relay
  publishes clean *domain* events rather than row-shaped CDC records. Don't wire up a connector
  without deciding what consumers should see.

## Known issues

- Orphaned objects: an upload whose `POST /patents` never arrives stays in MinIO forever. No
  sweeper exists yet.
- `PATENT.s3_file_url` is superseded by `document_key` and is now nullable and unwritten. Drop
  it in a later migration.
- Pagination is offset-based everywhere. Fine at current scale, not at 100k+ rows.
- `schema.sql` at the repo root is the original hand-written DDL and is **stale** — Prisma
  migrations are the source of truth.
- No `isActive` / account-deactivation flag on `User` (considered, deferred). A compromised or
  departing user's account can't be disabled — only their refresh tokens revoked.
- An old `JWT_SECRET` and `DATABASE_URL` are still present in git history (commit `b767bd7`).
  The secret has since been rotated, so the leaked values are inert.
