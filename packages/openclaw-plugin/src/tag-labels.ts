/** Convert Morfeusz2 tags to human-readable labels. */

const CASE_MAP: Record<string, string> = {
  nom: "nominative",
  gen: "genitive",
  dat: "dative",
  acc: "accusative",
  inst: "instrumental",
  loc: "locative",
  voc: "vocative",
};

const NUMBER_MAP: Record<string, string> = {
  sg: "singular",
  pl: "plural",
};

const PERSON_MAP: Record<string, string> = {
  pri: "1st person",
  sec: "2nd person",
  ter: "3rd person",
};

const GENDER_MAP: Record<string, string> = {
  m1: "masculine-personal",
  m2: "masculine-animate",
  m3: "masculine-inanimate",
  f: "feminine",
  n: "neuter",
};

const GENDER_SHORT: Record<string, string> = {
  m1: "masc.pers.",
  m2: "masc.anim.",
  m3: "masc.inanim.",
  f: "fem.",
  n: "neut.",
};

function formatGender(raw: string): string {
  // Handle single gender
  if (GENDER_MAP[raw]) return GENDER_MAP[raw];
  // Handle dot-joined multi-gender like "m2.m3.f.n" or "m1.m2.m3"
  const genders = raw.split(".");
  // Common shorthand patterns
  const set = new Set(genders);
  if (set.has("m1") && set.has("m2") && set.has("m3") && set.has("f") && set.has("n"))
    return "all genders";
  if (!set.has("m1") && (set.has("m2") || set.has("m3") || set.has("f") || set.has("n")))
    return "non-masculine-personal";
  if (set.has("m1") && !set.has("f") && !set.has("n"))
    return "masculine-personal";
  return genders.map((g) => GENDER_SHORT[g] ?? g).join("/");
}

function formatCase(raw: string): string {
  // Handle multi-case like "nom.acc"
  return raw
    .split(".")
    .map((c) => CASE_MAP[c] ?? c)
    .join("/");
}

function aspectSuffix(parts: string[]): string {
  if (parts.includes("imperf")) return " (imperfective)";
  if (parts.includes("perf")) return " (perfective)";
  return "";
}

/**
 * Build a human-readable label from a Morfeusz2 tag string.
 * Tag format varies by POS — see CLAUDE.md for full mappings.
 */
export function tagLabel(tag: string): string {
  const parts = tag.split(":");
  const pos = parts[0];
  const aspect = aspectSuffix(parts);

  // Nouns: subst:number:case(s):gender
  if (pos === "subst" && parts.length >= 4) {
    const num = NUMBER_MAP[parts[1]] ?? parts[1];
    const cas = formatCase(parts[2]);
    return `${cas} ${num}`;
  }

  // Infinitive: inf:aspect
  if (pos === "inf") {
    return `infinitive${aspect}`;
  }

  // Finite verbs: fin:number:person:aspect
  if (pos === "fin" && parts.length >= 4) {
    const num = NUMBER_MAP[parts[1]] ?? parts[1];
    const person = PERSON_MAP[parts[2]] ?? parts[2];
    return `${person} ${num} present${aspect}`;
  }

  // Past tense: praet:number:gender:aspect
  if (pos === "praet" && parts.length >= 4) {
    const num = parts[1];
    const gender = parts[2];

    if (num === "sg") {
      if (gender === "m1" || gender === "m2" || gender === "m3") {
        return `past masc. sg.${aspect}`;
      }
      if (gender === "f") {
        return `past fem. sg.${aspect}`;
      }
      if (gender === "n") {
        return `past neut. sg.${aspect}`;
      }
      return `past ${gender} sg.${aspect}`;
    }

    if (num === "pl") {
      if (gender === "m1") {
        return `past masc.pers. pl.${aspect}`;
      }
      // m2, m3, f, n in plural → non-masculine-personal
      return `past non-m1 pl.${aspect}`;
    }

    return `past ${gender} ${num}${aspect}`;
  }

  // Imperative: impt:number:person
  if (pos === "impt" && parts.length >= 3) {
    const num = parts[1];
    const person = parts[2];
    const personLabel = person === "pri" ? "1st" : person === "sec" ? "2nd" : person === "ter" ? "3rd" : person;
    return `imperative ${personLabel} ${num === "sg" ? "sg." : "pl."}`;
  }

  // Gerund / verbal noun: ger:number:case:gender:aspect...
  if (pos === "ger" && parts.length >= 3) {
    const num = NUMBER_MAP[parts[1]] ?? parts[1];
    const cas = formatCase(parts[2]);
    return `verbal noun, ${cas} ${num}${aspect}`;
  }

  // Active participle: pact:...
  if (pos === "pact") {
    if (parts.length >= 4) {
      const num = parts[1];
      const cas = formatCase(parts[2]);
      const gender = GENDER_SHORT[parts[3]] ?? parts[3];
      return `active participle, ${gender} ${cas} ${num === "sg" ? "sg." : "pl."}${aspect}`;
    }
    return `active participle${aspect}`;
  }

  // Passive participle: ppas:...
  if (pos === "ppas") {
    if (parts.length >= 4) {
      const num = parts[1];
      const cas = formatCase(parts[2]);
      const gender = GENDER_SHORT[parts[3]] ?? parts[3];
      return `passive participle, ${gender} ${cas} ${num === "sg" ? "sg." : "pl."}${aspect}`;
    }
    return `passive participle${aspect}`;
  }

  // Adjectives: adj:number:case:gender[:degree]
  // Degree is pos (positive), com (comparative), sup (superlative)
  if (pos === "adj" && parts.length >= 4) {
    const num = NUMBER_MAP[parts[1]] ?? parts[1];
    const cas = formatCase(parts[2]);
    const gender = formatGender(parts[3]);
    const degree = parts[4]; // may be undefined
    const degreeLabel = degree === "com" ? " (comparative)" : degree === "sup" ? " (superlative)" : "";
    return `${cas} ${num} (${gender})${degreeLabel}`;
  }

  // Adverb: adv
  if (pos === "adv") {
    return "adverb";
  }

  // Comparative adverb: com
  if (pos === "com") {
    return "comparative";
  }

  // Superlative adverb: sup
  if (pos === "sup") {
    return "superlative";
  }

  // Fallback: raw tag in backticks
  return `\`${tag}\``;
}
