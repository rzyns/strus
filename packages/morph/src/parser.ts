import type { MorphForm, MorphGender, ParsedTag, Paradigm } from "./types.js";

/**
 * Parse a NKJP morphosyntactic tag string into a structured object.
 *
 * Tag examples:
 *   subst:sg:inst:m3      → pos=subst, feat1=sg, feat2=inst, feat3=m3
 *   fin:sg:ter:imperf     → pos=fin,   feat1=sg, feat2=ter,  feat3=imperf
 *   adj:sg:nom:m1:pos     → pos=adj,   feat1=sg, feat2=nom,  feat3=m1, feat4=pos
 *   adv                   → pos=adv,   (no features)
 */
export function parseTag(tag: string): ParsedTag {
  const parts = tag.split(":");
  const pos = parts[0] ?? tag;
  const features: Record<string, string> = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part !== undefined && part.length > 0) {
      features[`feat${i}`] = part;
    }
  }

  return { pos, features, raw: tag };
}

const GENDER_TOKENS = new Set(["m1", "m2", "m3", "f", "n"]);

/**
 * Extract gender from a Morfeusz2 NKJP tag string.
 * Returns 'm' for m1/m2/m3, 'f' for f, 'n' for n, null if tag has no gender.
 */
export function tagGender(tag: string): MorphGender {
  const parts = tag.split(":");
  for (const part of parts) {
    // Handle dot-separated alternatives like "nom.m3"
    const subparts = part.split(".");
    for (const sub of subparts) {
      if (GENDER_TOKENS.has(sub)) {
        if (sub.startsWith("m")) return "m";
        return sub as "f" | "n";
      }
    }
  }
  return null;
}

/**
 * Group a flat list of morphological forms by their tag.
 * Multiple surface forms (orths) can map to the same tag.
 */
export function getParadigm(forms: MorphForm[]): Paradigm {
  const paradigm: Paradigm = new Map();

  for (const form of forms) {
    const existing = paradigm.get(form.tag);
    if (existing !== undefined) {
      existing.push(form);
    } else {
      paradigm.set(form.tag, [form]);
    }
  }

  return paradigm;
}
