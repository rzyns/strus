import type { MorphForm } from "./types.js";
import {
  MorfeuszImpl,
  MorfeuszUsage,
  DictionariesRepository,
} from "@rzyns/morfeusz-ts";

// ---------------------------------------------------------------------------
// Dictionary search paths
// ---------------------------------------------------------------------------

// Point morfeusz-ts at the system-installed .dict files.
// sgjp-a.dict → analyzer, sgjp-s.dict → generator
// Override with MORFEUSZ2_DICT_PATH env var for non-standard installations.
DictionariesRepository.dictionarySearchPaths = [
  process.env["MORFEUSZ2_DICT_PATH"] ?? "/usr/share/morfeusz2/dictionaries",
];

// ---------------------------------------------------------------------------
// Lazy singletons — load once, reuse across calls
// ---------------------------------------------------------------------------

let _analyzer: MorfeuszImpl | null = null;
let _generator: MorfeuszImpl | null = null;

async function getAnalyzer(): Promise<MorfeuszImpl> {
  if (!_analyzer) {
    const m = new MorfeuszImpl("sgjp", MorfeuszUsage.ANALYSE_ONLY);
    await m.load();
    _analyzer = m;
  }
  return _analyzer;
}

async function getGenerator(): Promise<MorfeuszImpl> {
  if (!_generator) {
    const m = new MorfeuszImpl("sgjp", MorfeuszUsage.GENERATE_ONLY);
    await m.load();
    _generator = m;
  }
  return _generator;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter out tokens morfeusz-ts could not recognise (tag="ign"),
 * whitespace pseudo-tokens (tag="sp"), and abbreviation markers (brev:*).
 */
function isUsable(tag: string): boolean {
  return tag !== "ign" && tag !== "sp" && !tag.startsWith("brev:");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all morphological forms for the given lemma.
 * Returns an empty array if the lemma is unknown to Morfeusz2.
 *
 */
export async function generate(lemma: string): Promise<MorphForm[]> {
  try {
    const gen = await getGenerator();
    return gen
      .generate(lemma)
      .filter((m) => isUsable(m.tag))
      .map((m) => ({ orth: m.orth, lemma: m.lemma, tag: m.tag }));
  } catch (err) {
    throw new Error(`morph.generate("${lemma}") failed: ${String(err)}`);
  }
}

/**
 * Analyse a single surface form and return all possible interpretations.
 */
export async function analyse(surface: string): Promise<MorphForm[]> {
  try {
    const ana = await getAnalyzer();
    return ana
      .analyseToArray(surface)
      .filter((m) => isUsable(m.tag))
      .map((m) => ({ orth: m.orth, lemma: m.lemma, tag: m.tag }));
  } catch (err) {
    throw new Error(`morph.analyse("${surface}") failed: ${String(err)}`);
  }
}

/**
 * Analyse a multi-token text in a single call.
 * More efficient than calling analyse() per token.
 */
export async function analyseText(text: string): Promise<MorphForm[]> {
  try {
    const ana = await getAnalyzer();
    return ana
      .analyseToArray(text)
      .filter((m) => isUsable(m.tag))
      .map((m) => ({ orth: m.orth, lemma: m.lemma, tag: m.tag }));
  } catch (err) {
    throw new Error(`morph.analyseText failed: ${String(err)}`);
  }
}
