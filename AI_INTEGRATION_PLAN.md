# AI service integration — plan

Written after reading `origin/ai-module` end to end and tracing both sides of the
boundary. Decisions marked **[confirmed]** were answered by the product owner;
everything else is my call and is reversible.

---

## 1. What the AI service actually is

`origin/ai-module` (commit `a3f9500`, branched from the pre-rewrite scaffold
`80ebcf5`) touches **only `AI_module/`** — 27 files, no Node changes. So this is a
directory to bring across, not a branch to merge.

It is a **Kafka consumer, not an HTTP API**. `dockerfile` runs
`python -m app.main`; the `uvicorn` CMD is commented out and the `8000:8000` port
mapping in its compose file is vestigial. FastAPI is in `requirements.txt` but
nothing imports it.

**Pipeline:** consume event → download PDF from `fileUrl` → extract text (PyMuPDF)
→ embed (`sentence-transformers/all-MiniLM-L6-v2`, 384-dim) → cache the vector in
Postgres → on submit, search Qdrant and publish a similarity report; on approve,
insert into Qdrant; on reject, drop the cache entry.

| | Value |
|---|---|
| Consumes | `Patents.submitted`, `Patents.approved`, `Patents.rejected` |
| Consumer group | `ai-service-patents`, `auto.offset.reset=earliest`, auto-commit on |
| Produces | `Notifications.similarity-report` |
| Event DTO | `eventId, patentId:int, title, applicationNumber, fileUrl, submittedBy:int, submittedAt` — all required |
| Report DTO | `patent_id, title, matches[{patent_id, title, score}]` |
| Infra | Kafka, Qdrant (`QDRANT_HOST`/`QDRANT_PORT`/`QDRANT_COLLECTION`), Postgres (`DATABASE_URL` or `DB_*`) |
| Env | `KAFKA_BOOTSTRAP_SERVERS`, `REPORT_TOPIC`, `EMBEDDING_MODEL_NAME`, `EMBEDDING_DIM`, `TMP_DIR` |

Only vectors of **approved** patents enter Qdrant, so a similarity report can only
ever name approved patents. That matters: reports cannot leak draft or
under-review titles, so surfacing one to a submitter is safe.

## 2. The gap

The AI service was written against the old scaffold, never against this backend.
Nothing lines up:

| # | Gap | Detail |
|---|---|---|
| G1 | Topics | Backend publishes one topic `patents.events`; AI subscribes to three `Patents.*` topics. Zero overlap — the AI would sit idle forever. |
| G2 | Payload | Backend emits fat domain events (`patent_id` as string, `document_key`, `version`, `sequence`, nested categories/inventors). AI requires a flat DTO with `fileUrl` and int ids. |
| G3 | No submit event | Backend deliberately emits **only** on approve/decline. The AI's whole similarity feature keys off `Patents.submitted`, which the backend never sends. |
| G4 | Document access | AI does `urlretrieve(fileUrl)` — tested against public arXiv PDFs. Backend keeps documents in a **private** MinIO bucket and stores object keys, never URLs. |
| G5 | No report sink | AI publishes `Notifications.similarity-report`; nothing consumes it. The backend has no Kafka consumer at all today, only the outbox producer. |
| G6 | Infra | Qdrant does not exist in our compose. AI's own compose has no Kafka, duplicates Postgres/MinIO, and collides on host ports (`5432`, `9000`). |
| G7 | Packaging | `app/config/settings.py` is 0 bytes (dead file, nothing imports it — harmless). No `.env.example`, but its compose declares `env_file: .env`, so `docker compose up` fails without one. |

**Verified, not assumed:** `requirements.txt` is UTF-16LE with a BOM, and I
expected that to break the image build. It does not — pip honours the BOM and
parses it correctly (`pip install --dry-run` resolves all 60 pins). It is a bad
diff experience in git, not a defect. I only convert it to UTF-8 because I have to
append a line to it, and appending UTF-8 bytes to a UTF-16 file *would* break it.

## 3. Decisions **[confirmed]**

1. **AI is advisory — no status gate.** `submit → pending_admin` is unchanged.
   `pending_ai` stays unimplemented. The AI report is decision support for the
   reviewing admin, and a dead AI service can never block a submission.
2. **The backend adapts to the AI's contract.** Backend publishes the three
   `Patents.*` topics in the shape the AI already parses. `patents.events` keeps
   being published unchanged, so the documented Search Service contract survives.
