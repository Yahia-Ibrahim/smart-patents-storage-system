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
npm run consumer         # AI similarity reports -> PATENT_REVIEW (its own process)
npm run consumer:dev     # same, under nodemon
npm run connect:register -- <template>   # register/update a Kafka Connect connector, see kafka-connect/README.md
docker compose up        # backend + relay + ai-reports + postgres (:5433) + minio (:9000/:9001) + kafka (:29092) + kafka-connect (:8083) + kafka-ui (:8080) + qdrant (:6333) + ai-service + ai-service-api (:8000)
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

**The AI service's database is created by `docker/postgres-init/`, which Postgres only runs on an
empty data directory.** An existing install needs it once by hand:

```bash
docker compose exec postgres psql -U patents -c 'CREATE DATABASE ai_db'
```

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
- `frontend/src/pages/patents/` — the Patents module: list, detail, create/edit, admin review queue,
  and prior-art search, with its shared pieces under `components/`.
- **Documents are uploaded when chosen, not when the form is saved.** The browser PUTs straight to
  storage over a presigned URL, so abandoning the form orphans an object — the accepted cost of
  keeping multi-megabyte bodies off the API.
- **Inventor order is list position, never a typed number.** The API demands a contiguous 1..N;
  deriving `order` from the index makes a gap unrepresentable rather than a validation error.
- **AI output is always marked as generated.** Explanations render in their own tinted block rather
  than in the same type as the patent's own text, and the similarity card says "advisory" — because
  it is: the AI gates nothing.
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
- `src/services/patents/` — the patents module split by concern, because one
  557-line service mixing all of them was hard to reason about and impossible to
  unit test. `patentService.js` orchestrates and holds no rules of its own:
  - `access.js` — visibility and ownership. **Every** patent read and write goes
    through `findVisiblePatent` / `findOwnedPatent` / `buildListFilter`.
  - `lifecycle.js` — the status transition table and its two guards.
  - `documents.js` — upload/download presigning and document ownership.
  - `relations.js` — category and inventor link validation.
- `src/utils/validation/` — chains split by domain (`shared`, `users`, `patents`,
  `catalog`) behind an index barrel; `require('../utils/validation')` is unchanged.
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
  category or inventor edits. It identifies content, and is deliberately *not* a dedup key on
  its own — see `sequence` under Messaging.
- **Every status transition is applied conditionally inside its transaction**
  (`applyTransition`), with the expected statuses in the WHERE clause. Reading the status and
  then writing unconditionally is check-then-act: two concurrent approvals both pass the read
  and both commit.
- **`documentKey` is unique.** Two patents sharing one makes deletion unsafe — deleting a draft
  would destroy the object an approved patent still points at.
- **Emails are viewer-scoped in DTOs** (`canSeeEmailOf`): an address goes out only to an admin
  or its owner. Any signed-up user can read approved patents and search the inventor directory,
  so unconditional emails would publish the whole user/admin directory.
- **Inventor order must be a contiguous 1..N**, and `order` is all-or-nothing across
  the list. Duplicate category ids are rejected rather than silently deduplicated —
  a repeated id means the client built the request wrong.
- **`GET /patents/:id/reviews` is owner-or-admin**, not merely "can see the patent" — review
  comments are internal notes and name the reviewing admin.
- **Object keys are derived server-side** and namespaced by user id. A client-supplied key is a
  path-traversal and cross-user-overwrite primitive; `keyBelongsToUser` is the real check.
- **Upload size is enforced after upload**, in `verifyDocument`. A presigned PUT cannot express
  a maximum content length.
- **Presigning and calling use different endpoints.** `S3_PUBLIC_ENDPOINT` is what goes *into* a
  presigned URL, because a browser follows it; `S3_ENDPOINT` is what this process dials. In
  compose they differ — `http://minio:9000` resolves only inside `patents-net`, so signing with
  it produced upload URLs no browser could use. They default to the same value, which is right
  for a host-run backend or real S3. One setter swaps both clients so the test fake still covers
  signing.
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
  deliberate — delivering v2 before v1 is worse than delivering late. The escape hatch is
  `OUTBOX_MAX_ATTEMPTS`: past that, a row is dead-lettered (excluded from claiming) so one
  poisonous event cannot wedge the queue forever. `/ready` reports the count.
- **Publishing happens outside any database transaction.** A Kafka round trip inside one blows
  Prisma's 5s interactive-transaction timeout on a slow broker, and the abort rolls back the
  mark-published writes for events already sent — an unbounded duplicate loop. Rows are claimed
  with `claimed_at` in a short committed statement instead.
- **Run exactly one relay.** Claiming stops two relays doing the same work, but it does not
  preserve ordering across them: relay B can publish v2 while relay A is still on v1.
- **The relay stamps `sequence` (the outbox row id) onto every payload at publish time.**
  `(patent_id, version)` is not a safe dedup key on its own — approve → decline → re-approve
  repeats the same version — so consumers should order by `sequence` and dedup on `event_id`.
- Only **approval** emits `PatentVersionUpserted`; declining a previously approved patent emits
  `PatentVersionWithdrawn`. Creating, submitting, and editing emit nothing **on this contract** —
  submission does emit to the AI service, which is a separate contract; see below.
- **An outbox row carries its own destination `topic`.** Null means the default
  `patents.events`, which is what every row meant before the AI integration. The relay resolves
  it; nothing routes by inspecting event type.
- **Debezium remains unregistered.** The infra is staged in compose, but the hand-written relay
  publishes clean *domain* events rather than row-shaped CDC records. Don't wire up a connector
  without deciding what consumers should see.

## AI service integration

`AI_module/` is **owned by another team**. Treat it as an external dependency: make the smallest
change that makes integration work, and record anything else rather than fixing it.

