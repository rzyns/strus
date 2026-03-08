import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * All environment variables consumed by strus services.
 *
 * @strus/db  — STRUS_DB_PATH
 * @strus/api — STRUS_DB_PATH, PORT
 * @strus/cli — STRUS_API_URL
 */
const ConfigSchema = z.object({
  /** Absolute path to the SQLite database file. Required — no default. */
  STRUS_DB_PATH: z
    .string({ required_error: "STRUS_DB_PATH is required" })
    .min(1, "STRUS_DB_PATH must not be empty"),

  /** HTTP port the API server listens on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3457),

  /** Base URL the CLI uses to reach the API. */
  STRUS_API_URL: z.string().url().default("http://localhost:3457"),

  /** ElevenLabs API key for TTS generation. Optional — TTS is skipped when absent. */
  ELEVENLABS_API_KEY: z.string().min(1).optional(),

  /** Google Gemini API key for image generation. Optional — images are skipped when absent. */
  GEMINI_API_KEY: z.string().min(1).optional(),

  /** Path to media directory for generated audio/images. Defaults to ./media. */
  STRUS_MEDIA_DIR: z.string().min(1).optional(),

  /** Base URL for serving media files. Defaults to http://localhost:{PORT}/media. */
  STRUS_MEDIA_BASE_URL: z.string().url().optional(),

  // ---------------------------------------------------------------------------
  // LLM generation pipeline
  // ---------------------------------------------------------------------------

  /** LLM provider for exercise generation. Default: "gemini". */
  STRUS_GENERATION_PROVIDER: z
    .enum(["gemini", "openai-compatible"])
    .default("gemini"),

  /** Model name passed to the provider. Default: "gemini-2.0-flash-exp". */
  STRUS_GENERATION_MODEL: z.string().min(1).default("gemini-2.0-flash-exp"),

  /** API key for OpenAI-compatible providers (e.g. OpenAI, Ollama ignores this). */
  STRUS_OPENAI_API_KEY: z.string().min(1).optional(),

  /** Base URL for OpenAI-compatible providers. Omit to use OpenAI default. */
  STRUS_OPENAI_BASE_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse and validate strus configuration from `process.env`.
 * Throws a descriptive error and exits if any required variable is missing
 * or any value fails validation.
 */
export function getConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${String(i.path[0] ?? "(unknown)")}: ${i.message}`)
      .join("\n");
    throw new Error(`strus configuration error:\n${messages}`);
  }
  return result.data;
}

/**
 * Subset for packages that only need the DB path.
 * Still validates the full schema so bad env is caught early.
 */
export function getDbConfig(): Pick<Config, "STRUS_DB_PATH"> {
  return getConfig();
}

/**
 * Subset for the API server.
 */
export function getApiConfig(): Pick<Config, "STRUS_DB_PATH" | "PORT"> {
  return getConfig();
}

/**
 * Subset for the CLI.
 */
export function getCliConfig(): Pick<Config, "STRUS_API_URL"> {
  return getConfig();
}
