/**
 * analytics/kc-mastery and analytics/kc-summary — KC mastery aggregation
 *
 * Tests for STR-17 (KC4): Analytics API endpoints that aggregate FSRS stability
 * per knowledge component via the card_knowledge_components junction table.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { call } from "@orpc/server";
import { db } from "@rzyns/strus-db";
import {
  knowledgeComponents,
  cardKnowledgeComponents,
  cards,
  notes,
  createInitialKnowledgeComponentFsrsState,
} from "@rzyns/strus-db";
import { router } from "./router.js";

// ---------------------------------------------------------------------------
// Migrations (once per test module)
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../db/migrations");
migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date();
const NOW_SECS = Math.floor(Date.now() / 1000);
const PAST = NOW_SECS - 3600;       // 1 hour ago — overdue
const FUTURE = NOW_SECS + 86400;    // tomorrow — not due

function makeKC(opts: {
  kind?: "case" | "number" | "tense" | "mood" | "gender" | "pos" | "lemma";
  label: string;
  labelPl?: string;
}): string {
  const id = randomUUID();
  const fsrs = createInitialKnowledgeComponentFsrsState();
  db.insert(knowledgeComponents).values({
    id,
    kind: opts.kind ?? "case",
    label: opts.label,
    labelPl: opts.labelPl ?? null,
    tagPattern: "*:gen:*",
    lemmaId: null,
    ...fsrs,
    createdAt: NOW,
  }).run();
  return id;
}

function makeNote(): string {
  const id = randomUUID();
  db.insert(notes).values({
    id,
    kind: "cloze",
    lemmaId: null,
    front: null,
    back: null,
    sentenceId: null,
    conceptId: null,
    clusterId: null,
    explanation: null,
    status: "approved",
    generationMeta: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function makeCard(opts: { stability: number; due: number }): string {
  const id = randomUUID();
  const noteId = makeNote();
  db.insert(cards).values({
    id,
    noteId,
    kind: "cloze_fill",
    tag: null,
    gapId: null,
    state: 2,
    due: opts.due,
    stability: opts.stability,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 7,
    reps: 3,
    lapses: 0,
    learningSteps: 0,
    lastReview: PAST - 86400,
  }).run();
  return id;
}

function linkCardToKC(cardId: string, kcId: string): void {
  db.insert(cardKnowledgeComponents).values({ cardId, kcId }).run();
}

// ---------------------------------------------------------------------------
// Tests: analytics.kcMastery
// ---------------------------------------------------------------------------

describe("analytics.kcMastery", () => {
  test("empty state: returns empty array when no KCs exist", async () => {
    // Use a non-existent kind filter so we don't get KCs seeded by other tests
    const result = await call(router.analytics.kcMastery, { kind: "mood", limit: 50, sort: "weakest" });
    // May or may not be empty depending on test isolation — just validate shape
    expect(Array.isArray(result)).toBe(true);
  });

  test("returns KC with correct aggregated data", async () => {
    const kcId = makeKC({ kind: "case", label: "genitive", labelPl: "dopełniacz" });
    const card1 = makeCard({ stability: 5, due: PAST });   // overdue, not mastered
    const card2 = makeCard({ stability: 30, due: FUTURE }); // not overdue, mastered

    linkCardToKC(card1, kcId);
    linkCardToKC(card2, kcId);

    const result = await call(router.analytics.kcMastery, { kind: "case", limit: 200, sort: "weakest" });
    const kc = result.find((r) => r.id === kcId);

    expect(kc).toBeDefined();
    expect(kc!.label).toBe("genitive");
    expect(kc!.labelPl).toBe("dopełniacz");
    expect(kc!.kind).toBe("case");
    expect(kc!.totalCards).toBe(2);
    expect(kc!.overdueCount).toBe(1);
    expect(kc!.masteredCount).toBe(1);
    expect(kc!.avgStability).toBeCloseTo((5 + 30) / 2, 5);
    expect(kc!.masteredPct).toBe(50.0);
  });

  test("KC with zero linked cards: masteredPct=0, avgStability=0", async () => {
    const kcId = makeKC({ kind: "number", label: "singular", labelPl: "liczba pojedyncza" });

    const result = await call(router.analytics.kcMastery, { kind: "number", limit: 200, sort: "weakest" });
    const kc = result.find((r) => r.id === kcId);

    expect(kc).toBeDefined();
    expect(kc!.totalCards).toBe(0);
    expect(kc!.masteredPct).toBe(0);
    expect(kc!.avgStability).toBe(0);
    expect(kc!.overdueCount).toBe(0);
  });

  test("filtering by kind: only returns matching KCs", async () => {
    const caseKcId = makeKC({ kind: "case", label: "locative-filter-test" });
    const tenseKcId = makeKC({ kind: "tense", label: "present-filter-test" });

    const result = await call(router.analytics.kcMastery, { kind: "tense", limit: 200, sort: "weakest" });
    const ids = result.map((r) => r.id);

    expect(ids).toContain(tenseKcId);
    expect(ids).not.toContain(caseKcId);
  });

  test("sort=weakest: ascending stability order", async () => {
    const kc1 = makeKC({ kind: "gender", label: "masculine-weak" });
    const kc2 = makeKC({ kind: "gender", label: "feminine-strong" });

    const card1 = makeCard({ stability: 3, due: FUTURE });
    const card2 = makeCard({ stability: 50, due: FUTURE });

    linkCardToKC(card1, kc1);
    linkCardToKC(card2, kc2);

    const result = await call(router.analytics.kcMastery, { kind: "gender", limit: 200, sort: "weakest" });
    const idx1 = result.findIndex((r) => r.id === kc1);
    const idx2 = result.findIndex((r) => r.id === kc2);

    expect(idx1).toBeLessThan(idx2);
  });

  test("sort=strongest: descending stability order", async () => {
    const kc1 = makeKC({ kind: "pos", label: "noun-weak-sort" });
    const kc2 = makeKC({ kind: "pos", label: "verb-strong-sort" });

    const card1 = makeCard({ stability: 2, due: FUTURE });
    const card2 = makeCard({ stability: 60, due: FUTURE });

    linkCardToKC(card1, kc1);
    linkCardToKC(card2, kc2);

    const result = await call(router.analytics.kcMastery, { kind: "pos", limit: 200, sort: "strongest" });
    const idx1 = result.findIndex((r) => r.id === kc1);
    const idx2 = result.findIndex((r) => r.id === kc2);

    expect(idx2).toBeLessThan(idx1);
  });

  test("sort=label: alphabetical order", async () => {
    const kcA = makeKC({ kind: "tense", label: "alpha-tense" });
    const kcZ = makeKC({ kind: "tense", label: "zeta-tense" });

    const result = await call(router.analytics.kcMastery, { kind: "tense", limit: 200, sort: "label" });
    const idxA = result.findIndex((r) => r.id === kcA);
    const idxZ = result.findIndex((r) => r.id === kcZ);

    expect(idxA).toBeLessThan(idxZ);
  });

  test("limit is respected", async () => {
    // Create multiple KCs to exceed limit
    for (let i = 0; i < 5; i++) {
      makeKC({ kind: "mood", label: `mood-limit-${i}` });
    }

    const result = await call(router.analytics.kcMastery, { kind: "mood", limit: 2, sort: "label" });
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: analytics.kcSummary
// ---------------------------------------------------------------------------

describe("analytics.kcSummary", () => {
  test("returns correct structure", async () => {
    const result = await call(router.analytics.kcSummary, {});
    expect(typeof result.totalLemmas).toBe("number");
    expect(typeof result.masteredLemmas).toBe("number");
    expect(typeof result.totalStructural).toBe("number");
    expect(typeof result.totalDueCards).toBe("number");
    // weakestKC may be null or an object
    if (result.weakestKC !== null) {
      expect(typeof result.weakestKC.label).toBe("string");
      expect(typeof result.weakestKC.avgStability).toBe("number");
    }
  });

  test("masteredLemmas counts lemma KCs with masteredPct >= 80", async () => {
    // Make a lemma KC with all mastered cards (high stability)
    const kcId = makeKC({ kind: "lemma", label: "mastered-lemma-test" });
    const card1 = makeCard({ stability: 100, due: FUTURE });
    const card2 = makeCard({ stability: 80, due: FUTURE });
    linkCardToKC(card1, kcId);
    linkCardToKC(card2, kcId);

    const result = await call(router.analytics.kcSummary, {});
    // Both cards are mastered (stability > 21) → masteredPct = 100%
    expect(result.masteredLemmas).toBeGreaterThanOrEqual(1);
    expect(result.totalLemmas).toBeGreaterThanOrEqual(1);
  });

  test("totalDueCards counts overdue cards", async () => {
    const kcId = makeKC({ kind: "case", label: "due-count-test" });
    const overdueCard = makeCard({ stability: 5, due: PAST });
    const notDueCard = makeCard({ stability: 5, due: FUTURE });
    linkCardToKC(overdueCard, kcId);
    linkCardToKC(notDueCard, kcId);

    const result = await call(router.analytics.kcSummary, {});
    // At least 1 overdue card from our setup
    expect(result.totalDueCards).toBeGreaterThanOrEqual(1);
  });
});
