/** File-backed store for pending import disambiguation, keyed by channelId. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface DisambigGroup {
  /** Human-readable surface form(s), e.g. "mają" */
  key: string;
  candidates: Array<{ lemma: string; pos: string }>;
}

export interface PendingImport {
  channelId: string;
  /** Original text passed to /strus add */
  text: string;
  listId?: string;
  groups: DisambigGroup[];
  /** Index into groups[] of the group currently awaiting the user's pick */
  groupIndex: number;
  /** Resolved selections so far: groupKey → chosen lemma ('' = skip) */
  selections: Record<string, string>;
}

const IMPORT_FILE =
  process.env.STRUS_IMPORT_FILE ??
  `${process.env.HOME ?? "/Users/claw"}/.openclaw/workspace/memory/strus-pending-import.json`;

function ensureDir(p: string) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function loadAll(): Map<string, PendingImport> {
  try {
    if (!existsSync(IMPORT_FILE)) return new Map();
    const parsed = JSON.parse(readFileSync(IMPORT_FILE, "utf8"));
    if (Array.isArray(parsed)) return new Map(parsed.map((p: PendingImport) => [p.channelId, p]));
    return new Map();
  } catch {
    return new Map();
  }
}

function saveAll(map: Map<string, PendingImport>) {
  ensureDir(IMPORT_FILE);
  writeFileSync(IMPORT_FILE, JSON.stringify([...map.values()], null, 2), "utf8");
}

export function getPending(channelId: string): PendingImport | undefined {
  return loadAll().get(channelId);
}

export function setPending(p: PendingImport): void {
  const all = loadAll();
  all.set(p.channelId, p);
  saveAll(all);
}

export function deletePending(channelId: string): void {
  const all = loadAll();
  all.delete(channelId);
  saveAll(all);
}
