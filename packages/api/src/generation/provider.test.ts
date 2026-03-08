import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { Type } from "@google/genai";
import { zodToGeminiSchema } from "./provider.js";

// ---------------------------------------------------------------------------
// zodToGeminiSchema — Zod → Gemini SchemaType converter
// ---------------------------------------------------------------------------

describe("zodToGeminiSchema — leaf types", () => {
  test("converts z.string()", () => {
    expect(zodToGeminiSchema(z.string())).toEqual({ type: Type.STRING });
  });

  test("converts z.number()", () => {
    expect(zodToGeminiSchema(z.number())).toEqual({ type: Type.NUMBER });
  });

  test("converts z.boolean()", () => {
    expect(zodToGeminiSchema(z.boolean())).toEqual({ type: Type.BOOLEAN });
  });
});

describe("zodToGeminiSchema — z.object", () => {
  test("converts a flat object with required fields", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = zodToGeminiSchema(schema);
    expect(result.type).toBe(Type.OBJECT);
    expect(result.properties?.name).toEqual({ type: Type.STRING });
    expect(result.properties?.age).toEqual({ type: Type.NUMBER });
    expect(result.required).toContain("name");
    expect(result.required).toContain("age");
  });

  test("optional fields are excluded from required[]", () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    });
    const result = zodToGeminiSchema(schema);
    expect(result.required).toContain("name");
    expect(result.required).not.toContain("nickname");
  });

  test("nullable fields are excluded from required[]", () => {
    const schema = z.object({
      required_field: z.string(),
      nullable_field: z.string().nullable(),
    });
    const result = zodToGeminiSchema(schema);
    expect(result.required).toContain("required_field");
    expect(result.required).not.toContain("nullable_field");
  });

  test("empty object has no required array (or empty required)", () => {
    const result = zodToGeminiSchema(z.object({}));
    expect(result.type).toBe(Type.OBJECT);
    // required should either be absent or empty
    if (result.required !== undefined) {
      expect(result.required).toHaveLength(0);
    }
  });
});

describe("zodToGeminiSchema — z.array", () => {
  test("converts z.array of strings", () => {
    const result = zodToGeminiSchema(z.array(z.string()));
    expect(result.type).toBe(Type.ARRAY);
    expect(result.items).toEqual({ type: Type.STRING });
  });

  test("converts z.array of numbers", () => {
    const result = zodToGeminiSchema(z.array(z.number()));
    expect(result.type).toBe(Type.ARRAY);
    expect(result.items).toEqual({ type: Type.NUMBER });
  });
});

describe("zodToGeminiSchema — unwrappers", () => {
  test("unwraps z.optional correctly", () => {
    const result = zodToGeminiSchema(z.string().optional());
    expect(result.type).toBe(Type.STRING);
  });

  test("unwraps z.nullable correctly", () => {
    const result = zodToGeminiSchema(z.string().nullable());
    expect(result.type).toBe(Type.STRING);
  });
});

describe("zodToGeminiSchema — enums", () => {
  test("converts z.enum to STRING with enum values", () => {
    const result = zodToGeminiSchema(z.enum(["a", "b", "c"]));
    expect(result.type).toBe(Type.STRING);
    expect(result.enum).toEqual(["a", "b", "c"]);
  });

  test("converts z.literal string to STRING with enum", () => {
    const result = zodToGeminiSchema(z.literal("foo"));
    expect(result.type).toBe(Type.STRING);
    expect(result.enum).toEqual(["foo"]);
  });
});

describe("zodToGeminiSchema — recursion regression", () => {
  /**
   * This is the critical regression test. Before the fix, nested z.object
   * inside z.array was not recursed into — the raw Zod instance leaked into
   * the output. Gemini's API rejects non-plain-object schemas silently or
   * with cryptic errors.
   */
  test("recurses into nested z.object inside z.array (the regression case)", () => {
    const schema = z.object({
      gaps: z.array(
        z.object({
          gap_index: z.number(),
          correct_answers: z.array(z.string()),
          hint: z.string().optional(),
        }),
      ),
    });

    const result = zodToGeminiSchema(schema);

    // gaps must be an ARRAY, not a raw Zod object
    const gaps = result.properties?.gaps;
    expect(gaps?.type).toBe(Type.ARRAY);

    // items must be an OBJECT with properties, not a Zod instance
    const items = gaps?.items;
    expect(items?.type).toBe(Type.OBJECT);
    expect(items?.properties?.gap_index).toEqual({ type: Type.NUMBER });
    const correctAnswers = items?.properties?.correct_answers;
    expect(correctAnswers?.type).toBe(Type.ARRAY);
    expect(correctAnswers?.items).toEqual({ type: Type.STRING });

    // No Zod class instances anywhere in the serialized output
    const json = JSON.stringify(result);
    expect(json).not.toContain("ZodString");
    expect(json).not.toContain("ZodObject");
    expect(json).not.toContain("ZodArray");
    expect(json).not.toContain("ZodNumber");
    expect(json).not.toContain("ZodOptional");
  });

  test("converts the full ClozeNoteSchema without Zod leakage", () => {
    // Mirrors the actual schema used in production
    const ClozeNoteSchema = z.object({
      sentence_text: z.string(),
      translation: z.string().nullable(),
      gaps: z.array(
        z.object({
          gap_index: z.number().int().min(1),
          correct_answers: z.array(z.string().min(1)).min(1),
          hint: z.string().nullable(),
          explanation: z.string(),
          why_not: z.string().nullable(),
        }),
      ).min(1),
    });

    const result = zodToGeminiSchema(ClozeNoteSchema);
    const json = JSON.stringify(result);

    // No Zod instances leaked
    expect(json).not.toMatch(/Zod[A-Z]/);

    // Top-level structure is correct
    expect(result.type).toBe(Type.OBJECT);
    expect(result.properties?.sentence_text).toEqual({ type: Type.STRING });

    // gaps is an array of objects
    const gapsSchema = result.properties?.gaps;
    expect(gapsSchema?.type).toBe(Type.ARRAY);
    const gapItem = gapsSchema?.items;
    expect(gapItem?.type).toBe(Type.OBJECT);
    const gapCorrectAnswers = gapItem?.properties?.correct_answers;
    expect(gapCorrectAnswers?.type).toBe(Type.ARRAY);
    expect(gapCorrectAnswers?.items).toEqual({ type: Type.STRING });
  });
});

describe("zodToGeminiSchema — error cases", () => {
  test("throws on unsupported type (z.date)", () => {
    expect(() => zodToGeminiSchema(z.date())).toThrow();
  });

  test("throws on unsupported type (z.bigint)", () => {
    expect(() => zodToGeminiSchema(z.bigint())).toThrow();
  });
});
