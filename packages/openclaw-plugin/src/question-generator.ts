/**
 * Agent-side question generation for strus quiz cards.
 *
 * Cards are specifications, not fixed Q&A pairs. This module generates varied
 * question surfaces at quiz time from the card's structured parameters — preventing
 * rote memorization of question wording.
 *
 * For morph_form: calls an LLM to generate a natural Polish gap sentence.
 * For contextual kinds (cloze_fill, multiple_choice, error_correction, classify):
 *   V1 decision: uses hardcoded instruction variants (random pick from small array), NOT LLM.
 *   Rationale: the instruction is short and predictable; LLM adds latency with minimal value.
 * For other kinds (gloss_forward, gloss_reverse, basic_forward): returns null.
 */

import type { DueCard } from "./api-client.js";
import { tagLabel } from "./tag-labels.js";

export interface GeneratorConfig {
  provider: "gemini" | "openai-compat";
  apiKey: string;
  model?: string;
  baseUrl?: string; // for openai-compat only
  timeoutMs?: number;
}

export interface GeneratedQuestion {
  text: string; // question to show the learner
  raw: string; // same value, stored in reviews.generated_question
}

// ---------------------------------------------------------------------------
// Hardcoded instruction variants for contextual card kinds
// ---------------------------------------------------------------------------

const CLOZE_FILL_VARIANTS = [
  "Uzupełnij lukę:",
  "Wstaw właściwą formę:",
  "Uzupełnij zdanie odpowiednią formą:",
];

const MULTIPLE_CHOICE_VARIANTS = [
  "Wybierz poprawną formę:",
  "Która forma jest poprawna?",
  "Zaznacz właściwą odpowiedź:",
];

const ERROR_CORRECTION_VARIANTS = [
  "Znajdź i popraw błąd:",
  "Popraw błąd w zdaniu:",
  "Co jest nie tak w tym zdaniu?",
];

const CLASSIFY_VARIANTS = [
  "Określ typ konstrukcji:",
  "Jak nazwiesz tę konstrukcję?",
  "Sklasyfikuj podany przykład:",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Tag context hint — drives the LLM toward the right grammatical context
// ---------------------------------------------------------------------------

/**
 * Returns a Polish hint for the LLM based on the morphosyntactic tag.
 * Helps the LLM construct a sentence that plausibly requires the target form.
 */
export function tagContextHint(tag: string): string | null {
  if (!tag) return null;
  const parts = tag.split(":");
  const pos = parts[0];

  // Nouns: subst:number:case:gender — extract the case portion (parts[2])
  if (pos === "subst" && parts.length >= 3) {
    const casePart = parts[2]; // may be dot-separated multi-case like "nom.acc"
    // Extract individual case values
    const cases = casePart.split(".");
    // Use the most specific/dominant case for the hint
    if (cases.includes("gen")) {
      return "Użyj dopełniacza po 'nie mam', 'brak', 'bez' lub po liczebnikach.";
    }
    if (cases.includes("dat")) {
      return "Użyj celownika po 'dać', 'pomóc', 'powiedzieć' lub 'podobać się'.";
    }
    if (cases.includes("acc")) {
      return "Użyj biernika po czasowniku przechodnim (np. 'widzieć', 'kupić', 'mieć').";
    }
    if (cases.includes("inst")) {
      return "Użyj narzędnika po 'być', 'z', 'między' lub jako orzecznik.";
    }
    if (cases.includes("loc")) {
      return "Użyj miejscownika po 'w', 'na', 'o', 'przy'.";
    }
    if (cases.includes("voc")) {
      return "Napisz zdanie z bezpośrednim zwrotem do tej osoby/rzeczy.";
    }
    return null; // nom or unrecognised
  }

  // Adjectives: adj:number:case:gender — extract case from parts[2]
  if (pos === "adj" && parts.length >= 3) {
    const casePart = parts[2];
    const cases = casePart.split(".");
    if (cases.includes("gen")) {
      return "Użyj dopełniacza po 'nie mam', 'brak', 'bez' lub po liczebnikach.";
    }
    if (cases.includes("dat")) {
      return "Użyj celownika po 'dać', 'pomóc', 'powiedzieć' lub 'podobać się'.";
    }
    if (cases.includes("acc")) {
      return "Użyj biernika po czasowniku przechodnim (np. 'widzieć', 'kupić', 'mieć').";
    }
    if (cases.includes("inst")) {
      return "Użyj narzędnika po 'być', 'z', 'między' lub jako orzecznik.";
    }
    if (cases.includes("loc")) {
      return "Użyj miejscownika po 'w', 'na', 'o', 'przy'.";
    }
    if (cases.includes("voc")) {
      return "Napisz zdanie z bezpośrednim zwrotem do tej osoby/rzeczy.";
    }
    return null;
  }

  // Past tense: praet:...
  if (pos === "praet") {
    return "Użyj formy czasu przeszłego.";
  }

  // Finite present: fin:...
  if (pos === "fin") {
    return "Użyj formy czasu teraźniejszego.";
  }

  // Imperative: impt:...
  if (pos === "impt") {
    return "Napisz prośbę lub polecenie (tryb rozkazujący).";
  }

  // Infinitive: inf:...
  if (pos === "inf") {
    return "Użyj bezokolicznika po 'chcieć', 'móc', 'trzeba' itp.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// LLM provider implementations (fetch-only, no new deps)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Jesteś generatorem ćwiczeń do nauki języka polskiego dla obcokrajowców.
Napisz jedno naturalne polskie zdanie, w którym brakuje formy podanego wyrazu.
W miejsce brakującej formy wstaw dokładnie trzy podkreślniki: ___ (trzy znaki podkreślenia).
Zasady:
- Zdanie musi być krótkie (5–12 słów), naturalne i poprawne gramatycznie
- Luka ___ musi wymagać dokładnie tej formy, którą podano (przypadek, liczba, rodzaj)
- Użyj DOKŁADNIE trzech podkreślników jako luki: ___ — nie dwóch (__), nie czterech (____), tylko trzech (___)
- Nie dodawaj tłumaczeń, objaśnień ani komentarzy — tylko samo zdanie
- Nie powtarzaj lematu w zdaniu w żadnej innej formie
- Odpowiedź to WYŁĄCZNIE polskie zdanie z luką ___. Zero wstępu, zero etykiet, zero wyjaśnień.`;

function buildUserMessage(lemma: string, label: string, hint: string | null, reinforce = false): string {
  let msg = `Słowo: ${lemma}\nWymagana forma: ${label}`;
  if (hint) msg += `\n${hint}`;
  msg += "\nNapisz zdanie z luką ___.";
  if (reinforce) {
    msg += "\nTwoje zdanie MUSI zawierać dokładnie jedną lukę zapisaną jako ___. Żadnych wyjątków.";
  }
  return msg;
}

/**
 * Strip any prompt leakage from LLM response.
 * If the model echoes back the dialogue scaffolding (e.g. "Uczeń: ...\nNauczyciel: ..."),
 * the actual sentence is on the last non-empty line.
 */
function stripLeakage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes("\n")) return trimmed;
  const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? trimmed;
}

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  config: GeneratorConfig,
  signal: AbortSignal,
): Promise<string> {
  const model = config.model ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${text}`);
  }

  const result = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: empty response");
  return stripLeakage(text);
}

