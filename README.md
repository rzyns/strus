# strus

A Polish morphological spaced repetition system (SRS) built on FSRS.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Strus helps you learn Polish vocabulary by drilling morphological forms (declensions, conjugations, etc.) using a spaced repetition algorithm. It integrates with the Morfeusz2 Polish morphological analyser to automatically generate all forms of a word.

## Monorepo structure

```
strus/
  packages/
    morph/     (@rzyns/strus-morph)  — Morfeusz2 CLI wrapper
    core/      (@rzyns/strus-core)   — Domain types + FSRS scheduling
    db/        (@rzyns/strus-db)     — Drizzle ORM schema + queries
    api/       (@rzyns/strus-api)    — Elysia + oRPC HTTP server
    cli/       (@rzyns/strus-cli)    — Commander.js interactive CLI
```

## Prerequisites

- [Bun](https://bun.sh/) >= 1.1
- [Morfeusz2](http://morfeusz.sgjp.pl/) CLI binary installed and on `$PATH`

## Install

```bash
bun install
```

## Development

```bash
# Start the API server (dev mode)
bun dev

# Run tests
bun test

# Typecheck all packages
bun typecheck

# Build all packages
bun build
```

## Database setup

```bash
# Generate migrations from schema
bun db:generate

# Apply migrations
bun db:migrate
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
| Package manager | Bun workspaces |
| HTTP framework | Elysia |
| RPC layer | oRPC |
| Database | SQLite + Drizzle ORM |
| SRS algorithm | ts-fsrs (FSRS v5) |
| Morphology | Morfeusz2 (subprocess) |
| Validation | Zod |
| Language | TypeScript |


## License

strus is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

If you run strus as a network service, you must make the corresponding source code available to users who interact with it over the network.

See [NOTICE](NOTICE) for third-party component attributions.
