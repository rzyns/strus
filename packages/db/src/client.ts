import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
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

const dbPath = process.env["STRUS_DB_PATH"] ?? "./strus.db";

/**
 * Default singleton database client.
 * Uses the `STRUS_DB_PATH` environment variable or `./strus.db`.
 */
export const db = createDb(dbPath);