3. **The AI fetches from MinIO by key**, not from a presigned URL. A presigned URL
   embedded in an event expires while the event is still queued — an outage longer
   than the TTL would make those events permanently unprocessable. Fetching by key
   has no expiry hazard and retries work days later.
4. **The report lands as a `PATENT_REVIEW` row** with `reviewStage: ai_filter` and
   `aiConfidenceScore` = top match score. Those columns are already reserved in the
   schema, so **no migration is needed for the report**, and it surfaces through the
   existing owner-or-admin `GET /patents/:id/reviews`.

---

## 4. Must change for E2E

### Backend — publish (G1, G2, G3)
- `src/events/aiEvents.js` — new. Builds the three flat AI payloads. Kept separate
  from `patentEvents.js` so the two contracts can diverge without one breaking the
  other.
- `src/services/patentService.js` — `submitForReview` enqueues `Patents.submitted`;
  `review()` additionally enqueues `Patents.approved` / `Patents.rejected`. Same
  outbox, same transaction — no new publishing mechanism, and the existing "never
  publish from a request handler" rule holds.
- Outbox rows need a **destination topic**. Today the relay hardcodes
  `config.kafka.patentEventsTopic` for every row. Add a nullable `topic` column;
  null keeps today's behaviour, so existing rows are unaffected. *(This is the one
  migration required.)*
- `applicationNumber` and `submittedAt` are required by the AI DTO but nullable
  here. Backend supplies fallbacks rather than changing the DTO — nothing in the AI
  reads `applicationNumber` (every use is commented out).

### Backend — consume (G5)
- `src/workers/reportConsumer.js` + `src/consumer.js` — mirrors `outboxRelay.js` /
  `relay.js` exactly, including a setter-injected client so tests never need a
  broker.
- Writes the `ai_filter` review row. Must be **idempotent** — delivery is
  at-least-once in both directions.

### AI service — minimum viable change (G4)
- `_download_document`: branch on URL scheme. `s3://bucket/key` → MinIO SDK;
  anything else → existing `urlretrieve` path **unchanged**, so their arXiv test
  scripts keep working exactly as before. One method, ~15 lines.
- `requirements.txt` → UTF-8, plus the MinIO client.
- Add `.env.example`.

### Infrastructure (G6)
- Qdrant service in the root `docker-compose.yml`, on `patents-net`.
- `ai-service` service built from `AI_module/`, `KAFKA_BOOTSTRAP_SERVERS=kafka:9092`.
- AI's Postgres → a separate `ai_db` **on the existing Postgres instance** rather
  than a second container.
- `AI_module/docker-compose.yml` left in place for the other team's standalone use;
  the root compose is what the integrated system runs.

### Verification
Real requests against running services: signup → upload → create → submit → observe
`Patents.submitted` → AI report on `Notifications.similarity-report` →
`GET /patents/:id/reviews` shows the `ai_filter` row. Then approve → vector in
Qdrant. Then the failure cases: AI down, Qdrant down, malformed event.

---

## 5. Known weaknesses — deliberately NOT fixed here

Found while reading; none blocks E2E. Recorded for the owning engineer.

| Area | Issue |
|---|---|
| AI tests | `tests/test_indexing_service.py` and `test_kafka_consumer.py` call `index_patent` / `approve_patent` / `reject_patent`, which **do not exist** (the methods are `handle_*_patent`). These tests fail against the code as written. Pre-existing, unrelated to integration. |
| AI reject | `handle_rejected_patent` deletes the cached embedding but **never removes the Qdrant vector**, so a declined patent stays in the similarity corpus forever. Genuine correctness bug that our decline flow now exercises. Flagged below. |
| AI startup | `VectorStoreService.__init__` calls Qdrant during `build_indexing_service()`, so the process crashes at boot if Qdrant is briefly unavailable. No retry/backoff. |
| AI errors | `consume_messages` catches every exception and `continue`s with auto-commit on — a failed message is silently dropped, never retried, no DLQ. |
| AI config | `settings.py` is empty; config is scattered `os.getenv` calls with inline defaults. `AdminRecord` table is defined and never used. |
| AI embedding | Text is embedded whole, with no chunking; MiniLM truncates at 256 tokens, so only the first page or so of a long patent influences the vector. |

**One flagged exception:** the Qdrant-delete-on-reject bug sits directly in the flow
this integration wires up. It is a ~3-line addition. I plan to make that minimal fix
and document it; say the word if you would rather leave it entirely to the owning
engineer.
