# Smart Patents Storage System

Express + Prisma backend for submitting, reviewing, and retrieving patents.

This service is the **Patent Management Service**: the source of truth for users, patents,
and their documents. It owns Postgres and MinIO, and it publishes domain events to Kafka
through a transactional outbox. It knows nothing about embeddings, vectors, or similarity
search — that is a separate service consuming `patents.events`.

## Quick start

```bash
cp .env.example .env                             # then fill in the values (see Environment)
npm install                                      # also runs `prisma generate` via postinstall
docker compose up -d postgres minio kafka        # Postgres :5433, MinIO :9000, Kafka :29092
npm run prisma:migrate                           # apply migrations
npm run prisma:seed                              # create the initial admin from env vars
npm run dev                                      # API on http://localhost:5000
npm run relay:dev                                # outbox -> Kafka, in a second terminal
```

> **Address Docker services as `127.0.0.1`, never `localhost`.** Docker publishes ports on
> `0.0.0.0` (IPv4 only) while Node resolves `localhost` to `::1` first, which produces
> intermittent `ECONNRESET` and connect timeouts that look like flaky infrastructure.
> `.env.example` already does this. Browser URLs are unaffected.

API docs (Swagger UI) are served at `http://localhost:5000/api-docs`.

## Environment

Copy `.env.example` to `.env`. It documents every variable; the ones worth knowing:

| Variable                 | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `DATABASE_URL`           | Postgres connection (host port **5433**, not 5432).                     |
| `TEST_DATABASE_URL`      | Separate DB for `npm test`. The suite truncates every table — never point this at your dev database. |
| `JWT_SECRET`             | Signing key. **Required in production** — the app throws on boot if unset when `NODE_ENV=production`. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_EXPIRES_IN`         | Access-token lifetime (default `15m`). Keep short; access tokens can't be revoked before expiry. |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh-token lifetime in days (default `30`).                          |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials for the seeded initial admin. No hardcoded default exists. |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Object storage for patent documents (MinIO in dev). |
| `UPLOAD_MAX_BYTES` / `ALLOWED_UPLOAD_TYPES` | Upload limits, enforced after the client uploads. |
| `KAFKA_BROKERS` / `PATENT_EVENTS_TOPIC` | Where the relay publishes domain events. |
| `OUTBOX_POLL_INTERVAL_MS` / `OUTBOX_BATCH_SIZE` | Relay tuning. |
| `CORS_ORIGINS` | Comma-separated allowlist. **Required in production** — the app refuses to boot without it. |

Configuration is validated at boot (`src/config/env.js`): a missing required value stops the
process with a list of everything that is wrong, rather than failing on the first request that
happens to need it.

## Authentication flow

The API issues a **short-lived access token** (JWT, ~15m) and a **long-lived refresh token**
(opaque random string, stored hashed in the DB).

```
signup / login  ──▶  { accessToken, refreshToken }
     │
     ├─ call protected routes with:  Authorization: Bearer <accessToken>
     │
     └─ when the access token expires:
            POST /users/refresh { refreshToken }  ──▶  new { accessToken, refreshToken }
