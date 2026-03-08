import { z } from "zod";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface GenerationProvider {
  generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Zod → Gemini SchemaType converter
// ---------------------------------------------------------------------------

type GeminiSchemaType = typeof Type[keyof typeof Type];

type GeminiSchema = {
  type: GeminiSchemaType;
  description?: string;
  nullable?: boolean;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
};

function zodToGeminiSchema(schema: z.ZodTypeAny): GeminiSchema {
  // Unwrap optional/nullable wrappers
  if (schema instanceof z.ZodOptional) {
    return { ...zodToGeminiSchema(schema.unwrap()), nullable: true };
  }
  if (schema instanceof z.ZodNullable) {
    return { ...zodToGeminiSchema(schema.unwrap()), nullable: true };
  }
  if (schema instanceof z.ZodDefault) {
    return zodToGeminiSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodEffects) {
    return zodToGeminiSchema(schema.innerType());
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, GeminiSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToGeminiSchema(value);
      // A field is required unless it's explicitly optional or has a default
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    const result: GeminiSchema = {
      type: Type.OBJECT,
      properties,
    };
    if (required.length > 0) {
      result.required = required;
    }
    return result;
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: Type.ARRAY,
      items: zodToGeminiSchema(schema.element),
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: Type.STRING };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: Type.NUMBER };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: Type.BOOLEAN };
  }

  if (schema instanceof z.ZodEnum) {
    return {
      type: Type.STRING,
      enum: schema.options as string[],
    };
  }

  if (schema instanceof z.ZodLiteral) {
    const val = schema.value;
    if (typeof val === "string") return { type: Type.STRING, enum: [val] };
    if (typeof val === "number") return { type: Type.NUMBER };
    if (typeof val === "boolean") return { type: Type.BOOLEAN };
  }

  // Fallback: treat unknown as string
  return { type: Type.STRING };
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

class GeminiProvider implements GenerationProvider {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for GeminiProvider");
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    const model = process.env.STRUS_GENERATION_MODEL ?? "gemini-2.0-flash-exp";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseSchema = zodToGeminiSchema(schema as z.ZodTypeAny) as any;
    const result = await this.ai.models.generateContent({
      model,
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
    this.client = new OpenAI({
      apiKey: process.env.STRUS_OPENAI_API_KEY ?? "ollama",
      baseURL: process.env.STRUS_OPENAI_BASE_URL,
    });
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    const model = process.env.STRUS_GENERATION_MODEL ?? "gpt-4o-mini";
    const completion = await this.client.chat.completions.parse({
      model,
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
  const p = process.env.STRUS_GENERATION_PROVIDER ?? "gemini";
  if (p === "gemini") return new GeminiProvider();
  if (p === "openai-compatible") return new OpenAICompatProvider();
  throw new Error(`Unknown STRUS_GENERATION_PROVIDER: ${p}`);
}
