/**
 * Tests for question-generator.ts — QG3 retry/fallback logic, blank validation,
 * and QG4 syntactic frame hints.
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  countBlanks,
  generateMorphQuestion,
  tagContextHint,
  type GeneratorConfig,
} from "./question-generator.js";

// ---------------------------------------------------------------------------
// countBlanks
// ---------------------------------------------------------------------------

describe("countBlanks", () => {
  test("returns 0 when no blank", () => {
    expect(countBlanks("Ona idzie do domu.")).toBe(0);
  });

  test("returns 1 for a single blank (three underscores)", () => {
    expect(countBlanks("Ona ___ do domu.")).toBe(1);
  });

  test("returns 2 for two blanks (three underscores each)", () => {
    expect(countBlanks("___ idzie do ___.")).toBe(2);
  });

  test("returns 3 for three blanks", () => {
    expect(countBlanks("___ ___ ___.")).toBe(3);
  });

  test("adjacent blanks — six underscores = one blank run", () => {
    // "______" is a single run of underscores — one blank
    expect(countBlanks("______")).toBe(1);
  });

  test("two underscores (QG3 regression) — counts as one blank", () => {
    // LLM produced __ instead of ___; must be detected, not silently passed through
    expect(countBlanks("Ona __ do domu.")).toBe(1);
  });

  test("two-underscore blank between words — detected", () => {
    expect(countBlanks("Księżniczce podobał się książę, ale jego __ brakowało.")).toBe(1);
  });

  test("four underscores — counts as one blank", () => {
    expect(countBlanks("Ona ____ do domu.")).toBe(1);
  });

  test("two separate two-underscore blanks", () => {
    expect(countBlanks("__ idzie do __.")).toBe(2);
  });

  test("single underscore is not a blank", () => {
    // A lone _ is used in some grammatical notation, not a gap
    expect(countBlanks("Forma_słowa")).toBe(0);
  });

  test("empty string", () => {
    expect(countBlanks("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateMorphQuestion — retry + canonical fallback
// ---------------------------------------------------------------------------

const BASE_CONFIG: GeneratorConfig = {
  provider: "gemini",
  apiKey: "test-key",
  model: "gemini-test",
  timeoutMs: 5000,
};

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("generateMorphQuestion", () => {
  test("returns first response when it contains exactly one blank", async () => {
    // Mock fetch to return a valid sentence on the first call
    const fetchMock = mock(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Ona ___ do domu." }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMorphQuestion(
      "iść",
      "3rd person singular present",
      null,
      BASE_CONFIG,
      makeSignal(),
    );

    expect(result.text).toBe("Ona ___ do domu.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries when first response has zero blanks, returns second response with one blank", async () => {
    let callCount = 0;
    const fetchMock = mock(async () => {
      callCount++;
      const text = callCount === 1
        ? "Ona idzie do domu."     // no blank — should retry
        : "Ona ___ do domu.";     // one blank — should accept
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMorphQuestion(
      "iść",
      "3rd person singular present",
      null,
      BASE_CONFIG,
      makeSignal(),
    );

    expect(result.text).toBe("Ona ___ do domu.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries when first response has multiple blanks, returns second response with one blank", async () => {
    let callCount = 0;
    const fetchMock = mock(async () => {
      callCount++;
      const text = callCount === 1
        ? "___ idzie do ___ domu."  // two blanks
        : "Ona ___ do domu.";       // one blank
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMorphQuestion(
      "iść",
      "3rd person singular present",
      null,
      BASE_CONFIG,
      makeSignal(),
    );

    expect(result.text).toBe("Ona ___ do domu.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("falls back to canonical format after MAX_RETRIES exhausted (all responses have wrong blank count)", async () => {
    // All 3 calls (attempt 0, 1, 2) return no blank
    const fetchMock = mock(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Ona idzie do domu." }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMorphQuestion(
      "dom",
      "genitive singular",
      null,
      BASE_CONFIG,
      makeSignal(),
    );

    // Should fall back to canonical: Napisz {label} słowa „{lemma}":
    expect(result.text).toBe(`Napisz genitive singular słowa „dom":`);
    // Exactly 3 calls: attempt 0, 1, 2
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("canonical fallback text contains no blank", async () => {
    const fetchMock = mock(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "bad response" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMorphQuestion(
      "dom",
      "locative singular",
      null,
      BASE_CONFIG,
      makeSignal(),
    );

    // The canonical fallback doesn't have a blank — that's intentional for clarity
    expect(result.text).toBe(`Napisz locative singular słowa „dom":`);
  });

  test("strips prompt leakage — takes last line when newline present", async () => {
    const fetchMock = mock(async () =>
      new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: "Uczeń: Słowo: dom\nNauczyciel: Podaj formę.\nWideo ___ na stole.",
              }],
            },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateMorphQuestion(
      "dom",
      "nominative singular",
      null,
      BASE_CONFIG,
      makeSignal(),
    );

    expect(result.text).toBe("Wideo ___ na stole.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// tagContextHint — QG4 syntactic frame hints
// ---------------------------------------------------------------------------

describe("tagContextHint — QG4 frame hints", () => {
  // ger + inst
  test("ger:sg:inst returns instrumental frame hint", () => {
    const hint = tagContextHint("ger:sg:inst:n:imperf:aff");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/z ___/);
    expect(hint).toMatch(/narzędnika/i);
    // Must warn against subject-position trap
    expect(hint).toMatch(/podmiot/i);
  });

  // ger + gen
  test("ger:sg:gen returns genitive frame hint", () => {
    const hint = tagContextHint("ger:sg:gen:n:perf:aff");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/nie ma ___/);
    expect(hint).toMatch(/dopełniacza/i);
  });

  // subst + inst — must include syntactic frame, not just case name
  test("subst:sg:inst returns instrumental frame hint with preposition examples", () => {
    const hint = tagContextHint("subst:sg:inst:m1");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/z ___/);
    // Must warn against subject-position trap
    expect(hint).toMatch(/podmiot/i);
  });

  // subst + gen
  test("subst:sg:gen returns genitive frame hint with verb examples", () => {
    const hint = tagContextHint("subst:sg:gen:m1");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/nie ma ___/);
  });

  // subst + dat — dative-governing verbs
  test("subst:sg:dat returns dative frame hint with governing verbs", () => {
    const hint = tagContextHint("subst:sg:dat:m1");
    expect(hint).not.toBeNull();
    // Must include at least one dative-governing verb
    expect(hint).toMatch(/ufać|pomagać|dziękować|brakować/);
  });

  // imps — impersonal form is the main predicate
  test("imps:perf returns impersonal predicate frame hint", () => {
    const hint = tagContextHint("imps:perf");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/orzeczenie/i);
    // Must warn against modal / subordinate clause traps
    expect(hint).toMatch(/modaln/i);
  });

  // pant — converb must open the sentence
  test("pant:perf returns anterior converb opening hint", () => {
    const hint = tagContextHint("pant:perf");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/OTWIERAĆ|otwierać/i);
    // Must show the pattern with blank first
    expect(hint).toMatch(/___,/);
  });

  // pcon — simultaneous action converb
  test("pcon:imperf returns simultaneous converb hint", () => {
    const hint = tagContextHint("pcon:imperf");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/równoczesn/i);
    // Must show the converb trailing pattern
    expect(hint).toMatch(/, ___/);
  });

  // Existing behaviour preserved: nom returns null
  test("subst:sg:nom returns null (nominative needs no frame hint)", () => {
    expect(tagContextHint("subst:sg:nom:m1")).toBeNull();
  });

  // Existing behaviour preserved: adj gen still works
  test("adj:sg:gen returns genitive hint", () => {
    const hint = tagContextHint("adj:sg:gen:m1:pos");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/dopełniacza/i);
  });

  // Unknown tag returns null
  test("unknown POS returns null", () => {
    expect(tagContextHint("xxx:sg")).toBeNull();
  });
});
