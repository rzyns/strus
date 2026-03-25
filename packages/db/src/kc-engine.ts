/**
 * KC (Knowledge Component) tag-matching engine.
 *
 * Given a card's NKJP tag string and a set of KnowledgeComponent rows,
 * determines which KCs the card belongs to.
 *
 * NKJP tag format: colon-delimited, POS first, then features.
 * Dots separate alternatives within a single segment.
 * Examples:
 *   subst:sg:gen:m3
 *   fin:sg:ter:imperf
 *   adj:sg:nom.acc:m1:pos
 *   praet:sg:m1:imperf
 */
import type { knowledgeComponents } from "./schema.js";

export type KnowledgeComponent = typeof knowledgeComponents.$inferSelect;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if a tag segment (which may contain dot-alternatives like "nom.acc")
 * contains the given literal value.
 *
 * "nom.acc" contains "nom" → true
 * "nom.acc" contains "acc" → true
 * "nom.acc" contains "gen" → false
 */
function segmentContains(tagSeg: string, literal: string): boolean {
  return tagSeg.split(".").includes(literal);
}

/**
 * Recursive glob matcher for colon-delimited NKJP tags.
 *
 * `*` as a pattern segment matches zero or more tag segments (greedy backtracking).
 * All other pattern segments are literals matched against the tag segment at that
 * position, honouring dot-alternatives in the tag (e.g. "nom.acc" matches "nom").
 */
function globMatch(
  tagSegs: string[],
  patSegs: string[],
  ti: number,
  pi: number,
): boolean {
  // Pattern exhausted — match iff tag is also exhausted
  if (pi === patSegs.length) return ti === tagSegs.length;

  const patSeg = patSegs[pi]!;

  if (patSeg === "*") {
    // Try consuming 0, 1, 2, … tag segments before advancing the pattern
    for (let skip = 0; skip <= tagSegs.length - ti; skip++) {
      if (globMatch(tagSegs, patSegs, ti + skip, pi + 1)) return true;
    }
    return false;
  }

  // Literal segment: tag must have a segment here and it must contain the literal
  if (ti >= tagSegs.length) return false;
  if (!segmentContains(tagSegs[ti]!, patSeg)) return false;
  return globMatch(tagSegs, patSegs, ti + 1, pi + 1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test whether an NKJP tag matches a KC's tag_pattern.
 *
 * Matching rules by KC kind:
 *
 * • `gender`  — tag_pattern is a bare gender token ("m1", "m2", "m3", "f", "n").
 *               Matches if any tag segment (after splitting on ":" and ".") equals
 *               the token. Gender tokens may appear at any position, including the
 *               last segment.
 *
 * • `pos` / `tense` / `mood` (comma-separated) — tag_pattern is a comma-separated
 *               list of POS tags (e.g. "fin,praet,bedzie,impt,…"). Matches if the
 *               tag's POS (first colon-segment) is in the list.
 *
 * • everything else — standard colon-delimited glob where "*" matches zero or more
 *               segments. Dot-alternatives in tag segments are honoured.
 *
 * Returns false if tag_pattern is null (lemma-kind KCs — matched separately).
 */
export function tagMatchesKC(tag: string, kc: KnowledgeComponent): boolean {
  if (!kc.tagPattern) return false;

  // Gender: pattern is a bare token like "m1", "f", "n"
  if (kc.kind === "gender") {
    for (const seg of tag.split(":")) {
      if (seg.split(".").includes(kc.tagPattern)) return true;
    }
    return false;
  }

  // Comma-separated POS list — used for verb, participle, and any future multi-POS KCs
  if (kc.tagPattern.includes(",")) {
    const posList = kc.tagPattern.split(",");
    const pos = tag.split(":")[0] ?? "";
    return posList.includes(pos);
  }

  // Default: colon-delimited glob pattern
  return globMatch(tag.split(":"), kc.tagPattern.split(":"), 0, 0);
}

/**
 * Map a card's NKJP tag to the IDs of all matching structural KCs.
 *
 * Lemma-kind KCs (tag_pattern is null) are excluded — they are matched
 * separately by comparing the card note's lemma_id to the KC's lemma_id.
 *
 * @param cardTag  The full NKJP tag string for the card (e.g. "subst:sg:gen:m3")
 * @param allKCs   All KC rows from the knowledge_components table
 * @returns        Array of KC IDs that match the tag
 */
export function mapCardToKCs(cardTag: string, allKCs: KnowledgeComponent[]): string[] {
  return allKCs
    .filter((kc) => kc.kind !== "lemma" && tagMatchesKC(cardTag, kc))
    .map((kc) => kc.id);
}
