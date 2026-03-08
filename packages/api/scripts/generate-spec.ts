/**
 * Standalone OpenAPI spec generator.
 * Run: pnpm --filter @rzyns/strus-api run generate:spec
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
      name: "Stats",
      description: "Aggregate usage statistics for dashboard display.",
    },
  ],
});

const outPath = resolve(import.meta.dir, "../openapi.json");
writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n", "utf-8");
console.log(`✓ OpenAPI spec written to ${outPath}`);
