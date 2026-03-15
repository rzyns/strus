/** Typed HTTP client for the strus API at localhost:3457. */

const DEFAULT_API_URL = "http://localhost:3457";

export interface StrusStats {
  lemmaCount: number;
  listCount: number;
  dueCount: number;
}

export type CardKind =
  | "morph_form"
  | "gloss_forward"
  | "gloss_reverse"
  | "basic_forward"
  | "cloze_fill"
  | "multiple_choice"
  | "error_correction"
  | "classify";

export interface ClozeGap {
  gapIndex: number;
  hint: string | null;
  correctAnswers: string[];
  explanation: string | null;
}

export interface ChoiceOption {
  id: string;
  optionText: string;
  isCorrect: boolean;
  explanation: string | null;
}

export interface ClassifyOption {
  id: string;
  name: string;
  isCorrect: boolean;
  description: string | null;
}

export interface DueCard {
  id: string;
  noteId: string;
  kind: CardKind;
  /** Citation form of the lemma (morph cards). Null for basic notes. */
  lemmaText: string | null;
  /** NKJP morphosyntactic tag (morph_form cards only). Null for gloss/basic. */
  tag: string | null;
  /** Accepted spellings for morph_form cards. Empty for gloss/basic. */
  forms: string[];
  /** Prompt text for gloss_forward / gloss_reverse / basic_forward cards. Null for morph_form. */
  front: string | null;
  /** Answer text for gloss/basic cards. Null for morph_form. */
  back: string | null;
  /** Sentence with {{N}} gap markers (cloze_fill), or plain sentence (contextual kinds). Null for non-contextual. */
  sentenceText: string | null;
  /** Gap definitions for cloze_fill cards. Null for all other kinds. */
  clozeGaps: ClozeGap[] | null;
  /** Shuffled answer options for multiple_choice cards. Null for all other kinds. */
  choiceOptions: ChoiceOption[] | null;
  /** Shuffled category options for classify cards. Null for all other kinds. */
  classifyOptions: ClassifyOption[] | null;
  /** Shown after answer reveal for all contextual kinds (if non-null). */
  noteExplanation: string | null;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
  nextDates: {
    again: string;
    hard: string;
    good: string;
    easy: string;
  };
}

export interface ReviewResult {
  reviewId: string;
  updated: {
    id: string;
    state: number;
    scheduledDays: number;
    due: string;
  };
}

export interface VocabList {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface ImportResult {
  created: Array<{ lemmaId: string; lemma: string; pos: string; source: string }>;
  skipped: Array<{ lemma: string; reason: string }>;
  unknownTokens: string[];
}

export interface DueParams {
  newLimit?: number;
  limit?: number;
  interleave?: boolean;
  listId?: string;
  kinds?: CardKind[];
  tagContains?: string;
  mode?: "card-first" | "note-first";
  noteLimit?: number;
  cardsPerNote?: number;
}

export function createApiClient(baseUrl?: string) {
  const base = (baseUrl ?? DEFAULT_API_URL).replace(/\/$/, "");

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`strus API ${init?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    getStats(): Promise<StrusStats> {
      return request("/api/stats");
    },

    getDueCards(params?: DueParams): Promise<DueCard[]> {
      const sp = new URLSearchParams();
      if (params?.newLimit != null) sp.set("newLimit", String(params.newLimit));
      if (params?.limit != null) sp.set("limit", String(params.limit));
      if (params?.interleave != null) sp.set("interleave", String(params.interleave));
      if (params?.listId) sp.set("listId", params.listId);
      if (params?.kinds?.length) params.kinds.forEach((k) => sp.append("kinds", k));
      if (params?.tagContains) sp.set("tagContains", params.tagContains);
      if (params?.mode) sp.set("mode", params.mode);
      if (params?.noteLimit != null) sp.set("noteLimit", String(params.noteLimit));
      if (params?.cardsPerNote != null) sp.set("cardsPerNote", String(params.cardsPerNote));
      const qs = sp.toString();
      return request(`/api/session/due${qs ? `?${qs}` : ""}`);
    },

    submitReview(cardId: string, rating: number, opts?: {
      userAnswer?: string;
      generatedQuestion?: string;
    }): Promise<ReviewResult> {
      return request("/api/session/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          rating,
          ...(opts?.userAnswer !== undefined && { userAnswer: opts.userAnswer }),
          ...(opts?.generatedQuestion !== undefined && { generatedQuestion: opts.generatedQuestion }),
        }),
      });
    },

    getLists(): Promise<VocabList[]> {
      return request("/api/lists");
    },

    importPreview(params: { text: string; listId?: string }): Promise<ImportPreviewResult> {
      return request("/api/import/text/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
    },

    importText(params: { text: string; listId?: string; includeLemmas?: string[] }): Promise<ImportResult> {
      return request("/api/import/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipAmbiguous: true, ...params }),
      });
    },
  };
}

export type StrusApiClient = ReturnType<typeof createApiClient>;

export interface ImportPreviewResult {
  candidates: Array<{
    lemma: string;
    pos: string;
    formsFound: string[];
    ambiguous: boolean;
    alreadyExists: boolean;
    isMultiWord: boolean;
  }>;
  unknownTokens: string[];
}
