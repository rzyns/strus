import type { MorphForm, ParsedTag, Paradigm } from "./types.js";

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
