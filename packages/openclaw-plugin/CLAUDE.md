# strus OpenClaw Plugin

## What you're building

An OpenClaw plugin that provides Discord-based Polish vocabulary drilling (strus SRS system).

Strus is a running API server at `http://localhost:3457`. The plugin integrates with it.

## Plugin location

`/Users/claw/dev/strus/packages/openclaw-plugin/` — loaded via `plugins.load.paths` in `~/.openclaw/openclaw.json`.

The old extension dir `~/.openclaw/extensions/strus/` is preserved as a fallback until the gateway is confirmed working from this location.

## TypeScript type resolution

`openclaw` is a peerDep — available from the gateway's node_modules at runtime.

For `tsc --noEmit`, a local `node_modules/openclaw` symlink points to `/usr/local/lib/node_modules/openclaw`.
This symlink is gitignored. To recreate after a fresh clone:
```sh
mkdir -p packages/openclaw-plugin/node_modules
ln -sf /usr/local/lib/node_modules/openclaw packages/openclaw-plugin/node_modules/openclaw
```

## Plugin SDK

The plugin SDK is at:
`/home/linuxbrew/.linuxbrew/lib/node_modules/openclaw/dist/plugin-sdk/plugin-sdk/index.d.ts`

Import types from: `@openclaw/plugin-sdk` (resolved by OpenClaw's jiti loader at runtime).

The entry point exports a default function `(api: OpenClawPluginApi) => void`.

Key `api` methods:
- `api.registerCommand(def)` — slash command, bypasses AI entirely
- `api.registerTool(tool, opts?)` — agent tool
- `api.registerService(service)` — background service (start/stop)
- `api.on("message_received", handler)` — observe inbound messages (cannot suppress AI)
- `api.pluginConfig` — plugin config from openclaw.json
- `api.logger` — { info, warn, error, debug? }
- `api.runtime` — runtime helpers (tts etc.)

## Strus API (localhost:3457)

### GET /api/stats
```json
{ "lemmaCount": 144, "listCount": 2, "dueCount": 4178 }
```

### GET /api/session/due?newLimit=20&interleave=true[&listId=uuid][&limit=100]
Returns array of LearningTarget:
```json
{
  "id": "uuid",                 // learningTargetId — use this for review
  "lemmaId": "uuid",
  "lemmaText": "dom",
  "tag": "subst:pl:inst:m3",
  "forms": ["domami"],
  "state": 0,                   // 0=new, 1=learning, 2=review, 3=relearning
  "due": "2026-02-25T04:00:00.000Z",
  "stability": 0,
  "difficulty": 0,
  "reps": 0,
  "lapses": 0,
  "lastReview": null
}
```

### POST /api/session/review
```json
// Request
{ "learningTargetId": "uuid", "rating": 3 }
// Ratings: 1=Again, 2=Hard, 3=Good, 4=Easy

// Response
{
  "reviewId": "uuid",
  "updated": { "id": "uuid", "state": 2, "scheduledDays": 2, "due": "2026-02-27T..." }
}
```
`updated.scheduledDays` → show "next in Xd" on correct answers.

### GET /api/lists
Array of: `{ id, name, description, createdAt }`

### POST /api/import/text
```json
// Request: { "text": "dom kurczak iść" }
// Response:
{
  "created": [{ "lemmaId": "uuid", "lemma": "dom", "pos": "subst", "source": "morfeusz" }],
  "skipped": [{ "lemma": "zamek", "reason": "ambiguous" }],
  "unknownTokens": []
}
```

### GET /api/lemmas
Array of: `{ id, lemma, pos, source, notes, createdAt, updatedAt }`

## Quiz Session State

Store as `Map<channelId, QuizSession>` in module scope (lives as long as gateway runs).

```typescript
interface QuizSession {
  channelId: string;
  cards: LearningTarget[];
  index: number;
  correct: number;
  total: number;
  skipped: number;
  mode: "slash" | "agent";  // slash = /s <answer> mode; agent = AI-driven mode
}
```

## Slash Commands

All bypass the AI — plugin handles entirely.

### /strus stats
Post: `📊 **Strus stats**\n- Lemmas: X\n- Lists: X\n- Due cards: X`

### /strus add <word>
Call `POST /api/import/text` with the word. Report created/skipped.

### /strus lists
Call `GET /api/lists`. Post bulleted list with names.

### /strus quiz [--list <name>] [--limit N] [--new-limit N]
1. Fetch cards from `GET /api/session/due`
2. Store session keyed by channelId with `mode: "slash"`
3. Post the first card question
4. Return empty string (session started — no need for additional text)

### /strus stop
End active session. Post summary. Clear session.

### /s <answer>
Short-alias quiz answer command (for autonomous mode).
1. Look up active session for channelId
2. If none: reply "No active quiz. Use /strus quiz to start."
3. Check answer against `card.forms[]` (case-insensitive, diacritic fallback)
4. Call `POST /api/session/review` with rating 1 (wrong) or 3 (right)
5. Post result (✅ or ❌)
6. Advance to next card (or end session if done)

## Agent Tools

Used by the AI agent for agent-driven quiz mode.

### strus_quiz_start
Params: `{ listId?: string, newLimit?: number, limit?: number }`
- Fetch cards, store session with `mode: "agent"`
- Return: `{ sessionId: channelId, total: N, firstCard: { lemmaText, tagLabel, forms } }`

### strus_quiz_submit
Params: `{ answer: string }`
- Get session for current channelId (from tool context: `ctx.messageChannel`)
- Grade answer, call review API
- Return: `{ correct: boolean, forms: string[], scheduledDays: number, nextCard: {...} | null, summary: {...} | null }`

### strus_quiz_skip
Params: `{}`  
- Skip current card (no review API call)
- Return: `{ nextCard: {...} | null }`

### strus_quiz_reveal
Params: `{}`
- Return current card's forms without grading
- Return: `{ forms: string[], nextCard: {...} | null }`

### strus_quiz_stop
Params: `{}`
- End session, return summary
- Return: `{ correct: N, total: N, pct: N, skipped: N }`

## Grading Logic

### Diacritic normalisation
If exact match fails, normalise both sides and retry:
`ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z`
Normalise-matched answers still count as **correct** (rating 3).

### Multi-form cards
Any match in `card.forms[]` counts as correct.

## Card Question Format

```
📖 **{lemmaText}** → *{tagLabel}?*
*(type `/s <answer>` · `/s ?` to reveal · `/strus stop` to quit)* [slash mode]
*(type your answer · `?` to reveal · `skip` to skip)* [agent mode]
```

## Tag Label Function

```typescript
function tagLabel(tag: string): string
```

Build a human-readable label from a Morfeusz2 tag. Key mappings:

**Nouns** (`subst:*`): `{case} {number}` — cases: nom, gen, dat, acc, inst, loc, voc; numbers: sg/pl. Multi-case `nom.acc` → "nominative/accusative". All after `subst:` are `number:case(s):gender`.

**Verbs**:
- `inf:*` → "infinitive"
- `fin:sg:pri:*` → "1sg present", `fin:sg:sec:*` → "2sg present", `fin:sg:ter:*` → "3sg present"
- `fin:pl:pri:*` → "1pl present", `fin:pl:sec:*` → "2pl present", `fin:pl:ter:*` → "3pl present"
- `praet:sg:m1:*` → "past masc. sg.", `praet:sg:f:*` → "past fem. sg."
- `praet:pl:m1:*` → "past virile pl.", `praet:pl:m2:*` → "past non-virile pl."
- `impt:sg:sec` → "imperative 2sg", `impt:pl:sec` → "imperative 2pl"
- `ger:*` → "verbal noun ({case} {number})"
- `pact:*` → "active participle"
- `ppas:*` → "passive participle"

**Adjectives** (`adj:*`): `{case} {number} ({gender})`

**Fallback**: raw tag in backticks.

Append ` (imperfective)` or ` (perfective)` when `:imperf` or `:perf` is in the tag.

## Background Service: Due-card Notifier

- ID: `strus-notifier`
- On start: set up interval using `pluginConfig.notifyIntervalMinutes` (default 60)
- On tick: `GET /api/stats`, if `dueCount > 0` AND `pluginConfig.notifyChannel` is set: send message to that channel using `api.runtime` or direct Discord API
- On stop: clear interval

For sending notifications, use `fetch` to `POST http://localhost:3457` (our own API) or use OpenClaw's internal message API if available via `api.runtime`.

Actually, for notifications: write to a file that the main agent can pick up, or use `openclaw system event`. Actually the simplest approach: call the Discord REST API directly using the bot token from `api.config.channels.discord.token` (or similar) if accessible, or use `api.runtime` if it exposes a send method.

**Simplest implementation**: skip Discord API call, just log. Leave notification sending as a TODO with a comment. Focus on stats collection and logging.

## Config Schema (openclaw.plugin.json)

```json
{
  "id": "strus",
  "name": "Strus Polish SRS",
  "description": "Polish morphological spaced-repetition quiz system via Discord",
  "version": "0.1.0",
  "skills": ["./skills/strus"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": { "type": "boolean" },
      "apiUrl": { "type": "string" },
      "notifyChannel": { "type": ["string", "null"] },
      "notifyIntervalMinutes": { "type": "integer", "minimum": 1 }
    }
  },
  "uiHints": {
    "apiUrl": { "label": "Strus API URL", "placeholder": "http://localhost:3457" },
    "notifyChannel": { "label": "Discord Channel for Due-card Notifications" },
    "notifyIntervalMinutes": { "label": "Notification Interval (minutes)" }
  }
}
```

## package.json

```json
{
  "name": "openclaw-strus",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

## Skills

Copy the existing strus skill from:
- `/Users/claw/.openclaw/workspace/skills/strus/SKILL.md`
- `/Users/claw/.openclaw/workspace/skills/strus/references/api.md`
- `/Users/claw/.openclaw/workspace/skills/strus/references/quiz-flow.md`

Place under `./skills/strus/` in the plugin directory.

Update SKILL.md to mention the agent tools (`strus_quiz_start`, etc.) and slash commands.

## TypeScript config

Use `"module": "ESNext"`, `"moduleResolution": "bundler"` (jiti loads TS at runtime).
No build step needed — jiti handles it.
No `node_modules` needed for the plugin itself (OpenClaw provides the SDK).

Keep all source in plain TypeScript. No external dependencies beyond what OpenClaw provides.

## Implementation Notes

- The session store is a module-level `Map` — it lives as long as the plugin process runs.
- `channelId` comes from the command context (`ctx.channel`) or tool context (`ctx.messageChannel`).
- For the notifier's send capability: use `fetch` to call an internal OpenClaw RPC or webhook. If not available without auth, just log a message with `api.logger.info` and leave a TODO.
- TypeScript: use `unknown` not `any`. Mark things optional properly.
- No `bun:sqlite` — this is an OpenClaw extension, not a Bun project.
- When posting Discord messages from slash command handlers, return `{ text: "..." }` — OpenClaw routes it to the right channel.

## Question Generator (Agent-Side)

Cards are *specifications*, not fixed Q&A pairs. The question surface is optionally generated at quiz time by an LLM — prevents rote memorization of question wording.

### How it works

- **morph_form** cards: an LLM generates a natural Polish sentence with `___` where the target form goes. The LLM receives the lemma, a human-readable tag label, and a tag-derived contextual hint. The target form itself is NOT given to the LLM.
- **contextual kinds** (cloze_fill, multiple_choice, error_correction, classify): a hardcoded instruction variant is picked at random from a small array. No network call — rationale: instruction is short and predictable; LLM adds latency with minimal value.
- **other kinds** (gloss_forward, gloss_reverse, basic_forward): no generation (returns null).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STRUS_QUESTION_GEN_ENABLED` | enabled if key present | Set to `"false"` to disable entirely |
| `GEMINI_API_KEY` | — | API key for the Gemini provider |
| `STRUS_QUESTION_GEN_API_KEY` | — | Overrides `GEMINI_API_KEY`; use for openai-compat keys |
| `STRUS_QUESTION_GEN_PROVIDER` | `"gemini"` | `"gemini"` or `"openai-compat"` |
| `STRUS_QUESTION_GEN_MODEL` | `"gemini-2.0-flash"` | Model override |
| `STRUS_QUESTION_GEN_BASE_URL` | — | Base URL for openai-compat (required for that provider) |
| `STRUS_QUESTION_GEN_TIMEOUT_MS` | `5000` | Timeout for LLM calls in ms |

Generator is disabled if `STRUS_QUESTION_GEN_ENABLED=false` **or** no API key is set.

### Tool Result Changes

All quiz tools now return `generatedQuestion: string | null` alongside card data:
- `strus_quiz_start` — generated question for the first card
- `strus_quiz_submit` — generated question for the next card (pre-generated)
- `strus_quiz_skip` — generated question for the next card
- `strus_quiz_reveal` — generated question for the next card

`strus_quiz_submit` also passes `userAnswer` and `generatedQuestion` to the server review API for analytics.

### Implementation

- `src/question-generator.ts` — `generateQuestion()`, `tagContextHint()`, provider implementations
- No new npm dependencies — uses `fetch` for HTTP calls
- `generateQuestion` never throws; all errors are caught, logged, and return `null`
