import { describe, test, expect } from "bun:test";
import { validateSentenceLength, validateGapMarkers } from "./validate.js";

// ---------------------------------------------------------------------------
// validateSentenceLength
// ---------------------------------------------------------------------------

describe("validateSentenceLength", () => {
  test("passes for a normal sentence with gap marker", () => {
    const result = validateSentenceLength({
      sentence_text: "Mój brat {{1}} na uniwersytecie w Warszawie.",
      translation: null,
      gaps: [],
    });
    expect(result.pass).toBe(true);
  });

  test("fails for sentence under 5 words", () => {
    const result = validateSentenceLength({
      sentence_text: "Idę {{1}}.",
      translation: null,
      gaps: [],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("Too short");
  });

  test("fails for sentence over 40 words", () => {
    const long = Array(42).fill("słowo").join(" ") + " {{1}}";
    const result = validateSentenceLength({
      sentence_text: long,
      translation: null,
      gaps: [],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("Too long");
  });

  test("passes for exactly 5 words", () => {
    // "To jest bardzo {{1}} zdanie." = 5 tokens
    const result = validateSentenceLength({
      sentence_text: "To jest bardzo {{1}} zdanie.",
      translation: null,
      gaps: [],
    });
    expect(result.pass).toBe(true);
  });

  test("passes for exactly 40 words", () => {
    const exactly40 = Array(39).fill("słowo").join(" ") + " {{1}}";
    const result = validateSentenceLength({
      sentence_text: exactly40,
      translation: null,
      gaps: [],
    });
    expect(result.pass).toBe(true);
  });

  test("counts words by splitting on whitespace, ignoring empty chunks", () => {
    // Leading/trailing spaces shouldn't create phantom words
    const result = validateSentenceLength({
      sentence_text: "  Ona {{1}} do domu.  ",
      translation: null,
      gaps: [],
    });
    // "Ona", "{{1}}", "do", "domu." = 4 words → too short
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("Too short");
  });

  test("layer is 'length'", () => {
    const result = validateSentenceLength({
      sentence_text: "Mój brat {{1}} na uniwersytecie w Warszawie.",
      translation: null,
      gaps: [],
    });
    expect(result.layer).toBe("length");
  });

  test("single gap — passes once gap is substituted (7 words)", () => {
    // "Ona {{1}} do szkoły autobusem każdego ranka."
    // filled: "Ona chodzi do szkoły autobusem każdego ranka." = 7 words → pass
    const result = validateSentenceLength({
      sentence_text: "Ona {{1}} do szkoły autobusem każdego ranka.",
      translation: null,
      gaps: [{ gap_index: 1, correct_answers: ["chodzi"], hint: null, explanation: "", why_not: null }],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toContain("7");
  });

  test("multiple gaps — sentence too short even when filled (4 words)", () => {
    // "{{1}} {{2}} do domu."
    // filled: "Ona idzie do domu." = 4 words → fail (min 5)
    const result = validateSentenceLength({
      sentence_text: "{{1}} {{2}} do domu.",
      translation: null,
      gaps: [
        { gap_index: 1, correct_answers: ["Ona"], hint: null, explanation: "", why_not: null },
        { gap_index: 2, correct_answers: ["idzie"], hint: null, explanation: "", why_not: null },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("Too short");
  });

  test("multi-word answer — 'bawią się' counts as two words (8 words total)", () => {
    // "Dzieci {{1}} razem na podwórku po szkole."
    // filled: "Dzieci bawią się razem na podwórku po szkole." = 8 words → pass
    const result = validateSentenceLength({
      sentence_text: "Dzieci {{1}} razem na podwórku po szkole.",
      translation: null,
      gaps: [{ gap_index: 1, correct_answers: ["bawią się"], hint: null, explanation: "", why_not: null }],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toContain("8");
  });
});

// ---------------------------------------------------------------------------
// validateGapMarkers
// ---------------------------------------------------------------------------

describe("validateGapMarkers", () => {
  test("passes when all gap indices are present in sentence text", () => {
    const result = validateGapMarkers({
      sentence_text: "Ona {{1}} do {{2}}.",
      translation: null,
      gaps: [
        { gap_index: 1, correct_answers: ["idzie"], hint: null, explanation: "", why_not: null },
        { gap_index: 2, correct_answers: ["domu"], hint: null, explanation: "", why_not: null },
      ],
    });
    expect(result.pass).toBe(true);
  });

  test("fails when a declared gap index is missing from text", () => {
    const result = validateGapMarkers({
      sentence_text: "Ona {{1}} do domu.",
      translation: null,
      gaps: [
        { gap_index: 1, correct_answers: ["idzie"], hint: null, explanation: "", why_not: null },
        { gap_index: 2, correct_answers: ["domu"], hint: null, explanation: "", why_not: null },
      ],
    });
    expect(result.pass).toBe(false);
    // Should mention the missing index
    expect(result.reason).toContain("2");
  });

  test("passes with no gaps declared and no markers in text", () => {
    const result = validateGapMarkers({
      sentence_text: "Ona idzie do domu.",
      translation: null,
      gaps: [],
    });
    expect(result.pass).toBe(true);
  });

  test("fails when multiple gap indices are missing", () => {
    const result = validateGapMarkers({
      sentence_text: "Słowo.",
      translation: null,
      gaps: [
        { gap_index: 1, correct_answers: ["a"], hint: null, explanation: "", why_not: null },
        { gap_index: 2, correct_answers: ["b"], hint: null, explanation: "", why_not: null },
        { gap_index: 3, correct_answers: ["c"], hint: null, explanation: "", why_not: null },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("1");
    expect(result.reason).toContain("2");
    expect(result.reason).toContain("3");
  });

  test("passes with a single gap present", () => {
    const result = validateGapMarkers({
      sentence_text: "Piszę {{1}} list.",
      translation: null,
      gaps: [
        { gap_index: 1, correct_answers: ["długi"], hint: null, explanation: "", why_not: null },
      ],
    });
    expect(result.pass).toBe(true);
  });

  test("layer is 'gap_markers'", () => {
    const result = validateGapMarkers({
      sentence_text: "Ona {{1}} do domu.",
      translation: null,
      gaps: [{ gap_index: 1, correct_answers: ["idzie"], hint: null, explanation: "", why_not: null }],
    });
    expect(result.layer).toBe("gap_markers");
  });
});

// ---------------------------------------------------------------------------
// NOTE: validateMorphology is intentionally not tested here.
// It requires @rzyns/morfeusz-ts (native TypeScript port of Morfeusz2 with
// dictionary files at /usr/share/morfeusz2/dictionaries). Mocking the
// `analyse` export from @rzyns/strus-morph would require a bun mock() call that
// intercepts the module — doable but deferred until the CI environment has
// the native dict files confirmed present.
// ---------------------------------------------------------------------------
