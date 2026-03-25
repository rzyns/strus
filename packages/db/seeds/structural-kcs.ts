#!/usr/bin/env bun
/**
 * Seed script: structural Knowledge Components (KC2).
 *
 * Creates the grammar-dimension KCs (case, number, gender, tense, mood, pos)
 * with deterministic IDs so re-running is idempotent.
 *
 * Run:
 *   STRUS_DB_PATH=/path/to/strus.db bun run packages/db/seeds/structural-kcs.ts
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { knowledgeComponents } from "../src/schema.js";
import { eq } from "drizzle-orm";

const dbPath = process.env.STRUS_DB_PATH;
if (!dbPath) {
  console.error("STRUS_DB_PATH required");
  process.exit(1);
}

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema: { knowledgeComponents } });

// ---------------------------------------------------------------------------
// Seed definitions
// ---------------------------------------------------------------------------

interface KCSeed {
  id: string;
  kind: string;
  label: string;
  labelPl: string;
  tagPattern: string;
}

const SEEDS: KCSeed[] = [
  // ── Cases ──────────────────────────────────────────────────────────────────
  { id: "kc-case-nom",  kind: "case", label: "nominative",    labelPl: "mianownik",    tagPattern: "*:nom:*" },
  { id: "kc-case-gen",  kind: "case", label: "genitive",      labelPl: "dopełniacz",   tagPattern: "*:gen:*" },
  { id: "kc-case-dat",  kind: "case", label: "dative",        labelPl: "celownik",     tagPattern: "*:dat:*" },
  { id: "kc-case-acc",  kind: "case", label: "accusative",    labelPl: "biernik",      tagPattern: "*:acc:*" },
  { id: "kc-case-inst", kind: "case", label: "instrumental",  labelPl: "narzędnik",    tagPattern: "*:inst:*" },
  { id: "kc-case-loc",  kind: "case", label: "locative",      labelPl: "miejscownik",  tagPattern: "*:loc:*" },
  { id: "kc-case-voc",  kind: "case", label: "vocative",      labelPl: "wołacz",       tagPattern: "*:voc:*" },

  // ── Numbers ────────────────────────────────────────────────────────────────
  { id: "kc-num-sg", kind: "number", label: "singular", labelPl: "liczba pojedyncza", tagPattern: "*:sg:*" },
  { id: "kc-num-pl", kind: "number", label: "plural",   labelPl: "liczba mnoga",      tagPattern: "*:pl:*" },

  // ── Genders ────────────────────────────────────────────────────────────────
  // tag_pattern is the bare gender token; matcher handles "any segment" logic for gender-kind
  { id: "kc-gen-m1", kind: "gender", label: "masculine personal",   labelPl: "męskoosobowy",    tagPattern: "m1" },
  { id: "kc-gen-m2", kind: "gender", label: "masculine animate",    labelPl: "męskożywotny",    tagPattern: "m2" },
  { id: "kc-gen-m3", kind: "gender", label: "masculine inanimate",  labelPl: "męskorzeczowy",   tagPattern: "m3" },
  { id: "kc-gen-f",  kind: "gender", label: "feminine",             labelPl: "żeński",          tagPattern: "f"  },
  { id: "kc-gen-n",  kind: "gender", label: "neuter",               labelPl: "nijaki",          tagPattern: "n"  },

  // ── Tenses ─────────────────────────────────────────────────────────────────
  // Polish tense is encoded in POS, not a feature
  { id: "kc-tense-pres", kind: "tense", label: "present", labelPl: "czas teraźniejszy", tagPattern: "fin:*" },
  { id: "kc-tense-past", kind: "tense", label: "past",    labelPl: "czas przeszły",     tagPattern: "praet:*" },
  { id: "kc-tense-fut",  kind: "tense", label: "future",  labelPl: "czas przyszły",     tagPattern: "bedzie:*" },

  // ── Moods ──────────────────────────────────────────────────────────────────
  // indicative (fin) intentionally overlaps with present tense — semantically correct
  { id: "kc-mood-ind",  kind: "mood", label: "indicative",  labelPl: "tryb oznajmujący",    tagPattern: "fin:*" },
  { id: "kc-mood-imp",  kind: "mood", label: "imperative",  labelPl: "tryb rozkazujący",    tagPattern: "impt:*" },
  { id: "kc-mood-cond", kind: "mood", label: "conditional", labelPl: "tryb przypuszczający", tagPattern: "cond:*" },

  // ── POS categories ─────────────────────────────────────────────────────────
  { id: "kc-pos-noun",       kind: "pos", label: "noun",        labelPl: "rzeczownik", tagPattern: "subst:*" },
  {
    id: "kc-pos-verb",
    kind: "pos",
    label: "verb",
    labelPl: "czasownik",
    // comma-separated list handled by matcher: checks if POS is in this list
    tagPattern: "fin,praet,bedzie,impt,cond,imps,inf,pcon,pant,pact,ppas,ger,winien",
  },
  { id: "kc-pos-adj",        kind: "pos", label: "adjective",   labelPl: "przymiotnik", tagPattern: "adj:*" },
  { id: "kc-pos-adv",        kind: "pos", label: "adverb",      labelPl: "przysłówek",  tagPattern: "adv:*" },
  { id: "kc-pos-num",        kind: "pos", label: "numeral",     labelPl: "liczebnik",   tagPattern: "num:*" },
  {
    id: "kc-pos-participle",
    kind: "pos",
    label: "participle",
    labelPl: "imiesłów",
    tagPattern: "pcon,pant,pact,ppas",
  },
];

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

let created = 0;
let skipped = 0;
const now = new Date();

for (const seed of SEEDS) {
  const existing = db
    .select({ id: knowledgeComponents.id })
    .from(knowledgeComponents)
    .where(eq(knowledgeComponents.id, seed.id))
    .get();

  if (existing) {
    skipped++;
    continue;
  }

  db.insert(knowledgeComponents).values({
    id: seed.id,
    kind: seed.kind as "case" | "number" | "tense" | "mood" | "gender" | "pos" | "lemma",
    label: seed.label,
    labelPl: seed.labelPl,
    tagPattern: seed.tagPattern,
    lemmaId: null,
    createdAt: now,
  }).run();

  console.log(`  + [${seed.kind}] ${seed.label} (${seed.id})`);
  created++;
}

console.log(`\nDone. Created: ${created}, already existed: ${skipped}.`);
