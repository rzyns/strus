# @strus/api — Agent Context

Elysia HTTP server with oRPC for type-safe routing and automatic OpenAPI spec generation.

## Key Files

```
packages/api/
├── src/
│   ├── index.ts      — server entry: migrations, spec generation, Elysia app, listen
│   ├── router.ts     — all oRPC procedures and the router export
│   ├── media.ts      — Gemini image generation + ElevenLabs audio generation
│   └── settings.ts   — key-value settings table helpers (getSetting/setSetting)
└── scripts/
    └── generate-spec.ts  — standalone script: writes openapi.json to disk
```

## oRPC Procedure Pattern

Every route **must** use the full builder chain so `OpenAPIGenerator` can extract schemas:

```ts
import { os, ORPCError } from "@orpc/server";
import { z } from "zod";

const myProcedure = os
  .route({
    method: "GET",           // HTTP method
    path: "/things/{id}",   // path params use {param} syntax
    tags: ["Things"],        // OpenAPI tag grouping
    summary: "Get a thing",
    description: "Optional longer description.",
  })
  .input(z.object({
    id: z.string().uuid(),
  }))
  .output(ThingOutput)      // always declare output schema
  .handler(async ({ input }) => {
    const [row] = await db.select().from(things).where(eq(things.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Thing not found: ${input.id}` });
    return mapThing(row);
  });
```

Then add to the router object at the bottom of `router.ts`.

## Mounting the oRPC Handler

The handler is mounted on Elysia as a catch-all. **Do not use `@orpc/elysia`** — it doesn't
exist. Use the generic fetch adapter:

```ts
import { OpenAPIHandler } from "@orpc/openapi/fetch";
const orpcHandler = new OpenAPIHandler(router);

app.all("/api/*", async ({ request }) => {
  const result = await orpcHandler.handle(request, { prefix: "/api" });
  return result.matched
    ? result.response
    : new Response("No procedure matched", { status: 404 });
});
```

## OpenAPI Spec Generation

The spec is generated at **server startup** from the oRPC router + Zod schemas:

```ts
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});
const spec = await generator.generate(router, { info: { … }, servers: […], tags: […] });
```

The `ZodToJsonSchemaConverter` import comes from `@orpc/zod` main entry — this is the Zod v3
converter. **Do not** use `@orpc/zod/zod4`.

## Zod Schema Conventions

```ts
const zId  = z.string().uuid().describe("UUID v4 identifier");
const zIso = z.string().datetime().describe("ISO 8601 date-time string");
const zSource = z.enum(["morfeusz", "manual"]);
```

Column type → Zod:
- `integer({ mode: "timestamp" })` → Drizzle returns `Date` → use `z.date()` or map to `zIso`
- Plain `integer()` Unix-second columns (`due`, `lastReview`) → `z.number().int()` or map to ISO strings in handler

## Error Handling

Throw `ORPCError` for expected errors — oRPC serializes these correctly:

```ts
throw new ORPCError("NOT_FOUND", { message: "…" });
throw new ORPCError("BAD_REQUEST", { message: "…" });
```

Unhandled JS errors become `INTERNAL_SERVER_ERROR` (500).

## Morphological Analysis

The `@strus/morph` package wraps `@rzyns/morfeusz-ts` — a native Node/Bun binding to
Morfeusz2. It uses **lazy singletons** (loaded once, reused across requests) and expects
the SGJP dictionary files at `/usr/share/morfeusz2/dictionaries`. No subprocess is spawned.

```ts
import { analyseText, generate } from "@strus/morph";
// analyseText(text: string) → Promise<MorphForm[]>
// generate(lemma: string, tag: string) → Promise<MorphForm[]>
```

If the dictionary files are missing, `analyseText` and `generate` throw — callers get a 500.
There is no silent degradation: missing morfeusz is a hard error.

## API Endpoints

### About
- `GET /about` — server metadata (version, db path)

### Lists (`/lists`)
- `GET /lists` — list all vocabulary lists
- `POST /lists` — create a vocabulary list
- `GET /lists/{id}` — get a vocabulary list with note count
- `DELETE /lists/{id}` — delete a vocabulary list
- `POST /lists/{listId}/lemmas` — add a lemma to a list via its morph note (lemma must already have a morph note)

### Lemmas (`/lemmas`)
- `GET /lemmas` — list lemmas (optional `?listId=` filter)
- `POST /lemmas` — create a lemma; if `source=morfeusz`, auto-generates morph forms and fires image generation
- `GET /lemmas/{id}` — get a lemma
- `DELETE /lemmas/{id}` — delete a lemma (cascades to notes, cards, reviews)
- `GET /lemmas/{id}/forms` — get all morphological forms for a lemma
- `POST /lemmas/{id}/generate-image` — (re)generate the Gemini image for a lemma; blocks until done

### Notes (`/notes`)
- `POST /notes` — create a note (`kind`: `morph` | `gloss` | `basic`)
- `GET /notes` — list notes (optional `?kind=`, `?listId=`, `?lemmaId=` filters)
- `GET /notes/{id}` — get a note with its cards and lemma
- `DELETE /notes/{id}` — delete a note (cascades to cards, reviews)
- `PATCH /notes/{id}` — update `front`/`back` (basic notes) or `back` (gloss notes); morph notes are read-only

### Cards (`/cards`)
- `GET /cards/{id}` — get a card
- `GET /cards/{id}/reviews` — review history, newest first

### Forms (`/forms`)
- `POST /forms/{id}/generate-audio` — generate ElevenLabs audio for a morph form; blocks until done

### Session (`/session`)
- `GET /session/due` — get a composed session of due cards (supports all card kinds)
- `POST /session/review` — record a card review rating (1=Again · 2=Hard · 3=Good · 4=Easy)

### Stats (`/stats`)
- `GET /stats` — overview: `{ lemmaCount, listCount, dueCount }`

### Import (`/import`)
- `POST /import/text/preview` — dry-run: tokenise Polish text, return candidates without writing
- `POST /import/text` — commit import; fires fire-and-forget image generation per new morfeusz lemma

### Settings (`/settings`)
- `GET /settings` — get `imagePromptTemplate` (current Mustache template and factory default)
- `POST /settings` — update `imagePromptTemplate`

## Data Model Summary

```
lemmas ──< morph_forms        (one lemma → many NKJP-tagged surface forms)
lemmas ──< notes              (one lemma → one morph note; also gloss notes)
notes  ──< cards              (one note → one or more FSRS cards)
cards  ──< reviews            (one card → many review records)
vocab_lists ──< vocab_list_notes ──< notes   (lists contain notes, not lemmas directly)
```

Note kinds and their cards:
- `morph` → `morph_form` cards (one per `morph_forms` row, keyed by tag)
- `gloss` → `gloss_forward` + `gloss_reverse` cards
- `basic` → `basic_forward` card

## Running the Server

```bash
STRUS_DB_PATH=/absolute/path/strus.db PORT=3457 bun run src/index.ts
# or with hot reload:
STRUS_DB_PATH=/absolute/path/strus.db PORT=3457 bun run --watch src/index.ts
```

Migrations run automatically at startup. The DB file is created if it doesn't exist.
