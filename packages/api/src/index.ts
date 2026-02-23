import { resolve } from "node:path";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { db } from "@strus/db";
import { router } from "./router.js";

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
    description: "Polish morphological spaced repetition system 🦤",
  },
  servers: [{ url: "/api", description: "API base" }],
});

// ---------------------------------------------------------------------------
// oRPC handler — routes all /api/* requests to the correct procedure
// ---------------------------------------------------------------------------

const orpcHandler = new OpenAPIHandler(router);

// ---------------------------------------------------------------------------
// Elysia app
// ---------------------------------------------------------------------------

const PORT = Number(process.env["PORT"] ?? 3457);

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

export const app = new Elysia()
  // Health check
  .get("/", () => ({ ok: true, version: "0.0.1" }))

  // OpenAPI spec (generated from oRPC router + Zod schemas)
  .get("/openapi.json", () => spec)

  // Swagger UI (CDN, loads spec from /openapi.json)
  .get("/docs", () => new Response(SWAGGER_UI_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }))

  // oRPC handler — all API routes
  .all("/api/*", async ({ request }) => {
    const result = await orpcHandler.handle(request, { prefix: "/api" });
    return result.matched
      ? result.response
      : new Response("No procedure matched", { status: 404 });
  })

  .listen(PORT);

console.log(`✓ strus API running at http://localhost:${PORT}`);
console.log(`  OpenAPI spec: http://localhost:${PORT}/openapi.json`);
console.log(`  Swagger UI:   http://localhost:${PORT}/docs`);

export type App = typeof app;
