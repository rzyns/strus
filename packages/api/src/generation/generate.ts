import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Mustache from "mustache";
import { eq, and } from "drizzle-orm";
import {
  grammarConcepts,
  sentences,
  notes,
  cards,
  clozeGaps,
  choiceOptions,
} from "@strus/db";
import type { DbClient } from "@strus/db";
import { createCard } from "@strus/core";
import { getConfig } from "@strus/config";
import type { GenerationProvider } from "./provider.js";
import {
  ClozeNoteSchema,
  ChoiceNoteSchema,
  type BatchResult,
} from "./types.js";
import { validateCloze } from "./validate.js";

// ---------------------------------------------------------------------------
// Template loader
// ---------------------------------------------------------------------------

function loadTemplate(name: string): string {
  return readFileSync(resolve(import.meta.dir, `templates/${name}`), "utf8");
}

function renderTemplate(name: string, context: Record<string, unknown>): string {
  return Mustache.render(loadTemplate(name), context);
}

// ---------------------------------------------------------------------------
// Card insertion helper (mirrors router.ts pattern)
// ---------------------------------------------------------------------------

function insertCardValues(cardData: Omit<import("@strus/core").Card, "id">) {
  return {
    id: randomUUID(),
    noteId: cardData.noteId,
    kind: cardData.kind,
    tag: cardData.tag ?? null,
    state: cardData.state,
    due: Math.floor(cardData.due.getTime() / 1000),
    stability: cardData.stability,
    difficulty: cardData.difficulty,
    elapsedDays: cardData.elapsedDays,
    scheduledDays: cardData.scheduledDays,
    reps: cardData.reps,
    lapses: cardData.lapses,
    learningSteps: cardData.learningSteps,
    lastReview: cardData.lastReview
      ? Math.floor(cardData.lastReview.getTime() / 1000)
      : null,
  };
}

// ---------------------------------------------------------------------------
// createCardsForNote — shared helper (idempotent)
// ---------------------------------------------------------------------------

/**
 * Insert FSRS cards for an approved note.
 * - cloze  → one cloze_fill card per gap
 * - choice → one multiple_choice card
 * - error  → one error_correction card
 * - classifier → one classify card
 *
 * Returns the number of cards actually created (0 if they already exist).
 */
