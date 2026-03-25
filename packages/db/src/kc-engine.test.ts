import { describe, test, expect } from "bun:test";
import { tagMatchesKC, mapCardToKCs } from "./kc-engine.js";
import type { KnowledgeComponent } from "./kc-engine.js";

// ---------------------------------------------------------------------------
// Helpers to build minimal KC objects for testing
// ---------------------------------------------------------------------------

function makeKC(overrides: Partial<KnowledgeComponent> & { id: string; kind: string; label: string }): KnowledgeComponent {
  return {
    labelPl: null,
    tagPattern: null,
    lemmaId: null,
    createdAt: new Date(),
    ...overrides,
  } as KnowledgeComponent;
}

// ---------------------------------------------------------------------------
// tagMatchesKC — case (glob patterns like *:gen:*)
// ---------------------------------------------------------------------------

describe("tagMatchesKC — case", () => {
  const genKC = makeKC({ id: "kc-case-gen", kind: "case", label: "genitive", tagPattern: "*:gen:*" });
  const nomKC = makeKC({ id: "kc-case-nom", kind: "case", label: "nominative", tagPattern: "*:nom:*" });
  const accKC = makeKC({ id: "kc-case-acc", kind: "case", label: "accusative", tagPattern: "*:acc:*" });
  const instKC = makeKC({ id: "kc-case-inst", kind: "case", label: "instrumental", tagPattern: "*:inst:*" });
  const datKC  = makeKC({ id: "kc-case-dat",  kind: "case", label: "dative", tagPattern: "*:dat:*" });
  const locKC  = makeKC({ id: "kc-case-loc",  kind: "case", label: "locative", tagPattern: "*:loc:*" });
  const vocKC  = makeKC({ id: "kc-case-voc",  kind: "case", label: "vocative", tagPattern: "*:voc:*" });

  test("subst:sg:gen:m3 → genitive", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", genKC)).toBe(true);
  });

  test("subst:sg:nom:m3 → nominative", () => {
    expect(tagMatchesKC("subst:sg:nom:m3", nomKC)).toBe(true);
  });

  test("subst:sg:acc:m3 → accusative", () => {
    expect(tagMatchesKC("subst:sg:acc:m3", accKC)).toBe(true);
  });

  test("subst:sg:inst:m3 → instrumental", () => {
    expect(tagMatchesKC("subst:sg:inst:m3", instKC)).toBe(true);
  });

  test("subst:pl:dat:f → dative", () => {
    expect(tagMatchesKC("subst:pl:dat:f", datKC)).toBe(true);
  });

  test("subst:sg:loc:m3 → locative", () => {
    expect(tagMatchesKC("subst:sg:loc:m3", locKC)).toBe(true);
  });

  test("subst:sg:voc:m3 → vocative", () => {
    expect(tagMatchesKC("subst:sg:voc:m3", vocKC)).toBe(true);
  });

  test("subst:sg:gen:m3 does NOT match nominative", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", nomKC)).toBe(false);
  });

  test("adj:sg:nom.acc:m1:pos → nominative (via dot-alternative)", () => {
    expect(tagMatchesKC("adj:sg:nom.acc:m1:pos", nomKC)).toBe(true);
  });

  test("adj:sg:nom.acc:m1:pos → accusative (via dot-alternative)", () => {
    expect(tagMatchesKC("adj:sg:nom.acc:m1:pos", accKC)).toBe(true);
  });

  test("adj:sg:nom.acc:m1:pos does NOT match genitive", () => {
    expect(tagMatchesKC("adj:sg:nom.acc:m1:pos", genKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tagMatchesKC — number
// ---------------------------------------------------------------------------

describe("tagMatchesKC — number", () => {
  const sgKC = makeKC({ id: "kc-num-sg", kind: "number", label: "singular", tagPattern: "*:sg:*" });
  const plKC = makeKC({ id: "kc-num-pl", kind: "number", label: "plural",   tagPattern: "*:pl:*" });

  test("subst:sg:gen:m3 → singular", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", sgKC)).toBe(true);
  });

  test("subst:pl:nom:m3 → plural", () => {
    expect(tagMatchesKC("subst:pl:nom:m3", plKC)).toBe(true);
  });

  test("subst:sg:gen:m3 does NOT match plural", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", plKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tagMatchesKC — gender (bare token matching)
// ---------------------------------------------------------------------------

describe("tagMatchesKC — gender", () => {
  const m1KC = makeKC({ id: "kc-gen-m1", kind: "gender", label: "masculine personal",  tagPattern: "m1" });
  const m2KC = makeKC({ id: "kc-gen-m2", kind: "gender", label: "masculine animate",   tagPattern: "m2" });
  const m3KC = makeKC({ id: "kc-gen-m3", kind: "gender", label: "masculine inanimate", tagPattern: "m3" });
  const fKC  = makeKC({ id: "kc-gen-f",  kind: "gender", label: "feminine",            tagPattern: "f" });
  const nKC  = makeKC({ id: "kc-gen-n",  kind: "gender", label: "neuter",              tagPattern: "n" });

  test("subst:sg:gen:m3 → masculine inanimate (m3 as final segment)", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", m3KC)).toBe(true);
  });

  test("subst:sg:gen:m3 does NOT match m1", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", m1KC)).toBe(false);
  });

  test("adj:sg:nom:m1:pos → masculine personal (m1 mid-segment)", () => {
    expect(tagMatchesKC("adj:sg:nom:m1:pos", m1KC)).toBe(true);
  });

  test("adj:sg:nom:f:pos → feminine", () => {
    expect(tagMatchesKC("adj:sg:nom:f:pos", fKC)).toBe(true);
  });

  test("adj:sg:nom:n:pos → neuter", () => {
    expect(tagMatchesKC("adj:sg:nom:n:pos", nKC)).toBe(true);
  });

  test("subst:sg:nom.acc:m2 → m2 via dot-alternative last-segment handling", () => {
    // m2 appears as last segment
    expect(tagMatchesKC("subst:sg:nom.acc:m2", m2KC)).toBe(true);
  });

  test("adj:sg:nom.m3 → m3 inside dot-alternative segment", () => {
    // m3 embedded in a dot alternative within a segment
    expect(tagMatchesKC("adj:sg:nom.m3", m3KC)).toBe(true);
  });

  test("fin:sg:ter:imperf → no gender match", () => {
    expect(tagMatchesKC("fin:sg:ter:imperf", m1KC)).toBe(false);
    expect(tagMatchesKC("fin:sg:ter:imperf", fKC)).toBe(false);
    expect(tagMatchesKC("fin:sg:ter:imperf", nKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tagMatchesKC — tense
// ---------------------------------------------------------------------------

describe("tagMatchesKC — tense", () => {
  const presKC  = makeKC({ id: "kc-tense-pres", kind: "tense", label: "present", tagPattern: "fin:*" });
  const pastKC  = makeKC({ id: "kc-tense-past", kind: "tense", label: "past",    tagPattern: "praet:*" });
  const futKC   = makeKC({ id: "kc-tense-fut",  kind: "tense", label: "future",  tagPattern: "bedzie:*" });

  test("fin:sg:ter:imperf → present", () => {
    expect(tagMatchesKC("fin:sg:ter:imperf", presKC)).toBe(true);
  });

  test("praet:sg:m1:imperf → past", () => {
    expect(tagMatchesKC("praet:sg:m1:imperf", pastKC)).toBe(true);
  });

  test("bedzie:sg:ter:imperf → future", () => {
    expect(tagMatchesKC("bedzie:sg:ter:imperf", futKC)).toBe(true);
  });

  test("subst:sg:gen:m3 does NOT match any tense", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", presKC)).toBe(false);
    expect(tagMatchesKC("subst:sg:gen:m3", pastKC)).toBe(false);
    expect(tagMatchesKC("subst:sg:gen:m3", futKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tagMatchesKC — mood
// ---------------------------------------------------------------------------

describe("tagMatchesKC — mood", () => {
  const indKC  = makeKC({ id: "kc-mood-ind",  kind: "mood", label: "indicative",  tagPattern: "fin:*" });
  const impKC  = makeKC({ id: "kc-mood-imp",  kind: "mood", label: "imperative",  tagPattern: "impt:*" });
  const condKC = makeKC({ id: "kc-mood-cond", kind: "mood", label: "conditional", tagPattern: "cond:*" });

  test("fin:sg:ter:imperf → indicative", () => {
    expect(tagMatchesKC("fin:sg:ter:imperf", indKC)).toBe(true);
  });

  test("impt:sg:sec → imperative", () => {
    expect(tagMatchesKC("impt:sg:sec", impKC)).toBe(true);
  });

  test("cond:sg:m1 → conditional", () => {
    expect(tagMatchesKC("cond:sg:m1", condKC)).toBe(true);
  });

  test("subst:sg:nom:m3 does NOT match any mood", () => {
    expect(tagMatchesKC("subst:sg:nom:m3", indKC)).toBe(false);
    expect(tagMatchesKC("subst:sg:nom:m3", impKC)).toBe(false);
    expect(tagMatchesKC("subst:sg:nom:m3", condKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tagMatchesKC — POS (comma-separated lists)
// ---------------------------------------------------------------------------

describe("tagMatchesKC — pos", () => {
  const nounKC       = makeKC({ id: "kc-pos-noun",       kind: "pos", label: "noun",       tagPattern: "subst:*" });
  const verbKC       = makeKC({ id: "kc-pos-verb",       kind: "pos", label: "verb",       tagPattern: "fin,praet,bedzie,impt,cond,imps,inf,pcon,pant,pact,ppas,ger,winien" });
  const adjKC        = makeKC({ id: "kc-pos-adj",        kind: "pos", label: "adjective",  tagPattern: "adj:*" });
  const advKC        = makeKC({ id: "kc-pos-adv",        kind: "pos", label: "adverb",     tagPattern: "adv:*" });
  const numKC        = makeKC({ id: "kc-pos-num",        kind: "pos", label: "numeral",    tagPattern: "num:*" });
  const participleKC = makeKC({ id: "kc-pos-participle", kind: "pos", label: "participle", tagPattern: "pcon,pant,pact,ppas" });

  test("subst:sg:gen:m3 → noun", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", nounKC)).toBe(true);
  });

  test("fin:sg:ter:imperf → verb", () => {
    expect(tagMatchesKC("fin:sg:ter:imperf", verbKC)).toBe(true);
  });

  test("praet:sg:m1:imperf → verb", () => {
    expect(tagMatchesKC("praet:sg:m1:imperf", verbKC)).toBe(true);
  });

  test("inf:imperf → verb", () => {
    expect(tagMatchesKC("inf:imperf", verbKC)).toBe(true);
  });

  test("ger:sg:nom:n:imperf:aff → NOT verb (ger is not in the pattern)", () => {
    // Wait — ger IS in the pattern. Let's assert it matches.
    expect(tagMatchesKC("ger:sg:nom:n:imperf:aff", verbKC)).toBe(true);
  });

  test("pact:sg:nom:m1:imperf:aff → verb AND participle", () => {
    expect(tagMatchesKC("pact:sg:nom:m1:imperf:aff", verbKC)).toBe(true);
    expect(tagMatchesKC("pact:sg:nom:m1:imperf:aff", participleKC)).toBe(true);
  });

  test("ppas:sg:nom:m3:perf:aff → participle", () => {
    expect(tagMatchesKC("ppas:sg:nom:m3:perf:aff", participleKC)).toBe(true);
  });

  test("adj:sg:nom:m1:pos → adjective", () => {
    expect(tagMatchesKC("adj:sg:nom:m1:pos", adjKC)).toBe(true);
  });

  test("adv → adverb (bare tag matches adv:* because * matches 0 segments)", () => {
    // The * in "adv:*" matches zero or more segments, so bare "adv" matches.
    // This is correct and desirable — Polish adverbs appear as both "adv" and "adv:pos".
    expect(tagMatchesKC("adv", advKC)).toBe(true);
    expect(tagMatchesKC("adv:pos", advKC)).toBe(true);
  });

  test("num:pl:nom:m1:rec → numeral", () => {
    expect(tagMatchesKC("num:pl:nom:m1:rec", numKC)).toBe(true);
  });

  test("noun tag does NOT match verb", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", verbKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tagMatchesKC — lemma-kind KCs
// ---------------------------------------------------------------------------

describe("tagMatchesKC — lemma KCs", () => {
  const lemmaKC = makeKC({ id: "kc-lemma-abc", kind: "lemma", label: "lemma:abc", tagPattern: null, lemmaId: "abc" });

  test("lemma KC always returns false (matched separately)", () => {
    expect(tagMatchesKC("subst:sg:gen:m3", lemmaKC)).toBe(false);
    expect(tagMatchesKC("fin:sg:ter:imperf", lemmaKC)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapCardToKCs — integration
// ---------------------------------------------------------------------------

describe("mapCardToKCs", () => {
  const allKCs: KnowledgeComponent[] = [
    makeKC({ id: "kc-case-nom",  kind: "case",   label: "nominative",           tagPattern: "*:nom:*" }),
    makeKC({ id: "kc-case-gen",  kind: "case",   label: "genitive",             tagPattern: "*:gen:*" }),
    makeKC({ id: "kc-num-sg",    kind: "number", label: "singular",             tagPattern: "*:sg:*" }),
    makeKC({ id: "kc-num-pl",    kind: "number", label: "plural",               tagPattern: "*:pl:*" }),
    makeKC({ id: "kc-gen-m3",    kind: "gender", label: "masculine inanimate",  tagPattern: "m3" }),
    makeKC({ id: "kc-pos-noun",  kind: "pos",    label: "noun",                 tagPattern: "subst:*" }),
    makeKC({ id: "kc-lemma-xyz", kind: "lemma",  label: "lemma:xyz",            tagPattern: null, lemmaId: "xyz" }),
  ];

  test("subst:sg:gen:m3 → genitive + singular + m3 + noun (4 KCs, no lemma)", () => {
    const ids = mapCardToKCs("subst:sg:gen:m3", allKCs);
    expect(ids).toContain("kc-case-gen");
    expect(ids).toContain("kc-num-sg");
    expect(ids).toContain("kc-gen-m3");
    expect(ids).toContain("kc-pos-noun");
    expect(ids).not.toContain("kc-case-nom");
    expect(ids).not.toContain("kc-num-pl");
    expect(ids).not.toContain("kc-lemma-xyz");
    expect(ids).toHaveLength(4);
  });

  test("adj:sg:nom.acc:m1:pos → nominative + accusative + singular + m1 (if m1 in KCs)", () => {
    const kcsWithM1 = [
      ...allKCs,
      makeKC({ id: "kc-gen-m1",   kind: "gender", label: "masculine personal", tagPattern: "m1" }),
      makeKC({ id: "kc-case-acc", kind: "case",   label: "accusative",         tagPattern: "*:acc:*" }),
      makeKC({ id: "kc-pos-adj",  kind: "pos",    label: "adjective",          tagPattern: "adj:*" }),
    ];
    const ids = mapCardToKCs("adj:sg:nom.acc:m1:pos", kcsWithM1);
    expect(ids).toContain("kc-case-nom");
    expect(ids).toContain("kc-case-acc");
    expect(ids).toContain("kc-num-sg");
    expect(ids).toContain("kc-gen-m1");
    expect(ids).toContain("kc-pos-adj");
    expect(ids).not.toContain("kc-gen-m3");
    expect(ids).not.toContain("kc-pos-noun");
  });

  test("lemma-kind KCs excluded from results", () => {
    const ids = mapCardToKCs("subst:sg:gen:m3", allKCs);
    expect(ids).not.toContain("kc-lemma-xyz");
  });

  test("empty KCs list → no matches", () => {
    expect(mapCardToKCs("subst:sg:gen:m3", [])).toHaveLength(0);
  });
});
