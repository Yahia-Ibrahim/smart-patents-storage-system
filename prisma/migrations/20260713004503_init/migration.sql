-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "PatentStatus" AS ENUM ('pending_ai', 'pending_admin', 'approved', 'declined', 'draft');

-- CreateEnum
CREATE TYPE "ReviewStage" AS ENUM ('ai_filter', 'admin_review');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('pass', 'fail', 'flagged');

-- CreateTable
CREATE TABLE "USER" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "USER_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PATENT" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "abstract" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "s3_file_url" TEXT NOT NULL,
    "status" "PatentStatus" NOT NULL DEFAULT 'pending_ai',
    "submitted_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PATENT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PATENT_REVIEW" (
    "id" BIGSERIAL NOT NULL,
    "patent_id" BIGINT NOT NULL,
    "reviewer_id" BIGINT,
    "review_stage" "ReviewStage" NOT NULL,
    "decision" "ReviewDecision",
    "ai_confidence_score" DECIMAL(5,2),
    "comments" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PATENT_REVIEW_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "INVENTOR" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "full_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "organization" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "INVENTOR_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PATENT_INVENTOR" (
    "patent_id" BIGINT NOT NULL,
    "inventor_id" BIGINT NOT NULL,
    "inventor_order" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PATENT_INVENTOR_pkey" PRIMARY KEY ("patent_id","inventor_id")
);

-- CreateTable
CREATE TABLE "CATEGORY" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "CATEGORY_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PATENT_CATEGORY" (
    "patent_id" BIGINT NOT NULL,
    "category_id" BIGINT NOT NULL,

    CONSTRAINT "PATENT_CATEGORY_pkey" PRIMARY KEY ("patent_id","category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "USER_email_key" ON "USER"("email");

-- CreateIndex
CREATE INDEX "idx_patent_status" ON "PATENT"("status");

-- CreateIndex
CREATE INDEX "idx_patent_submitted_by" ON "PATENT"("submitted_by");

-- CreateIndex
CREATE UNIQUE INDEX "INVENTOR_user_id_key" ON "INVENTOR"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "INVENTOR_email_key" ON "INVENTOR"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CATEGORY_name_key" ON "CATEGORY"("name");

-- AddForeignKey
ALTER TABLE "PATENT" ADD CONSTRAINT "PATENT_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "USER"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PATENT_REVIEW" ADD CONSTRAINT "PATENT_REVIEW_patent_id_fkey" FOREIGN KEY ("patent_id") REFERENCES "PATENT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PATENT_REVIEW" ADD CONSTRAINT "PATENT_REVIEW_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "USER"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "INVENTOR" ADD CONSTRAINT "INVENTOR_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PATENT_INVENTOR" ADD CONSTRAINT "PATENT_INVENTOR_patent_id_fkey" FOREIGN KEY ("patent_id") REFERENCES "PATENT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PATENT_INVENTOR" ADD CONSTRAINT "PATENT_INVENTOR_inventor_id_fkey" FOREIGN KEY ("inventor_id") REFERENCES "INVENTOR"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PATENT_CATEGORY" ADD CONSTRAINT "PATENT_CATEGORY_patent_id_fkey" FOREIGN KEY ("patent_id") REFERENCES "PATENT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PATENT_CATEGORY" ADD CONSTRAINT "PATENT_CATEGORY_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "CATEGORY"("id") ON DELETE CASCADE ON UPDATE CASCADE;