```

- **Access tokens** carry the user id (in `sub`) and `role`. They're verified by signature
  alone — no DB hit — so they can't be revoked before expiry. That's why they're short-lived.
- **Refresh tokens** are random 384-bit strings. Only their SHA-256 hash is stored, so a DB
  leak can't hand out live sessions. Each refresh **rotates**: the old token is revoked and a
  new one issued.
- **Reuse detection**: presenting an already-rotated refresh token is treated as theft — every
  session for that user is revoked, forcing a fresh login.
- **Logout** revokes the presented refresh token, or *all* of the caller's sessions if none is
  given. Changing a password also revokes every session.

## User roles

| Role    | How you get it                                                    |
| ------- | ----------------------------------------------------------------- |
| `user`  | Public signup. This is the only role `POST /users/signup` grants. |
| `admin` | Seeded (`npm run prisma:seed`) or created by an existing admin via `POST /users/admins`. **Admins cannot self-register.** |

Every admin created through the endpoint records the creating admin in `created_by` as an
audit trail; the FK is `ON DELETE RESTRICT` so that trail can't be erased.

## API endpoints

Base path: `/api`. Response envelope is uniform:

```jsonc
// success
{ "success": true, "data": { ... } }
// failure
{ "success": false, "error": { "code": "…", "message": "…", "details": [ ... ] } }
```

### Public

| Method | Path             | Purpose                               |
| ------ | ---------------- | ------------------------------------- |
| POST   | `/users/signup`  | Register (always role `user`).        |
| POST   | `/users/login`   | Log in; returns a token pair.         |
| POST   | `/users/refresh` | Exchange a refresh token for a new pair. |

### Authenticated (any role)

| Method | Path                  | Purpose                                        |
| ------ | --------------------- | ---------------------------------------------- |
| POST   | `/users/logout`       | Revoke current session (or all).               |
| GET    | `/users/me`           | Current profile, including any inventor record.|
| PATCH  | `/users/me`           | Update `name` and/or `email`.                  |
| PUT    | `/users/me/password`  | Change password (revokes all sessions).        |

### Admin only

| Method | Path             | Purpose                                       |
| ------ | ---------------- | --------------------------------------------- |
| POST   | `/users/admins`  | Create a new admin.                           |
| GET    | `/users`         | List users (`?page`, `?limit`, `?role`, `?search`). |
| GET    | `/users/:id`     | Get a user by id.                             |

### Patents

| Method | Path                      | Role  | Purpose                                                     |
| ------ | ------------------------- | ----- | ----------------------------------------------------------- |
| POST   | `/patents/uploads`        | user  | Get a presigned URL to upload a document straight to storage.|
| POST   | `/patents`                | user  | Create a patent as a `draft`.                                |
| GET    | `/patents`                | user  | List (`?page`,`?limit`,`?status`,`?categoryId`,`?submittedBy`,`?jurisdiction`,`?search`). |
| GET    | `/patents/:id`            | user  | Get one patent.                                              |
| PATCH  | `/patents/:id`            | owner | Edit while `draft` or `declined`.                            |
| DELETE | `/patents/:id`            | owner | Delete a `draft` (and its stored document).                  |
| POST   | `/patents/:id/submit`     | owner | `draft` → `pending_admin`.                                   |
| GET    | `/patents/:id/document`   | user  | Presigned download URL.                                      |
| GET    | `/patents/:id/reviews`    | user  | Review history.                                              |
| POST   | `/patents/:id/approve`    | admin | Approve; emits `PatentVersionUpserted`.                       |
| POST   | `/patents/:id/decline`    | admin | Decline (comments required); emits a withdrawal if it was approved. |

### Categories and inventors

| Method | Path                | Role  | Purpose                                             |
| ------ | ------------------- | ----- | --------------------------------------------------- |
| GET    | `/categories`       | user  | List (`?search`).                                   |
| GET    | `/categories/{id}`  | user  | Get one.                                            |
| POST   | `/categories`       | admin | Create.                                             |
| PATCH  | `/categories/:id`   | admin | Rename.                                             |
| DELETE | `/categories/:id`   | admin | Delete (detaches from patents; never deletes them). |
| GET    | `/inventors`        | user  | List/search (`?search`,`?page`,`?limit`).           |
| POST   | `/inventors`        | user  | Create (`linkToMe` attaches it to your account).    |
| GET    | `/inventors/:id`    | user  | Get one.                                            |
| PATCH  | `/inventors/:id`    | admin/linked user | Update.                                 |
| DELETE | `/inventors/:id`    | admin | Delete (refused while credited on a patent).        |

## Patent lifecycle

```
draft ──submit──▶ pending_admin ──approve──▶ approved
  ▲                     │                       │
  └──────edit───────────┴──decline──▶ declined ──┘
                                          │        (decline of an approved
                                          └─edit──▶ patent also withdraws it)