async function callOpenAICompat(
  systemPrompt: string,
  userMessage: string,
  config: GeneratorConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.baseUrl) throw new Error("openai-compat requires baseUrl");
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model: config.model ?? "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.9,
    max_tokens: 150,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI-compat API ${res.status}: ${text}`);
  }

  const result = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI-compat: empty response");
  return stripLeakage(text);
}

// ---------------------------------------------------------------------------
// Blank validation
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;

/**
 * Count the number of blanks in a string.
 * A blank is any sequence of 2 or more consecutive underscores.
 * This is intentionally tolerant: the system prompt asks for exactly ___ (3),
 * but if the LLM produces __ (2) or ____ (4+) we still count it as one blank
 * rather than silently passing an unusable sentence through to the user.
 */
export function countBlanks(text: string): number {
  return (text.match(/__+/g) ?? []).length;
}

/**
 * Generate a morph_form gap sentence with retry-on-blank-miss logic.
 * Exported for testing.
 *
 * Retry policy:
 * - If response has ≠ 1 blank → retry with reinforced prompt (max 2 retries)
 * - On exhaustion → canonical fallback: "Napisz {tagLabel} słowa „{lemma}":"
 */
export async function generateMorphQuestion(
  lemma: string,
  label: string,
  hint: string | null,
  config: GeneratorConfig,
  signal: AbortSignal,
): Promise<GeneratedQuestion> {
  const callLlm = (userMessage: string): Promise<string> =>
    config.provider === "gemini"
      ? callGemini(SYSTEM_PROMPT, userMessage, config, signal)
      : callOpenAICompat(SYSTEM_PROMPT, userMessage, config, signal);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const reinforce = attempt > 0;
    const userMessage = buildUserMessage(lemma, label, hint, reinforce);
    const text = await callLlm(userMessage);
    if (countBlanks(text) === 1) {
      return { text, raw: text };
    }
    // blank count mismatch — retry (loop continues) or fall through to fallback
  }

  // Canonical fallback after exhausting retries
  const text = `Napisz ${label} słowa „${lemma}":`;
  return { text, raw: text };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a varied question surface for a quiz card.
 * Returns null on failure — caller should fall back to the canonical format.
 * Never throws.
 */
export async function generateQuestion(
  card: DueCard,
  config: GeneratorConfig,
): Promise<GeneratedQuestion | null> {
  try {
    // Contextual kinds — hardcoded variants, no network call
    // V1 decision: the instruction is short and predictable; LLM adds latency with minimal value.
    if (card.kind === "cloze_fill") {
      const text = pickRandom(CLOZE_FILL_VARIANTS);
      return { text, raw: text };
    }
    if (card.kind === "multiple_choice") {
      const text = pickRandom(MULTIPLE_CHOICE_VARIANTS);
      return { text, raw: text };
    }
    if (card.kind === "error_correction") {
      const text = pickRandom(ERROR_CORRECTION_VARIANTS);
      return { text, raw: text };
    }
    if (card.kind === "classify") {
      const text = pickRandom(CLASSIFY_VARIANTS);
      return { text, raw: text };
    }

    // morph_form — LLM gap sentence generation
    if (card.kind === "morph_form") {
      const lemma = card.lemmaText;
      if (!lemma || !card.tag) return null;

      const label = tagLabel(card.tag);
      const hint = tagContextHint(card.tag);

      const timeoutMs = config.timeoutMs ?? 5000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await generateMorphQuestion(lemma, label, hint, config, controller.signal);
        return result;
      } finally {
        clearTimeout(timer);
      }
    }

    // gloss_forward, gloss_reverse, basic_forward — no generation
    return null;
  } catch (err) {
    // Never throw — log and return null so caller can fall back
    console.error("[strus:question-generator] generateQuestion failed:", err);
    return null;
  }
}
