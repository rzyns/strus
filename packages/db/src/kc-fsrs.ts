import { createCard, scheduleReview, type Rating } from "@rzyns/strus-core";

export interface KnowledgeComponentFsrsState {
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReview: number | null;
}

/**
 * Mirror the cards table's initial FSRS values for freshly created knowledge components.
 * We intentionally reuse the same initializer that cards use, then drop card-only fields.
 */
export function createInitialKnowledgeComponentFsrsState(): KnowledgeComponentFsrsState {
  const card = createCard("__kc-bootstrap__", "morph_form");

  return {
    state: card.state,
    due: Math.floor(card.due.getTime() / 1000),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.lastReview
      ? Math.floor(card.lastReview.getTime() / 1000)
      : null,
  };
}

/**
 * Apply a review rating to a KC using the same ts-fsrs repeat path as cards.
 * KCs do not persist learning_steps today, so we replay them with the default step index (0).
 */
export function scheduleKnowledgeComponentReview(
  kc: KnowledgeComponentFsrsState,
  rating: Rating,
  now: Date = new Date(),
): KnowledgeComponentFsrsState {
  const updated = scheduleReview({
    id: "__kc-bootstrap__",
    noteId: "__kc-bootstrap__",
    kind: "morph_form",
    state: kc.state,
    due: new Date(kc.due * 1000),
    stability: kc.stability,
    difficulty: kc.difficulty,
    elapsedDays: kc.elapsedDays,
    scheduledDays: kc.scheduledDays,
    reps: kc.reps,
    lapses: kc.lapses,
    learningSteps: 0,
    ...(kc.lastReview != null ? { lastReview: new Date(kc.lastReview * 1000) } : {}),
  }, rating, now);

  return {
    state: updated.state,
    due: Math.floor(updated.due.getTime() / 1000),
    stability: updated.stability,
    difficulty: updated.difficulty,
    elapsedDays: updated.elapsedDays,
    scheduledDays: updated.scheduledDays,
    reps: updated.reps,
    lapses: updated.lapses,
    lastReview: updated.lastReview
      ? Math.floor(updated.lastReview.getTime() / 1000)
      : null,
  };
}
