-- DropForeignKey
ALTER TABLE "PATENT" DROP CONSTRAINT "PATENT_submitted_by_fkey";

-- AlterTable
ALTER TABLE "PATENT" ADD COLUMN     "document_key" TEXT,
ADD COLUMN     "jurisdiction" VARCHAR(8),
ADD COLUMN     "publication_number" VARCHAR(64),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "submitted_at" TIMESTAMPTZ,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "s3_file_url" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'draft';

-- CreateTable
CREATE TABLE "OUTBOX_EVENT" (
    "id" BIGSERIAL NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" BIGINT NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "OUTBOX_EVENT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IDEMPOTENCY_KEY" (
    "key" VARCHAR(255) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IDEMPOTENCY_KEY_pkey" PRIMARY KEY ("user_id","endpoint","key")
);

-- CreateIndex
CREATE INDEX "idx_outbox_aggregate" ON "OUTBOX_EVENT"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "idx_idempotency_created" ON "IDEMPOTENCY_KEY"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PATENT_publication_number_key" ON "PATENT"("publication_number");

-- CreateIndex
CREATE INDEX "idx_patent_submitter_status" ON "PATENT"("submitted_by", "status");

-- CreateIndex
CREATE INDEX "idx_patent_created_at" ON "PATENT"("created_at");

-- CreateIndex
CREATE INDEX "idx_patent_review_patent" ON "PATENT_REVIEW"("patent_id");

-- AddForeignKey
ALTER TABLE "PATENT" ADD CONSTRAINT "PATENT_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "USER"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The relay only ever scans unpublished rows. A partial index keeps that scan
-- O(backlog) instead of O(all events ever published), which matters because the
-- table is append-only and never shrinks. Prisma's schema language cannot
-- express a partial index, so this is written by hand.
CREATE INDEX "idx_outbox_unpublished" ON "OUTBOX_EVENT"("id") WHERE "published_at" IS NULL;
