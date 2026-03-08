import { z } from "zod";

// ---------------------------------------------------------------------------
// Generated content types
// ---------------------------------------------------------------------------

export interface GeneratedClozeNote {
  sentence_text: string;
  translation: string | null;
  gaps: Array<{
    gap_index: number;
    correct_answers: string[];
    hint: string | null;
    explanation: string;
    why_not: string | null;
  }>;
}

export interface GeneratedChoiceNote {
  question_text: string;
  options: Array<{
    text: string;
    is_correct: boolean;
    explanation: string;
  }>;
}

export interface ValidationResult {
  layer: string;
  pass: boolean;
  confidence?: number;
  reason: string;
}

export interface BatchResult {
  batchId: string;
  generated: number;
  approved: number;
  flagged: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Zod schemas (used with generateObject)
// ---------------------------------------------------------------------------

export const ClozeNoteSchema = z.object({
  sentence_text: z.string().describe("Polish sentence with {{N}} gap markers"),
  translation: z.string().nullable().describe("English translation of the sentence"),
  gaps: z.array(
    z.object({
      gap_index: z.number().int().min(1).describe("1-based index matching {{N}} in sentence_text"),
      correct_answers: z
        .array(z.string().min(1))
        .min(1)
        .describe("Primary form + any acceptable variants"),
      hint: z.string().nullable().describe("Brief grammatical hint for the learner"),
      explanation: z.string().describe("Why this form is required here"),
      why_not: z
        .string()
        .nullable()
        .describe("What would be wrong about a near-synonym or different form"),
    }),
  ).min(1),
});

export const ChoiceNoteSchema = z.object({
  question_text: z.string().describe("Question asking the learner to identify or choose something"),
  options: z
    .array(
      z.object({
        text: z.string().describe("Option text"),
        is_correct: z.boolean().describe("Whether this option is correct"),
        explanation: z.string().describe("Why this option is right or wrong"),
      }),
    )
    .length(4)
    .describe("Exactly 4 options: 1 correct, 3 plausible but definitively wrong"),
});
