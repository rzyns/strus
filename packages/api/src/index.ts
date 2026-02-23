/**
 * @strus/api — Elysia HTTP server
 *
 * TODO: Integrate oRPC properly once the exact adapter API is confirmed.
 *
 *   Option A (if @orpc/elysia exists):
 *     import { createElysiaHandler } from '@orpc/elysia'
 *     app.use(createElysiaHandler({ router }))
 *
 *   Option B (generic fetch adapter):
 *     import { createFetchHandler } from '@orpc/server'
 *     app.all('/rpc/*', ({ request }) => createFetchHandler({ router, request }))
 *
 * See https://orpc.unnoq.com/adapters for current adapter docs.
 */

import { resolve } from "node:path";
import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "@strus/db";
import { router } from "./router.js";

// Default to 3457 — port 3000 is commonly forwarded from Windows to WSL2
const PORT = Number(process.env["PORT"] ?? 3457);

// Apply any pending migrations at startup.
// Using import.meta.dir (absolute path to this file's directory) so the
// migrations folder resolves correctly regardless of cwd.
const migrationsFolder = resolve(import.meta.dir, "../../db/migrations");
migrate(db, { migrationsFolder });
console.log(`Migrations applied from ${migrationsFolder}`);

export const app = new Elysia()
  // OpenAPI + Swagger UI
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "strus API",
          version: "0.0.1",
          description: "Polish morphological spaced repetition system",
        },
      },
      // Swagger UI served at /docs; spec available at /docs/json
    }),
  )

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------
  .get("/", () => ({ ok: true, version: "0.0.1" }))

  // ---------------------------------------------------------------------------
  // TODO: Mount oRPC router here.
  //
  // Stub REST-ish routes so the server starts while the oRPC adapter is sorted:
  // ---------------------------------------------------------------------------

  // Lists
  .get("/api/lists", () => router.lists.list({}))
  .post("/api/lists", ({ body }) =>
    router.lists.create(body as { name: string; description?: string }),
  )
  .get("/api/lists/:id", ({ params }) => router.lists.get({ id: params.id }))
  .delete("/api/lists/:id", ({ params }) =>
    router.lists.delete({ id: params.id }),
  )
  .post("/api/lists/:id/lexemes", ({ params, body }) =>
    router.lists.addLexeme({
      listId: params.id,
      lexemeId: (body as { lexemeId: string }).lexemeId,
    }),
  )

  // Lexemes
  .get("/api/lexemes", ({ query }) =>
    router.lexemes.list({
      ...(query["listId"] !== undefined ? { listId: query["listId"] } : {}),
    }),
  )
  .post("/api/lexemes", ({ body }) =>
    router.lexemes.create(
      body as { lemma: string; pos: string; notes?: string; listId?: string },
    ),
  )
  .get("/api/lexemes/:id", ({ params }) =>
    router.lexemes.get({ id: params.id }),
  )
  .delete("/api/lexemes/:id", ({ params }) =>
    router.lexemes.delete({ id: params.id }),
  )

  // Session
  .get("/api/session/due", ({ query }) =>
    router.session.due({
      ...(query["listId"] !== undefined ? { listId: query["listId"] } : {}),
      ...(query["limit"] !== undefined ? { limit: Number(query["limit"]) } : {}),
    }),
  )
  .post("/api/session/review", ({ body }) =>
    router.session.review(
      body as { learningTargetId: string; rating: number },
    ),
  )

  // Stats
  .get("/api/stats", () => router.stats.overview({}))

  .listen(PORT);

console.log(`strus API running at http://localhost:${PORT}`);
console.log(`Swagger UI: http://localhost:${PORT}/docs`);

export type App = typeof app;
