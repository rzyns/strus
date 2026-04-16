import { createCard } from "@rzyns/strus-core";

/**
 * Mirror the cards table's initial FSRS values for freshly created knowledge components.
 * We intentionally reuse the same initializer that cards use, then drop card-only fields.
 */
export function createInitialKnowledgeComponentFsrsState() {
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
