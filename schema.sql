-- 1. USERS TABLE
CREATE TABLE "USER" (
    "id" BIGSERIAL PRIMARY KEY, -- BIGSERIAL handles auto-incrementing
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) UNIQUE NOT NULL, -- Emails must be unique for login
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) CHECK ("role" IN ('user', 'admin')) NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. PATENTS TABLE
CREATE TABLE "PATENT" (
    "id" BIGSERIAL PRIMARY KEY,
    "title" VARCHAR(500) NOT NULL,
    "abstract" TEXT NOT NULL,         -- Changed to TEXT for long content
    "specification" TEXT NOT NULL,    -- Changed to TEXT for long content
    "s3_file_url" TEXT NOT NULL,      -- Fixed from BIGINT to TEXT for S3 links
    "status" VARCHAR(50) CHECK (
        "status" IN ('pending_ai', 'pending_admin', 'approved', 'declined', 'draft')
    ) NOT NULL DEFAULT 'pending_ai',
    "submitted_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_patent_submitted_by" FOREIGN KEY ("submitted_by") REFERENCES "USER"("id") ON DELETE SET NULL
);

-- Indexes for frequent searching and filtering
CREATE INDEX "idx_patent_status" ON "PATENT"("status");
CREATE INDEX "idx_patent_submitted_by" ON "PATENT"("submitted_by");
-- Optional: GIN index for full-text search on patent titles/abstracts
-- CREATE INDEX "idx_patent_text_search" ON "PATENT" USING GIN (to_tsvector('english', title || ' ' || abstract));

-- 3. PATENT REVIEWS TABLE (New: For AI and Admin pipeline)
CREATE TABLE "PATENT_REVIEW" (
    "id" BIGSERIAL PRIMARY KEY,
    "patent_id" BIGINT NOT NULL,
    "reviewer_id" BIGINT NULL,        -- NULL if reviewed by AI, Admin ID if human
    "review_stage" VARCHAR(50) CHECK ("review_stage" IN ('ai_filter', 'admin_review')) NOT NULL,
    "decision" VARCHAR(50) CHECK ("decision" IN ('pass', 'fail', 'flagged')),
    "ai_confidence_score" DECIMAL(5,2) NULL, -- E.g., 95.50 (Useful for the AI step)
    "comments" TEXT NULL,             -- Admin notes or AI generated summary/flags
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_review_patent" FOREIGN KEY ("patent_id") REFERENCES "PATENT"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_review_reviewer" FOREIGN KEY ("reviewer_id") REFERENCES "USER"("id") ON DELETE SET NULL
);

-- 4. INVENTORS TABLE
CREATE TABLE "INVENTOR" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" BIGINT NULL,            -- Links to USER if they are registered on the platform
    "full_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) UNIQUE NOT NULL,
    "organization" VARCHAR(255) NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_inventor_user" FOREIGN KEY ("user_id") REFERENCES "USER"("id") ON DELETE SET NULL
);

-- 5. PATENT_INVENTOR (Join Table)
CREATE TABLE "PATENT_INVENTOR" (
    "patent_id" BIGINT NOT NULL,
    "inventor_id" BIGINT NOT NULL,
    "inventor_order" INTEGER NOT NULL DEFAULT 1, -- e.g., 1st author, 2nd author
    PRIMARY KEY ("patent_id", "inventor_id"),    -- Fixed composite key syntax
    CONSTRAINT "fk_pi_patent" FOREIGN KEY ("patent_id") REFERENCES "PATENT"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_pi_inventor" FOREIGN KEY ("inventor_id") REFERENCES "INVENTOR"("id") ON DELETE CASCADE
);

-- 6. CATEGORY TABLE
CREATE TABLE "CATEGORY" (
    "id" BIGSERIAL PRIMARY KEY,
    "name" VARCHAR(255) UNIQUE NOT NULL -- Prevent duplicate categories
);

-- 7. PATENT_CATEGORY (Join Table)
CREATE TABLE "PATENT_CATEGORY" (
    "patent_id" BIGINT NOT NULL,
    "category_id" BIGINT NOT NULL,
    PRIMARY KEY ("patent_id", "category_id"),    -- Fixed composite key syntax
    CONSTRAINT "fk_pc_patent" FOREIGN KEY ("patent_id") REFERENCES "PATENT"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_pc_category" FOREIGN KEY ("category_id") REFERENCES "CATEGORY"("id") ON DELETE CASCADE
);