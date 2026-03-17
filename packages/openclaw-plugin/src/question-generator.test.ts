/**
 * Tests for question-generator.ts — QG3 retry/fallback logic and blank validation.
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  countBlanks,
  generateMorphQuestion,
  type GeneratorConfig,
} from "./question-generator.js";

// ---------------------------------------------------------------------------
// countBlanks
// ---------------------------------------------------------------------------

describe("countBlanks", () => {
  test("returns 0 when no blank", () => {
    expect(countBlanks("Ona idzie do domu.")).toBe(0);
  });

  test("returns 1 for a single blank", () => {
    expect(countBlanks("Ona ___ do domu.")).toBe(1);
  });

  test("returns 2 for two blanks", () => {
    expect(countBlanks("___ idzie do ___.")).toBe(2);
  });

  test("returns 3 for three blanks", () => {
    expect(countBlanks("___ ___ ___.")).toBe(3);
  });

  test("adjacent blanks — no overlap", () => {
    // "______" contains two non-overlapping ___ at positions 0 and 3
    expect(countBlanks("______")).toBe(2);
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
