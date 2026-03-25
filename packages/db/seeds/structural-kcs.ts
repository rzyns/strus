#!/usr/bin/env bun
/**
 * Seed script: structural Knowledge Components (KC2).
 *
 * Creates the grammar-dimension KCs (case, number, gender, tense, mood, pos)
 * with deterministic IDs so re-running is idempotent.
 *
 * Run:
 *   STRUS_DB_PATH=/path/to/strus.db bun run packages/db/seeds/structural-kcs.ts
 *
 * Note: the seed logic lives in packages/db/src/kc-seed.ts (shared with the API).
 * This script is a standalone runner for dev convenience.
 */
import { createDb } from "../src/client.js";
import { seedKCs } from "../src/kc-seed.js";

const dbPath = process.env.STRUS_DB_PATH;
if (!dbPath) {
  console.error("STRUS_DB_PATH required");
  process.exit(1);
}

const db = createDb(dbPath);
const { created, skipped } = seedKCs(db);

console.log(`Done. Created: ${created}, already existed: ${skipped}.`);
