#!/usr/bin/env bun
/**
 * KC Backfill (KC3).
 *
 * Populates card_knowledge_components for all existing morph_form cards.
 *
 * For each morph_form card:
 *   1. Runs the tag engine to find matching structural KCs (case, number,
 *      gender, tense, mood, pos).
 *   2. Looks up the note's lemma_id → finds or creates the lemma-kind KC.
 *   3. Bulk-inserts all matches into card_knowledge_components (idempotent).
 *
 * Run:
 *   STRUS_DB_PATH=/path/to/strus.db bun run packages/db/seeds/kc-backfill.ts
 *
 * Idempotent: uses INSERT OR IGNORE so re-running is safe.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and } from "drizzle-orm";
import {
  knowledgeComponents,
  cardKnowledgeComponents,
  cards,
  notes,
} from "../src/schema.js";
import { mapCardToKCs } from "../src/kc-engine.js";

const dbPath = process.env.STRUS_DB_PATH;
if (!dbPath) {
  console.error("STRUS_DB_PATH required");
  process.exit(1);
}

const sqlite = new Database(dbPath, { create: false });
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA journal_mode = WAL;");
const db = drizzle(sqlite);

// ---------------------------------------------------------------------------
// Load all structural KCs
// ---------------------------------------------------------------------------

const allKCs = db.select().from(knowledgeComponents).all();
const structuralKCs = allKCs.filter((kc) => kc.kind !== "lemma");
const lemmaKCByLemmaId = new Map(
  allKCs.filter((kc) => kc.kind === "lemma" && kc.lemmaId).map((kc) => [kc.lemmaId!, kc]),
);

console.log(`Loaded ${allKCs.length} KCs (${structuralKCs.length} structural, ${lemmaKCByLemmaId.size} lemma).`);

// ---------------------------------------------------------------------------
// Load all morph_form cards with their note's lemma_id
// ---------------------------------------------------------------------------

const morphCards = db
  .select({
    cardId: cards.id,
    tag: cards.tag,
    noteId: cards.noteId,
    lemmaId: notes.lemmaId,
  })
  .from(cards)
  .innerJoin(notes, eq(cards.noteId, notes.id))
  .where(eq(cards.kind, "morph_form"))
  .all();

console.log(`Found ${morphCards.length} morph_form cards.`);

// ---------------------------------------------------------------------------
// Process cards in batches
// ---------------------------------------------------------------------------

let linkedCount = 0;
let lemmaKCsCreated = 0;
const BATCH_SIZE = 200;
const now = new Date();

// Collect all (cardId, kcId) pairs to insert
const pairsToInsert: { cardId: string; kcId: string }[] = [];

for (const card of morphCards) {
  if (!card.tag) continue;

  // 1. Structural KCs via tag engine
  const matchingKcIds = mapCardToKCs(card.tag, structuralKCs);

  // 2. Lemma KC
  if (card.lemmaId) {
    let lemmaKC = lemmaKCByLemmaId.get(card.lemmaId);
    if (!lemmaKC) {
      // Create it
      const kcId = `kc-lemma-${card.lemmaId}`;
      db.insert(knowledgeComponents).values({
        id: kcId,
        kind: "lemma",
        label: `lemma:${card.lemmaId}`,
        labelPl: null,
        tagPattern: null,
        lemmaId: card.lemmaId,
        createdAt: now,
      }).run();
      lemmaKC = {
        id: kcId,
        kind: "lemma",
        label: `lemma:${card.lemmaId}`,
        labelPl: null,
        tagPattern: null,
        lemmaId: card.lemmaId,
        createdAt: now,
      };
      lemmaKCByLemmaId.set(card.lemmaId, lemmaKC);
      lemmaKCsCreated++;
    }
    matchingKcIds.push(lemmaKC.id);
  }

  for (const kcId of matchingKcIds) {
    pairsToInsert.push({ cardId: card.cardId, kcId });
  }
}

// Bulk insert in batches using raw SQL for INSERT OR IGNORE
const insertStmt = sqlite.prepare(
  "INSERT OR IGNORE INTO card_knowledge_components (card_id, kc_id) VALUES (?, ?)",
);

const insertBatch = sqlite.transaction((batch: { cardId: string; kcId: string }[]) => {
  for (const pair of batch) {
    insertStmt.run(pair.cardId, pair.kcId);
  }
});

for (let i = 0; i < pairsToInsert.length; i += BATCH_SIZE) {
  const batch = pairsToInsert.slice(i, i + BATCH_SIZE);
  insertBatch(batch);
  linkedCount += batch.length;
}

console.log(
  `\nBackfill complete.` +
  `\n  Linked: ${linkedCount} card↔KC pairs` +
  `\n  Across: ${morphCards.length} cards` +
  `\n  Lemma KCs created: ${lemmaKCsCreated}`,
);

// Quick sanity check
const totalJunction = sqlite.prepare("SELECT COUNT(*) as c FROM card_knowledge_components").get() as { c: number };
console.log(`  Total rows in card_knowledge_components: ${totalJunction.c}`);
