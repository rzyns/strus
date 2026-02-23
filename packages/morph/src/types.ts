export interface MorphForm {
  /** Surface form, e.g. "domem" */
  orth: string;
  /** Base form / lemma, e.g. "dom" */
  lemma: string;
  /** NKJP morphosyntactic tag, e.g. "subst:sg:inst:m3" */
  tag: string;
}

export interface ParsedTag {
  /** Part of speech: subst, verb, adj, adv, etc. */
  pos: string;
  /** Positional morphosyntactic features, e.g. { feat1: "sg", feat2: "inst", feat3: "m3" } */
  features: Record<string, string>;
  /** Original raw tag string */
  raw: string;
}

/**
 * All morphological forms of a lexeme grouped by tag.
 * Multiple orth variants can share the same tag (e.g. variant spellings).
 */
export type Paradigm = Map<string, MorphForm[]>;
