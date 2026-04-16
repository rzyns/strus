/**
 * /session/due + /session/targeted — KC-driven session composition
 *
 * STR-21 regression coverage:
 * - the most-overdue structural KC becomes today's focus for due sessions
 * - targeted sessions can explicitly filter by kcId
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { call } from "@orpc/server";
import { db } from "@rzyns/strus-db";
import {
  cards,
  notes,
  knowledgeComponents,
  cardKnowledgeComponents,
  createInitialKnowledgeComponentFsrsState,
  vocabLists,
  vocabListNotes,
} from "@rzyns/strus-db";
import { router } from "./router.js";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../db/migrations");
migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

const NOW = new Date();
const NOW_SECS = Math.floor(Date.now() / 1000);
const CARD_PAST_DUE = NOW_SECS - 3600;

function makeNote(status: "approved" | "draft" | "flagged" | "rejected" = "approved"): string {
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

function makeCard(noteId: string, due = CARD_PAST_DUE): string {
  const id = randomUUID();
  db.insert(cards).values({
    id,
    noteId,
    kind: "cloze_fill",
    tag: null,
    gapId: null,
    state: 2,
    due,
    stability: 10,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 1,
    reps: 3,
    lapses: 0,
    learningSteps: 0,
    lastReview: due - 86400,
  }).run();
  return id;
}

function makeKC(opts: {
  kind?: "case" | "number" | "tense" | "mood" | "gender" | "pos" | "lemma";
  label: string;
  due: number;
  stability?: number;
}): string {
  const id = randomUUID();
  const fsrs = createInitialKnowledgeComponentFsrsState();
  db.insert(knowledgeComponents).values({
    id,
    kind: opts.kind ?? "case",
    label: opts.label,
    labelPl: null,
    tagPattern: "*:gen:*",
    lemmaId: null,
    ...fsrs,
    due: opts.due,
    stability: opts.stability ?? fsrs.stability,
    createdAt: NOW,
  }).run();
  return id;
}

function linkCardToKC(cardId: string, kcId: string): void {
  db.insert(cardKnowledgeComponents).values({ cardId, kcId }).run();
}

function makeList(): string {
  const id = randomUUID();
  db.insert(vocabLists).values({
    id,
    name: `kc-priority-${id}`,
    description: null,
    createdAt: NOW,
  }).run();
  return id;
}

function addNoteToList(listId: string, noteId: string): void {
  db.insert(vocabListNotes).values({ listId, noteId }).run();
}

describe("/session/due — KC focus priority", () => {
  test("cards linked to the most-overdue structural KC are served first", async () => {
    const listId = makeList();

    const mostOverdueNoteId = makeNote("approved");
    addNoteToList(listId, mostOverdueNoteId);
    const mostOverdueCardId = makeCard(mostOverdueNoteId);

    const lessOverdueNoteId = makeNote("approved");
    addNoteToList(listId, lessOverdueNoteId);
    const lessOverdueCardId = makeCard(lessOverdueNoteId);

    const mostOverdueKcId = makeKC({
      kind: "case",
      label: `focus-case-${randomUUID()}`,
      due: NOW_SECS - 7 * 86400,
      stability: 12,
    });
    const lessOverdueKcId = makeKC({
      kind: "case",
      label: `secondary-case-${randomUUID()}`,
      due: NOW_SECS - 3600,
      stability: 1,
    });

    linkCardToKC(mostOverdueCardId, mostOverdueKcId);
    linkCardToKC(lessOverdueCardId, lessOverdueKcId);

    const result = await call(router.session.due, {
      listId,
      limit: 1,
      newLimit: 0,
      interleave: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(mostOverdueCardId);
    expect(result[0]!.id).not.toBe(lessOverdueCardId);
  });
});

describe("/session/targeted — kcId filter", () => {
  test("kcId filter returns only cards linked to that knowledge component", async () => {
    const targetNoteId = makeNote("approved");
    const targetCardId = makeCard(targetNoteId);

    const otherNoteId = makeNote("approved");
    const otherCardId = makeCard(otherNoteId);

    const unlinkedNoteId = makeNote("approved");
    const unlinkedCardId = makeCard(unlinkedNoteId);

    const targetKcId = makeKC({
      kind: "case",
      label: `target-kc-${randomUUID()}`,
      due: NOW_SECS - 86400,
    });
    const otherKcId = makeKC({
      kind: "case",
      label: `other-kc-${randomUUID()}`,
      due: NOW_SECS - 86400,
    });

    linkCardToKC(targetCardId, targetKcId);
    linkCardToKC(otherCardId, otherKcId);

    const result = await call(router.session.targeted, {
      kcId: targetKcId,
      limit: 100,
      newLimit: 0,
    });

    expect(result.some((card) => card.id === targetCardId)).toBe(true);
    expect(result.some((card) => card.id === otherCardId)).toBe(false);
    expect(result.some((card) => card.id === unlinkedCardId)).toBe(false);
  });
});
