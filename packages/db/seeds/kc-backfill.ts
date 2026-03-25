#!/usr/bin/env bun
/**
 * KC Backfill (KC3).
 *
 * Populates card_knowledge_components for all existing morph_form cards.
 *
 * Run:
 *   STRUS_DB_PATH=/path/to/strus.db bun run packages/db/seeds/kc-backfill.ts
 *
 * Note: the backfill logic lives in packages/db/src/kc-backfill.ts (shared with the API).
 * This script is a standalone runner for dev convenience.
 *
 * Idempotent: uses INSERT OR IGNORE so re-running is safe.
 */
import { createDb } from "../src/client.js";
import { backfillKCs } from "../src/kc-backfill.js";

const dbPath = process.env.STRUS_DB_PATH;
if (!dbPath) {
  console.error("STRUS_DB_PATH required");
  process.exit(1);
}

const db = createDb(dbPath);
const result = await backfillKCs(db);

console.log(
  `\nBackfill complete.` +
  `\n  Cards processed: ${result.cardsProcessed}` +
  `\n  Links created (or already existed): ${result.linksCreated}` +
  `\n  Lemma KCs created: ${result.lemmaKCsCreated}`,
);
