-- AlterTable
ALTER TABLE "USER" ADD COLUMN     "created_by" BIGINT;

-- CreateTable
CREATE TABLE "REFRESH_TOKEN" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "rotated_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "REFRESH_TOKEN_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "REFRESH_TOKEN_token_hash_key" ON "REFRESH_TOKEN"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_token_user" ON "REFRESH_TOKEN"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_token_expires" ON "REFRESH_TOKEN"("expires_at");

-- AddForeignKey
ALTER TABLE "USER" ADD CONSTRAINT "USER_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "USER"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REFRESH_TOKEN" ADD CONSTRAINT "REFRESH_TOKEN_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("id") ON DELETE CASCADE ON UPDATE CASCADE;
