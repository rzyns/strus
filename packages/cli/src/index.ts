#!/usr/bin/env bun
/**
 * @rzyns/strus-cli — Command-line interface for the strus SRS system.
 *
 * The CLI communicates with the strus API server. By default it hits
 * http://localhost:3457, configurable via STRUS_API_URL.
 *
 * TODO: Replace raw fetch calls with a type-safe oRPC client once the
 *       @orpc/client adapter is set up:
 *
 *   import { createClient } from '@orpc/client'
 *   import type { Router } from '@rzyns/strus-api'
 *   const client = createClient<Router>({ url: API_URL + '/rpc' })
 */

import { Command } from "commander";
import * as readline from "readline";
import { Rating } from "@rzyns/strus-core";

import { getCliConfig } from "@rzyns/strus-config";
const { STRUS_API_URL: API_URL } = getCliConfig();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Readline helper for interactive quiz
// ---------------------------------------------------------------------------

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    const lines: string[] = [];
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command()
  .name("strus")
  .description("Polish morphological spaced repetition system")
  .version("0.0.1");

// ---------------------------------------------------------------------------
// strus list
// ---------------------------------------------------------------------------

const listCmd = program.command("list").description("Vocabulary list commands");

listCmd
  .command("create <name>")
  .description("Create a new vocabulary list")
  .action(async (name: string) => {
    const list = await apiPost<{ id: string; name: string }>("/api/lists", {
      name,
    });
    console.log(`Created list "${list.name}" (id: ${list.id})`);
  });

listCmd
  .command("ls")
  .description("List all vocabulary lists")
  .action(async () => {
    const lists = await apiGet<Array<{ id: string; name: string; description?: string }>>(
      "/api/lists",
    );
    if (lists.length === 0) {
      console.log("No lists yet. Create one with: strus list create <name>");
      return;
    }
    for (const l of lists) {
      console.log(`${l.id}  ${l.name}${l.description ? `  — ${l.description}` : ""}`);
    }
  });

listCmd
  .command("get <id>")
  .description("Get a vocabulary list by ID")
  .action(async (id: string) => {
    const list = await apiGet<{
      id: string;
      name: string;
      description: string | null;
      createdAt: string;
    }>(`/api/lists/${encodeURIComponent(id)}`);
    console.log(`id          : ${list.id}`);
    console.log(`name        : ${list.name}`);
    console.log(`description : ${list.description ?? "(none)"}`);
    console.log(`createdAt   : ${list.createdAt}`);
  });

listCmd
  .command("delete <id>")
  .description("Delete a vocabulary list")
  .action(async (id: string) => {
    await apiDelete<{ success: true }>(`/api/lists/${encodeURIComponent(id)}`);
    console.log(`Deleted list ${id}`);
  });

listCmd
  .command("add-lemma <listId> <lemmaId>")
  .description("Add a lemma to a vocabulary list")
  .action(async (listId: string, lemmaId: string) => {
    await apiPost<{ success: true }>(
      `/api/lists/${encodeURIComponent(listId)}/lemmas`,
      { listId, lemmaId },
    );
    console.log(`Added lemma ${lemmaId} to list ${listId}`);
  });

listCmd
  .command("add-note")
  .description("Add a note directly to a vocabulary list")
  .requiredOption("--list <listId>", "ID of the vocabulary list")
  .requiredOption("--note <noteId>", "ID of the note to add")
  .action(async (opts: { list: string; note: string }) => {
    await apiPost<{ success: true }>(
      `/api/lists/${encodeURIComponent(opts.list)}/notes`,
      { listId: opts.list, noteId: opts.note },
    );
    console.log(`Added note ${opts.note} to list ${opts.list}`);
  });

// ---------------------------------------------------------------------------
// strus lemma
// ---------------------------------------------------------------------------

const lemmaCmd = program
  .command("lemma")
  .description("Lemma (vocabulary entry) commands");

lemmaCmd
  .command("add <lemma>")
  .description("Add a new lemma; auto-generates word forms + learning targets via Morfeusz2")
  .option("-l, --list <listId>", "Add to this list")
  .option("-p, --pos <pos>", "Part of speech (e.g. subst, verb, adj)", "subst")
  .option("-m, --manual", "Skip Morfeusz2; supply forms manually later (source=manual)")
  .action(async (lemma: string, opts: { list?: string; pos?: string; manual?: boolean }) => {
    const result = await apiPost<{ id: string; lemma: string; source: string }>(
      "/api/lemmas",
      {
        lemma,
        pos: opts.pos ?? "subst",
        source: opts.manual ? "manual" : "morfeusz",
        listId: opts.list,
      },
    );
    console.log(
      `Added lemma "${result.lemma}" [${result.source}] (id: ${result.id})` +
      (opts.list ? ` to list ${opts.list}` : ""),
    );
  });

lemmaCmd
  .command("ls")
  .description("List all lemmas")
  .option("-l, --list <listId>", "Filter by list")
  .action(async (opts: { list?: string }) => {
    const url = opts.list
      ? `/api/lemmas?listId=${encodeURIComponent(opts.list)}`
      : "/api/lemmas";
    const items = await apiGet<Array<{ id: string; lemma: string; pos: string; source: string }>>(url);
    if (items.length === 0) {
      console.log("No lemmas found.");
      return;
    }
    for (const l of items) {
      console.log(`${l.id}  ${l.lemma}  (${l.pos}) [${l.source}]`);
    }
  });

lemmaCmd
  .command("get <id>")
  .description("Get a lemma by ID")
  .action(async (id: string) => {
    const l = await apiGet<{
      id: string;
      lemma: string;
      pos: string;
      source: string;
      notes: string | null;
      createdAt: string;
      updatedAt: string;
    }>(`/api/lemmas/${encodeURIComponent(id)}`);
    console.log(`id        : ${l.id}`);
    console.log(`lemma     : ${l.lemma}`);
    console.log(`pos       : ${l.pos}`);
    console.log(`source    : ${l.source}`);
    console.log(`notes     : ${l.notes ?? "(none)"}`);
    console.log(`createdAt : ${l.createdAt}`);
    console.log(`updatedAt : ${l.updatedAt}`);
  });

