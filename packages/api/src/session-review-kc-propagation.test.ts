/**
 * /session/review — KC propagation
 *
 * STR-20 / KC7: reviewing a card should keep normal card FSRS behavior,
 * and also propagate the same rating to every linked parent KC.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { call } from "@orpc/server";
import {
  db,
  notes,
  cards,
  reviews,
  knowledgeComponents,
  cardKnowledgeComponents,
  createInitialKnowledgeComponentFsrsState,
  scheduleKnowledgeComponentReview,
} from "@rzyns/strus-db";
import { router } from "./router.js";
import { CardState, Rating, scheduleReview, type Card } from "@rzyns/strus-core";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../db/migrations");
migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

const NOW = new Date();
const NOW_SECS = Math.floor(Date.now() / 1000);
const PAST = NOW_SECS - 86400;

type SeededCard = {
  id: string;
  noteId: string;
  kind: Card["kind"];
  tag: string | null;
  gapId: string | null;
  state: CardState;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  lastReview: number | null;
};

type SeededKc = {
  id: string;
  kind: "case" | "number" | "tense" | "mood" | "gender" | "pos" | "lemma";
  label: string;
  labelPl: string | null;
  tagPattern: string | null;
  lemmaId: string | null;
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReview: number | null;
  createdAt: Date;
};

beforeEach(() => {
  db.delete(reviews).run();
  db.delete(cardKnowledgeComponents).run();
  db.delete(cards).run();
  db.delete(knowledgeComponents).run();
  db.delete(notes).run();
});

function makeNote(): string {
  const id = randomUUID();
  db.insert(notes).values({
    id,
    kind: "basic",
    lemmaId: null,
    front: "front",
    back: "back",
    lastReviewedAt: null,
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

function makeCard(overrides: Partial<SeededCard> = {}): SeededCard {
  const id = randomUUID();
  const noteId = makeNote();
  const row: SeededCard = {
    id,
    noteId,
    kind: "basic_forward",
    tag: null,
    gapId: null,
    state: CardState.Review,
    due: PAST,
    stability: 12,
    difficulty: 5.5,
    elapsedDays: 5,
    scheduledDays: 12,
    reps: 6,
    lapses: 1,
    learningSteps: 0,
    lastReview: PAST - 86400,
    ...overrides,
  };
  db.insert(cards).values(row).run();
  return row;
}

function toDomainCard(row: SeededCard): Card {
  return {
    id: row.id,
    noteId: row.noteId,
    kind: row.kind as Card["kind"],
    state: row.state as CardState,
    due: new Date(row.due * 1000),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learningSteps,
    ...(row.tag != null ? { tag: row.tag } : {}),
    ...(row.lastReview != null ? { lastReview: new Date(row.lastReview * 1000) } : {}),
  };
}

function makeKC(overrides: Partial<SeededKc> = {}): SeededKc {
  const id = randomUUID();
  const fsrs = createInitialKnowledgeComponentFsrsState();
  const row: SeededKc = {
    id,
    kind: "case",
    label: `kc-${id}`,
    labelPl: null,
    tagPattern: "*:gen:*",
    lemmaId: null,
    ...fsrs,
    createdAt: NOW,
    ...overrides,
  };
  db.insert(knowledgeComponents).values(row).run();
  return row;
}

function linkCardToKC(cardId: string, kcId: string): void {
  db.insert(cardKnowledgeComponents).values({ cardId, kcId }).run();
}

describe("/session/review — KC propagation", () => {
  test("card with no linked KCs still reviews normally", async () => {
    const cardRow = makeCard();
    const unrelatedKc = makeKC({
      state: CardState.Review,
      due: PAST,
      stability: 30,
      difficulty: 4.2,
      elapsedDays: 9,
      scheduledDays: 30,
      reps: 8,
      lapses: 0,
      lastReview: PAST - 86400,
    });

    const result = await call(router.session.review, { cardId: cardRow.id, rating: Rating.Good });
    const reviewedAt = new Date(result.updated.lastReview!);
    const expectedCard = scheduleReview(toDomainCard(cardRow), Rating.Good, reviewedAt);

    const [updatedCardRow] = db.select().from(cards).where(eq(cards.id, cardRow.id)).limit(1).all();
    const [reviewRow] = db.select().from(reviews).where(eq(reviews.id, result.reviewId)).limit(1).all();
    const [noteRow] = db.select().from(notes).where(eq(notes.id, cardRow.noteId)).limit(1).all();
    const [unchangedKcRow] = db.select().from(knowledgeComponents).where(eq(knowledgeComponents.id, unrelatedKc.id)).limit(1).all();

    expect(updatedCardRow).toBeDefined();
    expect(reviewRow).toBeDefined();
    expect(noteRow).toBeDefined();
    expect(unchangedKcRow).toBeDefined();
    const updatedCard = updatedCardRow!;
    const review = reviewRow!;
    const note = noteRow!;
    const unchangedKc = unchangedKcRow!;

    expect(updatedCard.state).toBe(expectedCard.state);
    expect(updatedCard.due).toBe(Math.floor(expectedCard.due.getTime() / 1000));
    expect(updatedCard.stability).toBe(expectedCard.stability);
    expect(updatedCard.difficulty).toBe(expectedCard.difficulty);
    expect(updatedCard.elapsedDays).toBe(expectedCard.elapsedDays);
    expect(updatedCard.scheduledDays).toBe(expectedCard.scheduledDays);
    expect(updatedCard.reps).toBe(expectedCard.reps);
    expect(updatedCard.lapses).toBe(expectedCard.lapses);
    expect(updatedCard.learningSteps).toBe(expectedCard.learningSteps);
    expect(updatedCard.lastReview).toBe(Math.floor(reviewedAt.getTime() / 1000));

    expect(review.cardId).toBe(cardRow.id);
    expect(review.rating).toBe(Rating.Good);
    expect(note.lastReviewedAt).toBe(Math.floor(reviewedAt.getTime() / 1000));

    expect(unchangedKc.state).toBe(unrelatedKc.state);
    expect(unchangedKc.due).toBe(unrelatedKc.due);
    expect(unchangedKc.stability).toBe(unrelatedKc.stability);
    expect(unchangedKc.difficulty).toBe(unrelatedKc.difficulty);
    expect(unchangedKc.elapsedDays).toBe(unrelatedKc.elapsedDays);
    expect(unchangedKc.scheduledDays).toBe(unrelatedKc.scheduledDays);
    expect(unchangedKc.reps).toBe(unrelatedKc.reps);
    expect(unchangedKc.lapses).toBe(unrelatedKc.lapses);
    expect(unchangedKc.lastReview).toBe(unrelatedKc.lastReview);
  });

  test("review propagates the same rating to every linked KC", async () => {
    const cardRow = makeCard({
      state: CardState.Review,
      due: PAST,
      stability: 20,
      difficulty: 4.8,
      elapsedDays: 7,
      scheduledDays: 20,
      reps: 10,
      lapses: 1,
      lastReview: PAST - 172800,
    });
    const kc1 = makeKC();
    const kc2 = makeKC({
      kind: "number",
      label: "singular",
      labelPl: "liczba pojedyncza",
      state: CardState.Review,
      due: PAST,
      stability: 18,
      difficulty: 5.1,
      elapsedDays: 6,
      scheduledDays: 18,
      reps: 7,
      lapses: 1,
      lastReview: PAST - 86400,
    });

    linkCardToKC(cardRow.id, kc1.id);
    linkCardToKC(cardRow.id, kc2.id);

    const result = await call(router.session.review, { cardId: cardRow.id, rating: Rating.Again });
    const reviewedAt = new Date(result.updated.lastReview!);
    const expectedCard = scheduleReview(toDomainCard(cardRow), Rating.Again, reviewedAt);
    const expectedKc1 = scheduleKnowledgeComponentReview({
      state: kc1.state,
      due: kc1.due,
      stability: kc1.stability,
      difficulty: kc1.difficulty,
      elapsedDays: kc1.elapsedDays,
      scheduledDays: kc1.scheduledDays,
      reps: kc1.reps,
      lapses: kc1.lapses,
      lastReview: kc1.lastReview,
    }, Rating.Again, reviewedAt);
    const expectedKc2 = scheduleKnowledgeComponentReview({
      state: kc2.state,
      due: kc2.due,
      stability: kc2.stability,
      difficulty: kc2.difficulty,
      elapsedDays: kc2.elapsedDays,
      scheduledDays: kc2.scheduledDays,
      reps: kc2.reps,
      lapses: kc2.lapses,
      lastReview: kc2.lastReview,
    }, Rating.Again, reviewedAt);

    const [updatedCardRow] = db.select().from(cards).where(eq(cards.id, cardRow.id)).limit(1).all();
    const [updatedKc1] = db.select().from(knowledgeComponents).where(eq(knowledgeComponents.id, kc1.id)).limit(1).all();
    const [updatedKc2] = db.select().from(knowledgeComponents).where(eq(knowledgeComponents.id, kc2.id)).limit(1).all();

    expect(updatedCardRow).toBeDefined();
    expect(updatedKc1).toBeDefined();
    expect(updatedKc2).toBeDefined();
    const updatedCard = updatedCardRow!;
    const persistedKc1 = updatedKc1!;
    const persistedKc2 = updatedKc2!;

    expect(updatedCard.state).toBe(expectedCard.state);
    expect(updatedCard.due).toBe(Math.floor(expectedCard.due.getTime() / 1000));
    expect(updatedCard.stability).toBe(expectedCard.stability);
    expect(updatedCard.difficulty).toBe(expectedCard.difficulty);
    expect(updatedCard.elapsedDays).toBe(expectedCard.elapsedDays);
    expect(updatedCard.scheduledDays).toBe(expectedCard.scheduledDays);
    expect(updatedCard.reps).toBe(expectedCard.reps);
    expect(updatedCard.lapses).toBe(expectedCard.lapses);
    expect(updatedCard.lastReview).toBe(Math.floor(reviewedAt.getTime() / 1000));

    expect(persistedKc1.state).toBe(expectedKc1.state);
    expect(persistedKc1.due).toBe(expectedKc1.due);
    expect(persistedKc1.stability).toBe(expectedKc1.stability);
    expect(persistedKc1.difficulty).toBe(expectedKc1.difficulty);
    expect(persistedKc1.elapsedDays).toBe(expectedKc1.elapsedDays);
    expect(persistedKc1.scheduledDays).toBe(expectedKc1.scheduledDays);
    expect(persistedKc1.reps).toBe(expectedKc1.reps);
    expect(persistedKc1.lapses).toBe(expectedKc1.lapses);
    expect(persistedKc1.lastReview).toBe(expectedKc1.lastReview);

    expect(persistedKc2.state).toBe(expectedKc2.state);
    expect(persistedKc2.due).toBe(expectedKc2.due);
    expect(persistedKc2.stability).toBe(expectedKc2.stability);
    expect(persistedKc2.difficulty).toBe(expectedKc2.difficulty);
    expect(persistedKc2.elapsedDays).toBe(expectedKc2.elapsedDays);
    expect(persistedKc2.scheduledDays).toBe(expectedKc2.scheduledDays);
    expect(persistedKc2.reps).toBe(expectedKc2.reps);
    expect(persistedKc2.lapses).toBe(expectedKc2.lapses);
    expect(persistedKc2.lastReview).toBe(expectedKc2.lastReview);
  });
});
