import { resolve } from "node:path";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { db } from "@strus/db";
import { router } from "./router.js";
import { staticPlugin } from "@elysiajs/static";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Migrations — applied at startup before the server binds
// ---------------------------------------------------------------------------

const migrationsFolder = resolve(import.meta.dir, "../../db/migrations");
migrate(db, { migrationsFolder });
console.log(`✓ Migrations applied from ${migrationsFolder}`);

// ---------------------------------------------------------------------------
// OpenAPI spec — generated from the oRPC router at startup
// ---------------------------------------------------------------------------

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

const spec = await generator.generate(router, {
  info: {
    title: "strus API",
    version: "0.0.1",
    description:
      "Polish morphological spaced repetition system 🦤\n\n" +
      "Stores vocabulary as *lemmas* (citation/dictionary forms). When a lemma is created with " +
      "source=morfeusz, Morfeusz2 generates all inflected word forms and seeds one FSRS " +
      "learning target per form. Review sessions surface due cards; each review updates the FSRS schedule.",
  },
  servers: [{ url: "/api", description: "API base" }],
  tags: [
    {
      name: "Lists",
      description: "Vocabulary list management. Lists are named collections of lemmas.",
    },
    {
      name: "Lemmas",
      description:
        "Lemma and morphological form management. " +
        "Creating a lemma with source=morfeusz triggers automatic paradigm generation via the Morfeusz2 CLI.",
    },
    {
      name: "Session",
      description:
        "Spaced repetition review session. " +
        "Fetch due cards, present them to the learner, and submit ratings. " +
        "The FSRS algorithm schedules the next review based on the rating.",
    },
    {
      name: "Notes",
      description:
        "Note management. Notes wrap cards — morph notes back morphological drills, " +
        "basic notes are custom front/back flashcards.",
    },
    {
      name: "Stats",
      description: "Aggregate usage statistics for dashboard display.",
    },
  ],
});

// ---------------------------------------------------------------------------
// oRPC handler — routes all /api/* requests to the correct procedure
// ---------------------------------------------------------------------------

const orpcHandler = new OpenAPIHandler(router);
const rpcHandler = new RPCHandler(router);

// ---------------------------------------------------------------------------
// Elysia app
// ---------------------------------------------------------------------------

import { getApiConfig } from "@strus/config";
const { PORT } = getApiConfig();

// Minimal Swagger UI (CDN) — points at our generated spec
const SWAGGER_UI_HTML = /* html */`<!DOCTYPE html>
<html>
<head>
  <title>strus API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({
      url: "/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
    });
  </script>
</body>
</html>`;

// Serve web frontend in production (dist built alongside by CI)
const webDist = resolve(import.meta.dir, "../../web/dist");
const webPlugin = existsSync(webDist)
  ? staticPlugin({ assets: webDist, prefix: "/", indexHTML: true })
  : null;

export const app = new Elysia()
  // Health check
  .get("/", () => ({ ok: true, version: "0.0.1" }))

  // OpenAPI spec (generated from oRPC router + Zod schemas)
  .get("/openapi.json", () => spec)

  // Swagger UI (CDN, loads spec from /openapi.json)
  .get("/docs", () => new Response(SWAGGER_UI_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }))

  // oRPC RPC handler — used by the web client
  .all("/rpc/*", async ({ request }) => {
    const result = await rpcHandler.handle(request, { prefix: "/rpc" });
    return result.matched
      ? result.response
      : new Response("No procedure matched", { status: 404 });
  })

  // oRPC OpenAPI handler — REST routes for Swagger/external consumers
  .all("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched
      ? result.response
      : new Response("No procedure matched", { status: 404 });
  })

  .use(webPlugin ?? new Elysia())
  .listen(PORT);

console.log(`✓ strus API running at http://localhost:${PORT}`);
console.log(`  OpenAPI spec: http://localhost:${PORT}/openapi.json`);
console.log(`  Swagger UI:   http://localhost:${PORT}/docs`);

export type App = typeof app;
