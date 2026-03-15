/** Slash command handlers for /strus and /s. */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { DueCard, StrusApiClient } from "./api-client.js";
import { gradeAnswer, gradeByIndex, gradeClozeFill } from "./grader.js";
import {
  createSession,
  getSession,
  deleteSession,
  currentCard,
  advanceSession,
  sessionSummary,
} from "./session-store.js";
import {
  getPending,
  setPending,
  deletePending,
  type DisambigGroup,
} from "./import-store.js";
import { tagLabel } from "./tag-labels.js";

// ---------------------------------------------------------------------------
// Question formatting
// ---------------------------------------------------------------------------

function formatQuestion(card: DueCard, mode: "slash" | "agent"): string {
  const hint =
    mode === "slash"
      ? "*(type `/s <answer>` · `/s ?` to reveal · `/strus stop` to quit)*"
      : "*(type your answer · `?` to reveal · `skip` to skip)*";

  switch (card.kind) {
    case "morph_form":
      return `📖 **${card.lemmaText}** → *${tagLabel(card.tag ?? "")}?*\n${hint}`;
    case "gloss_forward":
      return `🇵🇱 **${card.front}** → *translation?*\n${hint}`;
    case "gloss_reverse":
      return `🇬🇧 **${card.front}** → *Polish?*\n${hint}`;
    case "basic_forward":
      return `❓ **${card.front}**\n${hint}`;
    case "cloze_fill": {
      // Replace {{N}} markers with ___
      const rendered = (card.sentenceText ?? "").replace(/\{\{\d+\}\}/g, "___");
      // Collect hints from all gaps
      const hints = (card.clozeGaps ?? [])
        .map((g) => g.hint)
        .filter((h): h is string => h != null);
      const hintLine = hints.length > 0 ? `\n*(hint: ${hints.join(" / ")})*` : "";
      const lemmaLine = card.lemmaText ? `🔲 **${card.lemmaText}**\n` : "🔲 ";
      return `${lemmaLine}${rendered}${hintLine}\n${hint}`;
    }
    case "multiple_choice": {
      const sentenceLine = card.sentenceText ? `${card.sentenceText}\n` : "";
      const options = (card.choiceOptions ?? [])
        .map((o, i) => `${i + 1}. ${o.optionText}`)
        .join("\n");
      return `🔤 ${sentenceLine}${options}\n${hint}`;
    }
    case "error_correction":
      return `✏️ Find and fix the error:\n${card.sentenceText ?? ""}\n${hint}`;
    case "classify": {
      const sentenceLine = card.sentenceText ? `${card.sentenceText}\n` : "";
      const options = (card.classifyOptions ?? [])
        .map((o, i) => `${i + 1}. ${o.name}${o.description ? ` — ${o.description}` : ""}`)
        .join("\n");
      return `🏷️ Classify:\n${sentenceLine}${options}\n${hint}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Answer helpers
// ---------------------------------------------------------------------------

function acceptedAnswers(card: DueCard): string[] {
  switch (card.kind) {
    case "morph_form":
      return card.forms;
    case "cloze_fill": {
      const gaps = card.clozeGaps;
      if (!gaps || gaps.length === 0) return [];
      if (gaps.length === 1) return gaps[0].correctAnswers;
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

function answerDisplay(card: DueCard): string {
  switch (card.kind) {
    case "morph_form":
      return card.forms.join(" / ");
    case "cloze_fill": {
      const gaps = card.clozeGaps ?? [];
      if (gaps.length === 0) return "—";
      return gaps.map((g) => g.correctAnswers[0] ?? "?").join(", ");
    }
    case "multiple_choice": {
      const correct = card.choiceOptions?.find((o) => o.isCorrect);
      return correct ? correct.optionText : "—";
    }
    case "classify": {
      const correct = card.classifyOptions?.find((o) => o.isCorrect);
      return correct ? correct.name : "—";
    }
    default:
      return card.back ?? "—";
  }
}

// ---------------------------------------------------------------------------
// Disambiguation helpers
// ---------------------------------------------------------------------------

/**
 * Group ambiguous candidates by the set of surface forms that triggered them.
 * Mirrors the web UI's groupAmbiguous() logic.
 */
function buildDisambigGroups(
  candidates: Array<{ lemma: string; pos: string; formsFound: string[]; ambiguous: boolean }>,
): DisambigGroup[] {
  const map = new Map<string, DisambigGroup>();
  for (const c of candidates) {
    if (!c.ambiguous) continue;
    const key = [...c.formsFound].sort().join(", ");
    const existing = map.get(key);
    if (existing) {
      existing.candidates.push({ lemma: c.lemma, pos: c.pos });
    } else {
      map.set(key, { key, candidates: [{ lemma: c.lemma, pos: c.pos }] });
    }
  }
  return [...map.values()];
}

/** Format a single disambiguation prompt for one group. */
function formatDisambigPrompt(group: DisambigGroup, groupIndex: number, total: number): string {
  const header =
    total > 1
      ? `⚠️ **${group.key}** is ambiguous (${groupIndex + 1}/${total}) — which lemma did you mean?\n`
      : `⚠️ **${group.key}** is ambiguous — which lemma did you mean?\n`;

  const options = group.candidates
    .map((c, i) => `${i + 1}️⃣ **${c.lemma}** *(${c.pos})*`)
    .join("\n");

  return `${header}${options}\n0️⃣ Skip this word\n\nReply with \`/strus pick <number>\``;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function formatSummary(correct: number, total: number, skipped: number): string {
  if (total === 0) return "Session ended.";
  const pct = Math.round((correct / total) * 100);
  return `📊 **Session complete!**\nScore: ${correct}/${total} (${pct}%)\nCards reviewed: ${total} · Cards skipped/revealed: ${skipped}`;
}

// ---------------------------------------------------------------------------
// Arg parser
// ---------------------------------------------------------------------------

function parseArgs(raw: string): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  const tokens = raw.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--") && i + 1 < tokens.length) {
      flags[t.slice(2)] = tokens[++i];
    } else {
      positional.push(t);
    }
  }
  return { flags, positional };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCommands(api: OpenClawPluginApi, client: StrusApiClient) {
  api.registerCommand({
    name: "strus",
    description: "Polish SRS drill system — stats, add, lists, quiz, stop, pick",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      const { flags, positional } = parseArgs(args);
      const sub = positional[0] ?? "";
      const channelId = ctx.channel;

      switch (sub) {
        case "stats":  return handleStats(client);
        case "add":    return handleAdd(client, channelId, positional.slice(1).join(" "), flags["list"]);
        case "lists":  return handleLists(client);
        case "quiz":   return handleQuiz(client, channelId, flags);
        case "stop":   return handleStop(channelId);
        case "pick":   return handlePick(client, channelId, positional[1] ?? "");
        default:
          return {
            text: "Unknown subcommand. Usage: `/strus stats` · `/strus add <word>` · `/strus lists` · `/strus quiz` · `/strus stop` · `/strus pick <n>`",
          };
      }
    },
  });

  // /s <answer> — short quiz answer command
  api.registerCommand({
    name: "s",
    description: "Answer the current strus quiz card",
    acceptsArgs: true,
    handler: async (ctx) => {
      const answer = (ctx.args ?? "").trim();
      return handleAnswer(client, ctx.channel, answer);
    },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleStats(client: StrusApiClient) {
  const stats = await client.getStats();
  return {
    text: `📊 **Strus stats**\n- Lemmas: ${stats.lemmaCount}\n- Lists: ${stats.listCount}\n- Due cards: ${stats.dueCount}`,
  };
}

async function handleAdd(
  client: StrusApiClient,
  channelId: string,
  word: string,
  listName?: string,
) {
  if (!word) return { text: "Usage: `/strus add <word> [--list <name>]`" };

  // Resolve list name → id if provided
  let listId: string | undefined;
  if (listName) {
    const lists = await client.getLists();
    const match = lists.find((l) => l.name.toLowerCase() === listName.toLowerCase());
    if (!match) return { text: `List "${listName}" not found.` };
    listId = match.id;
  }

  // Preview first to detect ambiguity
  const preview = await client.importPreview({ text: word, listId });
  const ambigGroups = buildDisambigGroups(preview.candidates);

  if (ambigGroups.length > 0) {
    // Store pending state and show first group
    setPending({
      channelId,
      text: word,
      listId,
      groups: ambigGroups,
      groupIndex: 0,
      selections: {},
    });
    return { text: formatDisambigPrompt(ambigGroups[0], 0, ambigGroups.length) };
  }

  // No ambiguity — commit directly
  return commitImport(client, word, listId, []);
}

async function handlePick(client: StrusApiClient, channelId: string, raw: string) {
  const pending = getPending(channelId);
  if (!pending) {
    return { text: "No pending import disambiguation. Use `/strus add <word>` first." };
  }

  const n = parseInt(raw, 10);
  const group = pending.groups[pending.groupIndex];
  if (!group) {
    deletePending(channelId);
    return { text: "Something went wrong — no active group. Import cancelled." };
  }

  if (isNaN(n) || n < 0 || n > group.candidates.length) {
    const max = group.candidates.length;
    return { text: `Please reply with a number between 0 and ${max}. 0 = skip, 1–${max} = pick a lemma.` };
  }

  // Record selection
  const chosen = n === 0 ? "" : (group.candidates[n - 1]?.lemma ?? "");
  pending.selections[group.key] = chosen;
  pending.groupIndex++;

  // More groups to resolve?
  if (pending.groupIndex < pending.groups.length) {
    setPending(pending);
    const nextGroup = pending.groups[pending.groupIndex];
    return { text: formatDisambigPrompt(nextGroup, pending.groupIndex, pending.groups.length) };
  }

  // All groups resolved — commit
  deletePending(channelId);
  const includeLemmas = Object.values(pending.selections).filter(Boolean);
  return commitImport(client, pending.text, pending.listId, includeLemmas);
}

async function commitImport(
  client: StrusApiClient,
  text: string,
  listId: string | undefined,
  includeLemmas: string[],
) {
  const result = await client.importText({ text, listId, includeLemmas });
  const lines: string[] = [];
  for (const c of result.created) lines.push(`✅ Added **${c.lemma}** (${c.pos})`);
  for (const s of result.skipped) {
    if (s.reason !== "ambiguous") lines.push(`⏭️ Skipped **${s.lemma}** — ${s.reason}`);
  }
  if (result.unknownTokens.length > 0) lines.push(`❓ Unknown: ${result.unknownTokens.join(", ")}`);
  if (lines.length === 0) lines.push("Nothing to import.");
  return { text: lines.join("\n") };
}

async function handleLists(client: StrusApiClient) {
  const lists = await client.getLists();
  if (lists.length === 0) return { text: "No vocab lists found." };
  const lines = lists.map((l) => `- **${l.name}**${l.description ? ` — ${l.description}` : ""}`);
  return { text: `📋 **Vocab lists**\n${lines.join("\n")}` };
}

async function handleQuiz(
  client: StrusApiClient,
  channelId: string,
  flags: Record<string, string>,
) {
  const existing = getSession(channelId);
  if (existing) {
    return { text: "A quiz is already active. Use `/strus stop` to end it first." };
  }

  let listId: string | undefined;
  if (flags["list"]) {
    const lists = await client.getLists();
    const match = lists.find((l) => l.name.toLowerCase() === flags["list"].toLowerCase());
    if (!match) return { text: `List "${flags["list"]}" not found.` };
    listId = match.id;
  }

  const newLimit = flags["new-limit"] ? parseInt(flags["new-limit"], 10) : 20;
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : undefined;

  const cards = await client.getDueCards({ newLimit, limit, interleave: true, listId });
  if (cards.length === 0) {
    return { text: "🎉 No cards due right now! Come back later." };
  }

  const session = createSession(channelId, cards, "slash");
  const card = currentCard(session)!;
  return { text: formatQuestion(card, "slash") };
}

function handleStop(channelId: string) {
  const session = getSession(channelId);
  if (!session) return { text: "No active quiz session." };
  const summary = sessionSummary(session);
  deleteSession(channelId);
  return { text: formatSummary(summary.correct, summary.total, summary.skipped) };
}

async function handleAnswer(client: StrusApiClient, channelId: string, answer: string) {
  const session = getSession(channelId);
  if (!session) return { text: "No active quiz. Use `/strus quiz` to start." };

  const card = currentCard(session);
  if (!card) {
    const summary = sessionSummary(session);
    deleteSession(channelId);
    return { text: formatSummary(summary.correct, summary.total, summary.skipped) };
  }

  // Reveal
  if (answer === "?") {
    session.skipped++;
    const display = answerDisplay(card);
    const explanationSuffix =
      card.noteExplanation &&
      ["cloze_fill", "multiple_choice", "error_correction", "classify"].includes(card.kind)
        ? `\n📝 ${card.noteExplanation}`
        : "";
    const revealText = `👁️ **${display}** *(not rated)*${explanationSuffix}`;
    const next = advanceSession(session);
    if (!next) {
      const summary = sessionSummary(session);
      deleteSession(channelId);
      return { text: `${revealText}\n\n${formatSummary(summary.correct, summary.total, summary.skipped)}` };
    }
    return { text: `${revealText}\n\n${formatQuestion(next, "slash")}` };
  }

  // Grade — use specialised graders for contextual kinds
  let result;
  if (card.kind === "cloze_fill" && card.clozeGaps && card.clozeGaps.length > 1) {
    result = gradeClozeFill(answer, card.clozeGaps);
  } else if (card.kind === "multiple_choice" && card.choiceOptions) {
    result = gradeByIndex(answer, card.choiceOptions.map((o) => ({ text: o.optionText, isCorrect: o.isCorrect })));
  } else if (card.kind === "classify" && card.classifyOptions) {
    result = gradeByIndex(answer, card.classifyOptions.map((o) => ({ text: o.name, isCorrect: o.isCorrect })));
  } else {
    result = gradeAnswer(answer, acceptedAnswers(card));
  }

  // Append noteExplanation for contextual kinds
  const explanationSuffix =
    card.noteExplanation &&
    ["cloze_fill", "multiple_choice", "error_correction", "classify"].includes(card.kind)
      ? `\n📝 ${card.noteExplanation}`
      : "";

  let responseText: string;

  if (result.correct) {
    const review = await client.submitReview(card.id, 3);
    const days = review.updated.scheduledDays;
    session.correct++;
    session.total++;
    responseText = `✅ **${result.matchedForm}** — right! Next in ${days}d${explanationSuffix}`;
  } else {
    await client.submitReview(card.id, 1);
    session.total++;
    responseText = `❌ You said *${answer}* — correct: **${answerDisplay(card)}**${explanationSuffix}`;
  }

  const next = advanceSession(session);
  if (!next) {
    const summary = sessionSummary(session);
    deleteSession(channelId);
    return { text: `${responseText}\n\n${formatSummary(summary.correct, summary.total, summary.skipped)}` };
  }

  return { text: `${responseText}\n\n${formatQuestion(next, "slash")}` };
}
