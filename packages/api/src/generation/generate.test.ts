import { describe, test, expect, beforeEach } from "bun:test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { createDb } from "@strus/db";
import { notes, cards, clozeGaps } from "@strus/db";
import { createCardsForNote } from "./generate.js";

// ---------------------------------------------------------------------------
// In-memory DB setup
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../db/migrations");

function createTestDb() {
  const db = createDb(":memory:");
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-01-15T12:00:00.000Z");

function insertClozeNote(db: ReturnType<typeof createTestDb>, id: string) {
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
}

function insertChoiceNote(db: ReturnType<typeof createTestDb>, id: string) {
  db.insert(notes).values({
    id,
    kind: "choice",
    lemmaId: null,
    front: "Jak powiedzieć 'house' po polsku?",
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
}

function insertGap(
  db: ReturnType<typeof createTestDb>,
  noteId: string,
  gapIndex: number,
): string {
  const gapId = randomUUID();
  db.insert(clozeGaps).values({
    id: gapId,
    noteId,
    gapIndex,
    correctAnswers: JSON.stringify(["idzie"]),
    hint: null,
    conceptId: null,
    difficulty: 2,
    explanation: "Verb conjugation for 3rd person singular",
    createdAt: NOW,
  }).run();
  return gapId;
}

// ---------------------------------------------------------------------------
// createCardsForNote — cloze
// ---------------------------------------------------------------------------

describe("createCardsForNote — cloze notes", () => {
  test("creates one cloze_fill card per gap", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertClozeNote(db, noteId);

    const gapId1 = insertGap(db, noteId, 1);
    const gapId2 = insertGap(db, noteId, 2);

    const count = await createCardsForNote(db, { id: noteId, kind: "cloze" }, [
      { id: gapId1 },
      { id: gapId2 },
    ]);

    expect(count).toBe(2);

    const created = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.kind === "cloze_fill")).toBe(true);
  });

  test("each card references its gap via gapId", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertClozeNote(db, noteId);

    const gapId = insertGap(db, noteId, 1);

    await createCardsForNote(db, { id: noteId, kind: "cloze" }, [{ id: gapId }]);

    const created = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(created).toHaveLength(1);
    expect(created[0]?.gapId).toBe(gapId);
  });

  test("fetches gaps from DB when not provided explicitly", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertClozeNote(db, noteId);

    // Insert gaps directly, don't pass them to createCardsForNote
    insertGap(db, noteId, 1);
    insertGap(db, noteId, 2);

    const count = await createCardsForNote(db, { id: noteId, kind: "cloze" });

    expect(count).toBe(2);
    const created = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(created).toHaveLength(2);
  });

  test("is idempotent — second call returns 0, card count stays the same", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertClozeNote(db, noteId);

    const gapId1 = insertGap(db, noteId, 1);
    const gapId2 = insertGap(db, noteId, 2);
    const gaps = [{ id: gapId1 }, { id: gapId2 }];

    await createCardsForNote(db, { id: noteId, kind: "cloze" }, gaps);
    const second = await createCardsForNote(db, { id: noteId, kind: "cloze" }, gaps);

    expect(second).toBe(0);

    // Still exactly 2 cards — no duplicates
    const all = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(all).toHaveLength(2);
  });

  test("creates cards in state=New with correct defaults", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertClozeNote(db, noteId);

    const gapId = insertGap(db, noteId, 1);
    await createCardsForNote(db, { id: noteId, kind: "cloze" }, [{ id: gapId }]);

    const [card] = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(card).toBeDefined();
    expect(card!.state).toBe(0); // CardState.New
    expect(card!.reps).toBe(0);
    expect(card!.lapses).toBe(0);
    expect(card!.lastReview).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createCardsForNote — choice notes
// ---------------------------------------------------------------------------

describe("createCardsForNote — choice notes", () => {
  test("creates exactly one multiple_choice card", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertChoiceNote(db, noteId);

    const count = await createCardsForNote(db, { id: noteId, kind: "choice" });

    expect(count).toBe(1);

    const created = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe("multiple_choice");
  });

  test("is idempotent — second call for choice note returns 0", async () => {
    const db = createTestDb();
    const noteId = randomUUID();
    insertChoiceNote(db, noteId);

    await createCardsForNote(db, { id: noteId, kind: "choice" });
    const second = await createCardsForNote(db, { id: noteId, kind: "choice" });

    expect(second).toBe(0);
    const all = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(all).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createCardsForNote — other note kinds
// ---------------------------------------------------------------------------

describe("createCardsForNote — error and classifier notes", () => {
  test("creates one error_correction card for 'error' kind", async () => {
    const db = createTestDb();
    const noteId = randomUUID();

    db.insert(notes).values({
      id: noteId,
      kind: "error",
      lemmaId: null,
      front: "Ja jesteś student.",
      back: "Ja jestem studentem.",
      sentenceId: null,
      conceptId: null,
      clusterId: null,
      explanation: null,
      status: "approved",
      generationMeta: null,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    const count = await createCardsForNote(db, { id: noteId, kind: "error" });
    expect(count).toBe(1);

    const [card] = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(card?.kind).toBe("error_correction");
  });

  test("creates one classify card for 'classifier' kind", async () => {
    const db = createTestDb();
    const noteId = randomUUID();

    db.insert(notes).values({
      id: noteId,
      kind: "classifier",
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

    const count = await createCardsForNote(db, { id: noteId, kind: "classifier" });
    expect(count).toBe(1);

    const [card] = db.select().from(cards).where(eq(cards.noteId, noteId)).all();
    expect(card?.kind).toBe("classify");
  });

  test("returns 0 for unknown note kinds (no cards created)", async () => {
    const db = createTestDb();
    const noteId = randomUUID();

    db.insert(notes).values({
      id: noteId,
      kind: "basic",
      lemmaId: null,
      front: "dom",
      back: "house",
      sentenceId: null,
      conceptId: null,
      clusterId: null,
      explanation: null,
      status: "approved",
      generationMeta: null,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    // 'basic' kind is not handled by createCardsForNote
    const count = await createCardsForNote(db, { id: noteId, kind: "basic" });
    expect(count).toBe(0);
  });
});
