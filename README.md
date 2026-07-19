# Smart Patents Storage System

Express + Prisma backend for submitting, reviewing, and retrieving patents.

## Quick start

```bash
cp .env.example .env          # then fill in the values (see Environment below)
npm install                   # also runs `prisma generate` via postinstall
docker compose up -d postgres # Postgres on host port 5433
npm run prisma:migrate        # apply migrations
npm run prisma:seed           # create the initial admin from env vars
npm run dev                   # nodemon on http://localhost:5000
```

API docs (Swagger UI) are served at `http://localhost:5000/api-docs`.

## Environment

Copy `.env.example` to `.env`. Values that matter for the Users Module:

| Variable                 | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `DATABASE_URL`           | Postgres connection (host port **5433**, not 5432).                     |
| `TEST_DATABASE_URL`      | Separate DB for `npm test`. The suite truncates every table — never point this at your dev database. |
| `JWT_SECRET`             | Signing key. **Required in production** — the app throws on boot if unset when `NODE_ENV=production`. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_EXPIRES_IN`         | Access-token lifetime (default `15m`). Keep short; access tokens can't be revoked before expiry. |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh-token lifetime in days (default `30`).                          |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials for the seeded initial admin. No hardcoded default exists. |

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

### Example requests

```bash
# Register
curl -X POST localhost:5000/api/users/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"Passw0rd123"}'

# Log in
curl -X POST localhost:5000/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Passw0rd123"}'

# Call a protected route
curl localhost:5000/api/users/me -H "Authorization: Bearer $ACCESS_TOKEN"

# Refresh
curl -X POST localhost:5000/api/users/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"'"$REFRESH_TOKEN"'"}'

# Admin creates another admin
curl -X POST localhost:5000/api/users/admins \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Second Admin","email":"admin2@example.com","password":"Passw0rd123"}'
```

## Security notes

- **Passwords**: bcrypt, cost 12. Input is capped at 72 bytes (bcrypt's limit) in validation so
  nothing is silently truncated.
- **Login is timing-safe**: an unknown email still runs a bcrypt comparison against a dummy hash,
  so response time can't be used to enumerate registered accounts.
- **Email**: trimmed + lowercased only. `normalizeEmail()` is deliberately avoided — it collapses
  distinct Gmail addresses (`a.b@` vs `ab@`, `+tags`) into one and would block real signups.
- **Rate limiting**: login (per IP+email), signup (per IP), and refresh are throttled;
  brute-force login attempts return `429`.
- **No sensitive data leaves the API**: responses are built from explicit DTOs, so `password_hash`
  can't leak even if a column is added later. BigInt ids are serialized as strings.

## Testing

```bash
npm test          # jest + supertest against TEST_DATABASE_URL (real Postgres)
```

The suite creates the test database and applies migrations automatically on first run; it needs
Postgres running (`docker compose up -d postgres`). 99 tests cover registration, login, the auth
middleware, role authorization, profile endpoints, admin creation, refresh/rotation/reuse, logout,
validation failures, unauthorized access, and invalid credentials.

## Commands

```bash
npm run dev              # nodemon on src/server.js
npm start                # node src/server.js
npm test                 # run the test suite
npm run prisma:migrate   # prisma migrate dev
npm run prisma:seed      # seed the initial admin
npm run prisma:studio    # prisma studio
docker compose up        # backend + postgres (:5433) + minio (:9000/:9001)
```