lemmaCmd
  .command("delete <id>")
  .description("Delete a lemma")
  .action(async (id: string) => {
    await apiDelete<{ success: true }>(`/api/lemmas/${encodeURIComponent(id)}`);
    console.log(`Deleted lemma ${id}`);
  });

// ---------------------------------------------------------------------------
// strus card
// ---------------------------------------------------------------------------

const cardCmd = program.command("card").description("Basic card (flashcard) commands");

cardCmd
  .command("add <front> <back>")
  .description("Create a basic note with a front/back card")
  .option("-l, --list <listId>", "Add to this list")
  .action(async (front: string, back: string, opts: { list?: string }) => {
    const result = await apiPost<{ id: string; kind: string; front: string | null; back: string | null }>(
      "/api/notes",
      { front, back, listId: opts.list },
    );
    console.log(
      `Created basic card (note id: ${result.id})` +
      (opts.list ? ` in list ${opts.list}` : ""),
    );
  });

cardCmd
  .command("ls")
  .description("List basic notes")
  .action(async () => {
    const items = await apiGet<Array<{
      id: string; kind: string; front: string | null; back: string | null;
    }>>("/api/notes?kind=basic");
    if (items.length === 0) {
      console.log("No basic cards yet. Create one with: strus card add <front> <back>");
      return;
    }
    for (const n of items) {
      const frontPreview = (n.front ?? "").substring(0, 30);
      const backPreview = (n.back ?? "").substring(0, 30);
      console.log(`${n.id}  ${frontPreview}  →  ${backPreview}`);
    }
  });

cardCmd
  .command("get <id>")
  .description("Get a note with its cards")
  .action(async (id: string) => {
    const n = await apiGet<{
      id: string; kind: string; front: string | null; back: string | null;
      createdAt: string; updatedAt: string;
      cards: Array<{ id: string; kind: string; state: number; due: string }>;
    }>(`/api/notes/${encodeURIComponent(id)}`);
    console.log(`id        : ${n.id}`);
    console.log(`kind      : ${n.kind}`);
    console.log(`front     : ${n.front ?? "(none)"}`);
    console.log(`back      : ${n.back ?? "(none)"}`);
    console.log(`createdAt : ${n.createdAt}`);
    console.log(`updatedAt : ${n.updatedAt}`);
    if (n.cards.length > 0) {
      console.log(`cards     :`);
      for (const c of n.cards) {
        console.log(`  ${c.id}  ${c.kind}  state=${c.state}  due=${c.due}`);
      }
    }
  });

cardCmd
  .command("delete <id>")
  .description("Delete a note and its cards")
  .action(async (id: string) => {
    await apiDelete<{ success: true }>(`/api/notes/${encodeURIComponent(id)}`);
    console.log(`Deleted note ${id}`);
  });

cardCmd
  .command("edit <id>")
  .description("Update front/back of a basic note")
  .option("-f, --front <text>", "New front text")
  .option("-b, --back <text>", "New back text")
  .action(async (id: string, opts: { front?: string; back?: string }) => {
    if (!opts.front && !opts.back) {
      console.log("Nothing to update. Use --front and/or --back.");
      return;
    }
    const body: Record<string, string> = { id };
    if (opts.front) body.front = opts.front;
    if (opts.back) body.back = opts.back;
    const result = await apiPatch<{ id: string; front: string | null; back: string | null }>(
      `/api/notes/${encodeURIComponent(id)}`,
      body,
    );
    console.log(`Updated note ${result.id}`);
    console.log(`  front: ${result.front ?? "(none)"}`);
    console.log(`  back:  ${result.back ?? "(none)"}`);
  });

// ---------------------------------------------------------------------------
// strus gloss
// ---------------------------------------------------------------------------

const glossCmd = program.command("gloss").description("Gloss note (translation) commands");

glossCmd
  .command("add <lemmaId> <translation>")
  .description("Create a gloss note (lemma + translation → two cards)")
  .option("-l, --list <listId>", "Add to this list")
  .action(async (lemmaId: string, translation: string, opts: { list?: string }) => {
    const result = await apiPost<{ id: string; kind: string; back: string | null }>(
      "/api/notes",
      { kind: "gloss", lemmaId, back: translation, listId: opts.list },
    );
    console.log(
      `Created gloss note (id: ${result.id}, translation: "${result.back}")` +
      (opts.list ? ` in list ${opts.list}` : ""),
    );
  });

glossCmd
  .command("ls")
  .description("List gloss notes")
  .action(async () => {
    const items = await apiGet<Array<{
      id: string; kind: string; lemmaId: string | null; back: string | null;
    }>>("/api/notes?kind=gloss");
    if (items.length === 0) {
      console.log("No gloss notes yet. Create one with: strus gloss add <lemmaId> <translation>");
      return;
    }
    for (const n of items) {
      const backPreview = (n.back ?? "").substring(0, 40);
      console.log(`${n.id}  lemma:${n.lemmaId ?? "?"}  →  ${backPreview}`);
    }
  });

glossCmd
  .command("get <id>")
  .description("Get a gloss note with its cards")
  .action(async (id: string) => {
    const n = await apiGet<{
      id: string; kind: string; lemmaId: string | null; front: string | null; back: string | null;
      lemma: string | null;
      createdAt: string; updatedAt: string;
      cards: Array<{ id: string; kind: string; state: number; due: string }>;
    }>(`/api/notes/${encodeURIComponent(id)}`);
    console.log(`id        : ${n.id}`);
    console.log(`kind      : ${n.kind}`);
    console.log(`lemma     : ${n.lemma ?? "(none)"}`);
    console.log(`back      : ${n.back ?? "(none)"}`);
    console.log(`createdAt : ${n.createdAt}`);
    console.log(`updatedAt : ${n.updatedAt}`);
    if (n.cards.length > 0) {
      console.log(`cards     :`);
      for (const c of n.cards) {
        console.log(`  ${c.id}  ${c.kind}  state=${c.state}  due=${c.due}`);
      }
    }
  });

glossCmd
  .command("delete <id>")
  .description("Delete a gloss note and its cards")
  .action(async (id: string) => {
    await apiDelete<{ success: true }>(`/api/notes/${encodeURIComponent(id)}`);
    console.log(`Deleted gloss note ${id}`);
  });

