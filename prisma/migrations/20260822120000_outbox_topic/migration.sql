-- Destination topic for an outbox row.
--
-- Nullable on purpose: NULL means "the default patent events topic", which is
-- what every existing row meant implicitly. Backfilling would be a lie about
-- when the column started carrying meaning, and the relay already resolves
-- NULL to the configured default.
ALTER TABLE "OUTBOX_EVENT" ADD COLUMN "topic" VARCHAR(255);

-- The relay claims by (published_at, attempts, claimed_at) and never by topic,
-- so no new index is warranted here.
