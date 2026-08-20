# Infrastructure

This document covers the event-streaming / CDC infrastructure added to `docker-compose.yml`:
Kafka, Kafka Connect, and Debezium. It's infrastructure only — no producers, consumers, or
connector configs tied to this project's actual schema live here (see `kafka-connect/README.md`
for the one template that exists, and why it's explicitly not wired up by default).

The existing `backend` / `postgres` / `minio` services are unchanged in behaviour; `postgres`
gained three config flags (below) and everything gained an explicit Docker network.

## The pieces, and why each exists

### Kafka — event log / message broker

Kafka is the backbone: Debezium writes change events to it, and whatever you build next
(consumers, stream processors, other services) reads from it. It's the one genuinely new
category of infrastructure here — everything else (Connect, Debezium) exists to get data
into or out of it.

**Image: `apache/kafka:3.9.0`, KRaft mode, no ZooKeeper.**

ZooKeeper was Kafka's original metadata store, but Kafka has replaced it with **KRaft**
(Kafka's own Raft-based consensus), and ZooKeeper support was removed entirely as of Kafka 4.0.
Building a new setup on ZooKeeper in 2026 means building on a component that's actively being
deleted upstream. KRaft also means one fewer moving part locally — no separate ZooKeeper
container, no ZK connection string to keep in sync.

`apache/kafka` (the project's own official image, not a third-party rebuild) was chosen over
`confluentinc/cp-kafka` or `bitnami/kafka` because it tracks upstream Apache Kafka releases
directly with no added packaging layer or Confluent-specific extensions — fewer surprises, and
one less vendor in the stack.

**Single node, combined broker+controller (`KAFKA_PROCESS_ROLES: broker,controller`).** A
production KRaft cluster separates these roles across 3+ controller nodes and N broker nodes for
fault tolerance. Locally, one process doing both is simpler to run and entirely sufficient — you
aren't testing failover on your laptop.

**Three listeners, one job each** — this is the part most local Kafka setups get subtly wrong,
so it's worth spelling out:

| Listener | Used by | Advertised as |
|---|---|---|
| `PLAINTEXT` (9092) | Other containers on `patents-net` (kafka-connect, kafka-ui, and later your own services) | `kafka:9092` |
| `CONTROLLER` (9093) | KRaft's internal metadata-quorum traffic only | not advertised |
| `EXTERNAL` (29092) | Tools running on your host machine (a local script, a GUI client) | `127.0.0.1:29092` |

If you only had one listener advertised as a loopback address, containers couldn't reach it
(they'd try their own loopback). If you only advertised the internal container hostname, nothing
on your host could connect. Kafka's advertised-listener mechanism exists precisely to hand back
the *right* address depending on who's asking.

**EXTERNAL advertises `127.0.0.1`, not `localhost`, on purpose.** A host client bootstraps,
receives this address in the metadata response, and reconnects to it. Node resolves `localhost`
to `::1` first while the port is published on IPv4 only, so advertising the hostname produced
intermittent connection failures that looked like a broken broker. See the networking note at the
end of this file.

**`KAFKA_LOG_DIRS`** — must be set explicitly to `/var/lib/kafka/data`. The image defaults to
`/tmp/kafka-logs`, which meant the `./data/kafka` bind mount was present but never written to:
every `docker compose up` that recreated the container silently discarded every topic, message,
and consumer offset. This was a real bug, found by recreating the container and watching the
event log come back empty.

**`KAFKA_CLUSTER_ID`** — KRaft requires a cluster ID to format its storage on first boot; unlike
ZooKeeper-based Kafka, there's no external system to generate one for you. A fixed value
(`.env.example`, overridable) means `docker compose down` (without `-v`) and back up reuses the
same formatted storage instead of erroring on a mismatch. If you ever see
`InconsistentClusterIdException`, the data in `./data/kafka` was formatted with a different ID
than what's currently in your `.env` — wipe `./data/kafka` or fix the ID.

**Replication factor `1` everywhere** (`KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR`, etc.) — there's
only one broker, so any factor above 1 would just fail to satisfy. This is the setting you'll
change first when you move off a single dev node: production Kafka topics are typically
replicated 3x.

**What you'll likely touch later:** `KAFKA_AUTO_CREATE_TOPICS_ENABLE` (convenient in dev, usually
turned off in production so topic creation is deliberate/versioned), and the replication-factor
settings once you're running more than one broker.

**Production alternatives:** a managed Kafka service (Confluent Cloud, AWS MSK, Redpanda Cloud)
removes the operational burden of running brokers yourself. **Redpanda** is a Kafka-API-compatible
alternative written in C++ with no JVM and no ZooKeeper/KRaft distinction — a reasonable swap if
you want lower resource usage locally and don't need a Kafka-specific feature.

### Kafka Connect + Debezium — the CDC layer

**Why CDC, and why Debezium specifically:** you asked me to weigh this, so — the alternative to
CDC is dual-writing (your app writes to Postgres *and* publishes an event, in the same request)
or polling (a job that periodically queries for "what changed"). Dual-writing has a fundamental
consistency problem: the DB write and the publish can't be made atomic without an outbox table,
and polling either misses fast-changing rows between polls or hammers the database. CDC reads the
database's own write-ahead log — the thing Postgres already writes for crash recovery — so every
committed transaction is captured exactly once, in commit order, with no code in your application
path at all. That's what "do not implement CDC in application code" in your brief is pointing at:
this is infrastructure precisely because it sits *outside* the application.

Debezium is the standard choice for Postgres CDC specifically because Postgres ships native
logical-replication support (the `pgoutput` plugin, no extension to install) and Debezium's
Postgres connector is built directly on top of it — mature, widely deployed, and it's what the
rest of this write-up assumes. (Alternatives: AWS DMS if you're already committed to AWS and want
a managed connector; Materialize or Airbyte if what you actually want is data-replicated-into-a-
warehouse rather than a raw event stream. None of them fit "publish row-level change events to
Kafka for your own consumers" better than Debezium does.)

**Debezium runs *inside* Kafka Connect** — it's not a standalone service. Kafka Connect is a
plugin-hosting framework (a "Connect worker") that takes source/sink connector configs and runs
them as tasks; Debezium is a source-connector plugin for it. That's why there's a
`kafka-connect` service and not a `debezium` service. `quay.io/debezium/connect:2.7` is a Connect
worker with the Debezium plugins (Postgres, MySQL, MongoDB, SQL Server, Oracle, Db2) pre-bundled,
so there's no separate plugin-installation step.

**Postgres-side change (`docker-compose.yml`, `postgres.command`):**

```
wal_level=logical
max_wal_senders=10
max_replication_slots=10
```

`wal_level=logical` is the one setting that actually matters — it tells Postgres to include
enough information in the WAL for logical decoding (row contents, not just physical page diffs).
It's off by default because it has a real cost: WAL retention grows to cover whatever a
replication slot hasn't consumed yet. `max_wal_senders` / `max_replication_slots` just raise the
ceiling on how many replication connections/slots can exist concurrently (defaults are lower);
10 is comfortably more than one dev connector needs; **it's not a resource reservation** — headroom
you have not used costs nothing.

**Kafka Connect config, and the one thing to understand about it:** `CONFIG_STORAGE_TOPIC` /
`OFFSET_STORAGE_TOPIC` / `STATUS_STORAGE_TOPIC` are Connect's *own* bookkeeping topics (which
connectors are configured, how far each has read, whether each task is running) — not
where your change-data events land. A Postgres source connector's actual output topics are named
`<topic.prefix>.<schema>.<table>` (e.g. `patents.public.PATENT`), created per-table the first time
a connector captures that table. Don't confuse the two; `_connect-offsets` will never contain a
row from your `PATENT` table.

**No connector is registered by default.** This was a deliberate choice, not an oversight: a
Debezium connector config *is* schema-specific — `table.include.list` has to name real tables —
and your brief was explicit that infrastructure shouldn't assume your schema. What's provided
instead is `kafka-connect/connectors/postgres-source.json.template`, with every field explained
in `kafka-connect/README.md`, and a small registration script
(`npm run connect:register -- <template>`). You fill in the table list and register it when
you're ready; nothing here does that for you.

I verified the whole path works end-to-end while building this (registered a scratch connector
against a real table, inserted a row, watched the resulting event land on its Kafka topic, then
deregistered it and dropped the replication slot) — so the template is a starting point that's
known to work, not an untested guess.

**What you'll likely touch later:** `table.include.list` (immediately — the template is
unusable until you set this), `snapshot.mode` (e.g. `no_data` if you only want changes from *now*
forward, not a snapshot of existing rows), and the converters — plain JSON is easiest for local
development, but production Debezium deployments typically move to Avro or Protobuf with a
Schema Registry so consumers get compile-time-checked, evolvable schemas instead of untyped JSON.

**Production alternatives:** Debezium itself is the production-grade choice here, not just a
dev convenience — the change is usually *how* you run Connect (a managed Connect cluster,
Kubernetes with the Strimzi operator, or Confluent's managed Debezium connectors) rather than
swapping Debezium for something else.

### Kafka UI — local observability

**`provectuslabs/kafka-ui`**, not part of your brief's explicit list but included under "any other
infrastructure necessary for a complete local dev environment": without it, inspecting topics,
consumer groups, and connector status means shelling into containers and running CLI tools by
hand (as I did to verify the pipeline above). It's a pure dev-convenience read/write UI over the
Kafka and Connect REST APIs — nothing it does is reachable by your application, and it's the
easiest piece to delete from `docker-compose.yml` if you'd rather not run it.

Reachable at [localhost:8080](http://localhost:8080) once the stack is up.

## Docker networking, volumes, health, ordering

- **`patents-net`** — one explicit bridge network, all seven services attached. Compose gives
  you a default network for free, but naming it explicitly makes `docker network inspect
  patents-net` predictable and leaves room to attach other tooling (a debug container, a
  temporary consumer) without guessing the auto-generated name.
- **Volumes** follow the existing project convention — bind mounts under `./data/<service>`
  (already `.gitignore`d via the blanket `data/` rule), not Docker-managed named volumes. Kafka
  Connect has no volume: it's stateless by design — its config/offsets/status live in Kafka
  topics, not on its own disk, so killing and recreating the container loses nothing.
  **A bind mount only persists anything if the service is actually configured to write there** —
  see `KAFKA_LOG_DIRS` above. Bind mounts also carry a real cost on Windows/macOS: fsync is slow
  enough that the test suite disables `synchronous_commit` on the test database to stay usable.
- **Health checks** gate startup ordering via `depends_on: condition: service_healthy`, not
  fixed sleeps: `kafka-connect` waits for `kafka` to report healthy before starting (Connect
  fails hard if it can't reach a broker at boot), and `kafka-ui` waits for both. This is the same
  pattern already used for `backend` → `postgres`.
- **`restart: unless-stopped`** on every service, matching the existing services — if Docker
  restarts, so does your dev stack, but an explicit `docker compose stop` sticks.

## Bringing it up / tearing it down

```bash
docker compose up -d              # everything, including the pre-existing backend/postgres/minio
docker compose up -d kafka kafka-connect kafka-ui   # just the new pieces
docker compose down                # stop, keep ./data/* (including Kafka's log segments)
docker compose down -v             # also drop the network (bind-mounted data survives either way — delete ./data/ yourself if you want a truly clean slate)
```

Kafka Connect's REST API: `http://localhost:8083` (`GET /connectors`, `GET /connector-plugins`,
etc.). Kafka UI: `http://localhost:8080`.


## The outbox relay (what actually publishes today)

Debezium is staged here but **no connector is registered**, and application events do not come
from CDC. They come from a hand-written relay:

```
POST /patents/:id/approve
        │  one transaction
        ├─▶ PATENT.status = approved
        ├─▶ PATENT_REVIEW row
        └─▶ OUTBOX_EVENT row
                 │
   npm run relay ┴──▶ Kafka topic "patents.events", key = patent id
```

**Why a relay and not Debezium, given Debezium is right there?**

Debezium publishes *rows*. A consumer would receive `PATENT` column changes and have to
reconstruct what business event they represent — and it would need `PATENT_CATEGORY` and
`PATENT_INVENTOR` streams too, then join them itself, in the right order. The outbox publishes a
*domain event* that already carries everything a consumer needs (`src/events/patentEvents.js`).
The database schema stays free to change without breaking consumers, which is the entire value
of the boundary.

The Debezium setup stays in place because row-level CDC is genuinely useful for other things —
analytics, audit, replicating to a warehouse. It is just not how `patents.events` is produced.

**Operational properties**

- At-least-once. The relay can publish and then fail to mark the row published, so it re-sends.
  Consumers must be idempotent on `(patent_id, version)`.
- `FOR UPDATE SKIP LOCKED` on the claim query, so several relays can run concurrently without
  publishing the same event twice or blocking each other.
- A failed publish stops the batch instead of skipping ahead — ordering beats throughput here.
- The API never connects to Kafka. A broker outage queues events in Postgres; it does not take
  the API down. `/ready` reports the backlog.
- Runs as its own container (`relay` in `docker-compose.yml`) so a stall is visible.

## A local-networking trap

Docker publishes ports on `0.0.0.0` — IPv4 only. Node resolves `localhost` to `::1` first. Every
host-facing URL therefore uses `127.0.0.1`: Postgres on 5433, MinIO on 9000, Kafka on 29092. Using
`localhost` produces intermittent `ECONNRESET` and connect timeouts that look exactly like flaky
infrastructure and are not. This applies to Kafka's advertised listener too, not just to the
addresses you type — the broker hands clients an address to reconnect to.

Browser URLs (`:8080` Kafka UI, `:9001` MinIO console, `:5000/api-docs`) are unaffected; browsers
fall back to IPv4 correctly.