```

Status is never accepted from the client. The client calls an action, and the service decides
whether that action is legal from the current state. `pending_ai` and the `ai_filter` review
stage exist in the schema but are **deliberately unimplemented** — AI pre-screening is a
separate service.

**Visibility is data-scoped, not just role-scoped.** `requireUser` only proves someone is
logged in. A non-admin sees their own patents in any state, plus everyone's `approved` ones;
an invisible patent returns `404`, not `403`, so the response can't confirm that an id exists.

**Versioning.** `version` increments when *content* changes (title, abstract, specification,
document) and not when categories or inventors change. It is half of the downstream idempotency
key, so churning it would force pointless re-indexing.

## Uploads

Documents never pass through this API. The client asks for a presigned URL, PUTs the bytes
directly to storage, then sends the returned `objectKey` as `documentKey`:

```bash
# 1. ask for an upload target
curl -X POST 127.0.0.1:5000/api/patents/uploads   -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json'   -d '{"filename":"spec.pdf","contentType":"application/pdf"}'
# -> { "uploadUrl": "...", "objectKey": "patents/7/<uuid>/spec.pdf", "expiresAt": "..." }

# 2. upload straight to storage
curl -X PUT "$UPLOAD_URL" -H 'Content-Type: application/pdf' --data-binary @spec.pdf

# 3. create the patent referencing the key
curl -X POST 127.0.0.1:5000/api/patents   -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json'   -d '{"title":"...","abstract":"...","specification":"...","documentKey":"'"$OBJECT_KEY"'"}'

# 4. submit, then have an admin approve - approval is what emits the event
curl -X POST 127.0.0.1:5000/api/patents/$ID/submit  -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST 127.0.0.1:5000/api/patents/$ID/approve -H "Authorization: Bearer $ADMIN_TOKEN"   -H 'Content-Type: application/json' -d '{}'
```

Keys are derived server-side and namespaced by user id; a key issued to someone else is
rejected. Size is enforced *after* upload (a presigned PUT cannot express a maximum length),
and an oversized object is deleted rather than left behind.

## Idempotency

`POST /patents` accepts an optional `Idempotency-Key` header. A repeated key returns the
original response with `Idempotent-Replay: true` instead of creating a second patent.

The key is *reserved* before the handler runs, so a retry that arrives while the original is
still in flight — the common case, since clients retry after a dropped connection — gets a `409`
"still in progress" rather than creating a duplicate. The same key with a different body is also
a `409`. A failed request releases its key, so it stays retryable.

## Messaging: the transactional outbox

"Update the row, then publish an event" is a dual write: crash between the two and the database
and the event log disagree forever, with no way to tell which happened. Instead, approving a
patent writes the state change, the review row, **and** an `OUTBOX_EVENT` row in one
transaction. Either all three land or none do.

A separate process — `npm run relay` — moves outbox rows to Kafka:

```
POST /patents/:id/approve
        │  (one transaction)
        ├─▶ PATENT.status = approved
        ├─▶ PATENT_REVIEW row
        └─▶ OUTBOX_EVENT row
                 │
        relay ───┴──▶ Kafka topic "patents.events", key = patent id
