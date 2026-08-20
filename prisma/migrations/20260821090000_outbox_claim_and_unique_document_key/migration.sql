-- AlterTable
ALTER TABLE "OUTBOX_EVENT" ADD COLUMN     "claimed_at" TIMESTAMPTZ;

-- CreateIndex
CREATE UNIQUE INDEX "PATENT_document_key_key" ON "PATENT"("document_key");

-- The relay's claim query filters on published_at, claimed_at and attempts
-- together. Replaces the earlier index that only covered published_at.
DROP INDEX IF EXISTS "idx_outbox_unpublished";
CREATE INDEX "idx_outbox_claimable" ON "OUTBOX_EVENT"("id")
  WHERE "published_at" IS NULL;
