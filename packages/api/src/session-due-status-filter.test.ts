/**
 * /session/due — notes.status filter
 *
 * Regression test for db8805e: cards belonging to flagged (or draft/rejected)
 * notes must NOT be served by GET /session/due.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { createDb } from "@rzyns/strus-db";
import { notes, cards } from "@rzyns/strus-db";
import { call } from "@orpc/server";
import { router } from "./router.js";

// ---------------------------------------------------------------------------
// Test DB — fresh in-memory instance per test
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../db/migrations");

// The module-level `db` singleton in router.ts is backed by STRUS_DB_PATH which
// is set to ":memory:" by test-setup.ts.  We import it directly so we can seed
// data that the router's handlers will see.
import { db } from "@rzyns/strus-db";

// Run migrations once (idempotent — subsequent beforeEach won't re-run).
migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAST = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago (due for review)
const NOW = new Date();

function makeNote(status: "approved" | "draft" | "flagged" | "rejected"): string {
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
    status,
    generationMeta: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function makeCard(noteId: string): string {
  const id = randomUUID();
  db.insert(cards).values({
    id,
    noteId,
    kind: "cloze_fill",
    tag: null,
    gapId: null,
    state: 2,       // Review state — definitely eligible
    due: PAST,      // Due in the past
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

describe("/session/due — notes.status filter", () => {
  test("approved note: card IS served", async () => {
    const noteId = makeNote("approved");
    makeCard(noteId);

    const result = await call(router.session.due, { limit: 100, newLimit: 20 });
    const served = result.find((c) => c.noteId === noteId);
    expect(served).toBeDefined();
  });

  test("flagged note: card is NOT served", async () => {
    // Simulate the reported scenario:
    // 1. Note starts as approved (card created and eligible)
    // 2. Reviewer flags the note
    // 3. /session/due should no longer serve cards for that note
    const noteId = makeNote("approved");
    makeCard(noteId);

    // Confirm card is visible before flagging
    const before = await call(router.session.due, { limit: 100, newLimit: 20 });
    const visibleBefore = before.some((c) => c.noteId === noteId);
    expect(visibleBefore).toBe(true);

    // Flag the note (simulates what POST /notes/review with action:'flag' does)
    db.update(notes).set({ status: "flagged", updatedAt: new Date() }).where(eq(notes.id, noteId)).run();

    // Card should no longer be served
    const after = await call(router.session.due, { limit: 100, newLimit: 20 });
    const visibleAfter = after.some((c) => c.noteId === noteId);
    expect(visibleAfter).toBe(false);
  });

  test("draft note: card is NOT served", async () => {
    const noteId = makeNote("draft");
    makeCard(noteId);

    const result = await call(router.session.due, { limit: 100, newLimit: 20 });
    const served = result.some((c) => c.noteId === noteId);
    expect(served).toBe(false);
  });

  test("rejected note: card is NOT served", async () => {
    const noteId = makeNote("rejected");
    makeCard(noteId);

    const result = await call(router.session.due, { limit: 100, newLimit: 20 });
    const served = result.some((c) => c.noteId === noteId);
    expect(served).toBe(false);
  });
});
