/** Agent tools for AI-driven quiz mode. */

import { jsonResult } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi, AnyAgentTool } from "openclaw/plugin-sdk";

/** Subset of the SDK's PluginToolCtx that we actually use. */
interface PluginToolCtx {
  messageChannel?: string;
}
import type { CardKind, DueCard, StrusApiClient } from "./api-client.js";
import { gradeAnswer, gradeByIndex, gradeClozeFill } from "./grader.js";
import {
  createSession,
  getSession,
  setSession,
  deleteSession,
  currentCard,
  advanceSession,
  sessionSummary,
} from "./session-store.js";
import { tagLabel } from "./tag-labels.js";
import { generateQuestion, type GeneratorConfig } from "./question-generator.js";

// ---------------------------------------------------------------------------
// Card payload for agent consumption
// ---------------------------------------------------------------------------

function cardPayload(card: DueCard) {
  return {
    kind: card.kind,
    lemmaText: card.lemmaText,
    tag: card.tag,
    tagLabel: card.tag ? tagLabel(card.tag) : null,
    forms: card.forms,
    front: card.front,
    back: card.back,
    sentenceText: card.sentenceText,
    clozeGaps: card.clozeGaps,
    choiceOptions: card.choiceOptions,
    classifyOptions: card.classifyOptions,
    noteExplanation: card.noteExplanation,
  };
}

/** Returns accepted answers for a card (kind-aware). */
function acceptedAnswers(card: DueCard): string[] {
  switch (card.kind) {
    case "morph_form":
      return card.forms;
    case "cloze_fill": {
      const gaps = card.clozeGaps;
      if (!gaps || gaps.length === 0) return [];
      if (gaps.length === 1) return gaps[0].correctAnswers;
      // multi-gap: return first gap's answers; agent handles full grading via gradeClozeFill
      return gaps[0].correctAnswers;
    }
    case "multiple_choice": {
      const correct = card.choiceOptions?.find((o) => o.isCorrect);
      return correct ? [correct.optionText] : [];
    }
    case "classify": {
      const correct = card.classifyOptions?.find((o) => o.isCorrect);
      return correct ? [correct.name] : [];
    }
    case "error_correction":
      return card.back ? [card.back] : [];
    default:
      return card.back ? [card.back] : [];
  }
}

// ---------------------------------------------------------------------------
// Helper: safely generate question, returning null on any error
// ---------------------------------------------------------------------------

