# @strus/api — Agent Context

Elysia HTTP server with oRPC for type-safe routing and automatic OpenAPI spec generation.

## Key Files

```
packages/api/
├── src/
│   ├── index.ts      — server entry: migrations, spec generation, Elysia app, listen
│   └── router.ts     — all oRPC procedures and the router export
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

Then add to the router:
```ts
export const router = {
  things: { get: myProcedure, … },
};
```

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

## Zod Schemas

## API Endpoints

### Lists (`/lists`)
- `GET /lists` — list all vocabulary lists
- `POST /lists` — create a vocabulary list
- `GET /lists/{id}` — get a vocabulary list
- `DELETE /lists/{id}` — delete a vocabulary list
- `POST /lists/{listId}/lemmas` — add a lemma to a list

### Notes (`/notes`)
- `POST /notes` — create a basic note (and its basic_forward card)
- `GET /notes` — list notes (optionally filter by kind and/or listId)
- `GET /notes/{id}` — get a note with its cards
- `DELETE /notes/{id}` — delete a note (cascades to cards)
- `PATCH /notes/{id}` — update front/back of a basic note

### Lemmas (`/lemmas`)
- `GET /lemmas` — list lemmas
- `POST /lemmas` — create a lemma (auto-generates morph forms if source=morfeusz)
- `GET /lemmas/{id}` — get a lemma
- `DELETE /lemmas/{id}` — delete a lemma (cascades)
- `GET /lemmas/{id}/forms` — get morphological forms

### Session (`/session`)
- `GET /session/due` — get cards due for review (supports morph + basic cards)
- `POST /session/review` — record a review rating

### Stats (`/stats`)
- `GET /stats` — overview statistics

### Import (`/import`)
- `POST /import/text/preview` — preview text import candidates
- `POST /import/text` — import lemmas from text

## Zod Schemas

Common building blocks defined at the top of `router.ts`:

```ts
const zId  = z.string().uuid().describe("UUID v4 identifier");
const zIso = z.string().datetime().describe("ISO 8601 date-time string");
const zSource = z.enum(["morfeusz", "manual"]);
```

`integer({ mode: "timestamp" })` columns → Drizzle returns `Date` → use `z.date()` or
`.toISOString()` + `zIso` in output schemas. Plain `integer()` Unix-second columns
(e.g. `due`, `lastReview`) → `z.number().int()` or map to ISO strings via mapper functions.

## Error Handling

Throw `ORPCError` for expected errors — oRPC serializes these correctly:

```ts
throw new ORPCError("NOT_FOUND", { message: "…" });
throw new ORPCError("BAD_REQUEST", { message: "…" });
```

Unhandled JS errors become `INTERNAL_SERVER_ERROR` (500).

## Running the Server

```bash
STRUS_DB_PATH=/absolute/path/strus.db PORT=3457 bun run src/index.ts
# or with hot reload:
STRUS_DB_PATH=/absolute/path/strus.db PORT=3457 bun run --watch src/index.ts
```

Migrations run automatically at startup. The DB file is created if it doesn't exist.
