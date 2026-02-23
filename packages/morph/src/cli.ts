import type { MorphForm } from "./types.js";

const MORFEUSZ_BINARY = "morfeusz2";

/**
 * Parse raw morfeusz2 output lines into MorphForm objects.
 * Each line is tab-separated: orth\tlemma\ttag
 * Lines that don't match the expected format are silently skipped.
 */
function parseOutputLines(output: string): MorphForm[] {
  const forms: MorphForm[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;

    const [orth, lemma, tag] = parts as [string, string, string];
    if (orth && lemma && tag) {
      forms.push({ orth, lemma, tag });
    }
  }

  return forms;
}

/**
 * Run a morfeusz2 subprocess, write `input` to its stdin, and return stdout.
 * Throws a descriptive error if the binary is not found or exits non-zero.
 */
async function runMorfeusz(args: string[], input: string): Promise<string> {
  // Spawn inline (IIFE) so TypeScript infers the narrow generic type and
  // knows stdin/stdout/stderr are FileSink / ReadableStream, not `number`.
  const proc = (() => {
    try {
      return Bun.spawn([MORFEUSZ_BINARY, ...args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      throw new Error(
        `Failed to launch morfeusz2: binary "${MORFEUSZ_BINARY}" may not be installed. ` +
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
      `morfeusz2 exited with code ${exitCode}. ` +
        `stderr: ${stderr.trim() || "(empty)"}`,
    );
  }

  return stdout;
}

/**
 * Generate all morphological forms for the given lemma.
 * Calls `morfeusz2 --generate` with the lemma on stdin.
 *
 * Returns an empty array if morfeusz2 produces no output (e.g. unknown lemma).
 */
export async function generate(lemma: string): Promise<MorphForm[]> {
  try {
    const output = await runMorfeusz(["--generate"], lemma);
    return parseOutputLines(output);
  } catch (err) {
    // Re-throw with context
    throw new Error(
      `morph.generate("${lemma}") failed: ${String(err)}`,
    );
  }
}

/**
 * Analyse a surface form and return all possible interpretations.
 * Calls `morfeusz2` (analysis mode) with the surface form on stdin.
 *
 * Returns an empty array if morfeusz2 produces no output.
 */
export async function analyse(surface: string): Promise<MorphForm[]> {
  try {
    const output = await runMorfeusz([], surface);
    return parseOutputLines(output);
  } catch (err) {
    throw new Error(
      `morph.analyse("${surface}") failed: ${String(err)}`,
    );
  }
}
