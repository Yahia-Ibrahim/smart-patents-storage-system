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

## 5. What was verified, and how

All against a running stack — real HTTP, a real PDF in MinIO, real Kafka — not unit tests.
Driver scripts are in the scratchpad (`e2e.js`, `resilience.js`); the flow they exercise is:

| # | Check | Result |
|---|---|---|
| 1 | submit → `Patents.submitted` → AI → report → `GET /patents/:id/reviews` | works |
| 2 | Similarity is semantically real | new cooling patent scored **0.7630** against the self-chilling can and **0.0808** against the wind turbine |
| 3 | AI does not gate the lifecycle | submit returns `pending_admin`, unchanged |
| 4 | approve → vector enters Qdrant | points 2 → 3 |
| 5 | decline → vector leaves Qdrant | required a fix; see below |
| 6 | Both contracts emitted, routed by topic | `PatentSubmitted`→`Patents.submitted`, `PatentVersionUpserted`→default, … |
| 7 | **AI service down** | API accepted a submission in **176 ms**; report arrived automatically on restart |
| 8 | **Kafka down** | API accepted a submission in **101 ms**, `/ready` stayed `ready`, event held in the outbox, drained on broker recovery, report followed |
| 9 | Malformed reports (bad JSON, unknown patent, missing id) | all three discarded with distinct reasons; consumer stayed up |
| 10 | Whole stack in Docker | full loop re-run inside the network — 10/10 services healthy |
| 11 | Backend suite | 389 tests, 19 suites, green |

Two things were **wrong and got fixed** because running the system exposed them:

- **The report consumer crashed on every cold start.** The report topic does not exist until
  the AI service first publishes, and a KafkaJS consumer subscribing to an unknown topic fails
  its metadata refresh rather than waiting. It now ensures the topic before subscribing.
- **Declining left the patent in the similarity corpus forever.** Predicted from reading, then
  confirmed live: after declining, the embedding cache row was gone but the Qdrant point
  remained, so a declined patent kept being offered as prior art. Fixed in the AI service (see
  §6).

One thing is **wrong and was left alone** because it is pre-existing and unrelated:

- **Presigned URLs are unusable outside the Docker network.** Compose sets
  `S3_ENDPOINT: http://minio:9000` for the backend, so the URLs it signs name a host only
  resolvable inside the network. A browser — or anything on the host — cannot upload against
  them. Signing needs a *public* endpoint while the backend's own `headObject`/`deleteObject`
  calls need the *internal* one, so the real fix is two endpoints in `storageService`. Nothing
  to do with the AI service, which fetches over the internal network and is unaffected. The
  host-side E2E worked because a host-run backend signs with `127.0.0.1:9000`.

## 6. Changes made to the AI service

Deliberately tiny — 42 added lines in one file, nothing removed, no existing behaviour altered.

| Change | Why it was necessary |
|---|---|
| `_download_document` handles `s3://` | Required for integration. Documents live in a private bucket; the previous `urlretrieve` path is untouched, so their arXiv test scripts still work exactly as before. |
| `handle_rejected_patent` also clears Qdrant | Genuine correctness bug, confirmed live. Their code already intended cleanup on rejection — it cleared the cache — and simply missed the vector store. Kept as a separately guarded block so a cache failure cannot skip the externally visible half. |
| `requirements.txt` → UTF-8, `+ minio` | The client is needed for the above. Re-encoding was forced: appending a UTF-8 line to a UTF-16 file corrupts it. Note the encoding was **not** broken — pip honours the BOM. |
| `.env.example` added | It had none, and its own compose declares `env_file: .env`, so standalone `docker compose up` failed outright. |

Everything else found while reading was left alone and recorded below.

## 7. Known weaknesses — deliberately NOT fixed

Found while reading, and left alone. Recorded for the owning engineer.

| Area | Issue |
|---|---|
| AI tests | **Their suite cannot complete.** Ran it in the built image: 4 pass, 3 fail, 2 hang. The three failures are `AttributeError: 'IndexingService' object has no attribute 'index_patent'` (also `approve_patent`, `reject_patent`) — the methods are named `handle_*_patent`. `test_kafka_consumer.py` then **hangs forever**: `consume_messages` only increments `count` on success, and its `if msg is None: continue` has no exit, so once the dispatch raises (the dummy service has the same wrong method names) a `max_messages=1` call polls an exhausted dummy consumer for eternity. Entirely pre-existing — none of these tests touch the two methods this integration changed. |
| AI startup | `VectorStoreService.__init__` calls Qdrant during `build_indexing_service()`, so the process crashes at boot if Qdrant is briefly unavailable. No retry/backoff. |
| AI errors | `consume_messages` catches every exception and `continue`s with auto-commit on — a failed message is silently dropped, never retried, no DLQ. |
| AI config | `settings.py` is empty; config is scattered `os.getenv` calls with inline defaults. `AdminRecord` table is defined and never used. |
| AI embedding | Text is embedded whole, with no chunking; MiniLM truncates at 256 tokens, so only the first page or so of a long patent influences the vector. |

The one weakness that was **not** left alone is the Qdrant-delete-on-reject bug — it sat
directly in the flow this integration wires up and produced visibly wrong output, so it was
fixed. See §6.

### Found during verification (infrastructure, ours not theirs)

| Area | Issue |
|---|---|
| Presigned URL endpoint | See §5 — compose-signed URLs are unreachable from outside the Docker network. Pre-existing; needs split public/internal endpoints in `storageService`. |
| AI image size | 8.7 GB, because `torch==2.13.0` resolves to the CUDA build. A CPU-only index would cut it by roughly 7 GB, but the pin is the other team's. |
| Stale `node_modules` volume | The Node services mount an anonymous volume over `node_modules`, which survives `docker compose up` and silently masks dependency changes. Needs `--renew-anon-volumes` after any dependency change. |
| Qdrant upgrades | v1.18 cannot read storage written by v1.12; changing the pin requires wiping `data/qdrant`. Fine while the corpus is rebuildable from Postgres, not once it is not. |
| Report topic partitioning | The AI publishes reports with **no message key**, so they round-robin across partitions. On the single-partition default this is fine; on a multi-partition topic two reports for one patent could be handled concurrently and the last write would win arbitrarily. Fixing it properly means keying the produce call in their service. |
