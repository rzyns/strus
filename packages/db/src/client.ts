import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getDbConfig } from "@strus/config";
import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof createDb>;

/**
 * Create a Drizzle database client backed by Bun's native SQLite.
 *
 * @param path  Filesystem path to the SQLite database file.
 *              Pass ":memory:" for an in-memory database.
 *              Created automatically if it does not exist.
 */
export function createDb(path: string) {
  const sqlite = new Database(path, { create: true });

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL;");
  // Enforce foreign key constraints
  sqlite.exec("PRAGMA foreign_keys = ON;");

  return drizzle(sqlite, { schema });
}

const { STRUS_DB_PATH } = getDbConfig();

/**
 * Default singleton database client.
 * Uses the `STRUS_DB_PATH` environment variable (required — no default).
 */
export const db = createDb(STRUS_DB_PATH);