It runs as **two processes from one image**, and the distinction matters because they fail
differently:

| Process | What it is | How the backend reaches it |
|---|---|---|
| `ai-service` | Kafka consumer. Embeds documents, reports similarity. | Asynchronously, over the outbox. A dead one delays a report and blocks nothing. |
| `ai-service-api` | `uvicorn app.api.main:app` — `POST /api/v1/patents/search`. | Synchronously, from `POST /patents/search`. A dead one makes that one endpoint 503. |

The HTTP half arrived with the module's LangChain rewrite and is the **only** synchronous
dependency the backend has on the AI service.

- **The backend adapts to the AI's contract, not the reverse.** `src/events/aiEvents.js` builds a
  flat, camelCase payload matching its pydantic DTOs. This is deliberately *not* merged with
  `patentEvents.js`: two published interfaces, two owners, and a change requested by one consumer
  must not silently break the other.
- **Two contracts, one outbox.** Every AI event is enqueued in the same transaction as the state
  change, exactly like a domain event. The "never publish from a request handler" rule is not
  relaxed for it.

  | Moment | `patents.events` | AI topics |
  |---|---|---|
  | submit | *(silent)* | `Patents.submitted` |
  | approve | `PatentVersionUpserted` | `Patents.approved` |
  | decline after approval | `PatentVersionWithdrawn` | `Patents.rejected` |
  | decline, never approved | *(silent)* | `Patents.rejected` |

  The last row is the asymmetry worth remembering: the domain contract stays silent because
  nothing ever entered the search corpus, but the AI cached an embedding at submission and has
  state to drop.
- **The AI is advisory and gates nothing.** `submit → pending_admin` is unchanged and `pending_ai`
  stays unimplemented, so a dead AI service can never block a submission.
- **Documents travel as `s3://bucket/key` URIs, never presigned URLs.** A presigned URL expires
  while its event sits in the outbox or on the topic, so any outage longer than the TTL would
  strand events that can never be processed. The AI resolves the URI with its own MinIO
  credentials.
- **Reports come back on `Notifications.similarity-report`** and are consumed by
  `npm run consumer` (`src/workers/reportConsumer.js`), a **separate process** like the relay.
  They land as `PATENT_REVIEW` rows with the reserved `reviewStage: ai_filter` and
  `aiConfidenceScore` (stored as a **percentage**, since the column is `Decimal(5,2)`), so no new
  table was needed and they surface through the existing owner-or-admin
  `GET /patents/:id/reviews`.
- **The report consumer discards bad messages rather than retrying** — the opposite of the
  relay's head-of-line blocking, and deliberately so: there the payload is ours and a failure
  means our bug, here it comes from another team and will be just as bad on every retry. A
  *database* failure still throws, so the offset stays uncommitted and the message is redelivered.
- **Only approved patents enter Qdrant**, so a similarity report can only ever name a patent that
  is already public. That is what makes it safe to show one to a submitter.
- **The event payload carries `abstract`, and that is not decoration.** It is optional in their
  DTO, but on approval it becomes the Qdrant payload's `abstract`, which LangChain is configured
  to read as the document's `page_content` (`content_payload_key="abstract"`), and the explanation
  prompt grounds every match in it. Drop the field and search still finds the right patents while
  every explanation degrades to "no abstract was available".
- **`POST /patents/search` proxies the AI's search API** (`src/services/aiSearchService.js`,
  client behind a setter in `src/config/aiSearch.js`). It does two things the AI cannot do for
  itself: re-reads every matched id through `visibilityWhere`, because the corpus is not access
  controlled and lags — a patent declined a moment ago still has a vector until
  `Patents.rejected` is processed — and preserves the AI's ranking, which `findMany` would
  otherwise replace with id order.
- **Every AI failure is one 503 with one message.** A caller cannot act on the difference between
  a missing `GOOGLE_API_KEY`, an empty Qdrant and a restarting container; all three mean *try
  again later*. The distinction stays in the log. `AI_SEARCH_URL` is optional — unset, search
  reports itself unavailable and nothing else changes, which is also how `npm test` runs.
- **`GOOGLE_API_KEY` is needed only for explanations.** Retrieval works without it. The container
  starts either way (see below), so a missing key is a per-request 503, not a dead service.
- Changes made to `AI_module/` are limited to: `_download_document` (s3 support),
  `handle_rejected_patent` (clearing Qdrant, a real bug), the `requirements.txt` encoding plus
  `minio`, a `.env.example`, and two cold-start fixes the search API brought with it —
  `get_vector_store()` creating the collection it would otherwise raise on, and the FastAPI
  lifespan building the pipeline on first request rather than at boot, so Qdrant, the model
  download and the API key are no longer all required for the process to start. Everything else
  found while reading is recorded in `AI_INTEGRATION_PLAN.md`, not fixed.

## Known issues

- Orphaned objects: an upload whose `POST /patents` never arrives stays in MinIO forever. No
  sweeper exists yet.
- `PATENT.s3_file_url` is superseded by `document_key` and is now nullable and unwritten. Drop
  it in a later migration.
- Pagination is offset-based everywhere. Fine at current scale, not at 100k+ rows.
- `IDEMPOTENCY_KEY` grows forever; no retention job exists.
- An upload whose `POST /patents` never arrives stays in storage forever; no sweeper exists.
  (Replacing a document *does* delete the old object, and deleting a draft deletes its own.)
- No `isActive` / account-deactivation flag on `User` (considered, deferred). A compromised or
  departing user's account can't be disabled — only their refresh tokens revoked.
- An old `JWT_SECRET` and `DATABASE_URL` are still present in git history (commit `b767bd7`).
  The secret has since been rotated, so the leaked values are inert.
