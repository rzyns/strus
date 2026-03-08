import { describe, test, expect } from "bun:test";
import { parseTag, tagGender, tagWordClass, tagGenderLabel, getParadigm } from "./parser.js";
import type { MorphForm, MorphGender } from "./types.js";

// ---------------------------------------------------------------------------
// parseTag
// ---------------------------------------------------------------------------

describe("parseTag", () => {
  test("noun with 4 features: subst:sg:inst:m3", () => {
    const parsed = parseTag("subst:sg:inst:m3");
    expect(parsed.pos).toBe("subst");
    expect(parsed.features.feat1).toBe("sg");
    expect(parsed.features.feat2).toBe("inst");
    expect(parsed.features.feat3).toBe("m3");
    expect(parsed.raw).toBe("subst:sg:inst:m3");
  });

  test("verb with 4 features: fin:sg:ter:imperf", () => {
    const parsed = parseTag("fin:sg:ter:imperf");
    expect(parsed.pos).toBe("fin");
    expect(parsed.features.feat1).toBe("sg");
    expect(parsed.features.feat2).toBe("ter");
    expect(parsed.features.feat3).toBe("imperf");
    expect(parsed.raw).toBe("fin:sg:ter:imperf");
  });

  test("adjective with 5 features: adj:sg:nom:m1:pos", () => {
    const parsed = parseTag("adj:sg:nom:m1:pos");
    expect(parsed.pos).toBe("adj");
    expect(parsed.features.feat1).toBe("sg");
    expect(parsed.features.feat2).toBe("nom");
    expect(parsed.features.feat3).toBe("m1");
    expect(parsed.features.feat4).toBe("pos");
  });

  test("adverb with no features: adv", () => {
    const parsed = parseTag("adv");
    expect(parsed.pos).toBe("adv");
    expect(parsed.features).toEqual({});
    expect(parsed.raw).toBe("adv");
  });

  test("raw is always preserved verbatim", () => {
    const tag = "ger:sg:nom:n:imperf:aff";
    expect(parseTag(tag).raw).toBe(tag);
  });

  test("conjunction with no features: conj", () => {
    const parsed = parseTag("conj");
    expect(parsed.pos).toBe("conj");
    expect(Object.keys(parsed.features)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// tagGender
// ---------------------------------------------------------------------------

describe("tagGender", () => {
  test.each([
    // masculine subtypes
    ["subst:sg:nom:m1", "m"],
    ["subst:pl:gen:m2", "m"],
    ["subst:sg:nom:m3", "m"],
    // feminine
    ["subst:sg:nom:f",  "f"],
    ["subst:pl:gen:f",  "f"],
    // neuter
    ["subst:sg:nom:n",  "n"],
    // adjective gender
    ["adj:sg:nom:m1:pos", "m"],
    ["adj:sg:nom:f:pos",  "f"],
    ["adj:sg:nom:n:pos",  "n"],
  ])("tagGender(%s) === %s", (tag, expected) => {
    // test.each infers `expected` as `string`; cast to MorphGender since the
    // table only contains valid gender values (checked at author time).
    expect(tagGender(tag)).toBe(expected as MorphGender);
  });

  test("returns null for tags with no gender component", () => {
    expect(tagGender("adv")).toBeNull();
    expect(tagGender("conj")).toBeNull();
    expect(tagGender("fin:sg:ter:imperf")).toBeNull();
  });

  test("handles dot-separated alternatives: nom.acc:m3", () => {
    // In NKJP tags, ambiguous case is written as nom.acc.
    // The gender token (m3) follows and should still be detected.
    expect(tagGender("subst:sg:nom.acc:m3")).toBe("m");
  });

  test("handles gender token inside dot-alternatives: m3 in adj:sg:nom.m3", () => {
    // Rare but valid: gender embedded in a dot-separated feature
    expect(tagGender("adj:sg:nom.m3")).toBe("m");
  });
});

// ---------------------------------------------------------------------------
// tagWordClass
// ---------------------------------------------------------------------------

describe("tagWordClass", () => {
  test.each([
    ["subst:sg:nom:m3",   "noun"],
    ["verb:fin",          "verb"],     // starts with "verb:" — matched
    ["fin:sg:ter:imperf", ""],        // fin is not mapped — tagWordClass only checks verb/ger/pact/ppas
    ["ger:sg:nom:n:imperf:aff", "verb"],
    ["pact:sg:nom:m1:imperf:aff", "verb"],
    ["ppas:sg:nom:m3:perf:aff", "verb"],
    ["adj:sg:nom:m1:pos", "adjective"],
    ["adja",              "adjective"],  // adja starts with 'adj'
    ["adv",               "adverb"],
    ["advp",              "adverb"],     // advp starts with 'adv'
    ["num:pl:nom:m1:rec", "numeral"],
    ["prep:acc:nwok",     "preposition"],
    ["conj",              "conjunction"],
    ["comp:conj",         "conjunction"],
    ["interj",            "interjection"],
    ["brev:pun",          ""],          // no match → empty string
  ])("tagWordClass(%s) === %j", (tag, expected) => {
    expect(tagWordClass(tag)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tagGenderLabel
// ---------------------------------------------------------------------------

describe("tagGenderLabel", () => {
  test.each([
    ["subst:sg:nom:m3", "masculine"],
    ["subst:sg:nom:f",  "feminine"],
    ["subst:sg:nom:n",  "neuter"],
    ["adv",             ""],
    ["conj",            ""],
  ])("tagGenderLabel(%s) === %j", (tag, expected) => {
    expect(tagGenderLabel(tag)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getParadigm
// ---------------------------------------------------------------------------

describe("getParadigm", () => {
  const forms: MorphForm[] = [
    { orth: "dom",   lemma: "dom", tag: "subst:sg:nom:m3" },
    { orth: "domu",  lemma: "dom", tag: "subst:sg:gen:m3" },
    { orth: "domem", lemma: "dom", tag: "subst:sg:inst:m3" },
    // Two orths with the same tag (variant spellings)
    { orth: "domy",  lemma: "dom", tag: "subst:pl:nom:m3" },
    { orth: "domy",  lemma: "dom", tag: "subst:pl:nom:m3" },
  ];

  test("groups forms by tag", () => {
    const paradigm = getParadigm(forms);
    expect(paradigm.get("subst:sg:nom:m3")).toHaveLength(1);
    expect(paradigm.get("subst:sg:gen:m3")).toHaveLength(1);
    expect(paradigm.get("subst:sg:inst:m3")).toHaveLength(1);
  });

  test("accumulates multiple orths under the same tag", () => {
    const paradigm = getParadigm(forms);
    const plural = paradigm.get("subst:pl:nom:m3");
    expect(plural).toHaveLength(2);
    expect(plural?.map(f => f.orth)).toEqual(["domy", "domy"]);
  });

  test("returns a Map", () => {
    expect(getParadigm(forms)).toBeInstanceOf(Map);
  });

  test("empty input returns empty Map", () => {
    const paradigm = getParadigm([]);
    expect(paradigm.size).toBe(0);
  });

  test("preserves orth and lemma on grouped entries", () => {
    const paradigm = getParadigm(forms);
    const entry = paradigm.get("subst:sg:nom:m3")?.[0];
    expect(entry?.orth).toBe("dom");
    expect(entry?.lemma).toBe("dom");
  });
});
