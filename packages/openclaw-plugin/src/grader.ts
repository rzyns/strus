/** Answer grading with diacritic normalisation for Polish. */

const DIACRITIC_MAP: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

function stripDiacritics(s: string): string {
  return s.replace(/[ąćęłńóśźż]/gi, (ch) => {
    const lower = ch.toLowerCase();
    return DIACRITIC_MAP[lower] ?? ch;
  });
}

export interface GradeResult {
  correct: boolean;
  matchedForm: string | undefined;
}

/**
 * Grade a user's answer against expected forms.
 * Case-insensitive with diacritic fallback. Any match in forms[] counts.
 */
export function gradeAnswer(answer: string, forms: string[]): GradeResult {
  const trimmed = answer.trim().toLowerCase();

  // Exact match (case-insensitive)
  for (const form of forms) {
    if (trimmed === form.toLowerCase()) {
      return { correct: true, matchedForm: form };
    }
  }

  // Diacritic-normalised fallback
  const normAnswer = stripDiacritics(trimmed);
  for (const form of forms) {
    if (normAnswer === stripDiacritics(form.toLowerCase())) {
      return { correct: true, matchedForm: form };
    }
  }

  return { correct: false, matchedForm: undefined };
}

/**
 * Grade by index or option text for multiple_choice and classify cards.
 * Accepts either a 1-based number ("1", "2", "3") or the option text itself
 * (case-insensitive, diacritic-normalised).
 * Returns correct=true only if the selected option has isCorrect=true.
 */
export function gradeByIndex(
  userInput: string,
  options: Array<{ text: string; isCorrect: boolean }>,
): GradeResult {
  const trimmed = userInput.trim();

  // Try numeric index first
  const idx = parseInt(trimmed, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= options.length) {
    const opt = options[idx - 1];
    return { correct: opt.isCorrect, matchedForm: opt.text };
  }

  // Try text match (case-insensitive, diacritic-normalised)
  const normInput = stripDiacritics(trimmed.toLowerCase());
  for (const opt of options) {
    if (normInput === stripDiacritics(opt.text.toLowerCase())) {
      return { correct: opt.isCorrect, matchedForm: opt.text };
    }
  }

  return { correct: false, matchedForm: undefined };
}

/**
 * Grade a cloze_fill answer against gap definitions.
 * Single-gap: grade the whole input against gap[0].correctAnswers.
 * Multi-gap: split input by comma, grade each part against the corresponding gap; ALL must match.
 */
export function gradeClozeFill(
  userInput: string,
  gaps: Array<{ correctAnswers: string[] }>,
): GradeResult {
  if (gaps.length === 0) return { correct: false, matchedForm: undefined };

  if (gaps.length === 1) {
    return gradeAnswer(userInput.trim(), gaps[0].correctAnswers);
  }

  // Multi-gap: split by comma
  const parts = userInput.split(",").map((p) => p.trim());
  const matchedForms: string[] = [];

  for (let i = 0; i < gaps.length; i++) {
    const part = parts[i] ?? "";
    const result = gradeAnswer(part, gaps[i].correctAnswers);
    if (!result.correct) {
      return { correct: false, matchedForm: undefined };
    }
    matchedForms.push(result.matchedForm ?? part);
  }

  return { correct: true, matchedForm: matchedForms.join(", ") };
}
