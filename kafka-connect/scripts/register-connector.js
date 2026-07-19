#!/usr/bin/env node
/**
 * Registers (or updates) a Kafka Connect connector from a .json.template file,
 * substituting ${VAR} placeholders from .env / process.env.
 *
 * Usage:
 *   node kafka-connect/scripts/register-connector.js <path-to-template.json>
 *   node kafka-connect/scripts/register-connector.js kafka-connect/connectors/postgres-source.json.template
 *
 * Env:
 *   CONNECT_URL   Kafka Connect REST base URL (default http://localhost:8083)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CONNECT_URL = process.env.CONNECT_URL || 'http://localhost:8083';

async function main() {
  const templatePath = process.argv[2];
  if (!templatePath) {
    console.error('Usage: node register-connector.js <path-to-template.json>');
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(templatePath), 'utf8');
  const substituted = raw.replace(/\$\{(\w+)\}/g, (match, name) => {
    if (process.env[name] === undefined) {
      console.error(`Missing env var ${name} referenced by ${templatePath}`);
      process.exit(1);
    }
    return process.env[name];
  });

  if (substituted.includes('REPLACE_WITH_')) {
    console.error(
      `${templatePath} still has a REPLACE_WITH_... placeholder — edit it (e.g. table.include.list) before registering.`,
    );
    process.exit(1);
  }

  const body = JSON.parse(substituted);

  const existing = await fetch(`${CONNECT_URL}/connectors/${body.name}`);
  const isUpdate = existing.status === 200;

  const res = isUpdate
    ? await fetch(`${CONNECT_URL}/connectors/${body.name}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.config),
      })
    : await fetch(`${CONNECT_URL}/connectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Kafka Connect returned ${res.status}:\n${text}`);
    process.exit(1);
  }

  console.log(`${isUpdate ? 'Updated' : 'Registered'} connector "${body.name}".`);
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
