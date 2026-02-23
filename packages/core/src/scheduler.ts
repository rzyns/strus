import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  type Card,
  type RecordLog,
} from "ts-fsrs";
import { CardState, Rating, type LearningTarget } from "./types.js";

const params = generatorParameters();
const f = fsrs(params);

/**
 * ts-fsrs v5 RecordLog only has entries for the four scored ratings (1-4).
 * Rating.Manual (0) is excluded.
 */
type ScoredFsrsRating = Exclude<FsrsRating, typeof FsrsRating.Manual>;

/** Map our LearningTarget onto a ts-fsrs Card */
function toFsrsCard(target: LearningTarget): Card {
  // CardState and ts-fsrs State share the same integer values (0-3).
  // learning_steps was added in ts-fsrs v5; we don't persist it yet, so default to 0.
  const base: Card = {
    due: target.due,
    stability: target.stability,
    difficulty: target.difficulty,
    elapsed_days: target.elapsedDays,
    scheduled_days: target.scheduledDays,
    reps: target.reps,
    lapses: target.lapses,
    learning_steps: 0,
    state: target.state as unknown as Card["state"],
  };
  if (target.lastReview !== undefined) {
    base.last_review = target.lastReview;
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

/** Apply a ts-fsrs Card result back onto a LearningTarget (pure, no mutation) */
function applyCard(target: LearningTarget, card: Card): LearningTarget {
  return {
    ...target,
    state: card.state as unknown as CardState,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    // exactOptionalPropertyTypes: conditionally include to avoid `undefined` assignment
    ...(card.last_review !== undefined ? { lastReview: card.last_review } : {}),
  };
}

/**
 * Schedule a review and return the updated LearningTarget.
 * Pure function — no side effects.
 */
export function scheduleReview(
  target: LearningTarget,
  rating: Rating,
  now: Date = new Date(),
): LearningTarget {
  const card = toFsrsCard(target);
  const fsrsRating = toFsrsRating(rating);
  const recordLog: RecordLog = f.repeat(card, now);
  const result = recordLog[fsrsRating];
  if (!result) {
    throw new Error(`Unexpected: no schedule result for rating ${rating}`);
  }
  return applyCard(target, result.card);
}

/**
 * Return the next due date for each possible rating without mutating anything.
 * Useful for showing the user what each button will schedule.
 */
export function getNextReviewDates(
  target: LearningTarget,
  now: Date = new Date(),
): Record<Rating, Date> {
  const card = toFsrsCard(target);
  const recordLog: RecordLog = f.repeat(card, now);

  return {
    [Rating.Again]: recordLog[FsrsRating.Again]?.card.due ?? now,
    [Rating.Hard]:  recordLog[FsrsRating.Hard]?.card.due  ?? now,
    [Rating.Good]:  recordLog[FsrsRating.Good]?.card.due  ?? now,
    [Rating.Easy]:  recordLog[FsrsRating.Easy]?.card.due  ?? now,
  };
}

/**
 * Create a fresh LearningTarget (never-seen card) for the given lexeme + tag.
 */
export function createLearningTarget(
  lexemeId: string,
  tag: string,
): Omit<LearningTarget, "id"> {
  const card = createEmptyCard();
  return {
    lexemeId,
    tag,
    state: CardState.New,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    // last_review is undefined on a new card — omit to satisfy exactOptionalPropertyTypes
    ...(card.last_review !== undefined ? { lastReview: card.last_review } : {}),
  };
}
