import type { ParsedTag } from "@strus/morph";

export interface VocabList {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
}

export interface Lemma {
  id: string;
  /** Citation/dictionary form, e.g. "dom", "iść", "dobry" */
  lemma: string;
  pos: string;
  /** How the paradigm was populated */
  source: "morfeusz" | "manual";
  notes?: string;
  createdAt: Date;
}

export interface MorphFormRecord {
  id: string;
  lemmaId: string;
  /** Surface form */
  orth: string;
  /** NKJP morphosyntactic tag */
  tag: string;
  parsedTag: ParsedTag;
}

export interface Note {
  id: string;
  kind: "morph" | "gloss" | "basic";
  lemmaId?: string;
  front?: string;
  back?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Card {
  id: string;
  noteId: string;
  kind: "morph_form" | "gloss_forward" | "gloss_reverse" | "basic_forward" | "cloze_fill" | "multiple_choice" | "error_correction" | "classify";
  /** Only set for kind='morph_form' */
  tag?: string;
  state: CardState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  /** ts-fsrs v5: index into the learning_steps sequence (0 = start of learning queue) */
  learningSteps: number;
  lastReview?: Date;
}

export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export enum Rating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

export interface ReviewRecord {
  id: string;
  cardId: string;
  rating: Rating;
  stateBefore: CardState;
  due: Date;
  reviewedAt: Date;
  elapsedDays: number;
  scheduledDays: number;
  stabilityAfter: number;
  difficultyAfter: number;
}