export async function createCardsForNote(
  db: DbClient,
  note: { id: string; kind: string },
  gaps?: Array<{ id: string }>,
): Promise<number> {
  // Check idempotency — skip if any card already exists for this note
  const existing = db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.noteId, note.id))
    .limit(1)
    .all();

  if (existing.length > 0) return 0;

  let created = 0;

  if (note.kind === "cloze") {
    // Fetch gaps if not provided
    const gapRows = gaps ?? db
      .select({ id: clozeGaps.id })
      .from(clozeGaps)
      .where(eq(clozeGaps.noteId, note.id))
      .all();

    for (const gap of gapRows) {
      const cardData = createCard(note.id, "cloze_fill");
      db.insert(cards).values({
        ...insertCardValues(cardData),
        id: randomUUID(),
        gapId: gap.id,
      }).run();
      created++;
    }
  } else if (note.kind === "choice") {
    db.insert(cards).values(insertCardValues(createCard(note.id, "multiple_choice"))).run();
    created++;
  } else if (note.kind === "error") {
    db.insert(cards).values(insertCardValues(createCard(note.id, "error_correction"))).run();
    created++;
  } else if (note.kind === "classifier") {
    db.insert(cards).values(insertCardValues(createCard(note.id, "classify"))).run();
    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
// Few-shot example fetcher
// ---------------------------------------------------------------------------

async function getApprovedClozeExamples(
  db: DbClient,
  conceptId: string,
  limit = 2,
): Promise<Array<{ sentence: string; gap_index: number; correct_answers: string; explanation: string }>> {
  // Find approved cloze notes for this concept with their gaps
  const approvedNotes = db
    .select({
      sentenceId: notes.sentenceId,
      noteId: notes.id,
    })
    .from(notes)
    .where(
      and(
        eq(notes.kind, "cloze"),
        eq(notes.status, "approved"),
        eq(notes.conceptId, conceptId),
      ),
    )
    .limit(limit)
    .all();

  const examples: Array<{ sentence: string; gap_index: number; correct_answers: string; explanation: string }> = [];

  for (const n of approvedNotes) {
    if (!n.sentenceId) continue;
    const [sentence] = db.select().from(sentences).where(eq(sentences.id, n.sentenceId)).limit(1).all();
    if (!sentence) continue;
    const gaps = db.select().from(clozeGaps).where(eq(clozeGaps.noteId, n.noteId)).limit(1).all();
    if (gaps.length === 0) continue;
    const gap = gaps[0]!;
    const answers = JSON.parse(gap.correctAnswers) as string[];
    examples.push({
      sentence: sentence.text,
      gap_index: gap.gapIndex,
      correct_answers: answers.join(" / "),
      explanation: gap.explanation ?? "",
    });
  }

  return examples;
}

// ---------------------------------------------------------------------------
// generateCloze — one cloze note + gaps + cards
// ---------------------------------------------------------------------------

async function generateCloze(opts: {
  db: DbClient;
  concept: { id: string; name: string; description: string | null };
  batchId: string;
  difficulty: 1 | 2 | 3;
  provider: GenerationProvider;
}): Promise<"approved" | "flagged"> {
  const { db, concept, batchId, difficulty, provider } = opts;

  // 1. Few-shot examples
  const examples = await getApprovedClozeExamples(db, concept.id);

  // 2. Render template
  const prompt = renderTemplate("cloze-v1.txt", {
    concept_name: concept.name,
    difficulty,
    examples,
  });

  // 3. Generate
  const result = await provider.generateObject(prompt, ClozeNoteSchema);

  // 4. Validate
  const { allPassed, results: validationResults } = await validateCloze(result);
  const status = allPassed ? "approved" : "flagged";

  // 5. Insert sentence
  const sentenceId = randomUUID();
  const now = new Date();
  const { STRUS_GENERATION_MODEL } = getConfig();

  db.insert(sentences).values({
    id: sentenceId,
    text: result.sentence_text,
    translation: result.translation ?? null,
    source: `llm:${STRUS_GENERATION_MODEL}`,
    createdAt: now,
  }).run();

  // 6. Insert note
  const noteId = randomUUID();
  const generationMeta = JSON.stringify({
    model: STRUS_GENERATION_MODEL,
    template: "cloze-v1",
    batchId,
    generatedAt: now.toISOString(),
    validationResults,
  });

  db.insert(notes).values({
    id: noteId,
    kind: "cloze",
    lemmaId: null,
    front: null,
    back: null,
    sentenceId,
    conceptId: concept.id,
    clusterId: null,
    explanation: null,
    status,
    generationMeta,
    createdAt: now,
    updatedAt: now,
  }).run();

  // 7. Insert gaps
  const insertedGaps: Array<{ id: string }> = [];
  for (const gap of result.gaps) {
    const gapId = randomUUID();
    db.insert(clozeGaps).values({
      id: gapId,
      noteId,
      gapIndex: gap.gap_index,
      correctAnswers: JSON.stringify(gap.correct_answers),
      hint: gap.hint ?? null,
      conceptId: concept.id,
      difficulty,
      explanation: gap.explanation,
      createdAt: now,
    }).run();
    insertedGaps.push({ id: gapId });
  }

  // 8. Create cards if approved
  if (status === "approved") {
    await createCardsForNote(db, { id: noteId, kind: "cloze" }, insertedGaps);
  }

  return status;
}

// ---------------------------------------------------------------------------
// generateChoice — one choice note + options + card
// ---------------------------------------------------------------------------

async function generateChoice(opts: {
  db: DbClient;
  concept: { id: string; name: string; description: string | null };
  batchId: string;
  provider: GenerationProvider;
}): Promise<"approved" | "flagged"> {
  const { db, concept, batchId, provider } = opts;

  // Render template (no few-shot for choice in this phase)
  const prompt = renderTemplate("choice-v1.txt", {
    concept_name: concept.name,
    sentence_context: null,
  });

  // Generate
  const result = await provider.generateObject(prompt, ChoiceNoteSchema);

  // Basic validation: exactly 1 correct option
  const correctCount = result.options.filter((o) => o.is_correct).length;
  const validationResults = [
    {
      layer: "option_count",
      pass: result.options.length === 4,
      reason: `${result.options.length} options (expected 4)`,
    },
    {
      layer: "correct_count",
      pass: correctCount === 1,
      reason: `${correctCount} correct option(s) (expected 1)`,
    },
  ];
  const allPassed = validationResults.every((r) => r.pass);
  const status = allPassed ? "approved" : "flagged";

  const now = new Date();
  const { STRUS_GENERATION_MODEL } = getConfig();

  // Insert note
  const noteId = randomUUID();
  const generationMeta = JSON.stringify({
    model: STRUS_GENERATION_MODEL,
    template: "choice-v1",
    batchId,
    generatedAt: now.toISOString(),
    validationResults,
  });

  db.insert(notes).values({
    id: noteId,
    kind: "choice",
    lemmaId: null,
    front: result.question_text,
    back: null,
    sentenceId: null,
    conceptId: concept.id,
    clusterId: null,
    explanation: null,
    status,
    generationMeta,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Insert options
  for (let i = 0; i < result.options.length; i++) {
    const opt = result.options[i]!;
    db.insert(choiceOptions).values({
      id: randomUUID(),
      noteId,
      optionText: opt.text,
      isCorrect: opt.is_correct,
      explanation: opt.explanation,
      sortOrder: i,
    }).run();
  }

  // Create card if approved
  if (status === "approved") {
    await createCardsForNote(db, { id: noteId, kind: "choice" });
  }

  return status;
}

// ---------------------------------------------------------------------------
// generateBatch — public entry point
// ---------------------------------------------------------------------------

export async function generateBatch(opts: {
  kind: "cloze" | "choice";
  conceptId: string;
  count: number;
  difficulty?: 1 | 2 | 3;
  db: DbClient;
  provider: GenerationProvider;
}): Promise<BatchResult> {
  const { db } = opts;
  const batchId = randomUUID();

  const [concept] = db
    .select()
    .from(grammarConcepts)
    .where(eq(grammarConcepts.id, opts.conceptId))
    .limit(1)
    .all();

  if (!concept) throw new Error(`Concept ${opts.conceptId} not found`);

  let generated = 0;
  let approved = 0;
  let flagged = 0;
  let failed = 0;

  for (let i = 0; i < opts.count; i++) {
    try {
      let status: "approved" | "flagged";

      if (opts.kind === "cloze") {
        status = await generateCloze({
          db,
          concept,
          batchId,
          difficulty: opts.difficulty ?? 2,
          provider: opts.provider,
        });
      } else {
        status = await generateChoice({
          db,
          concept,
          batchId,
          provider: opts.provider,
        });
      }

      generated++;
      if (status === "approved") approved++;
      else flagged++;

      console.log(`[generation] batch ${batchId} item ${i + 1}/${opts.count} → ${status}`);
    } catch (err) {
      console.error(`[generation] batch ${batchId} item ${i + 1} failed:`, err);
      failed++;
    }
  }

  return { batchId, generated, approved, flagged, failed };
}
