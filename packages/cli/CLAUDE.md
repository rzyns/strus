# @strus/cli — Agent Context

Commander.js CLI that talks to the strus API server over HTTP.

## Key File

```
packages/cli/src/index.ts   — single file, all commands
```

## Pattern

All API calls go through `apiGet`, `apiPost`, `apiDelete` helpers at the top of the file.
The API base URL defaults to `http://localhost:3457`, override with `STRUS_API_URL`.

## Commands

| Command | API endpoint |
|---------|-------------|
| `strus stats` | GET /api/stats |
| `strus list ls` | GET /api/lists |
| `strus list create <name>` | POST /api/lists |
| `strus list get <id>` | GET /api/lists/{id} |
| `strus list delete <id>` | DELETE /api/lists/{id} |
| `strus list add-lemma <listId> <lemmaId>` | POST /api/lists/{listId}/lemmas |
| `strus lemma ls` | GET /api/lemmas |
| `strus lemma add <word>` | POST /api/lemmas |
| `strus lemma get <id>` | GET /api/lemmas/{id} |
| `strus lemma delete <id>` | DELETE /api/lemmas/{id} |
| `strus quiz` | GET /api/session/due + POST /api/session/review |
| `strus import preview [text]` | POST /api/import/text/preview |
| `strus import commit [text]` | POST /api/import/text |

## Adding a command

1. Add a `.command(...).description(...).option(...).action(async (opts) => { ... })` block.
2. Use `apiGet`, `apiPost`, or `apiDelete` — no raw fetch.
3. Run `pnpm typecheck` to verify.

## Running

```bash
STRUS_DB_PATH=... bun run packages/api/src/index.ts &   # start API first
bun run packages/cli/src/index.ts --help
bun run packages/cli/src/index.ts stats
```
