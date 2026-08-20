# Kafka Connect / Debezium connectors

> **Application events do not come from here.** `patents.events` is produced by the
> transactional outbox relay (`npm run relay`), which publishes clean domain events rather than
> row-shaped CDC records. See INFRASTRUCTURE.md for why. Debezium remains available for
> row-level CDC use cases — analytics, audit, warehouse replication — but no connector is
> registered by default.

This directory holds **connector templates**, not live connectors. Nothing here is registered
automatically — Kafka Connect starts with zero connectors configured, by design (see
`INFRASTRUCTURE.md` at the repo root for why).

```
kafka-connect/
  connectors/
    postgres-source.json.template   # generic Debezium Postgres source, no table list filled in
  scripts/
    register-connector.js           # substitutes .env values and POSTs/PUTs it to Connect
```

## Registering a connector

1. Copy the template you want (or edit it in place — it's not schema-specific until you fill in
   `table.include.list`).
2. Replace `table.include.list` with the table(s) you actually want to capture, e.g.
   `public.PATENT` or `public.PATENT,public.PATENT_REVIEW`.
3. Register it:

   ```bash
   npm run connect:register -- kafka-connect/connectors/postgres-source.json.template
   ```

   The script reads `.env`, substitutes `${POSTGRES_USER}` / `${POSTGRES_PASSWORD}` /
   `${POSTGRES_DB}`, refuses to run if a `REPLACE_WITH_...` placeholder is still present, and
   POSTs to Kafka Connect (`PUT`s instead if a connector with that name already exists — so
   re-running after an edit updates it in place).

4. Check it came up:

   ```bash
   curl -s http://localhost:8083/connectors/patents-postgres-source/status
   ```

   Or open Kafka UI at [localhost:8080](http://localhost:8080) → Kafka Connect → connector.

## Removing a connector

Deleting the connector does **not** drop its Postgres replication slot — Postgres keeps it (and
the WAL it's pinning) until you drop it explicitly:

```bash
curl -X DELETE http://localhost:8083/connectors/patents-postgres-source
docker exec patents-postgres psql -U patents -d patents \
  -c "SELECT pg_drop_replication_slot('debezium_patents');"
```

A slot with no connector consuming it silently accumulates WAL on disk — don't leave one behind
in a dev environment you're not actively using.

## Template reference

Every field in `postgres-source.json.template` and why it's there:

| Field | Why |
|---|---|
| `database.hostname` / `port` / `user` / `password` / `dbname` | Points at the `postgres` service already in `docker-compose.yml`. |
| `topic.prefix` | Prefixed onto every topic Debezium creates: `<prefix>.<schema>.<table>`. |
| `plugin.name: pgoutput` | Postgres's built-in logical-decoding output plugin (available since PG 10) — no extension to install. |
| `slot.name` | Name of the Postgres replication slot this connector owns. One slot per connector; must be unique. |
| `publication.name` / `publication.autocreate.mode: filtered` | Postgres publications gate which tables logical replication exposes. `filtered` creates one scoped to exactly `table.include.list`, not the whole database. |
| `schema.include.list` | Restricts snapshotting/decoding to the `public` schema — this project doesn't use others. |
| `table.include.list` | **The one field you must fill in.** Fully-qualified `schema.TABLE`, comma-separated for more than one. |
| `snapshot.mode: initial` | On first run, take a consistent snapshot of existing rows, then switch to streaming. Re-running later resumes from the stored offset, no re-snapshot. |
| `tombstones.on.delete` | Emit a null-value tombstone after a delete event, so Kafka's log compaction can eventually drop the row's key — standard practice for keyed CDC topics. |
| `key.converter` / `value.converter` (JSON, schemas disabled) | Plain JSON on the wire, easiest to read while developing. Swap for Avro/Protobuf + Schema Registry before production (see `INFRASTRUCTURE.md`). |
| `topic.creation.*` | Lets Connect auto-create the destination topic instead of requiring you to pre-create it. |
