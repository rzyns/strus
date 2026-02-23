# strus

A Polish morphological spaced repetition system (SRS) built on FSRS.

Strus helps you learn Polish vocabulary by drilling morphological forms (declensions, conjugations, etc.) using a spaced repetition algorithm. It integrates with the Morfeusz2 Polish morphological analyser to automatically generate all forms of a word.

## Monorepo structure

```
strus/
  packages/
    morph/     (@strus/morph)  — Morfeusz2 CLI wrapper
    core/      (@strus/core)   — Domain types + FSRS scheduling
    db/        (@strus/db)     — Drizzle ORM schema + queries
    api/       (@strus/api)    — Elysia + oRPC HTTP server
    cli/       (@strus/cli)    — Commander.js interactive CLI
```

## Prerequisites

- [Bun](https://bun.sh/) >= 1.1
- [pnpm](https://pnpm.io/) >= 9
- [Morfeusz2](http://morfeusz.sgjp.pl/) CLI binary installed and on `$PATH`

## Install

```bash
pnpm install
```

## Development

```bash
# Start the API server (dev mode)
pnpm dev

# Typecheck all packages
pnpm typecheck

# Build all packages
pnpm build
```

## Database setup

```bash
# Generate migrations from schema
pnpm db:generate

# Apply migrations
pnpm db:migrate
```

Set `STRUS_DB_PATH` to override the default database location (`./strus.db`).

## CLI usage

```bash
# Create a vocabulary list
strus list create "Nouns"

# Add a lexeme (auto-generates morph forms + learning targets)
strus lexeme add dom --list <listId> --pos subst

# List vocabulary
strus lexeme ls

# Start a quiz session
strus quiz --list <listId> --limit 20

# Show stats
strus stats
```

## API

The API server runs on `http://localhost:3000` by default.

- **oRPC router** — type-safe procedures for all CRUD + review operations
- **OpenAPI spec** — `GET /openapi.json`
- **Swagger UI** — `GET /docs`

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Package manager | pnpm workspaces |
| HTTP framework | Elysia |
| RPC layer | oRPC |
| Database | SQLite + Drizzle ORM |
| SRS algorithm | ts-fsrs (FSRS v5) |
| Morphology | Morfeusz2 (subprocess) |
| Validation | Zod |
| Language | TypeScript |
