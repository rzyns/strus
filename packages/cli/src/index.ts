#!/usr/bin/env bun
/**
 * @strus/cli — Command-line interface for the strus SRS system.
 *
 * The CLI communicates with the strus API server. By default it hits
 * http://localhost:3457, configurable via STRUS_API_URL.
 *
 * TODO: Replace raw fetch calls with a type-safe oRPC client once the
 *       @orpc/client adapter is set up:
 *
 *   import { createClient } from '@orpc/client'
 *   import type { Router } from '@strus/api'
 *   const client = createClient<Router>({ url: API_URL + '/rpc' })
 */

import { Command } from "commander";
import * as readline from "readline";
import { Rating } from "@strus/core";

const API_URL = process.env["STRUS_API_URL"] ?? "http://localhost:3457";

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
// strus quiz
// ---------------------------------------------------------------------------

program
  .command("quiz")
  .description("Interactive terminal quiz for due cards")
  .option("-l, --list <listId>", "Filter by list")
  .option("-n, --limit <n>", "Hard cap on total session size", "100")
  .option("--new-limit <n>", "Max new (state=0) cards per session", "20")
  .option("--no-interleave", "Disable lemma interleaving (serve in order)")
  .action(async (opts: { list?: string; limit?: string; newLimit?: string; interleave: boolean }) => {
    const limit = Number(opts.limit ?? 100);
    const newLimit = Number(opts.newLimit ?? 20);
    const qs = new URLSearchParams();
    if (opts.list) qs.set("listId", opts.list);
    qs.set("limit", String(limit));
    qs.set("newLimit", String(newLimit));
    qs.set("interleave", String(opts.interleave));

    interface DueCard {
      id: string;
      lemmaId: string;
      tag: string;
      state: number;
      lemmaText: string;
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
      console.log(`\n[${reviewed + 1}/${due.length}]`);
      console.log(`Lemma     : ${card.lemmaText}`);
      console.log(`Tag       : ${card.tag}`);
      console.log("─".repeat(40));

      let rating: Rating;

      if (card.forms.length === 0) {
        // No forms on record (manual lemma or form generation was skipped).
        // Fall back to self-assessment: reveal and ask.
        await prompt(rl, "No forms on record — press Enter to continue...");
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
// Run
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
