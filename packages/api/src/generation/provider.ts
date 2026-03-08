import { z } from "zod";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { getConfig } from "@rzyns/strus-config";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface GenerationProvider {
  generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Zod → Gemini SchemaType converter
// ---------------------------------------------------------------------------

type GeminiSchema = {
  type: (typeof Type)[keyof typeof Type];
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
};

export function zodToGeminiSchema(schema: z.ZodTypeAny): GeminiSchema {
  if (schema instanceof z.ZodObject) {
    const props: Record<string, GeminiSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema.shape)) {
      props[key] = zodToGeminiSchema(value as z.ZodTypeAny);
      // Only add to required if not optional/nullable/has default
      if (
        !(value instanceof z.ZodOptional) &&
        !(value instanceof z.ZodNullable) &&
        !(value instanceof z.ZodDefault)
      ) {
        required.push(key);
      }
    }
    return {
      type: Type.OBJECT,
      properties: props,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodArray) {
    return { type: Type.ARRAY, items: zodToGeminiSchema(schema.element) };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    // Unwrap and convert the inner type; Gemini doesn't have a nullable wrapper
    return zodToGeminiSchema(schema.unwrap());
  }

  if (schema instanceof z.ZodDefault) {
    return zodToGeminiSchema(schema._def.innerType);
  }

  if (schema instanceof z.ZodEffects) {
    return zodToGeminiSchema(schema.innerType());
  }

  if (schema instanceof z.ZodString) return { type: Type.STRING };
  if (schema instanceof z.ZodNumber) return { type: Type.NUMBER };
  if (schema instanceof z.ZodBoolean) return { type: Type.BOOLEAN };

  if (schema instanceof z.ZodEnum) {
    return { type: Type.STRING, enum: schema.options as string[] };
  }

  if (schema instanceof z.ZodLiteral) {
    const val = schema.value;
    if (typeof val === "string") return { type: Type.STRING, enum: [val] };
    if (typeof val === "number") return { type: Type.NUMBER };
    if (typeof val === "boolean") return { type: Type.BOOLEAN };
  }

  throw new Error(`Unsupported Zod type: ${schema.constructor.name}`);
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

class GeminiProvider implements GenerationProvider {
  private ai: GoogleGenAI;

  constructor() {
    const { GEMINI_API_KEY } = getConfig();
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for GeminiProvider");
    this.ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    const { STRUS_GENERATION_MODEL } = getConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseSchema = zodToGeminiSchema(schema as z.ZodTypeAny) as any;
    const result = await this.ai.models.generateContent({
      model: STRUS_GENERATION_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });
    const text = result.text ?? "{}";
    return schema.parse(JSON.parse(text));
  }
}

// ---------------------------------------------------------------------------
// OpenAICompatProvider
// ---------------------------------------------------------------------------

class OpenAICompatProvider implements GenerationProvider {
  private client: OpenAI;

  constructor() {
    const { STRUS_OPENAI_API_KEY, STRUS_OPENAI_BASE_URL } = getConfig();
    this.client = new OpenAI({
      apiKey: STRUS_OPENAI_API_KEY ?? "ollama",
      baseURL: STRUS_OPENAI_BASE_URL,
    });
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    const { STRUS_GENERATION_MODEL } = getConfig();
    const completion = await this.client.chat.completions.parse({
      model: STRUS_GENERATION_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: zodResponseFormat(schema as z.ZodType<T & Record<string, unknown>>, "output"),
    });
    const parsed = completion.choices[0]?.message.parsed;
    return schema.parse(parsed);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProvider(): GenerationProvider {
  const { STRUS_GENERATION_PROVIDER } = getConfig();
  if (STRUS_GENERATION_PROVIDER === "gemini") return new GeminiProvider();
  if (STRUS_GENERATION_PROVIDER === "openai-compatible") return new OpenAICompatProvider();
  throw new Error(`Unknown STRUS_GENERATION_PROVIDER: ${STRUS_GENERATION_PROVIDER}`);
}
