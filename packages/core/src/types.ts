import type { ParsedTag } from "@strus/morph";

export interface VocabList {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
}

export interface Lexeme {
  id: string;
  lemma: string;
  pos: string;
  notes?: string;
  createdAt: Date;
}

export interface MorphFormRecord {
  id: string;
  lexemeId: string;
  /** Surface form */
  orth: string;
  /** NKJP morphosyntactic tag */
  tag: string;
  parsedTag: ParsedTag;
}

export interface LearningTarget {
  id: string;
  lexemeId: string;
  /** The specific morphosyntactic tag being drilled */
  tag: string;
  state: CardState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
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
  learningTargetId: string;
  rating: Rating;
  stateBefore: CardState;
  due: Date;
  reviewedAt: Date;
  elapsedDays: number;
  scheduledDays: number;
  stabilityAfter: number;
  difficultyAfter: number;
}
