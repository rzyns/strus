---
name: strus
description: Polish morphological SRS drill system via Discord. Activate when the user says "strus quiz", "drill Polish", "practice Polish", "strus stats", "strus add WORD", "strus lists", "strus stop", or anything referencing the strus vocab/quiz system. Handles interactive flash-card sessions, vocabulary management, and progress stats — all backed by the strus API at localhost:3457.
---

# Strus Skill

Runs Polish morphology drills and vocabulary management via the strus API.

## Plugin Integration

This skill is backed by the **strus OpenClaw plugin**, which provides:

### Slash Commands (bypass AI entirely)
- `/strus stats` — show lemma/card/due counts
- `/strus add <word>` — import a word via the text import pipeline
- `/strus lists` — list all vocab lists
- `/strus quiz [--list <name>] [--limit N] [--new-limit N]` — start a quiz session
- `/strus stop` — end active quiz session
- `/s <answer>` — answer the current quiz card (slash mode)

### Agent Tools (for AI-driven quiz mode)
- `strus_quiz_start` — start a quiz session (returns first card)
- `strus_quiz_submit` — submit an answer, get grading result and next card
- `strus_quiz_skip` — skip current card without grading
- `strus_quiz_reveal` — reveal correct answer without grading
- `strus_quiz_stop` — end session and get summary

## API Base

`http://localhost:3457` (no auth). See `references/api.md` for full endpoint reference.

## Quiz Session Protocol

See `references/quiz-flow.md` for the full interaction protocol.

**Quick summary:**
1. Use `strus_quiz_start` to fetch cards and begin a session
2. For each card: present question → wait for user reply → use `strus_quiz_submit` to grade → present result → repeat
3. Auto-grade: answer matches accepted answer(s) → Good (3); wrong → Again (1); `?` → reveal without grading
4. Session ends automatically when all cards are done, or manually via `strus_quiz_stop`

## Card Kinds

There are 8 card kinds across two categories:

**Classic kinds:**
- `morph_form` — lemma → inflected form: `📖 **{lemmaText}** → *{tagLabel}?*` · answer: any in `forms[]`
- `gloss_forward` — Polish → translation: `🇵🇱 **{front}** → *translation?*` · answer: `back`
- `gloss_reverse` — translation → Polish: `🇬🇧 **{front}** → *Polish?*` · answer: `back`
- `basic_forward` — open prompt: `❓ **{front}**` · answer: `back`

**Contextual kinds** (sentence-based; include `sentenceText` and kind-specific option arrays):
- `cloze_fill` — fill the gap in a sentence: `🔲 {lemmaText?}\n{sentence with ___ for gaps}` · answer: text matching `clozeGaps[N].correctAnswers`; multi-gap: comma-separated
- `multiple_choice` — pick the right option: `🔤 {sentenceText}\n1. opt1\n2. opt2...` · answer: number or option text (matched against `choiceOptions[].isCorrect`)
- `error_correction` — fix the error in a sentence: `✏️ Find and fix the error:\n{sentenceText}` · answer: `back`
- `classify` — pick the right category: `🏷️ Classify:\n{sentenceText}\n1. cat1 — desc\n2. cat2...` · answer: number or name (matched against `classifyOptions[].isCorrect`)

All contextual kinds may include `noteExplanation` (string | null) — show it after the answer if non-null.

The API pre-populates `front` and `back` correctly for all classic kinds. For `morph_form`, `front`/`back` are null — use `lemmaText` + `tag` for the question and `forms[]` for answers.

## Agent-driven Quiz Mode

When using agent tools, the AI manages the conversation flow:
1. Call `strus_quiz_start` — returns `{ sessionId, total, firstCard }`
   - Optional `kinds` param: array of specific CardKind strings to filter
   - Optional `type` shorthand: `"morph"` (morph_form only), `"contextual"` (all 4 contextual kinds), `"all"` (default)
2. `firstCard` contains `{ lemmaText, tag, tagLabel, kind, forms, front, back, sentenceText, clozeGaps, choiceOptions, classifyOptions, noteExplanation }`
3. Format the question based on `kind` (see Card Kinds above)
4. When user answers, call `strus_quiz_submit` with their answer
5. Result includes `{ correct, forms, back, clozeGaps, choiceOptions, classifyOptions, noteExplanation, scheduledDays, nextCard, summary }`
6. If `nextCard` is null, session is done — show the summary
7. User can say `?` → use `strus_quiz_reveal`; `skip` → use `strus_quiz_skip`; `stop`/`quit`/`done` → use `strus_quiz_stop`
8. For contextual kinds: show `noteExplanation` after grading if non-null

## Morph Pipeline

Morphological analysis uses `@rzyns/morfeusz-ts` — a native Bun/Node binding to the Morfeusz2
C++ library, loaded lazily from `/usr/share/morfeusz2/dictionaries`. There is no subprocess
or external binary involved.

If morfeusz is unavailable (missing dict files), `POST /lemmas` with `source=morfeusz` and all
import endpoints will return 500. Check that the strus server started cleanly.

## Tag Labelling

Polish tags follow `pos:number:case:gender` for nouns, `pos:number:person:aspect` for verbs.
See `references/quiz-flow.md` for the full label map.

## Commands

| User says | Action |
|-----------|--------|
| `strus quiz` | Start session (20 new cards + all due reviews, interleaved) |
| `strus quiz --new-limit N` | Cap new cards at N (default 20) |
| `strus quiz --limit N` | Hard cap on total session size (default 100) |
| `strus quiz --list NAME` | Drill cards from a specific vocab list |
| `strus quiz --type contextual` | *(agent tool only)* Drill contextual cards only |
| `strus stats` | Show lemma/card/due counts |
| `strus add WORD` | Import a word via the text import pipeline |
| `strus lists` | List all vocab lists |
| `strus stop` / `quit` / `done` | End active quiz session |
| `strus pick <n>` | Pick option n (0=skip) when disambiguating an import |
