import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  type Card as FsrsCard,
  type RecordLog,
  type State as FsrsState,
} from "ts-fsrs";
import { CardState, Rating, type Card } from "./types.js";

// Compile-time assertion: CardState integer values must remain aligned with
// ts-fsrs State. If ts-fsrs changes its enum, this line will error.
type _AssertCardStateMatchesFsrsState = CardState extends FsrsState ? true : never;
const _assertCardState: _AssertCardStateMatchesFsrsState = true;

const params = generatorParameters();
const f = fsrs(params);

/**
 * ts-fsrs v5 RecordLog only has entries for the four scored ratings (1-4).
 * Rating.Manual (0) is excluded.
 */
type ScoredFsrsRating = Exclude<FsrsRating, typeof FsrsRating.Manual>;

/** Map our Card onto a ts-fsrs Card */
function toFsrsCard(card: Card): FsrsCard {
  // CardState and ts-fsrs State share the same integer values (0-3).
  const base: FsrsCard = {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learningSteps,
    state: card.state as unknown as FsrsCard["state"],
  };
  if (card.lastReview !== undefined) {
    base.last_review = card.lastReview;
  }
  return base;
}

/** Map our Rating enum to ts-fsrs's scored rating (excludes Manual) */
function toFsrsRating(rating: Rating): ScoredFsrsRating {
  switch (rating) {
    case Rating.Again: return FsrsRating.Again;
    case Rating.Hard:  return FsrsRating.Hard;
    case Rating.Good:  return FsrsRating.Good;
    case Rating.Easy:  return FsrsRating.Easy;
  }
}

/** Apply a ts-fsrs Card result back onto a Card (pure, no mutation) */
function applyFsrsCard(card: Card, fsrsCard: FsrsCard): Card {
  return {
    ...card,
    state: fsrsCard.state as unknown as CardState,
    due: fsrsCard.due,
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    elapsedDays: fsrsCard.elapsed_days,
    scheduledDays: fsrsCard.scheduled_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    learningSteps: fsrsCard.learning_steps,
    // exactOptionalPropertyTypes: conditionally include to avoid `undefined` assignment
    ...(fsrsCard.last_review !== undefined ? { lastReview: fsrsCard.last_review } : {}),
  };
}

/**
 * Schedule a review and return the updated Card.
 * Pure function — no side effects.
 */
export function scheduleReview(
  card: Card,
  rating: Rating,
  now: Date = new Date(),
): Card {
  const fsrsCard = toFsrsCard(card);
  const fsrsRating = toFsrsRating(rating);
  const recordLog: RecordLog = f.repeat(fsrsCard, now);
  const result = recordLog[fsrsRating];
  if (!result) {
    throw new Error(`Unexpected: no schedule result for rating ${rating}`);
  }
  return applyFsrsCard(card, result.card);
}

/**
 * Return the next due date for each possible rating without mutating anything.
 * Useful for showing the user what each button will schedule.
 */
export function getNextReviewDates(
  card: Card,
  now: Date = new Date(),
): Record<Rating, Date> {
  const fsrsCard = toFsrsCard(card);
  const recordLog: RecordLog = f.repeat(fsrsCard, now);

  return {
    [Rating.Again]: recordLog[FsrsRating.Again]?.card.due ?? now,
    [Rating.Hard]:  recordLog[FsrsRating.Hard]?.card.due  ?? now,
    [Rating.Good]:  recordLog[FsrsRating.Good]?.card.due  ?? now,
    [Rating.Easy]:  recordLog[FsrsRating.Easy]?.card.due  ?? now,
  };
}

/**
 * Create a fresh Card (never-seen) for the given note + optional tag.
 */
export function createCard(
  noteId: string,
  kind: Card["kind"],
  tag?: string,
): Omit<Card, "id"> {
  const emptyCard = createEmptyCard();
  return {
    noteId,
    kind,
    state: CardState.New,
    due: emptyCard.due,
    stability: emptyCard.stability,
    difficulty: emptyCard.difficulty,
    elapsedDays: emptyCard.elapsed_days,
    scheduledDays: emptyCard.scheduled_days,
    reps: emptyCard.reps,
    lapses: emptyCard.lapses,
    learningSteps: emptyCard.learning_steps,
    // last_review is undefined on a new card — omit to satisfy exactOptionalPropertyTypes
    ...(emptyCard.last_review !== undefined ? { lastReview: emptyCard.last_review } : {}),
    ...(tag !== undefined ? { tag } : {}),
  };
}