glossCmd
  .command("edit <id> <newTranslation>")
  .description("Update the translation of a gloss note")
  .action(async (id: string, newTranslation: string) => {
    const result = await apiPatch<{ id: string; back: string | null }>(
      `/api/notes/${encodeURIComponent(id)}`,
      { id, back: newTranslation },
    );
    console.log(`Updated gloss note ${result.id}`);
    console.log(`  translation: ${result.back ?? "(none)"}`);
  });

// ---------------------------------------------------------------------------
// strus quiz
// ---------------------------------------------------------------------------

program
  .command("quiz")
  .description("Interactive terminal quiz for due cards")
  .option("-l, --list <listId>", "Filter by list")
  .option("-n, --limit <n>", "Hard cap on total session size", "100")
  .option("--new-limit <n>", "Max new (state=0) cards per session", "20")
  .option("--no-interleave", "Disable lemma interleaving (serve in order)")
  .option("-k, --kind <kind>", "Card kind filter: morph | gloss | basic | all", "all")
  .option("-d, --direction <dir>", "Gloss direction: to-english | to-polish | both", "both")
  .option("-t, --tag <pattern>", "Filter morph_form cards by tag substring")
  .action(async (opts: {
    list?: string; limit?: string; newLimit?: string; interleave: boolean;
    kind: string; direction: string; tag?: string;
  }) => {
    const limit = Number(opts.limit ?? 100);
    const newLimit = Number(opts.newLimit ?? 20);
    const qs = new URLSearchParams();
    if (opts.list) qs.set("listId", opts.list);
    qs.set("limit", String(limit));
    qs.set("newLimit", String(newLimit));
    qs.set("interleave", String(opts.interleave));

    // Resolve kinds[] from --kind and --direction flags
    let kinds: string[] | undefined;
    switch (opts.kind) {
      case "morph": kinds = ["morph_form"]; break;
      case "gloss":
        if (opts.direction === "to-english") kinds = ["gloss_forward"];
        else if (opts.direction === "to-polish") kinds = ["gloss_reverse"];
        else kinds = ["gloss_forward", "gloss_reverse"];
        break;
      case "basic": kinds = ["basic_forward"]; break;
      // "all" → omit kinds param
    }
    if (kinds) {
      for (const k of kinds) qs.append("kinds", k);
    }
    if (opts.tag) qs.set("tagContains", opts.tag);

    interface DueCard {
      id: string;
      kind: string;
      lemmaId: string;
      tag: string;
      state: number;
      lemmaText: string | null;
      front: string | null;
      back: string | null;
      forms: string[];
    }

    const due = await apiGet<DueCard[]>(`/api/session/due?${qs.toString()}`);

    if (due.length === 0) {
      console.log("No cards due right now. Come back later!");
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(`\nStarting quiz: ${due.length} card(s) due.\n`);

    let reviewed = 0;
    let correct = 0;

    for (const card of due) {
      const isReveal = card.kind === "basic_forward" || card.kind === "gloss_forward" || card.kind === "gloss_reverse" || card.forms.length === 0;

      console.log(`\n[${reviewed + 1}/${due.length}]`);
      if (isReveal && card.front) {
        const label = card.kind === "basic_forward" ? "Basic" : card.kind === "gloss_forward" ? "Gloss (→ meaning)" : card.kind === "gloss_reverse" ? "Gloss (→ word)" : "Card";
        console.log(`${label}    : ${card.front}`);
      } else {
        console.log(`Lemma     : ${card.lemmaText ?? "(unknown)"}`);
        console.log(`Tag       : ${card.tag}`);
      }
      console.log("─".repeat(40));

      let rating: Rating;

      if (isReveal) {
        // Reveal flow: basic cards, gloss cards, or morph with no forms
        await prompt(rl, "Press Enter to reveal...");
        if (card.back) {
          console.log(`\nAnswer: ${card.back}`);
        } else {
          console.log("\nNo answer on record.");
        }
        console.log("\nRate your recall:");
        console.log("  1 = Again  (forgot)");
        console.log("  2 = Hard   (recalled with difficulty)");
        console.log("  3 = Good   (recalled correctly)");
        console.log("  4 = Easy   (perfect recall)");
        let r: Rating | undefined;
        while (r === undefined) {
          const raw = (await prompt(rl, "Rating [1-4]: ")).trim();
          const n = Number(raw);
          if (n >= 1 && n <= 4) r = n as Rating;
          else console.log("Please enter 1, 2, 3, or 4.");
        }
        rating = r;
      } else {
        // Exact-answer mode: user must type the correct form.
        const userInput = (await prompt(rl, "Your answer: ")).trim();
        const isCorrect = card.forms.some(
          (f) => f.toLowerCase() === userInput.toLowerCase(),
        );

        if (isCorrect) {
          console.log("✓ Correct!");
          correct++;
          // Ask recall quality (but not Again — that's for wrong answers only).
          console.log("\nHow easy was that recall?");
          console.log("  2 = Hard   (correct but felt difficult)");
          console.log("  3 = Good   (recalled with normal effort)");
          console.log("  4 = Easy   (came to mind immediately)");
          let r: Rating | undefined;
          while (r === undefined) {
            const raw = (await prompt(rl, "Rating [2-4]: ")).trim();
            const n = Number(raw);
            if (n >= 2 && n <= 4) r = n as Rating;
            else console.log("Please enter 2, 3, or 4.");
          }
          rating = r;
        } else {
          const correctDisplay = card.forms.join(" / ");
          console.log(`✗ Incorrect.  Correct form(s): ${correctDisplay}`);
          rating = Rating.Again;
        }
      }

      try {
        await apiPost("/api/session/review", {
          cardId: card.id,
          rating,
        });
      } catch (err) {
        console.error(`Failed to record review: ${String(err)}`);
      }

      reviewed++;
    }

    rl.close();
    if (reviewed > 0 && reviewed !== correct) {
      console.log(`\nQuiz complete! ${correct}/${reviewed} correct.`);
    } else if (reviewed > 0) {
      console.log(`\nQuiz complete! Perfect — ${reviewed}/${reviewed} correct.`);
    } else {
      console.log("\nQuiz complete!");
    }
  });

// ---------------------------------------------------------------------------
// strus stats
// ---------------------------------------------------------------------------

program
  .command("stats")
  .description("Show overview statistics")
  .action(async () => {
    const stats = await apiGet<{
      lemmaCount: number;
      listCount: number;
      dueCount: number;
    }>("/api/stats");
    console.log(`Lemmas  : ${stats.lemmaCount}`);
    console.log(`Lists   : ${stats.listCount}`);
    console.log(`Due now : ${stats.dueCount}`);
  });

// ---------------------------------------------------------------------------
// strus import
// ---------------------------------------------------------------------------

const importCmd = program.command("import").description("Import lemmas from Polish text");

importCmd
  .command("preview [text]")
  .description("Preview lemma candidates extracted from text")
  .option("-f, --file <path>", "Read text from a file instead of argument")
  .option("-l, --list <listId>", "Vocabulary list to check existence against (optional)")
  .action(async (text: string | undefined, opts: { file?: string; list?: string }) => {
    let inputText: string;
    if (opts.file !== undefined) {
      inputText = await Bun.file(opts.file).text();
    } else if (text !== undefined) {
      inputText = text;
    } else {
      inputText = await readStdin();
    }

    const body = {
      text: inputText,
      ...(opts.list !== undefined ? { listId: opts.list } : {}),
    };

    const result = await apiPost<{
      candidates: Array<{
        lemma: string;
        pos: string;
        formsFound: string[];
        ambiguous: boolean;
        alreadyExists: boolean;
        isMultiWord: boolean;
      }>;
      unknownTokens: string[];
    }>("/api/import/text/preview", body);

    const { candidates, unknownTokens } = result;
    const existsCount = candidates.filter((c) => c.alreadyExists).length;
    const ambiguousCount = candidates.filter((c) => c.ambiguous).length;

    console.log(
      `Found ${candidates.length} candidate lemmas (${existsCount} already exist, ${ambiguousCount} ambiguous):`,
    );
    console.log();
    for (const c of candidates) {
      const lemmaCol = c.lemma.padEnd(20);
      const posCol = c.pos.padEnd(8);
      const formsStr = `forms: ${c.formsFound.slice(0, 3).join(", ")}`;
      const flags = [
        c.alreadyExists ? "[exists]" : "",
        c.ambiguous ? "[ambiguous]" : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`  ${lemmaCol}${posCol}${formsStr}${flags ? `    ${flags}` : ""}`);
    }
    console.log();
    console.log(`Skipped stopwords + unknown tokens: ${unknownTokens.length}`);
  });

importCmd
  .command("commit [text]")
  .description("Import lemmas from text into the database")
  .option("-f, --file <path>", "Read text from a file")
  .option("-l, --list <listId>", "Add imported lemmas to this list (optional)")
  .option("--include-ambiguous", "Also commit ambiguous candidates (default: skip them)")
  .action(
    async (
      text: string | undefined,
      opts: { file?: string; list?: string; includeAmbiguous?: boolean },
    ) => {
      let inputText: string;
      if (opts.file !== undefined) {
        inputText = await Bun.file(opts.file).text();
      } else if (text !== undefined) {
        inputText = text;
      } else {
        inputText = await readStdin();
      }

      const body = {
        text: inputText,
        skipAmbiguous: !opts.includeAmbiguous,
        ...(opts.list !== undefined ? { listId: opts.list } : {}),
      };

      const result = await apiPost<{
        created: Array<{ lemmaId: string; lemma: string; pos: string; source: string }>;
        skipped: Array<{ lemma: string; reason: string }>;
        unknownTokens: string[];
      }>("/api/import/text", body);

      const { created, skipped } = result;
      const alreadyExistsCount = skipped.filter((s) => s.reason === "already_exists").length;
      const ambiguousCount = skipped.filter((s) => s.reason === "ambiguous").length;

      console.log("Import complete.");
      console.log(`  Created : ${created.length} lemmas`);
      console.log(
        `  Skipped : ${alreadyExistsCount} (already exist), ${ambiguousCount} (ambiguous)`,
      );

      if (created.length > 0) {
        console.log();
        console.log("Created:");
        for (const c of created) {
          console.log(`  ${c.lemma.padEnd(12)}${c.pos.padEnd(8)}${c.source}`);
        }
      }
    },
  );

// ---------------------------------------------------------------------------
// strus concept — Grammar concept taxonomy
// ---------------------------------------------------------------------------

const conceptCmd = program.command("concept").description("Grammar concept taxonomy commands");

conceptCmd
  .command("create <name>")
  .description("Create a grammar concept")
  .option("--parent <id>", "Parent concept UUID (omit for root concept)")
  .option("--description <text>", "Optional description")
  .action(async (name: string, opts: { parent?: string; description?: string }) => {
    const result = await apiPost<{
      id: string;
      name: string;
      description: string | null;
      parentId: string | null;
      createdAt: string;
    }>("/api/grammar-concepts", {
      name,
      ...(opts.parent ? { parentId: opts.parent } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
  });

conceptCmd
  .command("list")
  .description("List grammar concepts (roots by default; children when --parent is given)")
  .option("--parent <id>", "List direct children of this concept UUID")
  .action(async (opts: { parent?: string }) => {
    const url = opts.parent
      ? `/api/grammar-concepts?parentId=${encodeURIComponent(opts.parent)}`
      : "/api/grammar-concepts";
    const items = await apiGet<Array<{
      id: string;
      name: string;
      description: string | null;
      parentId: string | null;
      createdAt: string;
    }>>(url);
    if (items.length === 0) {
      console.log("No concepts found.");
      return;
    }
    for (const c of items) {
      const desc = c.description ? `  — ${c.description}` : "";
      const parent = c.parentId ? `  (parent: ${c.parentId})` : "";
      console.log(`${c.id}  ${c.name}${parent}${desc}`);
    }
  });

conceptCmd
  .command("get <id>")
  .description("Get a grammar concept by ID")
  .action(async (id: string) => {
    const c = await apiGet<{
      id: string;
      name: string;
      description: string | null;
      parentId: string | null;
      createdAt: string;
    }>(`/api/grammar-concepts/${encodeURIComponent(id)}`);
    console.log(JSON.stringify(c, null, 2));
  });

conceptCmd
  .command("children <id>")
  .description("List direct children of a grammar concept")
  .action(async (id: string) => {
    const items = await apiGet<Array<{
      id: string;
      name: string;
      description: string | null;
      parentId: string | null;
      createdAt: string;
    }>>(`/api/grammar-concepts/${encodeURIComponent(id)}/children`);
    if (items.length === 0) {
      console.log("No children found.");
      return;
    }
    for (const c of items) {
      const desc = c.description ? `  — ${c.description}` : "";
      console.log(`${c.id}  ${c.name}${desc}`);
    }
  });

// ---------------------------------------------------------------------------
// strus sentence — Sentence corpus
// ---------------------------------------------------------------------------

const sentenceCmd = program.command("sentence").description("Sentence corpus commands");

sentenceCmd
  .command("create")
  .description("Create a sentence")
  .requiredOption("--text <text>", "Sentence text (may include {{N}} gap markers for cloze)")
  .option("--translation <text>", "English translation")
  .option("--difficulty <n>", "Difficulty 1–5", (v) => parseInt(v, 10))
  .option("--concept <id>", "Grammar concept UUID (repeatable)", (val, prev: string[]) => [...prev, val], [] as string[])
  .action(async (opts: { text: string; translation?: string; difficulty?: number; concept: string[] }) => {
    const result = await apiPost<{
      id: string;
      text: string;
      translation: string | null;
      source: string;
      difficulty: number | null;
      createdAt: string;
    }>("/api/sentences", {
      text: opts.text,
      ...(opts.translation ? { translation: opts.translation } : {}),
      ...(opts.difficulty !== undefined ? { difficulty: opts.difficulty } : {}),
      ...(opts.concept.length > 0 ? { conceptIds: opts.concept } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
  });

sentenceCmd
  .command("list")
  .description("List sentences")
  .option("--concept <id>", "Filter by grammar concept UUID")
  .option("--difficulty <n>", "Filter by difficulty level", (v) => parseInt(v, 10))
  .option("--limit <n>", "Max results (default: 50)", (v) => parseInt(v, 10))
  .action(async (opts: { concept?: string; difficulty?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts.concept) qs.set("conceptId", opts.concept);
    if (opts.difficulty !== undefined) qs.set("difficulty", String(opts.difficulty));
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    const url = `/api/sentences${qs.toString() ? `?${qs.toString()}` : ""}`;
    const items = await apiGet<Array<{
      id: string;
      text: string;
      translation: string | null;
      source: string;
      difficulty: number | null;
      createdAt: string;
    }>>(url);
    if (items.length === 0) {
      console.log("No sentences found.");
      return;
    }
    for (const s of items) {
      const diff = s.difficulty !== null ? ` [diff:${s.difficulty}]` : "";
      const trans = s.translation ? `  →  ${s.translation.substring(0, 40)}` : "";
      console.log(`${s.id}${diff}  ${s.text.substring(0, 60)}${trans}`);
    }
  });

sentenceCmd
  .command("get <id>")
  .description("Get a sentence by ID")
  .action(async (id: string) => {
    const s = await apiGet<{
      id: string;
      text: string;
      translation: string | null;
      source: string;
      difficulty: number | null;
      createdAt: string;
    }>(`/api/sentences/${encodeURIComponent(id)}`);
    console.log(JSON.stringify(s, null, 2));
  });

// ---------------------------------------------------------------------------
// strus note — extensions for new note kinds
// ---------------------------------------------------------------------------

const noteCmd = program.command("note").description("Note commands (including contextual note kinds)");

/**
 * Parse a gap spec string into its components.
 * Format: "index=1,answers=chodzę|chadzam,hint=habitual motion"
 * The hint value may contain commas — we split on the first occurrence
 * of each known key.
 */
function parseGapSpec(spec: string): { gapIndex: number; correctAnswers: string[]; hint?: string } {
  const parts: Record<string, string> = {};
  // Split on comma boundaries that precede a known key (index=, answers=, hint=)
  const segments = spec.split(/,(?=index=|answers=|hint=)/);
  for (const seg of segments) {
    const eqIdx = seg.indexOf("=");
    if (eqIdx === -1) continue;
    const key = seg.substring(0, eqIdx).trim();
    const val = seg.substring(eqIdx + 1).trim();
    parts[key] = val;
  }
  const gapIndex = parseInt(parts["index"] ?? "0", 10);
  const correctAnswers = (parts["answers"] ?? "").split("|").map((a) => a.trim()).filter(Boolean);
  const hint = parts["hint"];
  return { gapIndex, correctAnswers, ...(hint ? { hint } : {}) };
}

noteCmd
  .command("create-cloze")
  .description("Create a cloze note (fill-in-the-gap). Each --gap creates one card.")
  .requiredOption("--sentence <id>", "Sentence UUID (must contain {{N}} gap markers)")
  .option("--concept <id>", "Primary grammar concept UUID")
  .option("--explanation <text>", "General explanation shown after answer")
  .option("--list <id>", "Vocabulary list UUID to add the note to")
  .option(
    "--gap <spec>",
    'Gap spec: "index=1,answers=form1|form2,hint=..." (repeatable)',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action(async (opts: {
    sentence: string;
    concept?: string;
    explanation?: string;
    list?: string;
    gap: string[];
  }) => {
    if (opts.gap.length === 0) {
      console.error("Error: at least one --gap spec is required");
      process.exit(1);
    }

    const gaps = opts.gap.map(parseGapSpec);

    const result = await apiPost<{
      id: string;
      kind: string;
      createdAt: string;
      clozeGaps: Array<{ id: string; gapIndex: number; correctAnswers: string[]; hint: string | null }>;
    }>("/api/notes/cloze", {
      sentenceId: opts.sentence,
      ...(opts.concept ? { conceptId: opts.concept } : {}),
      ...(opts.explanation ? { explanation: opts.explanation } : {}),
      ...(opts.list ? { listId: opts.list } : {}),
      gaps,
    });
    console.log(JSON.stringify(result, null, 2));
  });

noteCmd
  .command("create-choice")
  .description("Create a multiple-choice note. Each --option is a JSON object.")
  .option("--front <text>", "Question text (required if --sentence not provided)")
  .option("--sentence <id>", "Sentence UUID for context (required if --front not provided)")
  .option("--concept <id>", "Grammar concept UUID")
  .option("--explanation <text>", "General rationale shown after answer")
  .option("--list <id>", "Vocabulary list UUID to add the note to")
  .option(
    "--option <json>",
    'Option JSON: \'{"text":"...","isCorrect":true,"explanation":"..."}\' (repeatable)',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action(async (opts: {
    front?: string;
    sentence?: string;
    concept?: string;
    explanation?: string;
    list?: string;
    option: string[];
  }) => {
    if (opts.option.length < 2) {
      console.error("Error: at least two --option specs are required");
      process.exit(1);
    }
    if (!opts.front && !opts.sentence) {
      console.error("Error: --front or --sentence is required");
      process.exit(1);
    }

    const options = opts.option.map((o, i) => {
      try {
        const parsed = JSON.parse(o) as { text: string; isCorrect: boolean; explanation?: string };
        return {
          optionText: parsed.text,
          isCorrect: parsed.isCorrect,
          ...(parsed.explanation ? { explanation: parsed.explanation } : {}),
          sortOrder: i,
        };
      } catch {
        console.error(`Error: could not parse --option as JSON: ${o}`);
        process.exit(1);
      }
    });

    const result = await apiPost<{
      id: string;
      kind: string;
      createdAt: string;
      choiceOptions: Array<{ id: string; optionText: string; isCorrect: boolean; sortOrder: number }>;
    }>("/api/notes/choice", {
      ...(opts.front ? { front: opts.front } : {}),
      ...(opts.sentence ? { sentenceId: opts.sentence } : {}),
      ...(opts.concept ? { conceptId: opts.concept } : {}),
      ...(opts.explanation ? { explanation: opts.explanation } : {}),
      ...(opts.list ? { listId: opts.list } : {}),
      options,
    });
    console.log(JSON.stringify(result, null, 2));
  });

noteCmd
  .command("create-error")
  .description("Create an error-correction note (erroneous text → corrected version)")
  .requiredOption("--front <text>", "The erroneous text shown to the user")
  .requiredOption("--back <text>", "The corrected version revealed after answer")
  .option("--concept <id>", "Grammar concept UUID")
  .option("--explanation <text>", "Why the original was wrong")
  .option("--list <id>", "Vocabulary list UUID to add the note to")
  .action(async (opts: {
    front: string;
    back: string;
    concept?: string;
    explanation?: string;
    list?: string;
  }) => {
    const result = await apiPost<{
      id: string;
      kind: string;
      front: string | null;
      back: string | null;
      createdAt: string;
    }>("/api/notes/error", {
      front: opts.front,
      back: opts.back,
      ...(opts.concept ? { conceptId: opts.concept } : {}),
      ...(opts.explanation ? { explanation: opts.explanation } : {}),
      ...(opts.list ? { listId: opts.list } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
  });

noteCmd
  .command("create-classifier")
  .description("Create a classifier note (classify sentence into correct grammar concept)")
  .requiredOption("--sentence <id>", "Sentence UUID to classify")
  .requiredOption("--concept <id>", "The CORRECT grammar concept UUID for this sentence")
  .option("--explanation <text>", "Explanation shown after answer")
  .option("--list <id>", "Vocabulary list UUID to add the note to")
  .action(async (opts: {
    sentence: string;
    concept: string;
    explanation?: string;
    list?: string;
  }) => {
    const result = await apiPost<{
      id: string;
      kind: string;
      createdAt: string;
    }>("/api/notes/classifier", {
      sentenceId: opts.sentence,
      conceptId: opts.concept,
      ...(opts.explanation ? { explanation: opts.explanation } : {}),
      ...(opts.list ? { listId: opts.list } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// Generate command — LLM-powered batch note generation
// ---------------------------------------------------------------------------

const generateCmd = program
  .command("generate")
  .description("Batch-generate contextual exercise notes via LLM");

generateCmd
  .requiredOption("--concept <uuid>", "Grammar concept UUID to generate exercises for")
  .requiredOption("--kind <kind>", "Exercise kind: cloze or choice")
  .option("--count <n>", "Number of notes to generate (1–20)", "5")
  .option("--difficulty <n>", "Difficulty level 1–3 (1=beginner, 2=intermediate, 3=advanced)")
  .option("--list <uuid>", "Vocab list UUID to auto-assign generated notes to")
  .action(
    async (opts: {
      concept: string;
      kind: string;
      count: string;
      difficulty?: string;
      list?: string;
    }) => {
      if (opts.kind !== "cloze" && opts.kind !== "choice") {
        console.error(`Error: --kind must be "cloze" or "choice", got "${opts.kind}"`);
        process.exit(1);
      }

      const count = parseInt(opts.count, 10);
      if (isNaN(count) || count < 1 || count > 20) {
        console.error(`Error: --count must be an integer between 1 and 20`);
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        conceptId: opts.concept,
        kind: opts.kind,
        count,
      };

      if (opts.difficulty !== undefined) {
        const difficulty = parseInt(opts.difficulty, 10);
        if (isNaN(difficulty) || difficulty < 1 || difficulty > 3) {
          console.error(`Error: --difficulty must be 1, 2, or 3`);
          process.exit(1);
        }
        body["difficulty"] = difficulty;
      }

      const result = await apiPost<{
        batchId: string;
        generated: number;
        approved: number;
        flagged: number;
        failed: number;
        errors: string[];
      }>("/api/generation/generate", body);

      console.log(JSON.stringify(result, null, 2));

      if (opts.list && result.batchId) {
        try {
          // Fetch all approved notes from this batch via the correct drafts endpoint
          const notesResult = await apiGet<{ notes: Array<{ id: string }>; total: number }>(
            `/api/notes/drafts?batchId=${encodeURIComponent(result.batchId)}&status=approved&limit=100`
          );
          const noteIds = notesResult.notes.map((n) => n.id);
          if (noteIds.length === 0) {
            console.log("No approved notes to assign to list.");
          } else {
            let assigned = 0;
            for (const noteId of noteIds) {
              await apiPost<{ success: true }>(`/api/lists/${opts.list}/notes`, { listId: opts.list, noteId });
              assigned++;
            }
            console.log(`Assigned ${assigned} note(s) to list ${opts.list}.`);
          }
        } catch (err) {
          console.error(`Warning: notes were generated but could not be assigned to list ${opts.list}:`, err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }
    },
  );

// ---------------------------------------------------------------------------
// strus review — human triage for LLM-generated notes
// ---------------------------------------------------------------------------

interface DraftNote {
  id: string;
  kind: string;
  status: string;
  conceptId: string | null;
  sentenceId: string | null;
  explanation: string | null;
  generationMeta: string | null;
  createdAt: number;
  sentenceText?: string | null;
  gaps?: Array<{
    id: string;
    gapIndex: number;
    correctAnswers: string;
    hint: string | null;
    explanation: string | null;
  }>;
  options?: Array<{
    id: string;
    optionText: string;
    isCorrect: boolean;
    explanation: string | null;
  }>;
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function renderNote(note: DraftNote, index: number, total: number): void {
  const meta = parseMeta(note.generationMeta);
  const batchId = (meta["batchId"] as string | undefined) ?? "(none)";
  const validationResults = (meta["validationResults"] as Array<{ layer: string; pass: boolean }> | undefined) ?? [];

  console.log("\n" + "─".repeat(45));
  console.log(`Note #${index} of ${total}  [${note.kind} | ${note.status}]`);
  console.log(`Concept: ${note.conceptId ?? "(none)"}`);
  console.log(`Batch:   ${batchId}`);

  if (note.sentenceText) {
    console.log(`\nSentence: "${note.sentenceText}"`);
  }

  if (note.kind === "cloze" && note.gaps && note.gaps.length > 0) {
    for (const gap of note.gaps) {
      const answers = (() => {
        try { return JSON.stringify(JSON.parse(gap.correctAnswers)); }
        catch { return gap.correctAnswers; }
      })();
      console.log(`\nGap ${gap.gapIndex}:`);
      console.log(`  Correct answers: ${answers}`);
      if (gap.hint) console.log(`  Hint: ${gap.hint}`);
      if (gap.explanation) console.log(`  Explanation: ${gap.explanation}`);
    }
  } else if (note.kind === "choice" && note.options && note.options.length > 0) {
    // For choice notes, front is stored in the note itself — fetch from notes API if needed
    console.log(`\nOptions:`);
    for (const opt of note.options) {
      const marker = opt.isCorrect ? "✓" : " ";
      console.log(`  [${marker}] ${opt.optionText}${opt.explanation ? `  — ${opt.explanation}` : ""}`);
    }
  }

  if (note.explanation) {
    console.log(`\nExplanation: ${note.explanation}`);
  }

  if (validationResults.length > 0) {
    const validationStr = validationResults
      .map((r) => `${r.layer} ${r.pass ? "✓" : "✗"}`)
      .join(" | ");
    console.log(`\nValidation: ${validationStr}`);
  }

  console.log("─".repeat(45));
  process.stdout.write("[a]pprove  [f]lag  [r]eject  [s]kip  [q]uit\n> ");
}

/** Read a single keypress from stdin (raw mode). Returns the key character. */
function readKeypress(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (key: string) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(key);
    };
    process.stdin.on("data", onData);
  });
}

const reviewCmd = program
  .command("review")
  .description("Triage LLM-generated draft notes (approve/flag/reject)");

// `strus review` — interactive mode
reviewCmd
  .command("queue", { isDefault: true })
  .description("Interactive triage: walk through draft notes one by one")
  .option("--batch <id>", "Filter by generation batch ID")
  .option("--kind <kind>", "Filter by note kind (cloze|choice|error|classifier)")
  .option("--status <status>", "Filter by status (default: draft)", "draft")
  .action(
    async (opts: { batch?: string; kind?: string; status?: string }) => {
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      qs.set("offset", "0");
      if (opts.status) qs.set("status", opts.status);
      if (opts.kind) qs.set("kind", opts.kind);
      if (opts.batch) qs.set("batchId", opts.batch);

      const result = await apiGet<{ notes: DraftNote[]; total: number }>(
        `/api/notes/drafts?${qs.toString()}`,
      );

      const queue = result.notes;

      if (queue.length === 0) {
        console.log(`No notes found with status="${opts.status ?? "draft"}".`);
        return;
      }

      let approved = 0;
      let flagged = 0;
      let rejected = 0;
      let skipped = 0;
      let reviewedCount = 0;
      let quit = false;

      for (const [idx, note] of queue.entries()) {
        if (quit) break;
        renderNote(note, idx + 1, queue.length);

        let handled = false;
        while (!handled) {
          const key = (await readKeypress()).toLowerCase();
          process.stdout.write("\n");

          if (key === "q" || key === "\u0003" /* Ctrl-C */) {
            console.log("Quitting triage...");
            quit = true;
            handled = true;
            break;
          }

          if (key === "s") {
            skipped++;
            handled = true;
            break;
          }

          let action: "approve" | "flag" | "reject" | null = null;
          if (key === "a") action = "approve";
          else if (key === "f") action = "flag";
          else if (key === "r") action = "reject";

          if (action) {
            try {
              const res = await apiPost<{ noteId: string; status: string; cardsCreated: number }>(
                "/api/notes/review",
                { noteId: note.id, action },
              );
              console.log(
                `→ ${res.status}${action === "approve" && res.cardsCreated > 0 ? ` (${res.cardsCreated} card(s) created)` : ""}`,
              );
              reviewedCount++;
              if (action === "approve") approved++;
              else if (action === "flag") flagged++;
              else if (action === "reject") rejected++;
            } catch (err) {
              console.error(`API error: ${String(err)}`);
            }
            handled = true;
          } else {
            process.stdout.write("Unknown key. Use [a]pprove [f]lag [r]eject [s]kip [q]uit\n> ");
          }
        }
      }

      console.log(
        `\nSession complete. Reviewed: ${reviewedCount} | Approved: ${approved} | Flagged: ${flagged} | Rejected: ${rejected} | Skipped: ${skipped}`,
      );
    },
  );

// `strus review stats` — non-interactive counts
reviewCmd
  .command("stats")
  .description("Show note counts by status")
  .option("--batch <id>", "Filter by generation batch ID")
  .action(async (opts: { batch?: string }) => {
    const qs = new URLSearchParams();
    qs.set("limit", "1000");
    qs.set("offset", "0");
    if (opts.batch) qs.set("batchId", opts.batch);

    const result = await apiGet<{ notes: DraftNote[]; total: number }>(
      `/api/notes/drafts?${qs.toString()}`,
    );

    const counts: Record<string, number> = {};
    for (const note of result.notes) {
      counts[note.status] = (counts[note.status] ?? 0) + 1;
    }

    const statuses = ["draft", "approved", "flagged", "rejected"];
    const total = result.notes.length;

    console.log(`\n${"Status".padEnd(12)}${"Count".padStart(6)}`);
    console.log("─".repeat(12) + "  " + "─".repeat(5));
    for (const s of statuses) {
      if (counts[s] !== undefined) {
        console.log(`${s.padEnd(12)}${String(counts[s]).padStart(6)}`);
      }
    }
    // Any statuses not in the standard list
    for (const [s, c] of Object.entries(counts)) {
      if (!statuses.includes(s)) {
        console.log(`${s.padEnd(12)}${String(c).padStart(6)}`);
      }
    }
    console.log("─".repeat(12) + "  " + "─".repeat(5));
    console.log(`${"total".padEnd(12)}${String(total).padStart(6)}`);
    console.log();
  });

// ---------------------------------------------------------------------------
// strus cluster
// ---------------------------------------------------------------------------

const clusterCmd = program
  .command("cluster")
  .description("Manage semantic clusters");

// strus cluster create
clusterCmd
  .command("create")
  .description("Create a new semantic cluster")
  .requiredOption("--name <name>", "Cluster name (e.g. 'motion verbs')")
  .option("--type <type>", "Cluster type (prefix_family|vom_group|aspect_pair|custom)", "custom")
  .option("--description <desc>", "Optional description")
  .action(async (opts: { name: string; type: string; description?: string }) => {
    const result = await apiPost<{ id: string; name: string }>("/api/clusters", {
      name: opts.name,
      clusterType: opts.type,
      description: opts.description,
    });
    console.log(`Created cluster: ${result.name} (${result.id})`);
  });

// strus cluster list
clusterCmd
  .command("list")
  .description("List semantic clusters")
  .option("--limit <n>", "Max results", "50")
  .option("--offset <n>", "Offset", "0")
  .action(async (opts: { limit: string; offset: string }) => {
    const qs = new URLSearchParams({ limit: opts.limit, offset: opts.offset });
    const result = await apiGet<{
      clusters: Array<{ id: string; name: string; clusterType: string; description: string | null; memberCount: number }>;
      total: number;
    }>(`/api/clusters?${qs}`);

    if (result.clusters.length === 0) {
      console.log("No clusters found.");
      return;
    }

    console.log(`\n${"Name".padEnd(30)}${"Type".padEnd(16)}${"Members".padStart(8)}  ID`);
    console.log("─".repeat(75));
    for (const c of result.clusters) {
      console.log(
        `${c.name.padEnd(30)}${c.clusterType.padEnd(16)}${String(c.memberCount).padStart(8)}  ${c.id}`,
      );
    }
    console.log(`\nTotal: ${result.total}`);
  });

// strus cluster show <id>
clusterCmd
  .command("show <id>")
  .description("Show a semantic cluster with its members")
  .action(async (id: string) => {
    const cluster = await apiGet<{
      id: string;
      name: string;
      clusterType: string;
      description: string | null;
      members: Array<{ lemmaId: string; lemma: string; pos: string | null }>;
    }>(`/api/clusters/${id}`);

    console.log(`\nCluster: ${cluster.name}`);
    console.log(`Type:    ${cluster.clusterType}`);
    if (cluster.description) console.log(`Desc:    ${cluster.description}`);
    console.log(`ID:      ${cluster.id}`);
    console.log(`Members: ${cluster.members.length}`);

    if (cluster.members.length > 0) {
      console.log("\n  Lemma                   POS              ID");
      console.log("  " + "─".repeat(65));
      for (const m of cluster.members) {
        console.log(`  ${m.lemma.padEnd(24)}${(m.pos ?? "—").padEnd(16)} ${m.lemmaId}`);
      }
    }
    console.log();
  });

// strus cluster add-member
clusterCmd
  .command("add-member")
  .description("Add a lemma to a semantic cluster")
  .requiredOption("--cluster <id>", "Cluster ID")
  .requiredOption("--lemma <id>", "Lemma ID")
  .action(async (opts: { cluster: string; lemma: string }) => {
    const result = await apiPost<{ clusterId: string; lemmaId: string }>(
      `/api/clusters/${opts.cluster}/members`,
      { clusterId: opts.cluster, lemmaId: opts.lemma },
    );
    console.log(`Added lemma ${result.lemmaId} to cluster ${result.clusterId}`);
  });

// strus cluster remove-member
clusterCmd
  .command("remove-member")
  .description("Remove a lemma from a semantic cluster")
  .requiredOption("--cluster <id>", "Cluster ID")
  .requiredOption("--lemma <id>", "Lemma ID")
  .action(async (opts: { cluster: string; lemma: string }) => {
    const result = await apiDelete<{ removed: boolean }>(
      `/api/clusters/${opts.cluster}/members/${opts.lemma}`,
    );
    console.log(result.removed ? "Member removed." : "Member not found (already removed).");
  });

// strus cluster suggest
clusterCmd
  .command("suggest")
  .description("Suggest cluster candidates for a lemma")
  .requiredOption("--lemma <id>", "Lemma ID")
  .option("--limit <n>", "Max suggestions", "10")
  .action(async (opts: { lemma: string; limit: string }) => {
    const qs = new URLSearchParams({ lemmaId: opts.lemma, limit: opts.limit });
    const result = await apiGet<{
      suggestions: Array<{
        lemmaId: string;
        lemma: string;
        pos: string | null;
        score: number;
        reasons: string[];
      }>;
    }>(`/api/clusters/suggest?${qs}`);

    if (result.suggestions.length === 0) {
      console.log("No suggestions found.");
      return;
    }

    // Get the target lemma name for the header
    const firstSugg = result.suggestions[0];
    console.log(`\nSuggestions (${result.suggestions.length}):\n`);

    for (const [i, s] of result.suggestions.entries()) {
      const posLabel = s.pos ? `[${s.pos}]` : "";
      const scoreStr = s.score.toFixed(2);
      const reasonStr = s.reasons.join("; ");
      console.log(
        `  ${String(i + 1).padStart(2)}. ${s.lemma.padEnd(20)} ${posLabel.padEnd(12)} score: ${scoreStr}  — ${reasonStr}`,
      );
    }
    console.log();
  });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
