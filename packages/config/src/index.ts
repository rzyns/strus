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
