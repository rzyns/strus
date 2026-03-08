import { resolve, join, extname, sep } from "node:path";
import { Elysia } from "elysia";
import { otelPlugin } from "./instrumentation.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { db } from "@rzyns/strus-db";
import { router } from "./router.js";
import { staticPlugin } from "@elysiajs/static";
import { existsSync, readFileSync } from "node:fs";

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

import { getApiConfig } from "@rzyns/strus-config";
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
const webIndexHtml = existsSync(webDist)
  ? readFileSync(resolve(webDist, "index.html"), "utf-8")
  : null;

// Serve the Vite-built static assets (JS, CSS, etc.) from /assets/*
// indexHTML is intentionally disabled — Bun tries to resolve asset paths
// in HTML as module imports, which throws. We handle the SPA fallback
// ourselves with a wildcard route below.
const webPlugin = existsSync(webDist)
  ? staticPlugin({ assets: webDist, prefix: "/", indexHTML: false, alwaysStatic: true })
  : null;

export const app = new Elysia()
  // OTel — must be first so it can instrument all subsequent lifecycle hooks
  .use(otelPlugin)
  // Health check
  .get("/health", () => ({ ok: true, version: "0.0.1" }))

  // OpenAPI spec (generated from oRPC router + Zod schemas)
  .get("/openapi.json", () => spec)

  // Swagger UI (CDN, loads spec from /openapi.json)
  .get("/docs", () => new Response(SWAGGER_UI_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }))

  // Static media files (TTS audio, mnemonic images)
  .get("/media/*", ({ params }) => {
    const mediaDir = process.env.STRUS_MEDIA_DIR || resolve(process.cwd(), "media");
    const rawPath = (params as Record<string, string>)["*"] ?? "";
    // Decode percent-encoding (e.g. %C4%99 → ę) so Polish filenames resolve correctly
    const relPath = decodeURIComponent(rawPath);
    const filePath = join(mediaDir, relPath);

    // Prevent path traversal (check after decoding to catch encoded ../ attempts)
    const allowedPrefix = mediaDir.endsWith(sep) ? mediaDir : mediaDir + sep;
    if (filePath !== mediaDir && !filePath.startsWith(allowedPrefix)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (!file.size) {
      return new Response("Not found", { status: 404 });
    }

    const ext = extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };

    return new Response(file, {
      headers: { "Content-Type": contentTypes[ext] || "application/octet-stream" },
    });
  })

  // oRPC RPC handler — used by the web client
  // NOTE: use per-method helpers, not .all() — Elysia 1.4 .get("/*") beats .all("/rpc/*") for GETs
  .get("/rpc/*", async ({ request }) => {
    const result = await rpcHandler.handle(request, { prefix: "/rpc" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })
  .post("/rpc/*", async ({ request }) => {
    const result = await rpcHandler.handle(request, { prefix: "/rpc" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })

  // oRPC OpenAPI handler — REST routes for Swagger/external consumers
  // NOTE: same Elysia quirk — must use per-method routes instead of .all()
  .get("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })
  .post("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })
  .put("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })
  .patch("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })
  .delete("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched ? result.response : new Response("No procedure matched", { status: 404 });
  })

  .use(webPlugin ?? new Elysia())
  // SPA fallback: serve index.html for any route not matched above
  // (catches /quiz, /lemmas/:id, etc. so client-side routing works)
  .get("/*", () =>
    webIndexHtml
      ? new Response(webIndexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      : new Response("Not found", { status: 404 })
  )
  .listen(PORT);

console.log(`✓ strus API running at http://localhost:${PORT}`);
console.log(`  OpenAPI spec: http://localhost:${PORT}/openapi.json`);
console.log(`  Swagger UI:   http://localhost:${PORT}/docs`);

export type App = typeof app;
