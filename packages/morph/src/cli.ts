import type { MorphForm } from "./types.js";

// The Morfeusz2 package ships two separate CLI binaries:
//   morfeusz_generator  — generation mode (all forms of a given lemma)
//   morfeusz_analyzer   — analysis mode (all analyses for a given surface form / text)
const MORFEUSZ_GENERATOR = "morfeusz_generator";
const MORFEUSZ_ANALYZER = "morfeusz_analyzer";

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

/**
 * Parse output from `morfeusz_generator`.
 *
 * Each entry in the output is a bracket-delimited block. Lines look like:
 *   [orth,lemma,tag,qualifier,_         ← opening line (no closing bracket yet)
 *    orth,lemma,tag,qualifier,_          ← continuation form line
 *    orth,lemma,tag,qualifier,_]         ← last form line (closing bracket)
 *
 * Strategy: strip `[`, `]`, and surrounding whitespace from each line,
 * then parse as comma-separated with orth at index 0, lemma at 1, tag at 2.
 * Header lines (version banner, path, dict) are skipped.
 */
function parseGeneratorOutput(output: string): MorphForm[] {
  const forms: MorphForm[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (
      trimmed.startsWith("Morfeusz") ||
      trimmed.startsWith("Setting") ||
      trimmed.startsWith("Using")
    ) continue;

    const content = trimmed.replace(/^\[/, "").replace(/\]$/, "").trim();
    const parts = content.split(",");
    if (parts.length < 3) continue;

    const orth = parts[0]?.trim();
    const lemma = parts[1]?.trim();
    const tag = parts[2]?.trim();
    if (orth && lemma && tag) {
      forms.push({ orth, lemma, tag });
    }
  }
  return forms;
}

/**
 * Parse output from `morfeusz_analyzer`.
 *
 * Lines look like:
 *   [start,end,orth,lemma,tag,qualifier,disambiguation]   ← single analysis
 *   [start,end,orth,lemma,tag,qualifier,disambiguation    ← first of multi-line entry
 *    start,end,orth,lemma,tag,qualifier,disambiguation]   ← continuation line
 *
 * Strategy: strip `[`, `]`, and surrounding whitespace from each line,
 * then parse as comma-separated with orth at index 2, lemma at 3, tag at 4.
 * Header lines are skipped.
 */
function parseAnalyzerOutput(output: string): MorphForm[] {
  const forms: MorphForm[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (
      trimmed.startsWith("Morfeusz") ||
      trimmed.startsWith("Setting") ||
      trimmed.startsWith("Using")
    ) continue;

    const content = trimmed.replace(/^\[/, "").replace(/\]$/, "").trim();
    const parts = content.split(",");
    if (parts.length < 5) continue;

    const orth = parts[2]?.trim();
    const lemma = parts[3]?.trim();
    const tag = parts[4]?.trim();
    if (orth && lemma && tag) {
      forms.push({ orth, lemma, tag });
    }
  }
  return forms;
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

/**
 * Run a Morfeusz subprocess, write `input` to its stdin, and return stdout.
 * Throws a descriptive error if the binary is not found or exits non-zero.
 */
async function runMorfeusz(binary: string, input: string): Promise<string> {
  // Spawn inline (IIFE) so TypeScript infers the narrow generic type and
  // knows stdin/stdout/stderr are FileSink / ReadableStream, not `number`.
  const proc = (() => {
    try {
      return Bun.spawn([binary], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      throw new Error(
        `Failed to launch ${binary}: binary may not be installed. ` +
          `Original error: ${String(err)}`,
      );
    }
  })();

  // Write input and close stdin
  proc.stdin.write(input + "\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `${binary} exited with code ${exitCode}. ` +
        `stderr: ${stderr.trim() || "(empty)"}`,
    );
  }

  return stdout;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all morphological forms for the given lemma.
 * Uses `morfeusz_generator` with the lemma on stdin.
 *
 * Returns an empty array if the lemma is unknown to Morfeusz2.
 */
export async function generate(lemma: string): Promise<MorphForm[]> {
  try {
    const output = await runMorfeusz(MORFEUSZ_GENERATOR, lemma);
    return parseGeneratorOutput(output);
  } catch (err) {
    throw new Error(`morph.generate("${lemma}") failed: ${String(err)}`);
  }
}

/**
 * Analyse a single surface form and return all possible interpretations.
 * Uses `morfeusz_analyzer` with the surface form on stdin.
 */
export async function analyse(surface: string): Promise<MorphForm[]> {
  try {
    const output = await runMorfeusz(MORFEUSZ_ANALYZER, surface);
    return parseAnalyzerOutput(output);
  } catch (err) {
    throw new Error(`morph.analyse("${surface}") failed: ${String(err)}`);
  }
}

/**
 * Analyse a multi-token text in a single subprocess call.
 * Uses `morfeusz_analyzer` with the full text on stdin.
 * More efficient than calling `analyse` per token.
 */
export async function analyseText(text: string): Promise<MorphForm[]> {
  try {
    const output = await runMorfeusz(MORFEUSZ_ANALYZER, text);
    return parseAnalyzerOutput(output);
  } catch (err) {
    throw new Error(`morph.analyseText failed: ${String(err)}`);
  }
}