```

- **Delivery is at-least-once.** The relay can publish and then fail to mark the row published,
  so it re-sends. Consumers must be idempotent — see the dedup rule below.
- **Keyed by patent id** so every version of one patent lands on one partition — Kafka only
  guarantees ordering within a partition.
- **A failed publish stops the batch** rather than skipping ahead: delivering v2 before v1 is
  worse than delivering late. After `OUTBOX_MAX_ATTEMPTS` failures a row is dead-lettered so one
  poisonous event cannot block the queue forever; `/ready` reports the count.
- **The API never talks to Kafka.** A broker outage cannot take the API down; events simply
  queue in Postgres. That is the entire point.
- **Run exactly one relay.** Claiming stops two relays doing the same work, but it does not keep
  them in order — relay B can publish v2 while relay A is still sending v1.

### Consuming these events

- **Order by `sequence`** (a monotonic integer, the outbox row id) and ignore any event whose
  `sequence` is below the last one you applied for that patent.
- **Dedup on `event_id`** (a UUID, stable across redeliveries of the same event).
- **Do not dedup on `(patent_id, version)`.** `version` tracks *content*, so an
  approve → decline → re-approve cycle legitimately repeats it, and deduping on it would drop
  the patent from your projection permanently.

### Events

`PatentVersionUpserted` — a patent version entered the corpus (on approval). A **fat event**:
it carries the full title, abstract, specification, categories, inventors, and document key, so
a consumer never has to call back into this service.

`PatentVersionWithdrawn` — a previously approved patent left the corpus (declined). Without it,
a downstream projection would keep serving content this service no longer considers public.

Both are defined in [`src/events/patentEvents.js`](src/events/patentEvents.js). **Treat the
shape as a published interface**: adding optional fields is safe, renaming or removing one is a
breaking change.

## Health and readiness

| Path      | Purpose                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| `/health` | Liveness. Touches nothing — a probe that fails on a slow query gets the container killed during exactly the incident where you least want a restart. |
| `/ready`  | Readiness. Checks Postgres and object storage, reports the outbox backlog (`pending` / `retrying` / `deadLettered`), and returns `503` when a dependency is down. Kafka is deliberately *not* a readiness dependency, and a growing backlog never fails the probe — that is the outbox working while the broker is away. |

The probe is unauthenticated, so it reports `ok` / `error` only; the underlying driver message
goes to the log keyed by request id.

## Security notes

- **Passwords**: bcrypt at cost 12. Input is capped at 72 bytes (bcrypt's limit) in validation,
  so nothing is silently truncated.
- **Login is timing-safe**: an unknown email still runs a bcrypt comparison against a dummy hash,
  so response time can't be used to enumerate registered accounts.
- **Email**: trimmed + lowercased only. `normalizeEmail()` is deliberately avoided — it collapses
  distinct Gmail addresses (`a.b@` vs `ab@`, `+tags`) into one and would block real signups.
- **Rate limiting**: login (per IP+email), signup (per IP), and refresh are throttled;
  brute-force login attempts return `429`.
- **No sensitive data leaves the API**: responses are built from explicit DTOs, so `password_hash`
  can't leak even if a column is added later. BigInt ids are serialized as strings.
- **Email addresses are viewer-scoped.** Any signed-up user can read approved patents and search
  the inventor directory, so addresses go out only to an admin or their owner — otherwise
  registering would be a way to download the user directory. Search still *matches* on email
  server-side. Review history is owner-or-admin, since comments are internal notes.
- **Object keys are server-derived**, namespaced per user, and validated on use — a client-supplied
  key would be a path-traversal and cross-user-overwrite primitive.
- **CORS** is an explicit allowlist; the app refuses to start in production without one.
- **Request ids**: every response carries `X-Request-Id` (inbound ones are honoured), so a
  reported 500 maps to exactly one log line.

## Testing

```bash
npm test          # jest + supertest against TEST_DATABASE_URL (real Postgres)
```

The suite creates the test database and applies migrations automatically on first run. **It needs
Postgres and nothing else** — object storage and Kafka are replaced by in-memory fakes
(`tests/fakes.js`), because a suite that requires a full compose stack is a suite that stops
being run.

214 tests across 10 files: auth and sessions, role authorization, profiles, admin management,
the full patent lifecycle and its illegal transitions, cross-user visibility, uploads and
document access, categories, inventors, and the outbox/relay.

`tests/patents.review.test.js` is separate on purpose: each test there pins a defect found by
code review rather than by running the suite — concurrent approvals, concurrent idempotent
retries, shared document keys, mid-batch relay failures, and the validation gaps that surfaced
as 500s. They are the paths nothing exercised, which is why the bugs survived.

Two things the harness does that will otherwise confuse you:

- **bcrypt cost drops to 4 under `NODE_ENV=test`.** At 12, the patent tests spend most of their
  wall time in the KDF and trip their own timeouts. Assert against `BCRYPT_COST`, never `12`.
- **`synchronous_commit` is off on the test database.** Its data directory is a bind mount and
  fsync there is slow enough to trip test timeouts — this took the patent suite from 265s to
  25s. Scoped to the test DB, which is truncated between every test anyway.

## Commands

```bash
npm run dev              # nodemon on src/server.js
npm start                # node src/server.js
npm test                 # run the test suite
npm run prisma:migrate   # prisma migrate dev
npm run prisma:seed      # seed the initial admin
npm run prisma:studio    # prisma studio
npm run relay            # outbox -> Kafka relay process
npm run relay:dev        # same, under nodemon
docker compose up        # backend + relay + postgres + minio + kafka + connect + kafka-ui
```

## Not in scope here

Embeddings, vector search, similarity scoring, and AI pre-screening belong to a separate
service that consumes `patents.events`. This service deliberately knows nothing about them —
`pending_ai` and `ReviewStage.ai_filter` are reserved in the schema and unused in code.
