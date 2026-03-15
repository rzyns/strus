# Strus API Reference

Base URL: `http://localhost:3457`

## Session (Quiz)

### GET /api/session/due
Returns a composed session of due cards.

**Query params:**
- `newLimit` (int, default 20): max new cards (state=0) per session
- `limit` (int, default 100): hard cap on total session size
- `interleave` (bool, default true): round-robin by lemma to prevent back-to-back form drilling
- `listId` (uuid, optional): restrict to a specific vocab list
- `kinds` (array, optional): only include cards of these kinds — `morph_form`, `gloss_forward`, `gloss_reverse`, `basic_forward`
- `tagContains` (string, optional): filter `morph_form` cards to those whose tag contains this substring (e.g. `sg:inst`)
- `mode` (`card-first` | `note-first`, default `card-first`): session selection strategy
- `noteLimit` (int, default 10): max notes to include in `note-first` mode
- `cardsPerNote` (int, default 5): max cards per note in `note-first` mode

**Response item shape:**
```json
{
  "id": "uuid",
  "noteId": "uuid",
  "kind": "morph_form",
  "lemmaText": "dom",
  "tag": "subst:pl:inst:m3",
  "forms": ["domami"],
  "front": null,
  "back": null,
  "state": 0,
  "due": "2026-02-25T04:00:00.000Z",
  "stability": 0,
  "difficulty": 0,
  "reps": 0,
  "lapses": 0,
  "lastReview": null,
  "nextDates": {
    "again": "2026-02-25T04:10:00.000Z",
    "hard": "2026-02-25T05:00:00.000Z",
    "good": "2026-02-26T04:00:00.000Z",
    "easy": "2026-02-28T04:00:00.000Z"
  }
}
```

**Card kind field usage:**

| kind | `lemmaText` | `tag` | `forms` | `front` | `back` |
|------|-------------|-------|---------|---------|--------|
| `morph_form` | Polish lemma | NKJP tag | accepted spellings | null | null |
| `gloss_forward` | Polish word | null | [] | Polish word (=lemmaText) | translation |
| `gloss_reverse` | Polish word | null | [] | translation | Polish word (=lemmaText) |
| `basic_forward` | null | null | [] | prompt text | answer text |

For `gloss_*` and `basic_forward`, the API pre-populates `front`/`back` correctly — use them directly.

### POST /api/session/review
Submit a card rating.

**Request:**
```json
{ "cardId": "card-uuid", "rating": 3 }
```

Ratings: `1` = Again · `2` = Hard · `3` = Good · `4` = Easy

**Response:**
```json
{
  "reviewId": "uuid",
  "updated": {
    "id": "uuid",
    "state": 2,
    "scheduledDays": 2,
    "due": "2026-02-27T16:00:00.000Z"
  }
}
```
Use `updated.scheduledDays` to show "next in Xd" in quiz results.

## Stats

### GET /api/stats
```json
{ "lemmaCount": 144, "listCount": 2, "dueCount": 4178 }
```

## Lemmas

### GET /api/lemmas
Returns array of all lemmas: `[{ id, lemma, pos, source, notes, createdAt, updatedAt }]`

### POST /api/lemmas
Create a lemma directly (use import/text instead for Morfeusz2 normalization).

```json
{ "lemma": "jabłko", "pos": "subst", "source": "morfeusz" }
```

### GET /api/lemmas/:id
### DELETE /api/lemmas/:id

## Notes

### GET /api/notes
Returns all notes, optionally filtered.

**Query params:** `kind` (`morph` | `gloss` | `basic`), `listId` (uuid), `lemmaId` (uuid)

### POST /api/notes
Create a note.

**kind=basic:**
```json
{ "kind": "basic", "front": "prompt text", "back": "answer text" }
```

**kind=gloss:**
```json
{ "kind": "gloss", "lemmaId": "uuid", "back": "translation" }
```
Creates both `gloss_forward` and `gloss_reverse` cards automatically.

### GET /api/notes/:id — includes `cards[]` and `lemma` fields
### PATCH /api/notes/:id — update `front`/`back` (basic) or `back` (gloss); morph notes are read-only
### DELETE /api/notes/:id

## Cards

### GET /api/cards/:id
### GET /api/cards/:id/reviews — review history, newest first

## Import

### POST /api/import/text/preview
Dry-run: analyze text, return candidates without writing to DB.

**Request:** `{ "text": "dom kurczak iść" }`

**Response:**
```json
{
  "candidates": [
    { "lemma": "dom", "pos": "subst", "formsFound": ["dom"], "ambiguous": false, "isMultiWord": false }
  ],
  "unknownTokens": []
}
```

### POST /api/import/text
Commit import. Same request. Optional: `"skipAmbiguous": false` to include ambiguous.

**Response:**
```json
{
  "created": [{ "lemmaId": "uuid", "lemma": "dom", "pos": "subst", "source": "morfeusz" }],
  "skipped": [{ "lemma": "zamek", "reason": "ambiguous" }],
  "unknownTokens": []
}
```

## Vocab Lists

### GET /api/lists
### POST /api/lists — `{ "name": "My List", "description": "optional" }`
### GET /api/lists/:id
### DELETE /api/lists/:id
### POST /api/lists/:id/lemmas — `{ "lemmaId": "uuid" }` (attaches the lemma's morph note to the list)

## Cards

### GET /api/cards/:id
### GET /api/cards/:id/reviews — review history, newest first

## Lemma Media

### POST /api/lemmas/:id/generate-image
Regenerate (or generate for the first time) the Gemini image for a lemma. Blocks until done.

**Response:** `{ "imagePath": "...", "imagePrompt": "..." }`

## Form Audio

### POST /api/forms/:id/generate-audio
Generate ElevenLabs audio for a morphological form. Blocks until done.

**Response:** `{ "audioPath": "..." }`

## Settings

### GET /api/settings
```json
{
  "imagePromptTemplate": "A photorealistic ...",
  "imagePromptTemplateDefault": "A photorealistic ..."
}
```

### POST /api/settings — `{ "imagePromptTemplate": "Mustache template string" }`

## About

### GET /api/about — server metadata (version, db path)

## Morph Pipeline

The API uses `@rzyns/morfeusz-ts` — a native Bun/Node binding to the Morfeusz2 C++ library.
It loads **lazily** (once on first call, reused for all subsequent requests) from dictionary
files at `/usr/share/morfeusz2/dictionaries`.

- `analyseText(text)` — tokenise and analyse Polish text → array of `MorphForm`
- `generate(lemma, tag)` — generate all forms for a lemma → array of `MorphForm`

If the dictionary files are missing, these calls throw and the API returns 500.
No subprocess or external binary is involved.
