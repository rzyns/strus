import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * All environment variables consumed by strus services, except STRUS_DB_PATH.
 * Used by the CLI and any context that doesn't need DB access.
 *
 * @rzyns/strus-cli — STRUS_API_URL (and optional keys)
 */
const BaseConfigSchema = z.object({
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

  /** Model name passed to the provider. Default: "gemini-2.5-flash". */
  STRUS_GENERATION_MODEL: z.string().min(1).default("gemini-2.5-flash"),

  /** API key for OpenAI-compatible providers (e.g. OpenAI, Ollama ignores this). */
  STRUS_OPENAI_API_KEY: z.string().min(1).optional(),

  /** Base URL for OpenAI-compatible providers. Omit to use OpenAI default. */
  STRUS_OPENAI_BASE_URL: z.string().url().optional(),
});

/**
 * Full server config — extends BaseConfigSchema with the required STRUS_DB_PATH.
 *
 * @rzyns/strus-db  — STRUS_DB_PATH
 * @rzyns/strus-api — STRUS_DB_PATH, PORT
 */
const ServerConfigSchema = BaseConfigSchema.extend({
  /** Absolute path to the SQLite database file. Required — no default. */
  STRUS_DB_PATH: z
    .string({ required_error: "STRUS_DB_PATH is required" })
    .min(1, "STRUS_DB_PATH must not be empty"),
});

export type CliConfig = z.infer<typeof BaseConfigSchema>;
export type Config = z.infer<typeof ServerConfigSchema>;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function formatError(err: z.ZodError): string {
  return err.issues
    .map((i) => `  ${String(i.path[0] ?? "(unknown)")}: ${i.message}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse and validate strus configuration from `process.env`.
 * Throws a descriptive error if any required variable is missing or invalid.
 *
 * Requires STRUS_DB_PATH — use for server/db packages.
 */
export function getConfig(): Config {
  const result = ServerConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`strus configuration error:\n${formatError(result.error)}`);
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
 * Subset for the CLI. Does NOT require STRUS_DB_PATH.
 */
export function getCliConfig(): Pick<CliConfig, "STRUS_API_URL"> {
  const result = BaseConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`strus configuration error:\n${formatError(result.error)}`);
  }
  return result.data;
}
