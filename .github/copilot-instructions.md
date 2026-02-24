# GitHub Copilot Instructions

Polish morphological spaced repetition system. See `CLAUDE.md` for full context.

## Stack

- **Runtime:** Bun (not Node.js) — use `bun run`, `Bun.spawn`, `bun:sqlite`
- **Package manager:** pnpm workspaces
- **HTTP:** Elysia + oRPC (`@orpc/server`, `@orpc/openapi/fetch`)
- **Schema validation:** Zod **v3** only — import from `"zod"`, use `@orpc/zod` (NOT `@orpc/zod/zod4`)
- **ORM:** Drizzle ORM with `drizzle-orm/bun-sqlite` adapter (NOT `better-sqlite3`)
- **SRS:** ts-fsrs v5
- **Morphology:** Morfeusz2 CLI subprocess (NOT `morfeusz-ts` native addon)

## Non-Negotiable Rules

1. **Never import `better-sqlite3` in runtime code.** It's a Node-only native addon. Use `bun:sqlite`.
2. **Never use `@orpc/elysia`.** It doesn't exist. Mount oRPC via `OpenAPIHandler` from `@orpc/openapi/fetch`.
3. **Never use `@orpc/zod/zod4`.** This project uses Zod v3.
4. **`STRUS_DB_PATH` must be an absolute path.** Never use a relative DB path.
5. **`exactOptionalPropertyTypes: true` is enabled.** Don't assign `undefined` to optional properties — use conditional spreads: `...(val !== undefined ? { key: val } : {})`.
6. **All oRPC procedures must declare `.output(schema)`.** Without it, the OpenAPI spec will have empty response schemas.
7. **Migrations are committed to git** in `packages/db/migrations/`. Don't gitignore them.

## Data Model Terminology

- **Lemma** — dictionary citation form (what the user adds, e.g. "dom", "iść")
- **MorphForm** — individual inflected word form with NKJP tag (e.g. "domowi" / `subst:sg:dat:m3`)
- **LearningTarget** — one FSRS card, one MorphForm tag
- **VocabList** — named collection of lemmas

The word "lexeme" is not used as a type name in this codebase (see `Lemma` instead).

## oRPC Procedure Template

```ts
const myProc = os
  .route({ method: "GET", path: "/things/{id}", tags: ["Things"], summary: "…" })
  .input(z.object({ id: z.string().uuid() }))
  .output(ThingOutput)
  .handler(async ({ input }) => {
    const [row] = db.select().from(things).where(eq(things.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Not found: ${input.id}` });
    return mapThing(row);
  });
```

## ts-fsrs v5 Notes

- `Card` requires `learning_steps: number` (new in v5); default to `0` if not persisted
- `Rating.Manual = 0` — excluded from `RecordLog`; only use ratings 1–4
- `createEmptyCard()` omits `last_review` entirely (don't set it to `undefined`)
