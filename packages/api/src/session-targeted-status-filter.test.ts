/**
 * /session/targeted — notes.status filter + kinds/conceptId filters
 *
 * Regression test: cards belonging to non-approved notes must NOT be served
 * by POST /session/targeted. Also covers the `kinds` and `conceptId` filters.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { notes, cards, grammarConcepts } from "@rzyns/strus-db";
import { call } from "@orpc/server";
import { router } from "./router.js";

// ---------------------------------------------------------------------------
// Test DB — shares the module-level singleton seeded by test-setup.ts
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../db/migrations");

// The module-level `db` singleton in router.ts is backed by STRUS_DB_PATH which
// is set to ":memory:" by test-setup.ts. We import it directly so we can seed
// data that the router's handlers will see.
import { db } from "@rzyns/strus-db";

// Run migrations once (idempotent — subsequent calls are no-ops).
migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAST = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago (due for review)
const NOW = new Date();

function makeNote(
  status: "approved" | "draft" | "flagged" | "rejected",
  conceptId: string | null = null,
): string {
  const id = randomUUID();
  db.insert(notes).values({
    id,
    kind: "cloze",
    lemmaId: null,
    front: null,
    back: null,
    sentenceId: null,
    conceptId,
    clusterId: null,
    explanation: null,
    status,
    generationMeta: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function makeCard(
  noteId: string,
  kind: "cloze_fill" | "morph_form" = "cloze_fill",
): string {
  const id = randomUUID();
  db.insert(cards).values({
    id,
    noteId,
    kind,
    tag: null,
    gapId: null,
    state: 2,            // Review state — definitely eligible
    due: PAST,           // Due in the past
    stability: 10,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 1,
    reps: 3,
    lapses: 0,
    learningSteps: 0,
    lastReview: PAST - 86400,
  }).run();
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/session/targeted — notes.status filter", () => {
  test("approved note: card IS returned", async () => {
    const noteId = makeNote("approved");
    makeCard(noteId);

    const result = await call(router.session.targeted, { limit: 100, newLimit: 20 });
    const served = result.find((c) => c.noteId === noteId);
    expect(served).toBeDefined();
  });

  test("draft note: card is NOT returned", async () => {
    const noteId = makeNote("draft");
    makeCard(noteId);

    const result = await call(router.session.targeted, { limit: 100, newLimit: 20 });
    const served = result.some((c) => c.noteId === noteId);
    expect(served).toBe(false);
  });

  test("flagged note: card is NOT returned", async () => {
    const noteId = makeNote("flagged");
    makeCard(noteId);

    const result = await call(router.session.targeted, { limit: 100, newLimit: 20 });
    const served = result.some((c) => c.noteId === noteId);
    expect(served).toBe(false);
  });

  test("rejected note: card is NOT returned", async () => {
    const noteId = makeNote("rejected");
    makeCard(noteId);

    const result = await call(router.session.targeted, { limit: 100, newLimit: 20 });
    const served = result.some((c) => c.noteId === noteId);
    expect(served).toBe(false);
  });
});

describe("/session/targeted — kinds filter", () => {
  test("kinds=['cloze_fill'] returns cloze_fill cards and excludes morph_form cards", async () => {
    const clozeNoteId = makeNote("approved");
    const clozeCardId = makeCard(clozeNoteId, "cloze_fill");

    const morphNoteId = makeNote("approved");
    const morphCardId = makeCard(morphNoteId, "morph_form");

    const result = await call(router.session.targeted, {
      kinds: ["cloze_fill"],
      limit: 100,
      newLimit: 20,
    });

    const clozeServed = result.some((c) => c.id === clozeCardId);
    const morphServed = result.some((c) => c.id === morphCardId);

    expect(clozeServed).toBe(true);
    expect(morphServed).toBe(false);
  });
});

function makeConcept(): string {
  const id = randomUUID();
  db.insert(grammarConcepts).values({
    id,
    name: `test-concept-${id}`,
    description: null,
    parentId: null,
    createdAt: NOW,
  }).run();
  return id;
}

describe("/session/targeted — conceptId filter", () => {
  test("conceptId filter returns only cards from notes with that concept_id", async () => {
    const targetConcept = makeConcept();

    const matchingNoteId = makeNote("approved", targetConcept);
    const matchingCardId = makeCard(matchingNoteId);

    const otherNoteId = makeNote("approved", makeConcept());
    const otherCardId = makeCard(otherNoteId);

    const noConceptNoteId = makeNote("approved", null);
    const noConceptCardId = makeCard(noConceptNoteId);

    const result = await call(router.session.targeted, {
      conceptId: targetConcept,
      limit: 100,
      newLimit: 20,
    });

    const matchingServed = result.some((c) => c.id === matchingCardId);
    const otherServed = result.some((c) => c.id === otherCardId);
    const noConceptServed = result.some((c) => c.id === noConceptCardId);

    expect(matchingServed).toBe(true);
    expect(otherServed).toBe(false);
    expect(noConceptServed).toBe(false);
  });
});
