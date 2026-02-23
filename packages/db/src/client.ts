import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof createDb>;

/**
 * Create a Drizzle database client backed by better-sqlite3.
 *
 * @param path  Filesystem path to the SQLite database file.
 *              Created automatically if it does not exist.
 */
export function createDb(path: string) {
  const sqlite = new Database(path);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  // Enforce foreign key constraints
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

const dbPath = process.env["STRUS_DB_PATH"] ?? "./strus.db";

/**
 * Default singleton database client.
 * Uses the `STRUS_DB_PATH` environment variable or `./strus.db`.
 */
export const db = createDb(dbPath);
