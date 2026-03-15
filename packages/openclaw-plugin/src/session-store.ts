/** File-backed quiz session store, keyed by channelId. Survives gateway restarts. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { DueCard } from "./api-client.js";

export interface QuizSession {
  channelId: string;
  cards: DueCard[];
  index: number;
  correct: number;
  total: number;
  skipped: number;
  mode: "slash" | "agent";
  /** LLM-generated question text for the current card, or null if not generated. */
  currentGeneratedQuestion?: string | null;
}

// File path for persistence — same file the agent skill uses for routing
const SESSION_FILE =
  process.env.STRUS_SESSION_FILE ??
  `${process.env.HOME ?? "/Users/claw"}/.openclaw/workspace/memory/strus-quiz-session.json`;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadAll(): Map<string, QuizSession> {
  try {
    if (!existsSync(SESSION_FILE)) return new Map();
    const raw = readFileSync(SESSION_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Map(parsed.map((s: QuizSession) => [s.channelId, s]));
    }
    // Legacy format: single session object with a `channel` field
    if (parsed && typeof parsed === "object" && parsed.channel) {
      const session: QuizSession = {
        channelId: parsed.channel,
        cards: parsed.cards ?? [],
        index: parsed.index ?? 0,
        correct: parsed.correct ?? 0,
        total: parsed.total ?? 0,
        skipped: parsed.skipped ?? 0,
        mode: parsed.mode ?? "slash",
      };
      return new Map([[session.channelId, session]]);
    }
    return new Map();
  } catch {
    return new Map();
  }
}

function saveAll(sessions: Map<string, QuizSession>): void {
  ensureDir(SESSION_FILE);
  writeFileSync(SESSION_FILE, JSON.stringify([...sessions.values()], null, 2), "utf8");
}

export function getSession(channelId: string): QuizSession | undefined {
  return loadAll().get(channelId);
}

export function setSession(channelId: string, session: QuizSession): void {
  const all = loadAll();
  all.set(channelId, session);
  saveAll(all);
}

export function deleteSession(channelId: string): boolean {
  const all = loadAll();
  const existed = all.delete(channelId);
  if (existed) saveAll(all);
  return existed;
}

export function hasSession(channelId: string): boolean {
  return loadAll().has(channelId);
}

export function createSession(
  channelId: string,
  cards: DueCard[],
  mode: "slash" | "agent",
): QuizSession {
  const session: QuizSession = {
    channelId,
    cards,
    index: 0,
    correct: 0,
    total: 0,
    skipped: 0,
    mode,
  };
  const all = loadAll();
  all.set(channelId, session);
  saveAll(all);
  return session;
}

export function currentCard(session: QuizSession): DueCard | undefined {
  return session.cards[session.index];
}

export function advanceSession(session: QuizSession): DueCard | undefined {
  session.index++;
  const all = loadAll();
  all.set(session.channelId, session);
  saveAll(all);
  return session.cards[session.index];
}

export function sessionSummary(session: QuizSession) {
  const pct = session.total > 0 ? Math.round((session.correct / session.total) * 100) : 0;
  return { correct: session.correct, total: session.total, pct, skipped: session.skipped };
}
