#!/usr/bin/env bun
/**
 * Seed script: initial grammar_concepts taxonomy.
 * Run once: STRUS_DB_PATH=/path/to/strus.db bun run packages/db/seeds/grammar-concepts.ts
 * Idempotent: skips insert if a concept with the same name+parentId already exists.
 */
import Database from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { grammarConcepts } from "../src/schema.js";
import { eq, and, isNull } from "drizzle-orm";

const dbPath = process.env.STRUS_DB_PATH;
if (!dbPath) {
  console.error("STRUS_DB_PATH required");
  process.exit(1);
}

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema: { grammarConcepts } });

async function upsertConcept(
  name: string,
  description: string | null,
  parentId: string | null,
): Promise<string> {
  const existing = db
    .select({ id: grammarConcepts.id })
    .from(grammarConcepts)
    .where(
      parentId
        ? and(eq(grammarConcepts.name, name), eq(grammarConcepts.parentId, parentId))
        : and(eq(grammarConcepts.name, name), isNull(grammarConcepts.parentId)),
    )
    .get();
  if (existing) {
    console.log(`  skip: ${name}`);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.insert(grammarConcepts)
    .values({ id, name, description, parentId, createdAt: new Date() })
    .run();
  console.log(`  + ${name}`);
  return id;
}

console.log("Seeding grammar_concepts...");

// ---------------------------------------------------------------------------
// Reflexivity
// ---------------------------------------------------------------------------
const reflexivity = await upsertConcept("Reflexivity", "Uses and types of się", null);
await upsertConcept("True Reflexive", "się refers back to subject (myć się)", reflexivity);
await upsertConcept("Lexical/Inherent", "Obligatory się, no non-się form (bać się, śmiać się)", reflexivity);
await upsertConcept("Reciprocal", "Mutual action between subjects (kochać się, spotykać się)", reflexivity);
await upsertConcept("Anticausative", "Spontaneous event, no agent (drzwi się otworzyły)", reflexivity);
await upsertConcept("Impersonal/Passive", "Impersonal or passive usage (mówi się, je się)", reflexivity);

// ---------------------------------------------------------------------------
// Verbs of Motion
// ---------------------------------------------------------------------------
const vom = await upsertConcept("Verbs of Motion", "Polish motion verb system", null);
await upsertConcept("Determinate VoM", "Unidirectional, ongoing (iść, jechać, lecieć)", vom);
await upsertConcept("Indeterminate VoM", "Habitual or multidirectional (chodzić, jeździć, latać)", vom);
await upsertConcept("Prefixed VoM", "Motion verb with directional prefix (pójść, przyjechać, wylecieć)", vom);

// ---------------------------------------------------------------------------
// Aspect
// ---------------------------------------------------------------------------
const aspect = await upsertConcept("Aspect", "Imperfective vs perfective choice in context", null);
await upsertConcept("Imperfective in Context", "NSV chosen for ongoing, habitual, or background action", aspect);
await upsertConcept("Perfective in Context", "SV chosen for completed, resultative, or foregrounded action", aspect);

// ---------------------------------------------------------------------------
// Prefix Semantics
// ---------------------------------------------------------------------------
const prefix = await upsertConcept("Prefix Semantics", "Meaning shifts from verbal prefixes", null);
await upsertConcept("na-", "Completion, accumulation, or surfacing (napisać, nakryć)", prefix);
await upsertConcept("wy-", "Outward movement, extraction, completion (wypisać, wyjść)", prefix);
await upsertConcept("za-", "Initiation, coverage, or recording (zapisać, zamknąć, zaśpiewać)", prefix);
await upsertConcept("po-", "Distributive, brief, or slightly (porozmawiać, poczekać)", prefix);
await upsertConcept("prze-", "Through, across, or re- (przepisać, przejść, przerobić)", prefix);
await upsertConcept("od-", "Away from, back, or in return (odpisać, odejść)", prefix);
await upsertConcept("roz-", "Dispersal, unfolding, or intensification (rozbić, rozmawiać)", prefix);
await upsertConcept("do-", "Up to, completion, or addition (dopisać, dojść)", prefix);
await upsertConcept("u-", "Away, diminution, or result (uciąć, uciec, uśmiechnąć się)", prefix);

console.log("Done.");
