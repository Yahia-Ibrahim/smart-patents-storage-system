#!/bin/sh
# Creates the AI service's database on the shared Postgres instance.
#
# The AI service (AI_module/) keeps its embedding cache in SQLAlchemy-managed
# tables that Prisma knows nothing about. Putting them in the patents database
# would make every `prisma migrate diff` report drift, so it gets its own
# database on the same server rather than a second container.
#
# Postgres only runs the scripts in this directory when initialising an EMPTY
# data directory. An existing install needs this run once by hand:
#
#   docker compose exec postgres psql -U patents -c 'CREATE DATABASE ai_db'
set -e

DB_NAME="${AI_POSTGRES_DB:-ai_db}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
    CREATE DATABASE "$DB_NAME";
    GRANT ALL PRIVILEGES ON DATABASE "$DB_NAME" TO "$POSTGRES_USER";
SQL
