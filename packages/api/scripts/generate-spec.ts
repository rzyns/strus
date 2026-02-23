/**
 * Standalone OpenAPI spec generator.
 * Run: pnpm --filter @strus/api run generate:spec
 * Output: packages/api/openapi.json
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { router } from "../src/router.js";

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

const outPath = resolve(import.meta.dir, "../openapi.json");
writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n", "utf-8");
console.log(`✓ OpenAPI spec written to ${outPath}`);
