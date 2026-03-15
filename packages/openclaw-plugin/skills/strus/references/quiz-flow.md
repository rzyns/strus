# Quiz Flow Protocol

## Table of Contents
1. [Session Start](#session-start)
2. [Card Loop](#card-loop)
3. [Grading Logic](#grading-logic)
4. [Session End](#session-end)
5. [Tag Label Map](#tag-label-map)

---

## Session Start

```
GET /api/session/due?newLimit=20&interleave=true
```

- If `--limit N`: pass as `limit=N` query param
- `newLimit` defaults to 20
- If `--list <name>`: fetch `GET /api/lists`, find matching list by name, pass `listId=<uuid>`
- If 0 cards due: reply "🎉 No cards due right now! Come back later." and stop
- Store the array as `session.cards`, set `session.index = 0`, `session.correct = 0`, `session.total = 0`

---

## Card Loop

For each card at `session.cards[session.index]`:

### 1. Format the question

Cards come in four kinds — format differently for each:

**morph_form** (lemma → inflected form):
```
📖 **{lemmaText}** → *{humanLabel(tag)}?*
*(type `/s <answer>` · `/s ?` to reveal · `/strus stop` to quit)*
```
Example: `📖 **dom** → *instrumental plural?*`

**gloss_forward** (Polish → translation):
```
🇵🇱 **{front}** → *translation?*
*(type `/s <answer>` · `/s ?` to reveal · `/strus stop` to quit)*
```

**gloss_reverse** (translation → Polish):
```
🇬🇧 **{front}** → *Polish?*
*(type `/s <answer>` · `/s ?` to reveal · `/strus stop` to quit)*
```

**basic_forward**:
```
❓ **{front}**
*(type `/s <answer>` · `/s ?` to reveal · `/strus stop` to quit)*
```

The API pre-populates `front` and `back` correctly for all kinds — use them directly. For `morph_form`, use `forms[]` as accepted answers; for all others, use `back` as the single correct answer.

### 2. Handle user reply

| User reply | Action |
|------------|--------|
| Matches accepted answer(s) | Correct path |
| Any other text | Wrong path |
| `?` | Reveal path |
| `skip` | Skip path |
| `strus stop` / `quit` / `done` | End session |

### 3. Post result

**Correct:**
```
✅ **{matchedForm}** — right! Next in {scheduledDays}d
```
Rate: `3` (Good). Increment `session.correct` and `session.total`.

**Wrong:**
```
❌ You said *{userAnswer}* — correct: **{answer}**
```
Rate: `1` (Again). Increment `session.total` only.

**Reveal (`?`):**
```
👁️ **{answer}** *(not rated)*
```
Do NOT submit a review. Do NOT increment counters.

**Skip:**
```
⏭️ Skipped.
```
Do NOT submit a review. Do NOT increment counters.

### 4. Submit rating (except reveal/skip)

```
POST /api/session/review
{ "cardId": "card-uuid", "rating": 3 }
```

Use `card.id` as `cardId`. Parse `result.updated.scheduledDays` to show "next in Xd".

### 5. Advance

`session.index++`. If `session.index >= session.cards.length`: end session. Otherwise: loop.

---

## Grading Logic

### morph_form cards
`card.forms[]` contains all accepted spellings. Any match counts as correct.

### gloss_forward / gloss_reverse / basic_forward / error_correction cards
`card.back` is the single correct answer. Compare case-insensitively.

### Diacritic fallback
If the answer doesn't match exactly but matches after normalising Polish diacritics, count as **correct**.
Normalisation map: `ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z`
Apply to both the user's answer AND the expected answer(s) before comparing.

### Multi-form morph cards
Some tags have 2+ accepted forms (syncretism, e.g. `subst:sg:nom.acc:m3`). Any match in `card.forms[]` counts.

---

## Contextual Card Kinds

These four kinds all include `sentenceText` (a sentence providing context). They may include `noteExplanation` — always show it after the answer if non-null (e.g. `📝 {noteExplanation}`).

### cloze_fill

**Question format:**
```
🔲 **{lemmaText}** (if present)
{sentenceText with {{N}} replaced by ___}
*(hint: {hint})* (if any gap has a hint)
```

**Grading:**
- Single-gap: accept the whole answer against `clozeGaps[0].correctAnswers` (case-insensitive + diacritic fallback)
- Multi-gap: accept comma-separated input; e.g. `"szedłem, chodził"` → gap 1 = "szedłem", gap 2 = "chodził"
  - ALL gaps must match their respective `correctAnswers[]`; any single miss = incorrect

**Example multi-gap:** sentence "{{1}} do szkoły, a on {{2}} do domu." → user types `"szłam, szedł"`

### multiple_choice

**Question format:**
```
🔤 {sentenceText}
1. {choiceOptions[0].optionText}
2. {choiceOptions[1].optionText}
...
```

Options are pre-shuffled server-side. Accept user input as either:
- A 1-based number (`"1"`, `"2"`, `"3"`, …)
- The option text itself (case-insensitive, diacritic-normalised)

Correct = `choiceOptions[selected].isCorrect === true`

### error_correction

**Question format:**
```
✏️ Find and fix the error:
{sentenceText}
```

User types the corrected sentence. Graded against `card.back` (the correct version) using standard string matching + diacritic fallback.

### classify

**Question format:**
```
🏷️ Classify:
{sentenceText}
1. {classifyOptions[0].name} — {description}
2. {classifyOptions[1].name} — {description}
...
```

Options are pre-shuffled server-side. Accept user input as either:
- A 1-based number (`"1"`, `"2"`, `"3"`, …)
- The category name itself (case-insensitive, diacritic-normalised)

Correct = `classifyOptions[selected].isCorrect === true`

### After answer (all contextual kinds)
If `card.noteExplanation` is non-null, append it to the result message:
```
📝 {noteExplanation}
```

---

## Session End

Post a summary:
```
📊 **Session complete!**
Score: {correct}/{total} ({pct}%)
Cards reviewed: {total} · Cards skipped/revealed: {skipped}
```

If 0 cards were reviewed: just "Session ended."

---

## Tag Label Map

### Nouns (subst)

| Tag segment | Label |
|-------------|-------|
| `sg:nom` | nominative singular |
| `sg:gen` | genitive singular |
| `sg:dat` | dative singular |
| `sg:acc` | accusative singular |
| `sg:inst` | instrumental singular |
| `sg:loc` | locative singular |
| `sg:voc` | vocative singular |
| `pl:nom` | nominative plural |
| `pl:gen` | genitive plural |
| `pl:dat` | dative plural |
| `pl:acc` | accusative plural |
| `pl:inst` | instrumental plural |
| `pl:loc` | locative plural |
| `pl:voc` | vocative plural |

Multi-case tags like `sg:nom.acc` → "nominative/accusative singular"

### Verbs (fin, inf, praet, impt, ger, pact, ppas)

| Tag | Label |
|-----|-------|
| `inf` | infinitive |
| `fin:sg:pri:imperf` | 1st person singular present (imperfective) |
| `fin:sg:sec:imperf` | 2nd person singular present (imperfective) |
| `fin:sg:ter:imperf` | 3rd person singular present (imperfective) |
| `fin:pl:pri:imperf` | 1st person plural present (imperfective) |
| `fin:pl:sec:imperf` | 2nd person plural present (imperfective) |
| `fin:pl:ter:imperf` | 3rd person plural present (imperfective) |
| `praet:sg:m1:imperf` | past masc. sg. (imperfective) |
| `praet:sg:f:imperf` | past fem. sg. (imperfective) |
| `praet:pl:m1:imperf` | past masc.pers. pl. (imperfective) |
| `praet:pl:m2:imperf` | past non-m1 pl. (imperfective) |
| `impt:sg:sec` | imperative 2nd sg. |
| `impt:pl:sec` | imperative 2nd pl. |
| `ger:sg:nom` | verbal noun (gerund), nominative |
| `pact:sg:nom:m1:imperf:aff` | active participle, masc. nom. |
| `ppas:sg:nom:m1:perf:aff` | passive participle, masc. nom. |
| `:perf` suffix | perfective aspect |
| `:imperf` suffix | imperfective aspect |

### Adjectives (adj)

| Tag | Label |
|-----|-------|
| `adj:sg:nom:m1` | masculine nom. sg. |
| `adj:sg:gen:m1` | masculine gen. sg. |
| `adj:sg:nom:f` | feminine nom. sg. |
| `adj:sg:gen:f` | feminine gen. sg. |
| `adj:sg:nom:n` | neuter nom. sg. |
| `adj:pl:nom:m1` | masculine-personal nom. pl. |
| `adj:pl:nom:m2` | non-masculine-personal nom. pl. |

### Fallback
If no label matches, show the raw tag in backticks: e.g. `` `fin:sg:pri:perf` ``

---

## Display Tips

- Use Discord bold (`**word**`) for the target form
- Use italic (`*label*`) for the tag description
- Keep question and result messages short — one message each
- Do NOT dump all cards at once; one card at a time
- Post each result before fetching the next (never pre-fetch)
