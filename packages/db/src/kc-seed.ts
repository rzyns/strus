/**
 * Shared KC seed logic — usable by both the standalone seed script
 * and the API endpoint.
 *
 * Exports:
 *   KC_SEEDS — the 26 structural KC definitions
 *   seedKCs(db) — insert missing KCs, returns { created, skipped }
 */
import { eq } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { createInitialKnowledgeComponentFsrsState } from "./kc-fsrs.js";
import { knowledgeComponents } from "./schema.js";

// ---------------------------------------------------------------------------
// Seed definitions
// ---------------------------------------------------------------------------

export interface KCSeed {
  id: string;
  kind: "case" | "number" | "tense" | "mood" | "gender" | "pos" | "lemma";
  label: string;
  labelPl: string;
  tagPattern: string;
}

export const KC_SEEDS: KCSeed[] = [
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
  { id: "kc-gen-m1", kind: "gender", label: "masculine personal",   labelPl: "męskoosobowy",    tagPattern: "m1" },
  { id: "kc-gen-m2", kind: "gender", label: "masculine animate",    labelPl: "męskożywotny",    tagPattern: "m2" },
  { id: "kc-gen-m3", kind: "gender", label: "masculine inanimate",  labelPl: "męskorzeczowy",   tagPattern: "m3" },
  { id: "kc-gen-f",  kind: "gender", label: "feminine",             labelPl: "żeński",          tagPattern: "f"  },
  { id: "kc-gen-n",  kind: "gender", label: "neuter",               labelPl: "nijaki",          tagPattern: "n"  },

  // ── Tenses ─────────────────────────────────────────────────────────────────
  { id: "kc-tense-pres", kind: "tense", label: "present", labelPl: "czas teraźniejszy", tagPattern: "fin:*" },
  { id: "kc-tense-past", kind: "tense", label: "past",    labelPl: "czas przeszły",     tagPattern: "praet:*" },
  { id: "kc-tense-fut",  kind: "tense", label: "future",  labelPl: "czas przyszły",     tagPattern: "bedzie:*" },

  // ── Moods ──────────────────────────────────────────────────────────────────
  { id: "kc-mood-ind",  kind: "mood", label: "indicative",  labelPl: "tryb oznajmujący",     tagPattern: "fin:*" },
  { id: "kc-mood-imp",  kind: "mood", label: "imperative",  labelPl: "tryb rozkazujący",     tagPattern: "impt:*" },
  { id: "kc-mood-cond", kind: "mood", label: "conditional", labelPl: "tryb przypuszczający", tagPattern: "cond:*" },

  // ── POS categories ─────────────────────────────────────────────────────────
  { id: "kc-pos-noun", kind: "pos", label: "noun",      labelPl: "rzeczownik", tagPattern: "subst:*" },
  {
    id: "kc-pos-verb",
    kind: "pos",
    label: "verb",
    labelPl: "czasownik",
    tagPattern: "fin,praet,bedzie,impt,cond,imps,inf,pcon,pant,pact,ppas,ger,winien",
  },
  { id: "kc-pos-adj",        kind: "pos", label: "adjective", labelPl: "przymiotnik", tagPattern: "adj:*" },
  { id: "kc-pos-adv",        kind: "pos", label: "adverb",    labelPl: "przysłówek",  tagPattern: "adv:*" },
  { id: "kc-pos-num",        kind: "pos", label: "numeral",   labelPl: "liczebnik",   tagPattern: "num:*" },
  {
    id: "kc-pos-participle",
    kind: "pos",
    label: "participle",
    labelPl: "imiesłów",
    tagPattern: "pcon,pant,pact,ppas",
  },
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

export interface SeedKCsResult {
  created: number;
  skipped: number;
}

/**
 * Insert all structural KCs that don't already exist.
 * Idempotent — safe to call multiple times.
 */
export function seedKCs(db: DbClient): SeedKCsResult {
  let created = 0;
  let skipped = 0;
  const now = new Date();

  for (const seed of KC_SEEDS) {
    const existing = db
      .select({ id: knowledgeComponents.id })
      .from(knowledgeComponents)
      .where(eq(knowledgeComponents.id, seed.id))
      .get();

    if (existing) {
      skipped++;
      continue;
    }

    const fsrs = createInitialKnowledgeComponentFsrsState();
    db.insert(knowledgeComponents).values({
      id: seed.id,
      kind: seed.kind,
      label: seed.label,
      labelPl: seed.labelPl,
      tagPattern: seed.tagPattern,
      lemmaId: null,
      ...fsrs,
      createdAt: now,
    }).run();

    created++;
  }

  return { created, skipped };
}
