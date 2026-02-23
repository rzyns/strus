import type { Config } from "drizzle-kit";

export default {
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env["STRUS_DB_PATH"] ?? "./strus.db",
  },
} satisfies Config;
