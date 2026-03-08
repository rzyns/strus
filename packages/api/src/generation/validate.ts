import { analyse } from "@strus/morph";
import type { GeneratedClozeNote, ValidationResult } from "./types.js";

// ---------------------------------------------------------------------------
// Validation pipeline for generated notes
// ---------------------------------------------------------------------------

/**
 * Morphological validation: every correct_answer entry must be recognized
 * by Morfeusz2. Unknown forms → flagged (LLM hallucinated a non-word).
 */
export async function validateMorphology(
  draft: GeneratedClozeNote,
): Promise<ValidationResult> {
  for (const gap of draft.gaps) {
    for (const answer of gap.correct_answers) {
      const forms = await analyse(answer);
      if (forms.length === 0) {
        return {
          layer: "morphology",
          pass: false,
          reason: `Answer "${answer}" not recognized by Morfeusz2`,
        };
      }
    }
  }
  return {
    layer: "morphology",
    pass: true,
    reason: "All answers recognized by Morfeusz2",
  };
}

/**
 * Sentence length guard: 5–40 words. Very short sentences are usually
 * underspecified; very long ones are unwieldy in a cloze context.
 */
export function validateSentenceLength(draft: GeneratedClozeNote): ValidationResult {
  const words = draft.sentence_text.split(/\s+/).filter(Boolean).length;
  if (words < 5) {
    return {
      layer: "length",
      pass: false,
      reason: `Too short: ${words} words (min 5)`,
    };
  }
  if (words > 40) {
    return {
      layer: "length",
      pass: false,
      reason: `Too long: ${words} words (max 40)`,
    };
  }
  return { layer: "length", pass: true, reason: `${words} words` };
}

/**
 * Gap marker consistency: every gap declared in `gaps` must have a
 * corresponding {{N}} marker in sentence_text.
 */
export function validateGapMarkers(draft: GeneratedClozeNote): ValidationResult {
  const markers = [...draft.sentence_text.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
    parseInt(m[1] as string, 10),
  );
  const gapIndices = draft.gaps.map((g) => g.gap_index);
  const mismatched = gapIndices.filter((i) => !markers.includes(i));
  if (mismatched.length > 0) {
    return {
      layer: "gap_markers",
      pass: false,
      reason: `Gap indices ${mismatched.join(", ")} missing from sentence text`,
    };
  }
  return {
    layer: "gap_markers",
    pass: true,
    reason: "All gap indices present in sentence",
  };
}

/**
 * Run the full cloze validation pipeline.
 * Returns aggregated result — allPassed true only when every layer passes.
 */
export async function validateCloze(
  draft: GeneratedClozeNote,
): Promise<{ allPassed: boolean; results: ValidationResult[] }> {
  const results: ValidationResult[] = [];

  // Rule-based checks first (cheap)
  results.push(validateSentenceLength(draft));
  results.push(validateGapMarkers(draft));

  // Morphology check (requires Morfeusz2 lookup)
  results.push(await validateMorphology(draft));

  return {
    allPassed: results.every((r) => r.pass),
    results,
  };
}