async function tryGenerateQuestion(
  card: DueCard,
  config: GeneratorConfig,
): Promise<string | null> {
  try {
    const result = await generateQuestion(card, config);
    return result?.text ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(
  api: OpenClawPluginApi,
  client: StrusApiClient,
  generatorConfig?: GeneratorConfig,
) {
  // strus_quiz_start
  api.registerTool(
    (ctx: PluginToolCtx): AnyAgentTool => ({
      name: "strus_quiz_start",
      label: "Start a strus quiz session",
      description:
        "Start a Polish morphology quiz session. Fetches due cards from the strus SRS API and begins an interactive drill.",
      parameters: {
        type: "object" as const,
        properties: {
          listId: { type: "string", description: "UUID of a specific vocab list" },
          newLimit: { type: "number", description: "Max new cards (default 20)" },
          limit: { type: "number", description: "Hard cap on total cards" },
          kinds: {
            type: "array",
            items: { type: "string" },
            description: "Filter to specific card kinds (e.g. [\"morph_form\", \"cloze_fill\"])",
          },
          type: {
            type: "string",
            enum: ["morph", "contextual", "all"],
            description:
              "Shorthand filter: \"morph\" = morph_form only; \"contextual\" = cloze_fill + multiple_choice + error_correction + classify; \"all\" = no filter (default)",
          },
        },
        additionalProperties: false,
      },
      async execute(_toolCallId, params) {
        const channelId = ctx.messageChannel ?? "unknown";
        const existing = getSession(channelId);
        if (existing) {
          return jsonResult({ error: "A quiz session is already active. Use strus_quiz_stop first." });
        }

        const p = params as Record<string, unknown>;

        // Resolve kinds filter
        let kinds: CardKind[] | undefined;
        if (p.type === "morph") {
          kinds = ["morph_form"];
        } else if (p.type === "contextual") {
          kinds = ["cloze_fill", "multiple_choice", "error_correction", "classify"];
        } else if (Array.isArray(p.kinds) && p.kinds.length > 0) {
          kinds = p.kinds as CardKind[];
        }

        const cards = await client.getDueCards({
          newLimit: (p.newLimit as number | undefined) ?? 20,
          limit: p.limit as number | undefined,
          interleave: true,
          listId: p.listId as string | undefined,
          kinds,
        });

        if (cards.length === 0) {
          return jsonResult({ error: "No cards due right now." });
        }

        const session = createSession(channelId, cards, "agent");
        const first = currentCard(session)!;

        // Pre-generate question for the first card
        let generatedQuestion: string | null = null;
        if (generatorConfig) {
          generatedQuestion = await tryGenerateQuestion(first, generatorConfig);
          session.currentGeneratedQuestion = generatedQuestion;
          setSession(channelId, session);
        }

        return jsonResult({
          sessionId: channelId,
          total: cards.length,
          firstCard: cardPayload(first),
          generatedQuestion,
        });
      },
    }),
    { name: "strus_quiz_start" },
  );

  // strus_quiz_submit
  api.registerTool(
    (ctx: PluginToolCtx): AnyAgentTool => ({
      name: "strus_quiz_submit",
      label: "Submit a quiz answer",
      description:
        "Submit an answer for the current strus quiz card. Grades the answer and advances to the next card.",
      parameters: {
        type: "object" as const,
        properties: {
          answer: { type: "string", description: "The user's answer" },
        },
        required: ["answer"],
        additionalProperties: false,
      },
      async execute(_toolCallId, params) {
        const channelId = ctx.messageChannel ?? "unknown";
        const session = getSession(channelId);
        if (!session) return jsonResult({ error: "No active quiz session." });

        const card = currentCard(session);
        if (!card) return jsonResult({ error: "No more cards." });

        const answer = (params as Record<string, unknown>).answer as string;

        // Capture the generated question for this card before grading
        const generatedQuestionForReview = session.currentGeneratedQuestion ?? undefined;

        // Use specialised graders for contextual kinds
        let grade;
        if (card.kind === "cloze_fill" && card.clozeGaps && card.clozeGaps.length > 1) {
          grade = gradeClozeFill(answer, card.clozeGaps);
        } else if (card.kind === "multiple_choice" && card.choiceOptions) {
          grade = gradeByIndex(answer, card.choiceOptions.map((o) => ({ text: o.optionText, isCorrect: o.isCorrect })));
        } else if (card.kind === "classify" && card.classifyOptions) {
          grade = gradeByIndex(answer, card.classifyOptions.map((o) => ({ text: o.name, isCorrect: o.isCorrect })));
        } else {
          grade = gradeAnswer(answer, acceptedAnswers(card));
        }

        let scheduledDays = 0;
        if (grade.correct) {
          const review = await client.submitReview(card.id, 3, {
            userAnswer: answer,
            generatedQuestion: generatedQuestionForReview,
          });
          scheduledDays = review.updated.scheduledDays;
          session.correct++;
        } else {
          await client.submitReview(card.id, 1, {
            userAnswer: answer,
            generatedQuestion: generatedQuestionForReview,
          });
        }
        session.total++;

        const next = advanceSession(session);
        const nextCard = next ? cardPayload(next) : null;
        let summary = null;

        // Pre-generate question for the next card
        let generatedQuestion: string | null = null;
        if (next && generatorConfig) {
          generatedQuestion = await tryGenerateQuestion(next, generatorConfig);
          // Reload session after advanceSession persisted it, update generated question
          const updatedSession = getSession(channelId);
          if (updatedSession) {
            updatedSession.currentGeneratedQuestion = generatedQuestion;
            setSession(channelId, updatedSession);
          }
        }

        if (!next) {
          summary = sessionSummary(session);
          deleteSession(channelId);
        }

        return jsonResult({
          correct: grade.correct,
          matchedForm: grade.matchedForm ?? null,
          // return all answer fields so the agent can show the right answer for any card kind
          forms: card.forms,
          back: card.back,
          clozeGaps: card.clozeGaps,
          choiceOptions: card.choiceOptions,
          classifyOptions: card.classifyOptions,
          noteExplanation: card.noteExplanation,
          scheduledDays,
          nextCard,
          generatedQuestion,
          summary,
        });
      },
    }),
    { name: "strus_quiz_submit" },
  );

  // strus_quiz_skip
  api.registerTool(
    (ctx: PluginToolCtx): AnyAgentTool => ({
      name: "strus_quiz_skip",
      label: "Skip the current quiz card",
      description: "Skip the current card without grading. No review is submitted.",
      parameters: { type: "object" as const, properties: {}, additionalProperties: false },
      async execute() {
        const channelId = ctx.messageChannel ?? "unknown";
        const session = getSession(channelId);
        if (!session) return jsonResult({ error: "No active quiz session." });

        session.skipped++;
        const next = advanceSession(session);
        const nextCard = next ? cardPayload(next) : null;

        // Pre-generate question for the next card
        let generatedQuestion: string | null = null;
        if (next && generatorConfig) {
          generatedQuestion = await tryGenerateQuestion(next, generatorConfig);
          const updatedSession = getSession(channelId);
          if (updatedSession) {
            updatedSession.currentGeneratedQuestion = generatedQuestion;
            setSession(channelId, updatedSession);
          }
        }

        if (!next) {
          const summary = sessionSummary(session);
          deleteSession(channelId);
          return jsonResult({ nextCard: null, generatedQuestion: null, summary });
        }
        return jsonResult({ nextCard, generatedQuestion });
      },
    }),
    { name: "strus_quiz_skip" },
  );

  // strus_quiz_reveal
  api.registerTool(
    (ctx: PluginToolCtx): AnyAgentTool => ({
      name: "strus_quiz_reveal",
      label: "Reveal the current card's answer",
      description:
        "Show the correct answer for the current card without grading. Advances to the next card.",
      parameters: { type: "object" as const, properties: {}, additionalProperties: false },
      async execute() {
        const channelId = ctx.messageChannel ?? "unknown";
        const session = getSession(channelId);
        if (!session) return jsonResult({ error: "No active quiz session." });

        const card = currentCard(session);
        if (!card) return jsonResult({ error: "No more cards." });

        session.skipped++;
        const next = advanceSession(session);
        const nextCard = next ? cardPayload(next) : null;

        // Return both forms and back — agent picks whichever is relevant for the card kind
        const revealed = card.kind === "morph_form"
          ? { forms: card.forms, back: null, noteExplanation: null }
          : {
              forms: [],
              back: card.back,
              clozeGaps: card.clozeGaps,
              choiceOptions: card.choiceOptions,
              classifyOptions: card.classifyOptions,
              noteExplanation: card.noteExplanation,
            };

        // Pre-generate question for the next card
        let generatedQuestion: string | null = null;
        if (next && generatorConfig) {
          generatedQuestion = await tryGenerateQuestion(next, generatorConfig);
          const updatedSession = getSession(channelId);
          if (updatedSession) {
            updatedSession.currentGeneratedQuestion = generatedQuestion;
            setSession(channelId, updatedSession);
          }
        }

        if (!next) {
          const summary = sessionSummary(session);
          deleteSession(channelId);
          return jsonResult({ ...revealed, nextCard: null, generatedQuestion: null, summary });
        }
        return jsonResult({ ...revealed, nextCard, generatedQuestion });
      },
    }),
    { name: "strus_quiz_reveal" },
  );

  // strus_quiz_stop
  api.registerTool(
    (ctx: PluginToolCtx): AnyAgentTool => ({
      name: "strus_quiz_stop",
      label: "Stop the current quiz session",
      description: "End the active quiz session and return a summary.",
      parameters: { type: "object" as const, properties: {}, additionalProperties: false },
      async execute() {
        const channelId = ctx.messageChannel ?? "unknown";
        const session = getSession(channelId);
        if (!session) return jsonResult({ error: "No active quiz session." });
        const summary = sessionSummary(session);
        deleteSession(channelId);
        return jsonResult(summary);
      },
    }),
    { name: "strus_quiz_stop" },
  );
}
