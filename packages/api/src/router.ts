import { os, ORPCError } from "@orpc/server";
import { record } from "@elysiajs/opentelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { count, eq, lte, ne, like, and, or, inArray, asc, sql, isNull } from "drizzle-orm";
import { db } from "@rzyns/strus-db";
import { createProvider } from "./generation/provider.js";
import { generateBatch, createCardsForNote } from "./generation/generate.js";
import {
  vocabLists,
  lemmas,
  morphForms,
  cards,
  notes,
  reviews,
  vocabListNotes,
  grammarConcepts,
  sentences,
  sentenceConcepts,
  clozeGaps,
  choiceOptions,
  semanticClusters,
  semanticClusterMembers,
} from "@rzyns/strus-db";
import { generate, parseTag, tagGender, analyseText, analyse } from "@rzyns/strus-morph";
import { generateAudio, generateImage, getMediaBaseUrl } from "./media.js";
import { getSetting, setSetting, SETTINGS_KEYS, DEFAULTS } from "./settings.js";
import {
  scheduleReview,
  createCard,
  getNextReviewDates,
  Rating,
  CardState,
  type Card,
} from "@rzyns/strus-core";

// ---------------------------------------------------------------------------
// Primitive schema building blocks
// ---------------------------------------------------------------------------

const zId = z.string().uuid().describe("UUID v4 identifier");
const zIso = z.string().datetime().describe("ISO 8601 date-time string");
const zSource = z
  .enum(["morfeusz", "manual"])
  .describe(
    "How the paradigm was populated: morfeusz = auto-generated via Morfeusz2 CLI, manual = user-supplied forms",
  );

// ---------------------------------------------------------------------------
// Output schemas with field-level descriptions
// ---------------------------------------------------------------------------

const VocabListOutput = z.object({
  id: zId,
  name: z.string().describe("Human-readable name for the list"),
  description: z.string().nullable().describe("Optional longer description; null if not set"),
  createdAt: zIso.describe("When this list was created"),
});

const LemmaOutput = z.object({
  id: zId,
  lemma: z
    .string()
    .describe("Citation/dictionary form of the word, e.g. 'dom', 'iść', 'dobry'"),
  pos: z
    .string()
    .describe(
      "Part of speech from the NKJP tagset: subst (noun), verb, adj (adjective), adv (adverb), etc.",
    ),
  source: zSource,
  notes: z.string().nullable().describe("Free-form notes about this lemma; null if not set"),
  imageUrl: z.string().url().nullable().describe("URL to mnemonic image; null if not yet generated"),
  imagePrompt: z.string().nullable().describe("Generated image prompt sent to the image model; null if not yet generated"),
  createdAt: zIso.describe("When this lemma was added"),
  updatedAt: zIso.describe("When this lemma was last modified"),
});

const CardOutput = z.object({
  id: zId,
  noteId: zId.describe("ID of the parent note"),
  kind: z
    .enum(["morph_form", "gloss_forward", "gloss_reverse", "basic_forward", "cloze_fill", "multiple_choice", "error_correction", "classify"])
    .describe("Card kind: morph_form for morphological drill, gloss/basic for other note types"),
  tag: z
    .string()
    .nullable()
    .describe(
      "Full NKJP morphosyntactic tag identifying the specific form being drilled, e.g. 'subst:sg:inst:m3'. Only set for morph_form cards.",
    ),
  state: z
    .number()
    .int()
    .describe("FSRS card state: 0 = New, 1 = Learning, 2 = Review, 3 = Relearning"),
  due: zIso.describe("When this card is next due for review"),
  stability: z
    .number()
    .describe("FSRS stability — number of days until recall probability drops to ~90%"),
  difficulty: z
    .number()
    .describe("FSRS difficulty parameter on a 1–10 scale; higher = harder to remember"),
  elapsedDays: z.number().int().describe("Days elapsed since the last review"),
  scheduledDays: z.number().int().describe("Days ahead this card was scheduled at its last review"),
  reps: z.number().int().describe("Total number of completed reviews"),
  lapses: z.number().int().describe("Number of times this card was forgotten (rated Again)"),
  lastReview: zIso
    .nullable()
    .describe("Timestamp of the most recent review; null if this card has never been reviewed"),
});

const MorphFormOutput = z.object({
  id: zId,
  lemmaId: zId.describe("ID of the parent lemma"),
  orth: z.string().describe("Orthographic surface form, e.g. 'domem', 'domowi'"),
  tag: z.string().describe("Full NKJP morphosyntactic tag, e.g. 'subst:sg:inst:m3'"),
  parsedTag: z.string().describe("JSON-serialised parsed tag object"),
  audioUrl: z.string().url().nullable().describe("URL to TTS audio; null if not yet generated"),
  createdAt: zIso.describe("When this form was created"),
});

const SuccessOutput = z.object({
  success: z.literal(true).describe("Always true; present to confirm the operation completed"),
});

const StatsOutput = z.object({
  lemmaCount: z.number().int().describe("Total number of lemmas in the database"),
  listCount: z.number().int().describe("Total number of vocabulary lists"),
  dueCount: z.number().int().describe("Number of cards currently due for review"),
  draftCount: z.number().int().describe("Number of contextual exercise notes with status='draft' awaiting review"),
});

const NoteOutput = z.object({
  id: zId,
  kind: z.enum(["morph", "gloss", "basic", "cloze", "choice", "error", "classifier"]).describe("Note kind: morph for morphological drill, gloss for translation, basic for custom flashcards"),
  lemmaId: zId.nullable().describe("ID of the associated lemma; null for basic notes"),
  lemmaText: z.string().nullable().describe("Citation form of the associated lemma; null for basic notes"),
  front: z.string().nullable().describe("Prompt text for gloss/basic notes; null for morph notes"),
  back: z.string().nullable().describe("Answer text for gloss/basic notes; null for morph notes"),
  status: z.string().nullable().describe("Moderation status: draft | approved | flagged | rejected. Always non-null; morph/basic/gloss notes always return 'approved'."),
  sentenceId: z.string().nullable().describe("ID of the associated sentence; null for non-contextual notes"),
  sentenceText: z.string().nullable().describe("Sentence text (with {{N}} gap markers for cloze); null if no sentence"),
  conceptId: z.string().nullable().describe("ID of the grammar concept this note is tagged to; null if none"),
  explanation: z.string().nullable().describe("Human-readable explanation of why an answer is correct; null if not set"),
  generationMeta: z.string().nullable().describe("JSON string with generation metadata (model, batchId, etc.); null for hand-crafted notes"),
  createdAt: zIso.describe("When this note was created"),
  updatedAt: zIso.describe("When this note was last modified"),
});

const GrammarConceptOutput = z.object({
  id: zId,
  name: z.string().describe("Human-readable concept name, e.g. 'True Reflexive'"),
  description: z.string().nullable().describe("Longer explanation; null if not set"),
  parentId: zId.nullable().describe("Parent concept ID; null for root concepts"),
  createdAt: zIso.describe("When this concept was created"),
});

const SentenceOutput = z.object({
  id: zId,
  text: z.string().describe("Sentence text, possibly with {{N}} gap markers for cloze"),
  translation: z.string().nullable().describe("English translation; null if not set"),
  source: z.string().describe("Provenance: 'handcrafted', 'llm:...', etc."),
  difficulty: z.number().int().nullable().describe("Difficulty 1–5; null if not rated"),
  createdAt: zIso.describe("When this sentence was created"),
});

// ---------------------------------------------------------------------------
// Import schemas
// ---------------------------------------------------------------------------

const ImportTextInput = z.object({
  text: z.string().min(1).describe("Polish text to analyse — HTML should be stripped by the caller"),
  listId: z.string().uuid().optional().describe("Vocabulary list to add imported lemmas to"),
});

const ImportCandidateOutput = z.object({
  lemma: z.string(),
  pos: z.string(),
  formsFound: z.array(z.string()).describe("Surface forms from the input text that mapped to this lemma"),
  ambiguous: z.boolean().describe("True if multiple lemmas were possible for at least one of the input forms"),
  alreadyExists: z.boolean().describe("True if this lemma already exists in the database"),
  isMultiWord: z.boolean().describe("True if the lemma contains spaces — will be imported with source=manual"),
});

// ---------------------------------------------------------------------------
// Mappers — convert raw DB rows / domain objects to output shapes
// ---------------------------------------------------------------------------

function mapVocabList(row: typeof vocabLists.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapLemma(row: typeof lemmas.$inferSelect) {
  const baseUrl = getMediaBaseUrl();
  return {
    id: row.id,
    lemma: row.lemma,
    pos: row.pos,
    source: row.source,
    notes: row.notes,
    imageUrl: row.imagePath ? `${baseUrl}/${row.imagePath}` : null,
    imagePrompt: row.imagePrompt ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps a raw DB row from cards (due/lastReview are Unix seconds). */
function mapCardRow(row: typeof cards.$inferSelect) {
  return {
    id: row.id,
    noteId: row.noteId,
    kind: row.kind,
    tag: row.tag,
    state: row.state,
    due: new Date(row.due * 1000).toISOString(),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    lastReview: row.lastReview != null
      ? new Date(row.lastReview * 1000).toISOString()
      : null,
  };
}

/** Maps a domain Card (due/lastReview are Date objects). */
function mapCardDomain(card: Card) {
  return {
    id: card.id,
    noteId: card.noteId,
    kind: card.kind,
    tag: card.tag ?? null,
    state: card.state,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.lastReview?.toISOString() ?? null,
  };
}

function mapNote(
  row: typeof notes.$inferSelect,
  lemmaText: string | null = null,
  sentenceText: string | null = null,
) {
  return {
    id: row.id,
    kind: row.kind,
    lemmaId: row.lemmaId,
    lemmaText,
    front: row.front,
    back: row.back,
    status: row.status,
    sentenceId: row.sentenceId,
    sentenceText,
    conceptId: row.conceptId,
    explanation: row.explanation,
    generationMeta: row.generationMeta,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Import pipeline helpers
// ---------------------------------------------------------------------------

const STOPWORD_TAG_PREFIXES = new Set([
  "prep", "conj", "comp", "qub", "interj",
  "ppron12", "ppron3", "num", "numcol",
  "ign", "aglt", "brev",
]);

function isStopwordForm(tag: string, lemma: string): boolean {
  const base = tag.split(":")[0] ?? tag;
  return STOPWORD_TAG_PREFIXES.has(base) || lemma === "siebie";
}

/**
 * Strip SGJP homonym-disambiguation suffixes from lemma strings.
 * SGJP encodes multiple homonymous lexemes as e.g. "kot:Sm1", "kot:Sm2".
 * For import purposes we treat these as the same base lemma ("kot").
 */
function stripSgjpSuffix(lemma: string): string {
  return lemma.replace(/:[A-Z][a-zA-Z0-9]*$/, "");
}

/**
 * Return true if a morph form should be excluded from cards.
 * We skip negated forms (tag ending in ":neg") — they are regular and
 * predictable, and quizzing both "udostępnionym" and "nieudostępnionym"
 * as separate cards adds noise rather than value.
 */
function isExcludedForm(tag: string): boolean {
  return tag.endsWith(":neg");
}

function inferPos(tag: string): string {
  const base = tag.split(":")[0] ?? tag;
  if (base === "subst") return "subst";
  if (["adj", "adja", "adjp"].includes(base)) return "adj";
  if (base === "adv") return "adv";
  if (["fin", "praet", "impt", "imps", "inf", "pcon", "pant", "ger", "pact", "ppas", "bedzie"].includes(base)) return "verb";
  return base;
}

interface ImportCandidate {
  lemma: string;
  pos: string;
  formsFound: string[];
  ambiguous: boolean;
  isMultiWord: boolean;
}

async function analyseImportText(
  text: string,
): Promise<{ candidates: ImportCandidate[]; unknownTokens: string[] }> {
  // Let analyseText errors propagate — callers get a 500 with a useful message
  // rather than silently returning 0 candidates when morfeusz_analyzer is unavailable.
  const allForms = await record("morph.analyseText", async (span) => {
    span.setAttributes({
      "morph.text_length": text.length,
      "morph.word_count": text.split(/\s+/).filter(Boolean).length,
    });
    const result = await analyseText(text);
    span.setAttribute("morph.tokens_count", result.length);
    return result;
  }) as Awaited<ReturnType<typeof analyseText>>;

  // Group analyses by surface form (orth)
  const byOrth = new Map<string, typeof allForms>();
  for (const form of allForms) {
    const existing = byOrth.get(form.orth);
    if (existing !== undefined) existing.push(form);
    else byOrth.set(form.orth, [form]);
  }

  // Build lemma map, tracking ambiguity and which surface forms contributed
  const lemmaMap = new Map<string, { pos: string; orths: Set<string>; ambiguous: boolean }>();

  for (const [orth, forms] of byOrth) {
    const nonStop = forms.filter((f) => !isStopwordForm(f.tag, f.lemma));
    if (nonStop.length === 0) continue;

    // Normalise SGJP homonym suffixes ("kot:Sm1" → "kot") before dedup.
    const normalised = nonStop.map((f) => ({ ...f, lemma: stripSgjpSuffix(f.lemma) }));
    const distinctLemmas = [...new Set(normalised.map((f) => f.lemma))];

    // If one candidate exactly matches the surface form, prefer it and
    // don't flag as ambiguous (e.g. "kot" typed as vocab → "kot", not "kota").
    const resolvedLemmas =
      distinctLemmas.length > 1 && distinctLemmas.includes(orth)
        ? [orth]
        : distinctLemmas;
    const ambiguous = resolvedLemmas.length > 1;

    for (const lemma of resolvedLemmas) {
      const representativeTag = normalised.find((f) => f.lemma === lemma)!.tag;
      const pos = inferPos(representativeTag);
      const entry = lemmaMap.get(lemma);
      if (entry !== undefined) {
        entry.orths.add(orth);
        if (ambiguous) entry.ambiguous = true;
      } else {
        lemmaMap.set(lemma, { pos, orths: new Set([orth]), ambiguous });
      }
    }
  }

  const candidates: ImportCandidate[] = [...lemmaMap.entries()].map(([lemma, info]) => ({
    lemma,
    pos: info.pos,
    formsFound: [...info.orths],
    ambiguous: info.ambiguous,
    isMultiWord: lemma.includes(" "),
  }));

  return { candidates, unknownTokens: [] };
}

/**
 * Create a morph note for a lemma, generate morph forms, and create morph_form cards.
 * Returns the note ID.
 */
async function createMorphNoteAndCards(
  lemmaId: string,
  lemmaText: string,
  now: Date,
): Promise<string> {
  const noteId = crypto.randomUUID();
  await db.insert(notes).values({
    id: noteId,
    kind: "morph",
    lemmaId,
    front: null,
    back: null,
    createdAt: now,
    updatedAt: now,
  });

  let forms: Awaited<ReturnType<typeof generate>> = [];
  try {
    forms = await record("morph.generate", async (span) => {
      span.setAttribute("morph.lemma", lemmaText);
      const result = await generate(lemmaText);
      span.setAttribute("morph.forms_count", result.length);
      return result;
    }) as Awaited<ReturnType<typeof generate>>;
  } catch {
    console.warn(`[morph] morfeusz2 unavailable; skipping form generation for "${lemmaText}"`);
  }

  // Skip negated forms (":neg" tag suffix) — they are regular/predictable
  // and create confusing quiz cards (e.g. "nieudostępnionym" for udostępnić).
  forms = forms.filter((f) => !isExcludedForm(f.tag));

  for (const form of forms) {
    const parsed = parseTag(form.tag);
    await db.insert(morphForms).values({
      id: crypto.randomUUID(),
      lemmaId,
      orth: form.orth,
      tag: form.tag,
      parsedTag: JSON.stringify(parsed),
      createdAt: now,
    });

    const cardData = createCard(noteId, "morph_form", form.tag);
    await db.insert(cards).values({
      id: crypto.randomUUID(),
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
      lastReview: cardData.lastReview
        ? Math.floor(cardData.lastReview.getTime() / 1000)
        : null,
    });
  }

  return noteId;
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

const AboutOutput = z.object({
  name: z.string(),
  version: z.string(),
});

const about = os
  .route({
    method: "GET",
    path: "/about",
    tags: ["Meta"],
    summary: "Version and build information",
  })
  .input(z.object({}))
  .output(AboutOutput)
  .handler(() => ({
    name: pkg.name,
    version: pkg.version,
  }));

// ---------------------------------------------------------------------------
// Lists procedures
// ---------------------------------------------------------------------------

const listsList = os
  .route({
    method: "GET",
    path: "/lists",
    tags: ["Lists"],
    summary: "List all vocabulary lists",
  })
  .input(z.object({}))
  .output(z.array(VocabListOutput))
  .handler(async () =>
    db.select().from(vocabLists).all().map(mapVocabList)
  );

const listsCreate = os
  .route({
    method: "POST",
    path: "/lists",
    tags: ["Lists"],
    summary: "Create a vocabulary list",
  })
  .input(z.object({
    name: z.string().min(1).describe("Name for the new list"),
    description: z.string().optional().describe("Optional description"),
  }))
  .output(VocabListOutput)
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(vocabLists).values({
      id,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
    });
    return mapVocabList({ id, name: input.name, description: input.description ?? null, createdAt: now });
  });

const listsGet = os
  .route({
    method: "GET",
    path: "/lists/{id}",
    tags: ["Lists"],
    summary: "Get a vocabulary list",
  })
  .input(z.object({ id: zId }))
  .output(VocabListOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(vocabLists).where(eq(vocabLists.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `VocabList not found: ${input.id}` });
    return mapVocabList(row);
  });

const listsDelete = os
  .route({
    method: "DELETE",
    path: "/lists/{id}",
    tags: ["Lists"],
    summary: "Delete a vocabulary list",
    description:
      "Deletes the list and removes all its note associations. Notes and lemmas themselves are not deleted.",
  })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(vocabLists).where(eq(vocabLists.id, input.id));
    return { success: true as const };
  });

const listsAddLemma = os
  .route({
    method: "POST",
    path: "/lists/{listId}/lemmas",
    tags: ["Lists"],
    summary: "Add a lemma to a vocabulary list",
    description:
      "Associates an existing lemma with a vocabulary list via its morph note. " +
      "The lemma must already exist and have a morph note.",
  })
  .input(z.object({
    listId: zId.describe("ID of the vocabulary list"),
    lemmaId: zId.describe("ID of the lemma to add"),
  }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    // Find the morph note for this lemma
    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.lemmaId, input.lemmaId), eq(notes.kind, "morph")))
      .limit(1);

    if (!note) {
      throw new ORPCError("NOT_FOUND", {
        message: `No morph note found for lemma: ${input.lemmaId}`,
      });
    }

    await db.insert(vocabListNotes).values({
      listId: input.listId,
      noteId: note.id,
    });
    return { success: true as const };
  });

// ---------------------------------------------------------------------------
// Lemmas procedures
const listsAddNote = os
  .route({
    method: "POST",
    path: "/lists/{listId}/notes",
    tags: ["Lists"],
    summary: "Add a note to a vocabulary list",
    description:
      "Associates an existing note directly with a vocabulary list. " +
      "Idempotent — calling twice with the same IDs returns success both times.",
  })
  .input(z.object({
    listId: zId.describe("ID of the vocabulary list"),
    noteId: zId.describe("ID of the note to add"),
  }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    // Verify the list exists
    const [list] = await db
      .select({ id: vocabLists.id })
      .from(vocabLists)
      .where(eq(vocabLists.id, input.listId))
      .limit(1);

    if (!list) {
      throw new ORPCError("NOT_FOUND", {
        message: `Vocabulary list not found: ${input.listId}`,
      });
    }

    // Verify the note exists
    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .limit(1);

    if (!note) {
      throw new ORPCError("NOT_FOUND", {
        message: `Note not found: ${input.noteId}`,
      });
    }

    // Insert idempotently (primaryKey constraint on (listId, noteId))
    await db
      .insert(vocabListNotes)
      .values({ listId: input.listId, noteId: input.noteId })
      .onConflictDoNothing();

    return { success: true as const };
  });

// ---------------------------------------------------------------------------

const lemmasList = os
  .route({
    method: "GET",
    path: "/lemmas",
    tags: ["Lemmas"],
    summary: "List lemmas",
    description: "Returns all lemmas, optionally filtered to those belonging to a specific vocabulary list.",
  })
  .input(z.object({
    listId: z.string().uuid().optional().describe("Filter to lemmas in this vocabulary list"),
  }))
  .output(z.array(LemmaOutput))
  .handler(async ({ input }) => {
    if (input.listId) {
      return db
        .select({ lemma: lemmas })
        .from(lemmas)
        .innerJoin(
          notes,
          eq(notes.lemmaId, lemmas.id),
        )
        .innerJoin(
          vocabListNotes,
          and(
            eq(vocabListNotes.noteId, notes.id),
            eq(vocabListNotes.listId, input.listId),
          ),
        )
        .all()
        .map((r) => mapLemma(r.lemma));
    }
    return db.select().from(lemmas).all().map(mapLemma);
  });

const lemmasCreate = os
  .route({
    method: "POST",
    path: "/lemmas",
    tags: ["Lemmas"],
    summary: "Create a lemma",
    description:
      "Creates a lemma and, if source is 'morfeusz' and Morfeusz2 is available, automatically " +
      "generates all morphological word forms and seeds one FSRS card per form via a morph note. " +
      "Use source='manual' to supply forms yourself via POST /lemmas/{id}/forms. " +
      "Optionally associates the new lemma with a vocabulary list.",
  })
  .input(z.object({
    lemma: z.string().min(1).describe("Citation/dictionary form of the word, e.g. 'dom', 'iść'"),
    pos: z
      .string()
      .min(1)
      .describe("Part of speech (NKJP tag prefix): subst, verb, adj, adv, etc."),
    source: zSource.default("morfeusz").describe(
      "morfeusz (default) = auto-generate word forms via Morfeusz2; manual = user will supply forms",
    ),
    notes: z.string().optional().describe("Optional free-form notes"),
    listId: z.string().uuid().optional().describe("Vocabulary list to add this lemma to"),
  }))
  .output(LemmaOutput)
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(lemmas).values({
      id,
      lemma: input.lemma,
      pos: input.pos,
      source: input.source,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });

    if (input.source === "morfeusz") {
      const noteId = await createMorphNoteAndCards(id, input.lemma, now);

      if (input.listId) {
        await db.insert(vocabListNotes).values({ listId: input.listId, noteId });
      }

      // Fire-and-forget image generation — don't block the response
      const citationForm = db.select({ tag: morphForms.tag }).from(morphForms)
        .where(and(eq(morphForms.lemmaId, id), eq(morphForms.orth, input.lemma)))
        .limit(1).get();
      const citationTag = citationForm?.tag ?? "";
      generateImage(input.lemma, citationTag).then((result) => {
        if (result.relativePath || result.imagePrompt) {
          db.update(lemmas).set({
            ...(result.relativePath ? { imagePath: result.relativePath } : {}),
            ...(result.imagePrompt ? { imagePrompt: result.imagePrompt } : {}),
          }).where(eq(lemmas.id, id)).run();
        }
      }).catch((err) => {
        console.warn(`[media] Image generation failed for "${input.lemma}":`, err);
      });
    } else {
      // Manual source: ALWAYS create a morph note (even without a listId).
      // Without this, listsAddLemma throws NOT_FOUND for any manual lemma
      // that was created before being added to a list, because it queries
      // for a morph note and finds none.
      const noteId = crypto.randomUUID();
      await db.insert(notes).values({
        id: noteId,
        kind: "morph",
        lemmaId: id,
        front: null,
        back: null,
        createdAt: now,
        updatedAt: now,
      });
      if (input.listId) {
        await db.insert(vocabListNotes).values({ listId: input.listId, noteId });
      }
    }

    return mapLemma({
      id,
      lemma: input.lemma,
      pos: input.pos,
      source: input.source,
      notes: input.notes ?? null,
      imagePath: null,
      imagePrompt: null,
      createdAt: now,
      updatedAt: now,
    });
  });

const lemmasGet = os
  .route({
    method: "GET",
    path: "/lemmas/{id}",
    tags: ["Lemmas"],
    summary: "Get a lemma",
  })
  .input(z.object({ id: zId }))
  .output(LemmaOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(lemmas).where(eq(lemmas.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Lemma not found: ${input.id}` });
    return mapLemma(row);
  });

const lemmasDelete = os
  .route({
    method: "DELETE",
    path: "/lemmas/{id}",
    tags: ["Lemmas"],
    summary: "Delete a lemma",
    description:
      "Deletes a lemma along with all its morphological forms, notes, and cards (cascade). " +
      "Review history is also removed.",
  })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(lemmas).where(eq(lemmas.id, input.id));
    return { success: true as const };
  });

const lemmasForms = os
  .route({
    method: "GET",
    path: "/lemmas/{id}/forms",
    tags: ["Lemmas"],
    summary: "Get morphological forms for a lemma",
    description:
      "Returns all inflected word forms (paradigm) generated by Morfeusz2 for this lemma.",
  })
  .input(z.object({ id: zId }))
  .output(z.array(MorphFormOutput))
  .handler(async ({ input }) => {
    const [row] = await db.select({ id: lemmas.id }).from(lemmas).where(eq(lemmas.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Lemma not found: ${input.id}` });

    const baseUrl = getMediaBaseUrl();
    return db
      .select()
      .from(morphForms)
      .where(eq(morphForms.lemmaId, input.id))
      .all()
      .map((f) => ({
        id: f.id,
        lemmaId: f.lemmaId,
        orth: f.orth,
        tag: f.tag,
        parsedTag: f.parsedTag,
        audioUrl: f.audioPath ? `${baseUrl}/${f.audioPath}` : null,
        createdAt: f.createdAt.toISOString(),
      }));
  });

// ---------------------------------------------------------------------------
// Media generation procedures
// ---------------------------------------------------------------------------

const lemmasGenerateImage = os
  .route({
    method: "POST",
    path: "/lemmas/{id}/generate-image",
    tags: ["Lemmas"],
    summary: "Generate a mnemonic image for a lemma",
    description:
      "Generates a mnemonic image via Gemini and stores it. Returns the updated lemma with imageUrl populated.",
  })
  .input(z.object({ id: zId }))
  .output(LemmaOutput)
  .handler(async ({ input }) => {
    const [row] = db
      .select()
      .from(lemmas)
      .where(eq(lemmas.id, input.id))
      .limit(1)
      .all();
    if (!row)
      throw new ORPCError("NOT_FOUND", {
        message: `Lemma not found: ${input.id}`,
      });

    const citationForm = db.select({ tag: morphForms.tag }).from(morphForms)
      .where(and(eq(morphForms.lemmaId, input.id), eq(morphForms.orth, row.lemma)))
      .limit(1).get();
    const citationTag = citationForm?.tag ?? "";

    // Look up the first gloss note for this lemma so we can pass the
    // translation to the image-prompt template as {{meaning}}.
    const glossNote = db
      .select({ back: notes.back })
      .from(notes)
      .where(and(eq(notes.lemmaId, input.id), eq(notes.kind, "gloss")))
      .orderBy(asc(notes.createdAt))
      .limit(1)
      .get();
    const meaning = glossNote?.back ?? null;

    const result = await generateImage(row.lemma, citationTag, meaning);
    if (result.relativePath || result.imagePrompt) {
      db.update(lemmas)
        .set({
          ...(result.relativePath ? { imagePath: result.relativePath } : {}),
          ...(result.imagePrompt ? { imagePrompt: result.imagePrompt } : {}),
        })
        .where(eq(lemmas.id, input.id))
        .run();
    }

    const [updated] = db
      .select()
      .from(lemmas)
      .where(eq(lemmas.id, input.id))
      .limit(1)
      .all();
    return mapLemma(updated!);
  });

const formsGenerateAudio = os
  .route({
    method: "POST",
    path: "/forms/{id}/generate-audio",
    tags: ["Forms"],
    summary: "Generate TTS audio for a morphological form",
    description:
      "Generates TTS audio via ElevenLabs and stores it. Returns the audio URL.",
  })
  .input(z.object({ id: zId }))
  .output(z.object({ audioUrl: z.string().url().nullable() }))
  .handler(async ({ input }) => {
    const [row] = db
      .select({
        id: morphForms.id,
        orth: morphForms.orth,
        tag: morphForms.tag,
        audioPath: morphForms.audioPath,
      })
      .from(morphForms)
      .where(eq(morphForms.id, input.id))
      .limit(1)
      .all();
    if (!row)
      throw new ORPCError("NOT_FOUND", {
        message: `Form not found: ${input.id}`,
      });

    const relativePath = await generateAudio(row.orth, row.tag, tagGender(row.tag));
    if (relativePath) {
      db.update(morphForms)
        .set({ audioPath: relativePath })
        .where(eq(morphForms.id, input.id))
        .run();
    }

    const baseUrl = getMediaBaseUrl();
    return {
      audioUrl: relativePath ? `${baseUrl}/${relativePath}` : null,
    };
  });

// ---------------------------------------------------------------------------
// Session procedures
// ---------------------------------------------------------------------------

const NextDatesOutput = z.object({
  again: zIso,
  hard: zIso,
  good: zIso,
  easy: zIso,
}).describe("Projected due dates for each rating, computed at session load time");

const ClozeGapRenderOutput = z.object({
  gapIndex: z.number().int(),
  hint: z.string().nullable(),
  correctAnswers: z.array(z.string()),
  explanation: z.string().nullable(),
});

const ChoiceOptionRenderOutput = z.object({
  id: zId,
  optionText: z.string(),
  isCorrect: z.boolean(),
  explanation: z.string().nullable(),
});

const ClassifyOptionRenderOutput = z.object({
  id: zId,
  name: z.string(),
  isCorrect: z.boolean(),
});

const DueCardOutput = CardOutput.extend({
  lemmaText: z
    .string()
    .nullable()
    .describe("Citation/dictionary form of the lemma, e.g. 'dom', 'iść'. Null for non-morph cards."),
  front: z.string().nullable().describe("Prompt text for basic/gloss cards; null for morph cards"),
  back: z.string().nullable().describe("Answer text for basic/gloss cards; null for morph cards"),
  forms: z
    .array(z.string())
    .describe(
      "Orthographic variants for this card's tag combination. " +
      "Empty when the lemma has source=manual or Morfeusz2 form generation was skipped.",
    ),
  formId: z.string().nullable().describe("morph_forms row ID for the card's specific form; needed to call generateAudio"),
  lemmaFormId: z.string().nullable().describe("morph_forms row ID for the citation form; needed to generate lemmaAudioUrl"),
  lemmaId: z.string().nullable().describe("ID of the associated lemma; null for basic cards"),
  audioUrl: z.string().nullable().describe("URL to TTS audio for this form; null if not yet generated"),
  lemmaAudioUrl: z.string().nullable().describe("URL to citation-form TTS audio; null if not generated"),
  imageUrl: z.string().nullable().describe("URL to mnemonic image for the lemma; null if not yet generated"),
  imagePrompt: z.string().nullable().describe("Generated image prompt sent to the image model; null if not yet generated"),
  nextDates: NextDatesOutput,
  sentenceText: z.string().nullable()
    .describe("Sentence text with {{N}} markers for cloze_fill; plain text for classify; null for other kinds"),
  clozeGaps: z.array(ClozeGapRenderOutput).nullable()
    .describe("Gaps for cloze_fill cards; null for other kinds"),
  choiceOptions: z.array(ChoiceOptionRenderOutput).nullable()
    .describe("Shuffled options for multiple_choice cards; null for other kinds"),
  classifyOptions: z.array(ClassifyOptionRenderOutput).nullable()
    .describe("Sibling concepts for classify cards; null for other kinds"),
  noteExplanation: z.string().nullable()
    .describe("Note-level explanation shown after answer for new card kinds; null otherwise"),
});

/**
 * Round-robin interleave cards by lemmaId so that consecutive cards in a
 * session are unlikely to share the same lemma (i.e. won't drill all forms
 * of one word back-to-back).
 */
function interleaveByLemma<T extends { lemmaId: string | null }>(items: T[]): T[] {
  // Group by lemmaId (preserve internal order within each group)
  const groups = new Map<string, T[]>();
  const noLemma: T[] = [];
  for (const item of items) {
    if (item.lemmaId == null) {
      noLemma.push(item);
      continue;
    }
    const g = groups.get(item.lemmaId);
    if (g !== undefined) g.push(item);
    else groups.set(item.lemmaId, [item]);
  }

  // Round-robin across groups until all cards are placed
  const queues = [...groups.values()];
  const result: T[] = [];
  let round = 0;
  const total = items.length - noLemma.length;
  while (result.length < total) {
    let advanced = false;
    for (let q = 0; q < queues.length; q++) {
      const queue = queues[q];
      if (queue !== undefined && round < queue.length) {
        result.push(queue[round]!);
        advanced = true;
      }
    }
    if (!advanced) break;
    round++;
  }
  // Append cards with no lemmaId at the end
  result.push(...noLemma);
  return result;
}

/** Fisher-Yates in-place shuffle — returns the same array. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

const sessionDue = os
  .route({
    method: "GET",
    path: "/session/due",
    tags: ["Session"],
    summary: "Get cards due for review",
    description:
      "Returns cards whose due date has passed. " +
      "Review cards (state ≥ 1) are always included. New cards (state = 0) " +
      "are capped at `newLimit` to pace vocabulary introduction. " +
      "When `interleave` is true (default), cards are round-robin'd by lemma " +
      "so consecutive cards are unlikely to share the same word. " +
      "Each card includes the parent lemma's citation form and the accepted " +
      "orthographic variants for the specific tag being drilled.",
  })
  .input(z.object({
    listId: z
      .string()
      .uuid()
      .optional()
      .describe("Restrict to cards from this vocabulary list"),
    limit: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Hard cap on total session size (default: 100)"),
    newLimit: z
      .coerce
      .number()
      .int()
      .min(0)
      .max(200)
      .default(20)
      .describe("Maximum new (state=0) cards to introduce per session (default: 20)"),
    interleave: z
      .coerce
      .boolean()
      .default(true)
      .describe("Interleave cards by lemma to avoid back-to-back form drilling (default: true)"),
    kinds: z
      .array(z.enum(["morph_form", "gloss_forward", "gloss_reverse", "basic_forward", "cloze_fill", "multiple_choice", "error_correction", "classify"]))
      .optional()
      .describe("Only include cards of these kinds"),
    tagContains: z
      .string()
      .optional()
      .describe("Filter morph_form cards to those whose tag contains this substring"),
    mode: z
      .enum(["card-first", "note-first"])
      .default("card-first")
      .describe(
        "Session selection strategy. card-first (default) picks cards directly. " +
        "note-first selects notes that need attention, then picks cards within each note.",
      ),
    noteLimit: z
      .coerce
      .number()
      .int()
      .positive()
      .default(10)
      .describe("Maximum notes to include in a note-first session (default: 10)"),
    cardsPerNote: z
      .coerce
      .number()
      .int()
      .positive()
      .default(5)
      .describe("Maximum cards per note in note-first mode (default: 5)"),
  }))
  .output(z.array(DueCardOutput))
  .handler(async ({ input }) => {
    const nowSecs = Math.floor(Date.now() / 1000);

    // Build optional filter conditions for kinds / tagContains.
    const extraFilters = [
      lte(cards.due, nowSecs),
      ...(input.kinds ? [inArray(cards.kind, input.kinds)] : []),
      ...(input.tagContains
        ? [or(ne(cards.kind, "morph_form"), like(cards.tag, `%${input.tagContains}%`))]
        : []),
    ];

    type RawRow = {
      card: typeof cards.$inferSelect;
      lemmaId: string | null;
      lemmaText: string | null;
      front: string | null;
      back: string | null;
    };

    let session: RawRow[];

    if (input.mode === "note-first") {
      // -----------------------------------------------------------------
      // Note-first mode
      // Step 1: select notes that have at least one due card.
      // -----------------------------------------------------------------
      const baseNoteQ = input.listId
        ? db
            .selectDistinct({ noteId: notes.id, lastReviewedAt: notes.lastReviewedAt })
            .from(notes)
            .innerJoin(cards, and(eq(cards.noteId, notes.id), ...extraFilters))
            .innerJoin(
              vocabListNotes,
              and(
                eq(vocabListNotes.noteId, notes.id),
                eq(vocabListNotes.listId, input.listId),
              ),
            )
        : db
            .selectDistinct({ noteId: notes.id, lastReviewedAt: notes.lastReviewedAt })
            .from(notes)
            .innerJoin(cards, and(eq(cards.noteId, notes.id), ...extraFilters));

      const selectedNotes = baseNoteQ
        // SQLite has no NULLS FIRST syntax; `IS NOT NULL` evaluates to 0 for NULLs
        // and 1 for non-nulls, so sorting ASC puts never-reviewed notes first.
        .orderBy(sql`${notes.lastReviewedAt} IS NOT NULL`, asc(notes.lastReviewedAt))
        .limit(input.noteLimit)
        .all();

      if (selectedNotes.length === 0) return [];

      const noteIds = selectedNotes.map((n) => n.noteId);

      // Step 2: fetch due cards for those notes.
      const rawDue = input.listId
        ? db
            .select({
              card: cards,
              lemmaId: notes.lemmaId,
              lemmaText: lemmas.lemma,
              front: notes.front,
              back: notes.back,
            })
            .from(cards)
            .innerJoin(notes, eq(notes.id, cards.noteId))
            .leftJoin(lemmas, eq(lemmas.id, notes.lemmaId))
            .innerJoin(
              vocabListNotes,
              and(
                eq(vocabListNotes.noteId, cards.noteId),
                eq(vocabListNotes.listId, input.listId),
              ),
            )
            .where(and(inArray(cards.noteId, noteIds), ...extraFilters))
            .all()
        : db
            .select({
              card: cards,
              lemmaId: notes.lemmaId,
              lemmaText: lemmas.lemma,
              front: notes.front,
              back: notes.back,
            })
            .from(cards)
            .innerJoin(notes, eq(notes.id, cards.noteId))
            .leftJoin(lemmas, eq(lemmas.id, notes.lemmaId))
            .where(and(inArray(cards.noteId, noteIds), ...extraFilters))
            .all();

      // Step 2b: group by note, cap cardsPerNote, enforce newLimit across session.
      const byNote = new Map<string, RawRow[]>();
      for (const r of rawDue) {
        const g = byNote.get(r.card.noteId);
        if (g !== undefined) g.push(r);
        else byNote.set(r.card.noteId, [r]);
      }

      let newCount = 0;
      const collected: RawRow[] = [];
      // Iterate in the same order as selectedNotes to preserve priority.
      for (const { noteId } of selectedNotes) {
        const noteCards = byNote.get(noteId);
        if (!noteCards) continue;

        const reviewCards = noteCards.filter((r) => r.card.state > 0);
        const newCards = noteCards.filter((r) => r.card.state === 0);
        shuffle(reviewCards);
        shuffle(newCards);

        let taken = 0;
        for (const r of reviewCards) {
          if (taken >= input.cardsPerNote) break;
          collected.push(r);
          taken++;
        }
        for (const r of newCards) {
          if (taken >= input.cardsPerNote) break;
          if (newCount >= input.newLimit) break;
          collected.push(r);
          taken++;
          newCount++;
        }
      }

      // Step 3: flatten and cap.
      session = collected.slice(0, input.limit);
    } else {
      // -----------------------------------------------------------------
      // Card-first mode (existing behaviour)
      // -----------------------------------------------------------------
      const fetchCap = Math.max(500, input.limit * 2 + input.newLimit * 4);

      const rawDue = input.listId
        ? db
            .select({
              card: cards,
              lemmaId: notes.lemmaId,
              lemmaText: lemmas.lemma,
              front: notes.front,
              back: notes.back,
            })
            .from(cards)
            .innerJoin(notes, eq(notes.id, cards.noteId))
            .leftJoin(lemmas, eq(lemmas.id, notes.lemmaId))
            .innerJoin(
              vocabListNotes,
              and(
                eq(vocabListNotes.noteId, cards.noteId),
                eq(vocabListNotes.listId, input.listId),
              ),
            )
            .where(and(...extraFilters))
            .limit(fetchCap)
            .all()
        : db
            .select({
              card: cards,
              lemmaId: notes.lemmaId,
              lemmaText: lemmas.lemma,
              front: notes.front,
              back: notes.back,
            })
            .from(cards)
            .innerJoin(notes, eq(notes.id, cards.noteId))
            .leftJoin(lemmas, eq(lemmas.id, notes.lemmaId))
            .where(and(...extraFilters))
            .limit(fetchCap)
            .all();

      if (rawDue.length === 0) return [];

      // Session composition:
      //   - Review/Learning/Relearning cards (state > 0): always included
      //   - New cards (state = 0): capped at newLimit, shuffled for variety
      const reviewPool = rawDue.filter((r) => r.card.state > 0);
      const newPool = shuffle(rawDue.filter((r) => r.card.state === 0));
      const newCards = newPool.slice(0, input.newLimit);

      // Shuffle reviews too so the order isn't purely by insertion date.
      shuffle(reviewPool);

      let combined = [...reviewPool, ...newCards];

      // Interleave by lemma: round-robin so forms of the same word are spread out.
      if (input.interleave && combined.length > 1) {
        combined = interleaveByLemma(combined);
      }

      session = combined.slice(0, input.limit);
    }

    if (session.length === 0) return [];

    // Batch-fetch all morph forms for the lemmas in the final session set.
    const lemmaIds = [...new Set(session.map((r) => r.lemmaId).filter((id): id is string => id != null))];
    const allForms = lemmaIds.length > 0
      ? db
          .select({
            id: morphForms.id,
            lemmaId: morphForms.lemmaId,
            orth: morphForms.orth,
            tag: morphForms.tag,
            audioPath: morphForms.audioPath,
          })
          .from(morphForms)
          .where(inArray(morphForms.lemmaId, lemmaIds))
          .all()
      : [];

    // Build lookups: `${lemmaId}::${tag}` → orth[] and → first form with audio info
    const formsByKey = new Map<string, string[]>();
    const formInfoByKey = new Map<string, { id: string; orth: string; tag: string; audioPath: string | null }>();
    for (const f of allForms) {
      const key = `${f.lemmaId}::${f.tag}`;
      const existing = formsByKey.get(key);
      if (existing !== undefined) existing.push(f.orth);
      else formsByKey.set(key, [f.orth]);
      // Store first form info for audio lookup
      if (!formInfoByKey.has(key)) {
        formInfoByKey.set(key, { id: f.id, orth: f.orth, tag: f.tag, audioPath: f.audioPath });
      }
    }

    // Batch-fetch lemma image paths + lemma text (for citation-form audio lookup)
    const lemmaImagePaths = new Map<string, string | null>();
    const lemmaImagePrompts = new Map<string, string | null>();
    const lemmaAudioByLemmaId = new Map<string, string | null>();
    const lemmaFormIdByLemmaId = new Map<string, string | null>();
    const lemmaCitationTag = new Map<string, string>();
    if (lemmaIds.length > 0) {
      const lemmaRows = db
        .select({ id: lemmas.id, imagePath: lemmas.imagePath, imagePrompt: lemmas.imagePrompt, lemma: lemmas.lemma })
        .from(lemmas)
        .where(inArray(lemmas.id, lemmaIds))
        .all();
      for (const row of lemmaRows) {
        lemmaImagePaths.set(row.id, row.imagePath);
        lemmaImagePrompts.set(row.id, row.imagePrompt);
        // Find the first morph form whose orth matches the citation form (for ID, regardless of audio)
        const citationFormForId = allForms.find(
          (f) => f.lemmaId === row.id && f.orth === row.lemma,
        );
        lemmaFormIdByLemmaId.set(row.id, citationFormForId?.id ?? null);
        lemmaCitationTag.set(row.id, citationFormForId?.tag ?? "");
        // Find the first morph form whose orth matches the citation form and has audio
        const citationForm = allForms.find(
          (f) => f.lemmaId === row.id && f.orth === row.lemma && f.audioPath != null,
        );
        lemmaAudioByLemmaId.set(row.id, citationForm?.audioPath ?? null);
      }
    }

    // ----------------------------------------------------------------
    // Batch fetches for new card kinds (cloze_fill, multiple_choice,
    // error_correction, classify)
    // ----------------------------------------------------------------
    const newKindCards = session.filter((r) =>
      r.card.kind === "cloze_fill" ||
      r.card.kind === "multiple_choice" ||
      r.card.kind === "error_correction" ||
      r.card.kind === "classify"
    );

    // Map noteId → {sentenceId, conceptId, explanation} for new-kind notes
    const newKindNoteIds = [...new Set(newKindCards.map((r) => r.card.noteId))];
    type NewKindNoteMeta = { sentenceId: string | null; conceptId: string | null; explanation: string | null };
    const noteMetaById = new Map<string, NewKindNoteMeta>();
    if (newKindNoteIds.length > 0) {
      const noteRows = db
        .select({ id: notes.id, sentenceId: notes.sentenceId, conceptId: notes.conceptId, explanation: notes.explanation })
        .from(notes)
        .where(inArray(notes.id, newKindNoteIds))
        .all();
      for (const n of noteRows) {
        noteMetaById.set(n.id, { sentenceId: n.sentenceId, conceptId: n.conceptId, explanation: n.explanation });
      }
    }

    // Batch-fetch sentences
    const sentenceIds = [...new Set(
      newKindCards
        .map((r) => noteMetaById.get(r.card.noteId)?.sentenceId)
        .filter((id): id is string => id != null)
    )];
    const sentenceTextById = new Map<string, string>();
    if (sentenceIds.length > 0) {
      const sentenceRows = db.select({ id: sentences.id, text: sentences.text })
        .from(sentences)
        .where(inArray(sentences.id, sentenceIds))
        .all();
      for (const s of sentenceRows) {
        sentenceTextById.set(s.id, s.text);
      }
    }

    // Batch-fetch cloze_gaps (for cloze_fill cards)
    const clozeNoteIds = [...new Set(
      session.filter((r) => r.card.kind === "cloze_fill").map((r) => r.card.noteId)
    )];
    // Map noteId → gap[] (sorted by gapIndex)
    const clozeGapsByNoteId = new Map<string, Array<{ gapIndex: number; hint: string | null; correctAnswers: string[]; explanation: string | null }>>();
    if (clozeNoteIds.length > 0) {
      const gapRows = db.select().from(clozeGaps)
        .where(inArray(clozeGaps.noteId, clozeNoteIds))
        .all();
      for (const g of gapRows) {
        const existing = clozeGapsByNoteId.get(g.noteId);
        const gap = {
          gapIndex: g.gapIndex,
          hint: g.hint,
          correctAnswers: JSON.parse(g.correctAnswers) as string[],
          explanation: g.explanation,
        };
        if (existing !== undefined) existing.push(gap);
        else clozeGapsByNoteId.set(g.noteId, [gap]);
      }
    }

    // Batch-fetch choice_options (for multiple_choice cards)
    const choiceNoteIds = [...new Set(
      session.filter((r) => r.card.kind === "multiple_choice").map((r) => r.card.noteId)
    )];
    type ChoiceOptRow = { id: string; optionText: string; isCorrect: boolean; explanation: string | null };
    const choiceOptionsByNoteId = new Map<string, ChoiceOptRow[]>();
    if (choiceNoteIds.length > 0) {
      const optRows = db.select().from(choiceOptions)
        .where(inArray(choiceOptions.noteId, choiceNoteIds))
        .all();
      for (const o of optRows) {
        const existing = choiceOptionsByNoteId.get(o.noteId);
        const opt: ChoiceOptRow = { id: o.id, optionText: o.optionText, isCorrect: o.isCorrect, explanation: o.explanation };
        if (existing !== undefined) existing.push(opt);
        else choiceOptionsByNoteId.set(o.noteId, [opt]);
      }
    }

    // Batch-fetch concepts for classify cards (siblings by parentId)
    const classifyNoteIds = [...new Set(
      session.filter((r) => r.card.kind === "classify").map((r) => r.card.noteId)
    )];
    // Map noteId → classifyOptions[]
    const classifyOptionsByNoteId = new Map<string, Array<{ id: string; name: string; isCorrect: boolean }>>();
    if (classifyNoteIds.length > 0) {
      // Collect conceptIds for all classifier notes
      const conceptIds = [...new Set(
        classifyNoteIds
          .map((nid) => noteMetaById.get(nid)?.conceptId)
          .filter((id): id is string => id != null)
      )];
      if (conceptIds.length > 0) {
        // Fetch the correct concepts to get their parentIds
        const correctConceptRows = db.select().from(grammarConcepts)
          .where(inArray(grammarConcepts.id, conceptIds))
          .all();
        const conceptById = new Map(correctConceptRows.map((c) => [c.id, c]));

        // Collect parentIds (skip root concepts — already validated at creation time)
        const parentIds = [...new Set(
          correctConceptRows.map((c) => c.parentId).filter((pid): pid is string => pid != null)
        )];

        // Fetch all siblings (children of the same parent)
        const siblingRows = parentIds.length > 0
          ? db.select().from(grammarConcepts)
              .where(inArray(grammarConcepts.parentId, parentIds))
              .all()
          : [];

        // Group siblings by parentId
        const siblingsByParentId = new Map<string, typeof siblingRows>();
        for (const s of siblingRows) {
          if (!s.parentId) continue;
          const g = siblingsByParentId.get(s.parentId);
          if (g !== undefined) g.push(s);
          else siblingsByParentId.set(s.parentId, [s]);
        }

        // Build classifyOptions for each classifier note
        for (const noteId of classifyNoteIds) {
          const meta = noteMetaById.get(noteId);
          if (!meta?.conceptId) continue;
          const correctConcept = conceptById.get(meta.conceptId);
          if (!correctConcept?.parentId) continue;
          const siblings = siblingsByParentId.get(correctConcept.parentId) ?? [];
          const options = siblings.map((s) => ({ id: s.id, name: s.name, isCorrect: s.id === meta.conceptId }));
          shuffle(options);
          classifyOptionsByNoteId.set(noteId, options);
        }
      }
    }

    const now = new Date(nowSecs * 1000);
    const baseUrl = getMediaBaseUrl();

    // Lazy TTS generation for morph_form cards missing audio
    const audioGenerationPromises: Array<Promise<void>> = [];
    for (const r of session) {
      if (r.card.kind !== "morph_form" || !r.lemmaId || !r.card.tag) continue;
      const key = `${r.lemmaId}::${r.card.tag}`;
      const formInfo = formInfoByKey.get(key);
      if (!formInfo || formInfo.audioPath != null) continue;

      // Queue lazy TTS generation (fire-and-forget, update DB in background)
      const capturedFormInfo = formInfo;
      audioGenerationPromises.push(
        generateAudio(capturedFormInfo.orth, capturedFormInfo.tag, tagGender(capturedFormInfo.tag))
          .then((audioPath) => {
            if (audioPath) {
              db.update(morphForms)
                .set({ audioPath })
                .where(eq(morphForms.id, capturedFormInfo.id))
                .run();
              capturedFormInfo.audioPath = audioPath;
            }
          })
          .catch((err) => {
            console.warn(`[media] TTS generation failed for "${capturedFormInfo.orth}":`, err);
          }),
      );
    }

    // Wait for all TTS generation to complete so URLs are available in the response
    if (audioGenerationPromises.length > 0) {
      await Promise.allSettled(audioGenerationPromises);
    }

    return session.map((r) => {
      let front = r.front;
      let back = r.back;

      // For gloss cards, populate front/back from lemma text + translation
      if (r.card.kind === "gloss_forward") {
        front = r.lemmaText;   // Polish word
        back = r.back;         // translation
      } else if (r.card.kind === "gloss_reverse") {
        front = r.back;        // translation
        back = r.lemmaText;    // Polish word
      }

      // Compute projected next-due dates for each rating
      const domainCard: Card = {
        id: r.card.id,
        noteId: r.card.noteId,
        kind: r.card.kind as Card["kind"],
        state: r.card.state as CardState,
        due: new Date(r.card.due * 1000),
        stability: r.card.stability,
        difficulty: r.card.difficulty,
        elapsedDays: r.card.elapsedDays,
        scheduledDays: r.card.scheduledDays,
        reps: r.card.reps,
        lapses: r.card.lapses,
        learningSteps: r.card.learningSteps,
        ...(r.card.tag != null ? { tag: r.card.tag } : {}),
        ...(r.card.lastReview != null ? { lastReview: new Date(r.card.lastReview * 1000) } : {}),
      };
      const dates = getNextReviewDates(domainCard, now);

      // Resolve media URLs
      const formKey = r.lemmaId && r.card.tag ? `${r.lemmaId}::${r.card.tag}` : null;
      const formInfo = formKey ? formInfoByKey.get(formKey) : undefined;
      const audioPath = formInfo?.audioPath ?? null;
      const imagePath = r.lemmaId ? lemmaImagePaths.get(r.lemmaId) ?? null : null;

      // Populate new-kind fields
      const noteMeta = noteMetaById.get(r.card.noteId);
      let sentenceText: string | null = null;
      let clozeGapsOut: Array<{ gapIndex: number; hint: string | null; correctAnswers: string[]; explanation: string | null }> | null = null;
      let choiceOptionsOut: Array<{ id: string; optionText: string; isCorrect: boolean; explanation: string | null }> | null = null;
      let classifyOptionsOut: Array<{ id: string; name: string; isCorrect: boolean }> | null = null;
      const noteExplanation = noteMeta?.explanation ?? null;

      if (r.card.kind === "cloze_fill") {
        const sid = noteMeta?.sentenceId;
        sentenceText = sid ? (sentenceTextById.get(sid) ?? null) : null;
        clozeGapsOut = clozeGapsByNoteId.get(r.card.noteId) ?? null;
      } else if (r.card.kind === "multiple_choice") {
        const opts = choiceOptionsByNoteId.get(r.card.noteId);
        if (opts) {
          const shuffled = [...opts];
          shuffle(shuffled);
          choiceOptionsOut = shuffled;
        }
      } else if (r.card.kind === "classify") {
        const sid = noteMeta?.sentenceId;
        sentenceText = sid ? (sentenceTextById.get(sid) ?? null) : null;
        classifyOptionsOut = classifyOptionsByNoteId.get(r.card.noteId) ?? null;
      }

      return {
        ...mapCardRow(r.card),
        formId: formInfo?.id ?? null,
        lemmaFormId: r.lemmaId ? (lemmaFormIdByLemmaId.get(r.lemmaId) ?? null) : null,
        lemmaId: r.lemmaId ?? null,
        lemmaText: r.lemmaText,
        front,
        back,
        forms: r.lemmaId && r.card.tag
          ? formsByKey.get(`${r.lemmaId}::${r.card.tag}`) ?? []
          : [],
        audioUrl: audioPath ? `${baseUrl}/${audioPath}` : null,
        lemmaAudioUrl: r.lemmaId
          ? (() => { const p = lemmaAudioByLemmaId.get(r.lemmaId!); return p ? `${baseUrl}/${p}` : null; })()
          : null,
        imageUrl: imagePath ? `${baseUrl}/${imagePath}` : null,
        imagePrompt: r.lemmaId
          ? lemmaImagePrompts.get(r.lemmaId) ?? null
          : null,
        nextDates: {
          again: dates[Rating.Again].toISOString(),
          hard: dates[Rating.Hard].toISOString(),
          good: dates[Rating.Good].toISOString(),
          easy: dates[Rating.Easy].toISOString(),
        },
        sentenceText,
        clozeGaps: clozeGapsOut,
        choiceOptions: choiceOptionsOut,
        classifyOptions: classifyOptionsOut,
        noteExplanation,
      };
    });
  });

const sessionReview = os
  .route({
    method: "POST",
    path: "/session/review",
    tags: ["Session"],
    summary: "Record a review",
    description:
      "Submits a review rating for a card. The FSRS algorithm computes the next " +
      "due date and updates the card's stability and difficulty. The review event is logged " +
      "for retention analytics.",
  })
  .input(z.object({
    cardId: zId.describe("ID of the card being reviewed"),
    rating: z.nativeEnum(Rating).describe(
      "Review outcome: 1 = Again (forgot), 2 = Hard (correct but difficult), " +
      "3 = Good (correct), 4 = Easy (too easy)",
    ),
  }))
  .output(z.object({
    reviewId: zId.describe("ID of the newly created review record"),
    updated: CardOutput.describe("The card with its updated FSRS state"),
  }))
  .handler(async ({ input }) => {
    const [row] = await db
      .select()
      .from(cards)
      .where(eq(cards.id, input.cardId))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: `Card not found: ${input.cardId}`,
      });
    }

    const now = new Date();
    const dueDateBefore = new Date(row.due * 1000);

    const card: Card = {
      id: row.id,
      noteId: row.noteId,
      kind: row.kind as Card["kind"],
      state: row.state as CardState,
      due: dueDateBefore,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsedDays: row.elapsedDays,
      scheduledDays: row.scheduledDays,
      reps: row.reps,
      lapses: row.lapses,
      learningSteps: row.learningSteps,
      ...(row.tag != null ? { tag: row.tag } : {}),
      ...(row.lastReview != null ? { lastReview: new Date(row.lastReview * 1000) } : {}),
    };

    const updated = scheduleReview(card, input.rating, now);

    await db
      .update(cards)
      .set({
        state: updated.state,
        due: Math.floor(updated.due.getTime() / 1000),
        stability: updated.stability,
        difficulty: updated.difficulty,
        elapsedDays: updated.elapsedDays,
        scheduledDays: updated.scheduledDays,
        reps: updated.reps,
        lapses: updated.lapses,
        learningSteps: updated.learningSteps,
        lastReview: updated.lastReview
          ? Math.floor(updated.lastReview.getTime() / 1000)
          : null,
      })
      .where(eq(cards.id, input.cardId));

    const nowSecs = Math.floor(now.getTime() / 1000);

    const reviewId = crypto.randomUUID();
    await db.insert(reviews).values({
      id: reviewId,
      cardId: input.cardId,
      rating: input.rating,
      stateBefore: card.state,
      due: Math.floor(dueDateBefore.getTime() / 1000),
      reviewedAt: nowSecs,
      elapsedDays: updated.elapsedDays,
      scheduledDays: updated.scheduledDays,
      stabilityAfter: updated.stability,
      difficultyAfter: updated.difficulty,
    });

    // Update the parent note's last-reviewed timestamp.
    await db
      .update(notes)
      .set({ lastReviewedAt: nowSecs })
      .where(eq(notes.id, row.noteId));

    return {
      reviewId,
      updated: mapCardDomain(updated),
    };
  });

// ---------------------------------------------------------------------------
// Stats procedure
// ---------------------------------------------------------------------------

const statsOverview = os
  .route({
    method: "GET",
    path: "/stats",
    tags: ["Stats"],
    summary: "Overview statistics",
    description: "Returns aggregate counts for quick dashboard display.",
  })
  .input(z.object({}))
  .output(StatsOutput)
  .handler(async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const [lemmaResult] = await db.select({ value: count() }).from(lemmas);
    const [listResult] = await db.select({ value: count() }).from(vocabLists);
    const [dueResult] = await db
      .select({ value: count() })
      .from(cards)
      .where(lte(cards.due, nowSecs));
    const [draftResult] = await db
      .select({ value: count() })
      .from(notes)
      .where(and(
        inArray(notes.kind, ["cloze", "choice", "error", "classifier"]),
        eq(notes.status, "draft"),
      ));

    return {
      lemmaCount: lemmaResult?.value ?? 0,
      listCount: listResult?.value ?? 0,
      dueCount: dueResult?.value ?? 0,
      draftCount: draftResult?.value ?? 0,
    };
  });

// ---------------------------------------------------------------------------
// Import procedures
// ---------------------------------------------------------------------------

const importPreview = os
  .route({
    method: "POST",
    path: "/import/text/preview",
    tags: ["Import"],
    summary: "Preview text import candidates",
    description:
      "Tokenises Polish text via Morfeusz2, filters stopwords, and returns candidate lemmas " +
      "with ambiguity and existence flags. Does not modify the database.",
  })
  .input(ImportTextInput)
  .output(
    z.object({
      candidates: z.array(ImportCandidateOutput),
      unknownTokens: z.array(z.string()).describe("Tokens that Morfeusz2 could not analyse"),
    }),
  )
  .handler(async ({ input }) => {
    const { candidates, unknownTokens } = await analyseImportText(input.text);
    const withExists = await Promise.all(
      candidates.map(async (c) => {
        const [row] = await db
          .select({ id: lemmas.id })
          .from(lemmas)
          .where(eq(lemmas.lemma, c.lemma))
          .limit(1);
        return { ...c, alreadyExists: row !== undefined };
      }),
    );
    return { candidates: withExists, unknownTokens };
  });

const importCommit = os
  .route({
    method: "POST",
    path: "/import/text",
    tags: ["Import"],
    summary: "Import lemmas from text",
    description:
      "Tokenises Polish text, filters stopwords, then commits non-duplicate lemmas to the database. " +
      "Multi-word expressions are imported with source=manual; single words with source=morfeusz " +
      "(Morfeusz2 will generate their inflected forms). Ambiguous candidates are skipped by default. " +
      "Pass includeLemmas with the lemmas the user selected from a preview to resolve ambiguity.",
  })
  .input(
    ImportTextInput.extend({
      skipAmbiguous: z
        .boolean()
        .default(true)
        .describe("Skip ambiguous candidates (default: true). Set false to commit all candidates."),
      includeLemmas: z
        .array(z.string())
        .optional()
        .describe(
          "Explicit list of lemma strings to commit even if ambiguous. " +
          "Use this to resolve ambiguity after a preview: pass the lemma(s) the user selected. " +
          "Takes precedence over skipAmbiguous for matching candidates.",
        ),
    }),
  )
  .output(
    z.object({
      created: z.array(
        z.object({
          lemmaId: z.string().uuid(),
          lemma: z.string(),
          pos: z.string(),
          source: zSource,
        }),
      ),
      skipped: z.array(
        z.object({
          lemma: z.string(),
          reason: z.enum(["already_exists", "ambiguous"]),
        }),
      ),
      unknownTokens: z.array(z.string()),
    }),
  )
  .handler(async ({ input }) => {
    const { candidates, unknownTokens } = await analyseImportText(input.text);

    const created: Array<{ lemmaId: string; lemma: string; pos: string; source: "morfeusz" | "manual" }> = [];
    const skipped: Array<{ lemma: string; reason: "already_exists" | "ambiguous" }> = [];

    for (const c of candidates) {
      // Check if already in DB
      const [existing] = await db
        .select({ id: lemmas.id })
        .from(lemmas)
        .where(eq(lemmas.lemma, c.lemma))
        .limit(1);
      if (existing !== undefined) {
        skipped.push({ lemma: c.lemma, reason: "already_exists" });
        continue;
      }

      // Skip ambiguous unless this lemma was explicitly selected by the user.
      const explicitlyIncluded = input.includeLemmas?.includes(c.lemma) ?? false;
      if (c.ambiguous && input.skipAmbiguous && !explicitlyIncluded) {
        skipped.push({ lemma: c.lemma, reason: "ambiguous" });
        continue;
      }

      const source: "morfeusz" | "manual" = c.isMultiWord ? "manual" : "morfeusz";
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(lemmas).values({
        id,
        lemma: c.lemma,
        pos: c.pos,
        source,
        notes: null,
        createdAt: now,
        updatedAt: now,
      });

      if (source === "morfeusz") {
        const noteId = await createMorphNoteAndCards(id, c.lemma, now);
        if (input.listId !== undefined) {
          await db.insert(vocabListNotes).values({ listId: input.listId, noteId });
        }

        // Fire-and-forget image generation — mirrors lemmasCreate behaviour.
        // Swallows failures (rate-limit, network) so the import response is
        // never blocked by media generation.
        const citationForm = db
          .select({ tag: morphForms.tag })
          .from(morphForms)
          .where(and(eq(morphForms.lemmaId, id), eq(morphForms.orth, c.lemma)))
          .limit(1)
          .get();
        const citationTag = citationForm?.tag ?? "";
        generateImage(c.lemma, citationTag).then((result) => {
          if (result.relativePath || result.imagePrompt) {
            db.update(lemmas).set({
              ...(result.relativePath ? { imagePath: result.relativePath } : {}),
              ...(result.imagePrompt ? { imagePrompt: result.imagePrompt } : {}),
            }).where(eq(lemmas.id, id)).run();
          }
        }).catch((err) => {
          console.warn(`[media] Import image generation failed for "${c.lemma}":`, err);
        });
      } else {
        // Manual source: create a morph note (with no forms)
        const noteId = crypto.randomUUID();
        await db.insert(notes).values({
          id: noteId,
          kind: "morph",
          lemmaId: id,
          front: null,
          back: null,
          createdAt: now,
          updatedAt: now,
        });
        if (input.listId !== undefined) {
          await db.insert(vocabListNotes).values({ listId: input.listId, noteId });
        }
      }

      created.push({ lemmaId: id, lemma: c.lemma, pos: c.pos, source });
    }

    return { created, skipped, unknownTokens };
  });

// ---------------------------------------------------------------------------
// Grammar Concepts procedures
// ---------------------------------------------------------------------------

const grammarConceptsList = os
  .route({
    method: "GET",
    path: "/grammar-concepts",
    tags: ["Grammar Concepts"],
    summary: "List grammar concepts",
    description: "Returns root concepts when parentId is omitted; direct children when parentId is provided.",
  })
  .input(z.object({
    parentId: zId.optional().describe("Filter to direct children of this concept; omit for root concepts"),
  }))
  .output(z.array(GrammarConceptOutput))
  .handler(async ({ input }) => {
    const rows = input.parentId
      ? db.select().from(grammarConcepts).where(eq(grammarConcepts.parentId, input.parentId)).all()
      : db.select().from(grammarConcepts).where(isNull(grammarConcepts.parentId)).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      parentId: r.parentId,
      createdAt: r.createdAt.toISOString(),
    }));
  });

const grammarConceptsCreate = os
  .route({
    method: "POST",
    path: "/grammar-concepts",
    tags: ["Grammar Concepts"],
    summary: "Create a grammar concept",
  })
  .input(z.object({
    name: z.string().min(1).describe("Concept name"),
    description: z.string().optional().describe("Optional explanation"),
    parentId: zId.optional().describe("Parent concept ID; omit for a root concept"),
  }))
  .output(GrammarConceptOutput)
  .handler(async ({ input }) => {
    if (input.parentId) {
      const [parent] = db.select({ id: grammarConcepts.id }).from(grammarConcepts)
        .where(eq(grammarConcepts.id, input.parentId)).limit(1).all();
      if (!parent) throw new ORPCError("NOT_FOUND", { message: `Parent concept not found: ${input.parentId}` });
    }
    const id = crypto.randomUUID();
    const now = new Date();
    db.insert(grammarConcepts).values({
      id,
      name: input.name,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      createdAt: now,
    }).run();
    return { id, name: input.name, description: input.description ?? null, parentId: input.parentId ?? null, createdAt: now.toISOString() };
  });

const grammarConceptsGet = os
  .route({
    method: "GET",
    path: "/grammar-concepts/{id}",
    tags: ["Grammar Concepts"],
    summary: "Get a grammar concept",
  })
  .input(z.object({ id: zId }))
  .output(GrammarConceptOutput)
  .handler(async ({ input }) => {
    const [row] = db.select().from(grammarConcepts).where(eq(grammarConcepts.id, input.id)).limit(1).all();
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Grammar concept not found: ${input.id}` });
    return { id: row.id, name: row.name, description: row.description, parentId: row.parentId, createdAt: row.createdAt.toISOString() };
  });

const grammarConceptsChildren = os
  .route({
    method: "GET",
    path: "/grammar-concepts/{id}/children",
    tags: ["Grammar Concepts"],
    summary: "Get direct children of a grammar concept",
  })
  .input(z.object({ id: zId }))
  .output(z.array(GrammarConceptOutput))
  .handler(async ({ input }) => {
    const [parent] = db.select({ id: grammarConcepts.id }).from(grammarConcepts)
      .where(eq(grammarConcepts.id, input.id)).limit(1).all();
    if (!parent) throw new ORPCError("NOT_FOUND", { message: `Grammar concept not found: ${input.id}` });
    const rows = db.select().from(grammarConcepts).where(eq(grammarConcepts.parentId, input.id)).all();
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, parentId: r.parentId, createdAt: r.createdAt.toISOString() }));
  });

// ---------------------------------------------------------------------------
// Sentences procedures
// ---------------------------------------------------------------------------

function mapSentence(row: typeof sentences.$inferSelect): z.infer<typeof SentenceOutput> {
  return {
    id: row.id,
    text: row.text,
    translation: row.translation,
    source: row.source,
    difficulty: row.difficulty,
    createdAt: row.createdAt.toISOString(),
  };
}

const sentencesList = os
  .route({
    method: "GET",
    path: "/sentences",
    tags: ["Sentences"],
    summary: "List sentences",
    description: "Returns sentences, optionally filtered by grammar concept and/or difficulty.",
  })
  .input(z.object({
    conceptId: zId.optional().describe("Filter to sentences tagged with this grammar concept"),
    difficulty: z.coerce.number().int().min(1).max(5).optional().describe("Filter by difficulty level"),
    limit: z.coerce.number().int().min(1).max(500).default(50).describe("Max results (default: 50)"),
  }))
  .output(z.array(SentenceOutput))
  .handler(async ({ input }) => {
    if (input.conceptId) {
      const rows = db
        .select({ sentence: sentences })
        .from(sentences)
        .innerJoin(sentenceConcepts, eq(sentenceConcepts.sentenceId, sentences.id))
        .where(and(
          eq(sentenceConcepts.conceptId, input.conceptId),
          ...(input.difficulty !== undefined ? [eq(sentences.difficulty, input.difficulty)] : []),
        ))
        .limit(input.limit)
        .all();
      return rows.map((r) => mapSentence(r.sentence));
    }
    const conditions = input.difficulty !== undefined ? [eq(sentences.difficulty, input.difficulty)] : [];
    const rows = conditions.length > 0
      ? db.select().from(sentences).where(and(...conditions)).limit(input.limit).all()
      : db.select().from(sentences).limit(input.limit).all();
    return rows.map(mapSentence);
  });

const sentencesCreate = os
  .route({
    method: "POST",
    path: "/sentences",
    tags: ["Sentences"],
    summary: "Create a sentence",
    description: "Creates a sentence and optionally tags it with grammar concepts.",
  })
  .input(z.object({
    text: z.string().min(3).describe("Sentence text; may contain {{N}} gap markers for cloze use"),
    translation: z.string().optional().describe("English translation"),
    source: z.string().default("handcrafted").describe("Provenance (default: handcrafted)"),
    difficulty: z.number().int().min(1).max(5).optional().describe("Difficulty 1–5"),
    conceptIds: z.array(zId).optional().describe("Grammar concepts to tag this sentence with"),
  }))
  .output(SentenceOutput)
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();
    db.insert(sentences).values({
      id,
      text: input.text,
      translation: input.translation ?? null,
      source: input.source,
      difficulty: input.difficulty ?? null,
      createdAt: now,
    }).run();
    if (input.conceptIds && input.conceptIds.length > 0) {
      for (const conceptId of input.conceptIds) {
        db.insert(sentenceConcepts).values({ sentenceId: id, conceptId }).run();
      }
    }
    return { id, text: input.text, translation: input.translation ?? null, source: input.source, difficulty: input.difficulty ?? null, createdAt: now.toISOString() };
  });

const sentencesGet = os
  .route({
    method: "GET",
    path: "/sentences/{id}",
    tags: ["Sentences"],
    summary: "Get a sentence",
  })
  .input(z.object({ id: zId }))
  .output(SentenceOutput)
  .handler(async ({ input }) => {
    const [row] = db.select().from(sentences).where(eq(sentences.id, input.id)).limit(1).all();
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Sentence not found: ${input.id}` });
    return mapSentence(row);
  });

// ---------------------------------------------------------------------------
// Notes procedures
// ---------------------------------------------------------------------------

/** Helper to insert a card row from a createCard() result. */
function insertCardValues(cardData: Omit<import("@rzyns/strus-core").Card, "id">) {
  return {
    id: crypto.randomUUID(),
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

const notesCreate = os
  .route({
    method: "POST",
    path: "/notes",
    tags: ["Notes"],
    summary: "Create a note",
    description:
      "Creates a note. kind='basic' (default) creates a basic_forward card. " +
      "kind='gloss' requires lemmaId + back (translation) and creates gloss_forward + gloss_reverse cards.",
  })
  .input(z.object({
    kind: z.enum(["basic", "gloss"]).default("basic").describe("Note kind: basic (default) or gloss"),
    front: z.string().min(1).optional().describe("Prompt text — required for basic, ignored for gloss"),
    back: z.string().min(1).optional().describe("Answer/translation text — required for both basic and gloss"),
    lemmaId: z.string().uuid().optional().describe("Lemma ID — required for gloss notes"),
    listId: z.string().uuid().optional().describe("Vocabulary list to add this note to"),
  }))
  .output(NoteOutput)
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();

    if (input.kind === "gloss") {
      if (!input.lemmaId) {
        throw new ORPCError("BAD_REQUEST", { message: "lemmaId is required for gloss notes" });
      }
      if (!input.back) {
        throw new ORPCError("BAD_REQUEST", { message: "back (translation) is required for gloss notes" });
      }

      // Verify lemma exists
      const [lemmaRow] = db.select().from(lemmas).where(eq(lemmas.id, input.lemmaId)).limit(1).all();
      if (!lemmaRow) {
        throw new ORPCError("NOT_FOUND", { message: `Lemma not found: ${input.lemmaId}` });
      }

      await db.insert(notes).values({
        id,
        kind: "gloss",
        lemmaId: input.lemmaId,
        front: null,
        back: input.back,
        createdAt: now,
        updatedAt: now,
      });

      // Create both gloss_forward and gloss_reverse cards
      await db.insert(cards).values(insertCardValues(createCard(id, "gloss_forward")));
      await db.insert(cards).values(insertCardValues(createCard(id, "gloss_reverse")));

      if (input.listId) {
        await db.insert(vocabListNotes).values({ listId: input.listId, noteId: id });
      }

      return mapNote({
        id,
        kind: "gloss",
        lemmaId: input.lemmaId,
        front: null,
        back: input.back,
        lastReviewedAt: null,
        sentenceId: null,
        conceptId: null,
        clusterId: null,
        explanation: null,
        status: "approved",
        generationMeta: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Default: basic note
    if (!input.front) {
      throw new ORPCError("BAD_REQUEST", { message: "front is required for basic notes" });
    }
    if (!input.back) {
      throw new ORPCError("BAD_REQUEST", { message: "back is required for basic notes" });
    }

    await db.insert(notes).values({
      id,
      kind: "basic",
      lemmaId: null,
      front: input.front,
      back: input.back,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(cards).values(insertCardValues(createCard(id, "basic_forward")));

    if (input.listId) {
      await db.insert(vocabListNotes).values({ listId: input.listId, noteId: id });
    }

    return mapNote({
      id,
      kind: "basic",
      lemmaId: null,
      front: input.front,
      back: input.back,
      lastReviewedAt: null,
      sentenceId: null,
      conceptId: null,
      clusterId: null,
      explanation: null,
      status: "approved",
      generationMeta: null,
      createdAt: now,
      updatedAt: now,
    });
  });

const notesList = os
  .route({
    method: "GET",
    path: "/notes",
    tags: ["Notes"],
    summary: "List notes",
    description: "Returns all notes, optionally filtered by kind, vocabulary list, and/or lemma.",
  })
  .input(z.object({
    kind: z.enum(["morph", "gloss", "basic", "cloze", "choice", "error", "classifier"]).optional().describe("Filter by note kind"),
    listId: z.string().uuid().optional().describe("Filter to notes in this vocabulary list"),
    lemmaId: z.string().uuid().optional().describe("Filter to notes associated with this lemma"),
    status: z.enum(["draft", "flagged", "approved", "rejected"]).optional().describe("Filter by moderation status"),
  }))
  .output(z.array(NoteOutput))
  .handler(async ({ input }) => {
    // Build WHERE conditions
    const conditions = [];
    if (input.kind) conditions.push(eq(notes.kind, input.kind));
    if (input.lemmaId) conditions.push(eq(notes.lemmaId, input.lemmaId));
    if (input.status) conditions.push(eq(notes.status, input.status));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    if (input.listId) {
      const q = db
        .select({ note: notes, lemmaText: lemmas.lemma, sentenceText: sentences.text })
        .from(notes)
        .leftJoin(lemmas, eq(lemmas.id, notes.lemmaId))
        .leftJoin(sentences, eq(sentences.id, notes.sentenceId))
        .innerJoin(
          vocabListNotes,
          and(
            eq(vocabListNotes.noteId, notes.id),
            eq(vocabListNotes.listId, input.listId),
          ),
        );
      const rows = whereClause ? q.where(whereClause).all() : q.all();
      return rows.map((r) => mapNote(r.note, r.lemmaText ?? null, r.sentenceText ?? null));
    }

    const rows = whereClause
      ? db.select({ note: notes, lemmaText: lemmas.lemma, sentenceText: sentences.text }).from(notes).leftJoin(lemmas, eq(lemmas.id, notes.lemmaId)).leftJoin(sentences, eq(sentences.id, notes.sentenceId)).where(whereClause).all()
      : db.select({ note: notes, lemmaText: lemmas.lemma, sentenceText: sentences.text }).from(notes).leftJoin(lemmas, eq(lemmas.id, notes.lemmaId)).leftJoin(sentences, eq(sentences.id, notes.sentenceId)).all();
    return rows.map((r) => mapNote(r.note, r.lemmaText ?? null, r.sentenceText ?? null));
  });

const notesGet = os
  .route({
    method: "GET",
    path: "/notes/{id}",
    tags: ["Notes"],
    summary: "Get a note with its cards",
  })
  .input(z.object({ id: zId }))
  .output(NoteOutput.extend({
    cards: z.array(CardOutput),
    lemma: z.string().nullable().describe("Lemma text for morph/gloss notes; null for basic notes"),
    gaps: z.array(z.object({
      id: z.string(),
      gapIndex: z.number().int(),
      correctAnswers: z.string().describe("JSON-encoded array of accepted answers"),
      hint: z.string().nullable(),
      explanation: z.string().nullable(),
    })).optional().describe("Gap definitions for cloze notes; undefined for other kinds"),
    options: z.array(z.object({
      id: z.string(),
      optionText: z.string(),
      isCorrect: z.boolean(),
      explanation: z.string().nullable(),
    })).optional().describe("Answer options for choice notes; undefined for other kinds"),
  }))
  .handler(async ({ input }) => {
    const [row] = await db.select().from(notes).where(eq(notes.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Note not found: ${input.id}` });

    const noteCards = db.select().from(cards).where(eq(cards.noteId, input.id)).all();

    let lemmaText: string | null = null;
    if (row.lemmaId) {
      const [lemmaRow] = db.select().from(lemmas).where(eq(lemmas.id, row.lemmaId)).limit(1).all();
      if (lemmaRow) lemmaText = lemmaRow.lemma;
    }

    let sentenceText: string | null = null;
    if (row.sentenceId) {
      const [sentenceRow] = db.select().from(sentences).where(eq(sentences.id, row.sentenceId)).limit(1).all();
      if (sentenceRow) sentenceText = sentenceRow.text;
    }

    let gaps: Array<{ id: string; gapIndex: number; correctAnswers: string; hint: string | null; explanation: string | null }> | undefined;
    if (row.kind === "cloze") {
      gaps = db.select({
        id: clozeGaps.id,
        gapIndex: clozeGaps.gapIndex,
        correctAnswers: clozeGaps.correctAnswers,
        hint: clozeGaps.hint,
        explanation: clozeGaps.explanation,
      }).from(clozeGaps).where(eq(clozeGaps.noteId, input.id)).all();
    }

    let options: Array<{ id: string; optionText: string; isCorrect: boolean; explanation: string | null }> | undefined;
    if (row.kind === "choice") {
      options = db.select({
        id: choiceOptions.id,
        optionText: choiceOptions.optionText,
        isCorrect: choiceOptions.isCorrect,
        explanation: choiceOptions.explanation,
      }).from(choiceOptions).where(eq(choiceOptions.noteId, input.id)).all();
    }

    return {
      ...mapNote(row, lemmaText, sentenceText),
      cards: noteCards.map(mapCardRow),
      lemma: lemmaText,
      gaps,
      options,
    };
  });

const notesDelete = os
  .route({
    method: "DELETE",
    path: "/notes/{id}",
    tags: ["Notes"],
    summary: "Delete a note",
    description: "Deletes a note and all its cards (cascade). Review history for those cards is also removed.",
  })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(notes).where(eq(notes.id, input.id));
    return { success: true as const };
  });

const notesUpdate = os
  .route({
    method: "PATCH",
    path: "/notes/{id}",
    tags: ["Notes"],
    summary: "Update a note",
    description:
      "Updates a basic note (front and/or back) or a gloss note (back/translation only). " +
      "Returns 400 for morph notes.",
  })
  .input(z.object({
    id: zId,
    front: z.string().min(1).optional().describe("New prompt text (basic notes only)"),
    back: z.string().min(1).optional().describe("New answer/translation text"),
  }))
  .output(NoteOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(notes).where(eq(notes.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Note not found: ${input.id}` });

    if (row.kind === "morph") {
      throw new ORPCError("BAD_REQUEST", { message: "Morph notes cannot be edited" });
    }

    if (row.kind === "gloss") {
      if (input.front !== undefined) {
        throw new ORPCError("BAD_REQUEST", { message: "Cannot edit front of a gloss note — front is derived from the lemma" });
      }
      if (input.back === undefined) {
        throw new ORPCError("BAD_REQUEST", { message: "Nothing to update — provide back (translation)" });
      }
    }

    const now = new Date();
    const updates = {
      updatedAt: now,
      ...(input.front !== undefined ? { front: input.front } : {}),
      ...(input.back !== undefined ? { back: input.back } : {}),
    };

    await db.update(notes).set(updates).where(eq(notes.id, input.id));

    return mapNote({
      ...row,
      ...(input.front !== undefined ? { front: input.front } : {}),
      ...(input.back !== undefined ? { back: input.back } : {}),
      updatedAt: now,
    });
  });

// ---------------------------------------------------------------------------
// New note creation procedures (cloze / choice / error / classifier)
// ---------------------------------------------------------------------------

const ClozeNoteOutput = NoteOutput.extend({
  clozeGaps: z.array(z.object({
    id: zId,
    gapIndex: z.number().int(),
    correctAnswers: z.array(z.string()),
    hint: z.string().nullable(),
    explanation: z.string().nullable(),
    difficulty: z.number().int().nullable(),
  })),
});

const ChoiceNoteOutput = NoteOutput.extend({
  choiceOptions: z.array(z.object({
    id: zId,
    optionText: z.string(),
    isCorrect: z.boolean(),
    explanation: z.string().nullable(),
    sortOrder: z.number().int(),
  })),
});

const notesCreateCloze = os
  .route({
    method: "POST",
    path: "/notes/cloze",
    tags: ["Notes"],
    summary: "Create a cloze note",
    description:
      "Creates a cloze note from a sentence. Each gap generates one cloze_fill card. " +
      "Gap markers {{N}} must be present in the sentence text for each gap index.",
  })
  .input(z.object({
    sentenceId: zId.describe("UUID of the sentence this cloze is based on"),
    conceptId: zId.optional().describe("Primary grammar concept this note exercises"),
    explanation: z.string().optional().describe("Shown after answer; general note on the rule"),
    listId: zId.optional(),
    gaps: z.array(z.object({
      gapIndex: z.number().int().min(1).describe("1-based; must match {{N}} marker in sentence text"),
      correctAnswers: z.array(z.string().min(1)).min(1).describe("Accepted answer variants"),
      hint: z.string().optional(),
      conceptId: zId.optional().describe("More specific concept for this gap"),
      difficulty: z.number().int().min(1).max(5).optional(),
      explanation: z.string().optional().describe("Gap-specific rationale; overrides note-level explanation"),
    })).min(1),
  }))
  .output(ClozeNoteOutput)
  .handler(async ({ input }) => {
    // 1. Verify sentence exists
    const [sentence] = db.select().from(sentences).where(eq(sentences.id, input.sentenceId)).limit(1).all();
    if (!sentence) throw new ORPCError("NOT_FOUND", { message: `Sentence not found: ${input.sentenceId}` });

    // 2. Validate gap markers exist in sentence text
    for (const gap of input.gaps) {
      const marker = `{{${gap.gapIndex}}}`;
      if (!sentence.text.includes(marker)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Gap marker "${marker}" not found in sentence text: "${sentence.text}"`,
        });
      }
    }

    const id = crypto.randomUUID();
    const now = new Date();

    // 3. Insert note
    db.insert(notes).values({
      id,
      kind: "cloze",
      lemmaId: null,
      front: null,
      back: null,
      sentenceId: input.sentenceId,
      conceptId: input.conceptId ?? null,
      explanation: input.explanation ?? null,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    }).run();

    // 4. Insert gaps and cards
    const insertedGaps: Array<{
      id: string;
      gapIndex: number;
      correctAnswers: string[];
      hint: string | null;
      explanation: string | null;
      difficulty: number | null;
    }> = [];

    for (const gap of input.gaps) {
      const gapId = crypto.randomUUID();
      db.insert(clozeGaps).values({
        id: gapId,
        noteId: id,
        gapIndex: gap.gapIndex,
        correctAnswers: JSON.stringify(gap.correctAnswers),
        hint: gap.hint ?? null,
        conceptId: gap.conceptId ?? null,
        difficulty: gap.difficulty ?? null,
        explanation: gap.explanation ?? null,
        createdAt: now,
      }).run();

      // One card per gap
      const cardData = createCard(id, "cloze_fill");
      db.insert(cards).values({ ...insertCardValues(cardData), id: crypto.randomUUID(), gapId }).run();

      insertedGaps.push({
        id: gapId,
        gapIndex: gap.gapIndex,
        correctAnswers: gap.correctAnswers,
        hint: gap.hint ?? null,
        explanation: gap.explanation ?? null,
        difficulty: gap.difficulty ?? null,
      });
    }

    // 5. Optional list association
    if (input.listId) {
      db.insert(vocabListNotes).values({ listId: input.listId, noteId: id }).run();
    }

    return {
      ...mapNote({
        id,
        kind: "cloze",
        lemmaId: null,
        front: null,
        back: null,
        lastReviewedAt: null,
        sentenceId: input.sentenceId,
        conceptId: input.conceptId ?? null,
        clusterId: null,
        explanation: input.explanation ?? null,
        status: "approved",
        generationMeta: null,
        createdAt: now,
        updatedAt: now,
      }, null, sentence.text),
      clozeGaps: insertedGaps,
    };
  });

const notesCreateChoice = os
  .route({
    method: "POST",
    path: "/notes/choice",
    tags: ["Notes"],
    summary: "Create a multiple-choice note",
    description:
      "Creates a multiple-choice note. At least one option must be marked correct. " +
      "Either front or sentenceId (or both) must be provided.",
  })
  .input(z.object({
    front: z.string().min(1).optional().describe("Question text; required if sentenceId not provided"),
    sentenceId: zId.optional().describe("Source sentence for context; if provided, front may be omitted"),
    conceptId: zId.optional(),
    explanation: z.string().optional().describe("General rationale shown after answer"),
    listId: zId.optional(),
    options: z.array(z.object({
      optionText: z.string().min(1),
      isCorrect: z.boolean(),
      explanation: z.string().optional().describe("Why this option is right or wrong"),
      sortOrder: z.number().int().optional().default(0),
    })).min(2).describe("At least 2 options, at least 1 must be correct"),
  }))
  .output(ChoiceNoteOutput)
  .handler(async ({ input }) => {
    // Validate: need front or sentenceId
    if (!input.front && !input.sentenceId) {
      throw new ORPCError("BAD_REQUEST", { message: "Either front or sentenceId must be provided" });
    }
    // Validate: at least one correct option
    if (!input.options.some((o) => o.isCorrect)) {
      throw new ORPCError("BAD_REQUEST", { message: "At least one option must be marked isCorrect: true" });
    }

    const id = crypto.randomUUID();
    const now = new Date();

    // 1. Insert note
    db.insert(notes).values({
      id,
      kind: "choice",
      lemmaId: null,
      front: input.front ?? null,
      back: null,
      sentenceId: input.sentenceId ?? null,
      conceptId: input.conceptId ?? null,
      explanation: input.explanation ?? null,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    }).run();

    // 2. Insert options
    const insertedOptions: Array<{
      id: string;
      optionText: string;
      isCorrect: boolean;
      explanation: string | null;
      sortOrder: number;
    }> = [];

    for (const opt of input.options) {
      const optId = crypto.randomUUID();
      db.insert(choiceOptions).values({
        id: optId,
        noteId: id,
        optionText: opt.optionText,
        isCorrect: opt.isCorrect,
        explanation: opt.explanation ?? null,
        sortOrder: opt.sortOrder ?? 0,
      }).run();
      insertedOptions.push({
        id: optId,
        optionText: opt.optionText,
        isCorrect: opt.isCorrect,
        explanation: opt.explanation ?? null,
        sortOrder: opt.sortOrder ?? 0,
      });
    }

    // 3. One card for the note
    db.insert(cards).values(insertCardValues(createCard(id, "multiple_choice"))).run();

    // 4. Optional list association
    if (input.listId) {
      db.insert(vocabListNotes).values({ listId: input.listId, noteId: id }).run();
    }

    const sentenceText = input.sentenceId
      ? (db.select({ text: sentences.text }).from(sentences).where(eq(sentences.id, input.sentenceId)).limit(1).all()[0]?.text ?? null)
      : null;

    return {
      ...mapNote({
        id,
        kind: "choice",
        lemmaId: null,
        front: input.front ?? null,
        back: null,
        lastReviewedAt: null,
        sentenceId: input.sentenceId ?? null,
        conceptId: input.conceptId ?? null,
        clusterId: null,
        explanation: input.explanation ?? null,
        status: "approved",
        generationMeta: null,
        createdAt: now,
        updatedAt: now,
      }, null, sentenceText),
      choiceOptions: insertedOptions,
    };
  });

const notesCreateError = os
  .route({
    method: "POST",
    path: "/notes/error",
    tags: ["Notes"],
    summary: "Create an error-correction note",
    description: "Creates an error-correction note. Front is the erroneous text; back is the corrected version.",
  })
  .input(z.object({
    front: z.string().min(1).describe("The erroneous text shown to the user"),
    back: z.string().min(1).describe("The corrected version revealed after answer"),
    sentenceId: zId.optional().describe("Source sentence if applicable"),
    conceptId: zId.optional(),
    explanation: z.string().optional().describe("Why the original was wrong"),
    listId: zId.optional(),
  }))
  .output(NoteOutput)
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();

    // 1. Insert note
    db.insert(notes).values({
      id,
      kind: "error",
      lemmaId: null,
      front: input.front,
      back: input.back,
      sentenceId: input.sentenceId ?? null,
      conceptId: input.conceptId ?? null,
      explanation: input.explanation ?? null,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    }).run();

    // 2. One error_correction card
    db.insert(cards).values(insertCardValues(createCard(id, "error_correction"))).run();

    // 3. Optional list association
    if (input.listId) {
      db.insert(vocabListNotes).values({ listId: input.listId, noteId: id }).run();
    }

    const sentenceText = input.sentenceId
      ? (db.select({ text: sentences.text }).from(sentences).where(eq(sentences.id, input.sentenceId)).limit(1).all()[0]?.text ?? null)
      : null;

    return mapNote({
      id,
      kind: "error",
      lemmaId: null,
      front: input.front,
      back: input.back,
      lastReviewedAt: null,
      sentenceId: input.sentenceId ?? null,
      conceptId: input.conceptId ?? null,
      clusterId: null,
      explanation: input.explanation ?? null,
      status: "approved",
      generationMeta: null,
      createdAt: now,
      updatedAt: now,
    }, null, sentenceText);
  });

const notesCreateClassifier = os
  .route({
    method: "POST",
    path: "/notes/classifier",
    tags: ["Notes"],
    summary: "Create a classifier note",
    description:
      "Creates a classifier note. The user sees the sentence and must classify it into the correct concept. " +
      "The concept must have a parent (siblings are required as wrong options in the quiz).",
  })
  .input(z.object({
    sentenceId: zId.describe("The sentence the user will classify"),
    conceptId: zId.describe("The CORRECT concept classification for this sentence"),
    explanation: z.string().optional(),
    listId: zId.optional(),
  }))
  .output(NoteOutput)
  .handler(async ({ input }) => {
    // Verify sentence exists
    const [sentence] = db.select({ id: sentences.id, text: sentences.text }).from(sentences)
      .where(eq(sentences.id, input.sentenceId)).limit(1).all();
    if (!sentence) throw new ORPCError("NOT_FOUND", { message: `Sentence not found: ${input.sentenceId}` });

    // Verify concept exists and has a parent (siblings required for classify quiz)
    const [concept] = db.select().from(grammarConcepts)
      .where(eq(grammarConcepts.id, input.conceptId)).limit(1).all();
    if (!concept) throw new ORPCError("NOT_FOUND", { message: `Grammar concept not found: ${input.conceptId}` });
    if (!concept.parentId) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Concept "${concept.name}" is a root concept — classifiers require a concept with a parent (for sibling quiz options)`,
      });
    }

    const id = crypto.randomUUID();
    const now = new Date();

    // 1. Insert note
    db.insert(notes).values({
      id,
      kind: "classifier",
      lemmaId: null,
      front: null,
      back: null,
      sentenceId: input.sentenceId,
      conceptId: input.conceptId,
      explanation: input.explanation ?? null,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    }).run();

    // 2. One classify card
    db.insert(cards).values(insertCardValues(createCard(id, "classify"))).run();

    // 3. Optional list association
    if (input.listId) {
      db.insert(vocabListNotes).values({ listId: input.listId, noteId: id }).run();
    }

    return mapNote({
      id,
      kind: "classifier",
      lemmaId: null,
      front: null,
      back: null,
      lastReviewedAt: null,
      sentenceId: input.sentenceId,
      conceptId: input.conceptId,
      clusterId: null,
      explanation: input.explanation ?? null,
      status: "approved",
      generationMeta: null,
      createdAt: now,
      updatedAt: now,
    }, null, sentence.text);
  });

// ---------------------------------------------------------------------------
// Cards procedures
// ---------------------------------------------------------------------------

const ReviewOutput = z.object({
  id: zId,
  rating: z.number().int().describe("Review rating: 1=Again, 2=Hard, 3=Good, 4=Easy"),
  stateBefore: z.number().int().describe("Card state before the review: 0=New, 1=Learning, 2=Review, 3=Relearning"),
  reviewedAt: zIso.describe("When this review was recorded"),
  due: zIso.describe("When the card was due at time of review"),
  elapsedDays: z.number().int().describe("Days elapsed since the previous review"),
  scheduledDays: z.number().int().describe("Days the card was scheduled ahead"),
  stabilityAfter: z.number().describe("FSRS stability after the review"),
  difficultyAfter: z.number().describe("FSRS difficulty after the review"),
});

const cardsGet = os
  .route({
    method: "GET",
    path: "/cards/{id}",
    tags: ["Cards"],
    summary: "Get a card",
  })
  .input(z.object({ id: zId }))
  .output(CardOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(cards).where(eq(cards.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Card not found: ${input.id}` });
    return mapCardRow(row);
  });

const cardsReviews = os
  .route({
    method: "GET",
    path: "/cards/{id}/reviews",
    tags: ["Cards"],
    summary: "Get review history for a card",
    description: "Returns review records for a card, newest first.",
  })
  .input(z.object({
    id: zId.describe("ID of the card"),
    limit: z.coerce.number().int().min(1).max(100).default(20).describe("Maximum number of reviews to return (default: 20)"),
  }))
  .output(z.array(ReviewOutput))
  .handler(async ({ input }) => {
    const rows = db
      .select()
      .from(reviews)
      .where(eq(reviews.cardId, input.id))
      .orderBy(sql`${reviews.reviewedAt} DESC`)
      .limit(input.limit)
      .all();

    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      stateBefore: r.stateBefore,
      reviewedAt: new Date(r.reviewedAt * 1000).toISOString(),
      due: new Date(r.due * 1000).toISOString(),
      elapsedDays: r.elapsedDays,
      scheduledDays: r.scheduledDays,
      stabilityAfter: r.stabilityAfter,
      difficultyAfter: r.difficultyAfter,
    }));
  });

// ---------------------------------------------------------------------------
// Settings procedures
// ---------------------------------------------------------------------------

const settingsGet = os
  .route({
    method: "GET",
    path: "/settings",
    tags: ["Settings"],
    summary: "Get application settings",
  })
  .input(z.object({}))
  .output(z.object({
    imagePromptTemplate: z.string().describe("Current Mustache template for image prompt generation"),
    imagePromptTemplateDefault: z.string().describe("Factory-default template for image prompts"),
  }))
  .handler(() => ({
    imagePromptTemplate: getSetting(SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE),
    imagePromptTemplateDefault: DEFAULTS[SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE] ?? "",
  }));

const settingsSet = os
  .route({
    method: "POST",
    path: "/settings",
    tags: ["Settings"],
    summary: "Update application settings",
  })
  .input(z.object({
    imagePromptTemplate: z.string().min(10).describe("Mustache template for image prompt generation"),
  }))
  .output(z.object({ ok: z.boolean() }))
  .handler(({ input }) => {
    setSetting(SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE, input.imagePromptTemplate);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Semantic Cluster procedures
// ---------------------------------------------------------------------------

const ClusterOutput = z.object({
  id: zId,
  name: z.string(),
  clusterType: z.string(),
  description: z.string().nullable(),
  createdAt: zIso,
});

const clustersCreate = os
  .route({
    method: "POST",
    path: "/clusters",
    tags: ["Clusters"],
    summary: "Create a semantic cluster",
  })
  .input(z.object({
    name: z.string().min(1).describe("Cluster name, e.g. 'motion verbs'"),
    clusterType: z.string().min(1).describe("Cluster type: prefix_family | vom_group | aspect_pair | custom"),
    description: z.string().optional().describe("Optional description"),
  }))
  .output(z.object({ id: zId, name: z.string() }))
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();
    db.insert(semanticClusters).values({
      id,
      name: input.name,
      clusterType: input.clusterType,
      description: input.description ?? null,
      createdAt: now,
    }).run();
    return { id, name: input.name };
  });

const clustersList = os
  .route({
    method: "GET",
    path: "/clusters",
    tags: ["Clusters"],
    summary: "List semantic clusters",
  })
  .input(z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }))
  .output(z.object({
    clusters: z.array(z.object({
      id: zId,
      name: z.string(),
      clusterType: z.string(),
      description: z.string().nullable(),
      memberCount: z.number(),
    })),
    total: z.number(),
  }))
  .handler(async ({ input }) => {
    const rows = db.select().from(semanticClusters)
      .limit(input.limit)
      .offset(input.offset)
      .all();

    const totalResult = db.select({ total: count() }).from(semanticClusters).all();
    const total = totalResult[0]?.total ?? 0;

    const clusters = rows.map((r) => {
      const memberResult = db
        .select({ memberCount: count() })
        .from(semanticClusterMembers)
        .where(eq(semanticClusterMembers.clusterId, r.id))
        .all();
      const memberCount = memberResult[0]?.memberCount ?? 0;
      return {
        id: r.id,
        name: r.name,
        clusterType: r.clusterType,
        description: r.description,
        memberCount,
      };
    });

    return { clusters, total: total ?? 0 };
  });

const clustersGet = os
  .route({
    method: "GET",
    path: "/clusters/{id}",
    tags: ["Clusters"],
    summary: "Get a semantic cluster with its members",
  })
  .input(z.object({ id: zId }))
  .output(z.object({
    id: zId,
    name: z.string(),
    clusterType: z.string(),
    description: z.string().nullable(),
    members: z.array(z.object({
      lemmaId: zId,
      lemma: z.string(),
      pos: z.string().nullable(),
    })),
  }))
  .handler(async ({ input }) => {
    const [cluster] = db.select().from(semanticClusters)
      .where(eq(semanticClusters.id, input.id))
      .limit(1)
      .all();
    if (!cluster) throw new ORPCError("NOT_FOUND", { message: `Cluster not found: ${input.id}` });

    const memberRows = db
      .select({
        lemmaId: semanticClusterMembers.lemmaId,
        lemma: lemmas.lemma,
        pos: lemmas.pos,
      })
      .from(semanticClusterMembers)
      .innerJoin(lemmas, eq(lemmas.id, semanticClusterMembers.lemmaId))
      .where(eq(semanticClusterMembers.clusterId, input.id))
      .all();

    return {
      id: cluster.id,
      name: cluster.name,
      clusterType: cluster.clusterType,
      description: cluster.description,
      members: memberRows.map((m) => ({
        lemmaId: m.lemmaId,
        lemma: m.lemma,
        pos: m.pos ?? null,
      })),
    };
  });

const clustersAddMember = os
  .route({
    method: "POST",
    path: "/clusters/{clusterId}/members",
    tags: ["Clusters"],
    summary: "Add a lemma to a semantic cluster (idempotent)",
  })
  .input(z.object({
    clusterId: zId,
    lemmaId: zId,
  }))
  .output(z.object({ clusterId: zId, lemmaId: zId }))
  .handler(async ({ input }) => {
    // Verify cluster exists
    const [cluster] = db.select({ id: semanticClusters.id }).from(semanticClusters)
      .where(eq(semanticClusters.id, input.clusterId)).limit(1).all();
    if (!cluster) throw new ORPCError("NOT_FOUND", { message: `Cluster not found: ${input.clusterId}` });

    // Verify lemma exists
    const [lemma] = db.select({ id: lemmas.id }).from(lemmas)
      .where(eq(lemmas.id, input.lemmaId)).limit(1).all();
    if (!lemma) throw new ORPCError("NOT_FOUND", { message: `Lemma not found: ${input.lemmaId}` });

    // Idempotent insert — ignore if already exists
    const existing = db.select().from(semanticClusterMembers)
      .where(and(
        eq(semanticClusterMembers.clusterId, input.clusterId),
        eq(semanticClusterMembers.lemmaId, input.lemmaId),
      ))
      .limit(1)
      .all();

    if (existing.length === 0) {
      db.insert(semanticClusterMembers).values({
        clusterId: input.clusterId,
        lemmaId: input.lemmaId,
        role: null,
      }).run();
    }

    return { clusterId: input.clusterId, lemmaId: input.lemmaId };
  });

const clustersRemoveMember = os
  .route({
    method: "DELETE",
    path: "/clusters/{clusterId}/members/{lemmaId}",
    tags: ["Clusters"],
    summary: "Remove a lemma from a semantic cluster",
  })
  .input(z.object({
    clusterId: zId,
    lemmaId: zId,
  }))
  .output(z.object({ removed: z.boolean() }))
  .handler(async ({ input }) => {
    const existing = db.select().from(semanticClusterMembers)
      .where(and(
        eq(semanticClusterMembers.clusterId, input.clusterId),
        eq(semanticClusterMembers.lemmaId, input.lemmaId),
      ))
      .limit(1)
      .all();

    if (existing.length === 0) return { removed: false };

    db.delete(semanticClusterMembers)
      .where(and(
        eq(semanticClusterMembers.clusterId, input.clusterId),
        eq(semanticClusterMembers.lemmaId, input.lemmaId),
      ))
      .run();

    return { removed: true };
  });

const clustersSuggest = os
  .route({
    method: "GET",
    path: "/clusters/suggest",
    tags: ["Clusters"],
    summary: "Suggest cluster candidates for a lemma",
    description: "Pure DB scoring: same POS class (+0.4) + shared grammar concepts (+0.3 each, capped at +0.6) - already clustered (-0.1).",
  })
  .input(z.object({
    lemmaId: zId,
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }))
  .output(z.object({
    suggestions: z.array(z.object({
      lemmaId: zId,
      lemma: z.string(),
      pos: z.string().nullable(),
      score: z.number(),
      reasons: z.array(z.string()),
    })),
  }))
  .handler(async ({ input }) => {
    // 1. Get target lemma
    const [targetLemma] = db.select().from(lemmas)
      .where(eq(lemmas.id, input.lemmaId))
      .limit(1)
      .all();
    if (!targetLemma) throw new ORPCError("NOT_FOUND", { message: `Lemma not found: ${input.lemmaId}` });

    // 2. Get POS class from Morfeusz2 analysis
    let targetPosClass: string | null = null;
    try {
      const forms = await analyse(targetLemma.lemma);
      if (forms.length > 0) {
        const tag = forms[0]!.tag;
        targetPosClass = tag.split(":")[0] ?? null;
      }
    } catch {
      // Fallback to stored pos if Morfeusz2 fails
      targetPosClass = targetLemma.pos ? targetLemma.pos.split(":")[0] ?? null : null;
    }

    // 3. Get grammar concepts for the target lemma (via notes.conceptId and sentence_concepts)
    const targetNoteRows = db.select({ conceptId: notes.conceptId })
      .from(notes)
      .where(and(eq(notes.lemmaId, input.lemmaId)))
      .all()
      .filter((n) => n.conceptId !== null);
    const targetConceptIds = new Set(targetNoteRows.map((n) => n.conceptId as string));

    // Also pick up sentence_concepts linked via notes' sentences
    const targetSentenceRows = db.select({ conceptId: sentenceConcepts.conceptId })
      .from(sentenceConcepts)
      .innerJoin(notes, eq(notes.sentenceId, sentenceConcepts.sentenceId))
      .where(eq(notes.lemmaId, input.lemmaId))
      .all();
    for (const row of targetSentenceRows) {
      targetConceptIds.add(row.conceptId);
    }

    // 4. Get clusters the target lemma is already in
    const targetClusterRows = db.select({ clusterId: semanticClusterMembers.clusterId })
      .from(semanticClusterMembers)
      .where(eq(semanticClusterMembers.lemmaId, input.lemmaId))
      .all();
    const targetClusterIds = new Set(targetClusterRows.map((r) => r.clusterId));

    // 5. Get all lemmas that share a cluster with the target (for -0.1 penalty)
    const coClusteredLemmaIds = new Set<string>();
    if (targetClusterIds.size > 0) {
      const coRows = db.select({ lemmaId: semanticClusterMembers.lemmaId })
        .from(semanticClusterMembers)
        .where(inArray(semanticClusterMembers.clusterId, [...targetClusterIds]))
        .all();
      for (const r of coRows) {
        if (r.lemmaId !== input.lemmaId) coClusteredLemmaIds.add(r.lemmaId);
      }
    }

    // 6. Get all other lemmas
    const allLemmas = db.select().from(lemmas)
      .where(ne(lemmas.id, input.lemmaId))
      .all();

    // 7. Score each candidate
    const scored: Array<{
      lemmaId: string;
      lemma: string;
      pos: string | null;
      score: number;
      reasons: string[];
    }> = [];

    for (const candidate of allLemmas) {
      let score = 0;
      const reasons: string[] = [];

      // POS class scoring
      if (targetPosClass !== null) {
        const candidatePosClass = candidate.pos ? candidate.pos.split(":")[0] ?? null : null;
        if (candidatePosClass === targetPosClass) {
          score += 0.4;
          reasons.push("same POS class");
        }
      }

      // Shared grammar concepts
      const candidateNoteRows = db.select({ conceptId: notes.conceptId })
        .from(notes)
        .where(eq(notes.lemmaId, candidate.id))
        .all()
        .filter((n) => n.conceptId !== null);
      const candidateConceptIds = new Set(candidateNoteRows.map((n) => n.conceptId as string));

      const candidateSentenceRows = db.select({ conceptId: sentenceConcepts.conceptId })
        .from(sentenceConcepts)
        .innerJoin(notes, eq(notes.sentenceId, sentenceConcepts.sentenceId))
        .where(eq(notes.lemmaId, candidate.id))
        .all();
      for (const row of candidateSentenceRows) {
        candidateConceptIds.add(row.conceptId);
      }

      let conceptBonus = 0;
      for (const cid of candidateConceptIds) {
        if (targetConceptIds.has(cid)) {
          // Look up concept name for reason string
          const [concept] = db.select({ name: grammarConcepts.name })
            .from(grammarConcepts)
            .where(eq(grammarConcepts.id, cid))
            .limit(1)
            .all();
          const bonus = Math.min(0.3, 0.6 - conceptBonus);
          if (bonus > 0) {
            conceptBonus += 0.3;
            score += bonus;
            reasons.push(`shares concept: ${concept?.name ?? cid}`);
          }
          if (conceptBonus >= 0.6) break;
        }
      }

      // Penalty for already co-clustered
      if (coClusteredLemmaIds.has(candidate.id)) {
        score -= 0.1;
        reasons.push("already in same cluster");
      }

      if (score > 0) {
        scored.push({
          lemmaId: candidate.id,
          lemma: candidate.lemma,
          pos: candidate.pos ?? null,
          score: Math.max(0, Math.round(score * 100) / 100),
          reasons,
        });
      }
    }

    // Sort descending by score, return top N
    scored.sort((a, b) => b.score - a.score);
    return { suggestions: scored.slice(0, input.limit) };
  });

// ---------------------------------------------------------------------------
// Generation procedures
// ---------------------------------------------------------------------------

const generationGenerate = os
  .route({
    method: "POST",
    path: "/generation/generate",
    tags: ["Generation"],
    summary: "Batch-generate contextual exercise notes via LLM",
    description:
      "Generates cloze or multiple-choice notes for a given grammar concept using the " +
      "configured LLM provider (Gemini or OpenAI-compatible). Notes are validated via " +
      "Morfeusz2 and rule-based checks; passing notes are auto-approved, failing ones are flagged.",
  })
  .input(
    z.object({
      conceptId: z.string().uuid().describe("Grammar concept UUID to generate exercises for"),
      kind: z.enum(["cloze", "choice"]).describe("Exercise type: cloze fill-in-the-blank or multiple choice"),
      count: z.number().int().min(1).max(20).default(5).describe("Number of notes to generate"),
      difficulty: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe("Difficulty level 1–3 (1=beginner, 2=intermediate, 3=advanced); default 2"),
    }),
  )
  .output(
    z.object({
      batchId: z.string().describe("UUID identifying this generation batch"),
      generated: z.number().int().describe("Total notes successfully generated (before validation)"),
      approved: z.number().int().describe("Notes that passed all validation checks"),
      flagged: z.number().int().describe("Notes that failed one or more validation checks"),
      failed: z.number().int().describe("Notes that errored during generation"),
    }),
  )
  .handler(async ({ input }) => {
    const provider = createProvider();
    const batchOpts: Parameters<typeof generateBatch>[0] = {
      kind: input.kind,
      conceptId: input.conceptId,
      count: input.count,
      db,
      provider,
    };
    if (input.difficulty !== undefined) {
      batchOpts.difficulty = input.difficulty as 1 | 2 | 3;
    }
    return generateBatch(batchOpts);
  });

// ---------------------------------------------------------------------------
// notes.listDrafts — GET /notes/drafts
// ---------------------------------------------------------------------------

const notesListDrafts = os
  .route({
    method: "GET",
    path: "/notes/drafts",
    tags: ["Notes"],
    summary: "List notes by status",
    description: "Fetches notes (draft/flagged/approved/rejected) with their gaps or options included. Supports filtering by status, kind, and batchId.",
  })
  .input(
    z.object({
      status: z.enum(["draft", "flagged", "approved", "rejected"]).optional().describe("Filter by note status; omit for all statuses"),
      kind: z.enum(["cloze", "choice", "error", "classifier"]).optional().describe("Filter by note kind"),
      batchId: z.string().optional().describe("Filter by generation batch ID (matches generation_meta.batchId)"),
      limit: z.coerce.number().int().min(1).max(100).default(20).describe("Maximum notes to return"),
      offset: z.coerce.number().int().min(0).default(0).describe("Pagination offset"),
    }),
  )
  .output(
    z.object({
      notes: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          status: z.string(),
          conceptId: z.string().nullable(),
          sentenceId: z.string().nullable(),
          explanation: z.string().nullable(),
          generationMeta: z.string().nullable(),
          createdAt: z.number(),
          gaps: z.array(
            z.object({
              id: z.string(),
              gapIndex: z.number(),
              correctAnswers: z.string(),
              hint: z.string().nullable(),
              explanation: z.string().nullable(),
            }),
          ).optional(),
          options: z.array(
            z.object({
              id: z.string(),
              optionText: z.string(),
              isCorrect: z.boolean(),
              explanation: z.string().nullable(),
            }),
          ).optional(),
          sentenceText: z.string().nullable().optional(),
          front: z.string().nullable().optional(),
          back: z.string().nullable().optional(),
        }),
      ),
      total: z.number(),
    }),
  )
  .handler(async ({ input }) => {
    // Build filter conditions
    const conditions: ReturnType<typeof eq>[] = [];
    if (input.status) conditions.push(eq(notes.status, input.status));
    if (input.kind) conditions.push(eq(notes.kind, input.kind));

    // Fetch notes (with batchId filter applied in-memory since SQLite JSON extract is fragile)
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let rows = db
      .select({
        id: notes.id,
        kind: notes.kind,
        status: notes.status,
        conceptId: notes.conceptId,
        sentenceId: notes.sentenceId,
        explanation: notes.explanation,
        generationMeta: notes.generationMeta,
        createdAt: notes.createdAt,
        sentenceText: sentences.text,
        front: notes.front,
        back: notes.back,
      })
      .from(notes)
      .leftJoin(sentences, eq(sentences.id, notes.sentenceId))
      .where(whereClause)
      .all();

    // Filter by batchId in-memory
    if (input.batchId) {
      const batchId = input.batchId;
      rows = rows.filter((r) => {
        if (!r.generationMeta) return false;
        try {
          const meta = JSON.parse(r.generationMeta) as { batchId?: string };
          return meta.batchId === batchId;
        } catch {
          return false;
        }
      });
    }

    const total = rows.length;
    const pageRows = rows.slice(input.offset, input.offset + input.limit);

    // Fetch gaps and options for the page
    const noteIds = pageRows.map((r) => r.id);

    const gapRows = noteIds.length > 0
      ? db
        .select({
          id: clozeGaps.id,
          noteId: clozeGaps.noteId,
          gapIndex: clozeGaps.gapIndex,
          correctAnswers: clozeGaps.correctAnswers,
          hint: clozeGaps.hint,
          explanation: clozeGaps.explanation,
        })
        .from(clozeGaps)
        .where(inArray(clozeGaps.noteId, noteIds))
        .all()
      : [];

    const optionRows = noteIds.length > 0
      ? db
        .select({
          id: choiceOptions.id,
          noteId: choiceOptions.noteId,
          optionText: choiceOptions.optionText,
          isCorrect: choiceOptions.isCorrect,
          explanation: choiceOptions.explanation,
        })
        .from(choiceOptions)
        .where(inArray(choiceOptions.noteId, noteIds))
        .all()
      : [];

    // Group by noteId
    const gapsByNote = new Map<string, typeof gapRows>();
    for (const g of gapRows) {
      const existing = gapsByNote.get(g.noteId) ?? [];
      existing.push(g);
      gapsByNote.set(g.noteId, existing);
    }

    const optionsByNote = new Map<string, typeof optionRows>();
    for (const o of optionRows) {
      const existing = optionsByNote.get(o.noteId) ?? [];
      existing.push(o);
      optionsByNote.set(o.noteId, existing);
    }

    const resultNotes = pageRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      conceptId: r.conceptId,
      sentenceId: r.sentenceId,
      explanation: r.explanation,
      generationMeta: r.generationMeta,
      createdAt: r.createdAt instanceof Date ? Math.floor(r.createdAt.getTime() / 1000) : (r.createdAt as number),
      sentenceText: r.sentenceText ?? null,
      front: r.front ?? null,
      back: r.back ?? null,
      gaps: r.kind === "cloze" ? (gapsByNote.get(r.id) ?? []).map((g) => ({
        id: g.id,
        gapIndex: g.gapIndex,
        correctAnswers: g.correctAnswers,
        hint: g.hint,
        explanation: g.explanation,
      })) : undefined,
      options: r.kind === "choice" ? (optionsByNote.get(r.id) ?? []).map((o) => ({
        id: o.id,
        optionText: o.optionText,
        isCorrect: o.isCorrect,
        explanation: o.explanation,
      })) : undefined,
    }));

    return { notes: resultNotes, total };
  });

// ---------------------------------------------------------------------------
// notes.review — POST /notes/review
// ---------------------------------------------------------------------------

const notesReview = os
  .route({
    method: "POST",
    path: "/notes/review",
    tags: ["Notes"],
    summary: "Approve, flag, or reject a draft note",
    description: "Transitions a note's status. On approve, FSRS cards are auto-created. Idempotent — re-approving a note that already has cards is safe.",
  })
  .input(
    z.object({
      noteId: z.string().uuid().describe("ID of the note to review"),
      action: z.enum(["approve", "flag", "reject"]).describe("Triage action"),
      reason: z.string().optional().describe("Optional human annotation for flag/reject actions"),
    }),
  )
  .output(
    z.object({
      noteId: z.string(),
      status: z.string(),
      cardsCreated: z.number(),
    }),
  )
  .handler(async ({ input }) => {
    const [note] = db
      .select()
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .limit(1)
      .all();

    if (!note) {
      throw new ORPCError("NOT_FOUND", { message: `Note not found: ${input.noteId}` });
    }

    const statusMap = {
      approve: "approved",
      flag: "flagged",
      reject: "rejected",
    } as const;

    const newStatus = statusMap[input.action];
    const now = new Date();

    // Optionally append reason to generation_meta
    let updatedMeta = note.generationMeta;
    if (input.reason && (input.action === "flag" || input.action === "reject")) {
      try {
        const meta = updatedMeta ? (JSON.parse(updatedMeta) as Record<string, unknown>) : {};
        meta["reviewReason"] = input.reason;
        meta["reviewedAt"] = now.toISOString();
        updatedMeta = JSON.stringify(meta);
      } catch {
        // If meta is malformed, just append a new object
        updatedMeta = JSON.stringify({ reviewReason: input.reason, reviewedAt: now.toISOString() });
      }
    }

    db.update(notes)
      .set({ status: newStatus, generationMeta: updatedMeta, updatedAt: now })
      .where(eq(notes.id, input.noteId))
      .run();

    let cardsCreated = 0;
    if (input.action === "approve") {
      cardsCreated = await createCardsForNote(db, { id: note.id, kind: note.kind });
    }

    return { noteId: input.noteId, status: newStatus, cardsCreated };
  });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const router = {
  about,
  lists: {
    list: listsList,
    create: listsCreate,
    get: listsGet,
    delete: listsDelete,
    addLemma: listsAddLemma,
    addNote: listsAddNote,
  },
  grammarConcepts: {
    list: grammarConceptsList,
    create: grammarConceptsCreate,
    get: grammarConceptsGet,
    children: grammarConceptsChildren,
  },
  sentences: {
    list: sentencesList,
    create: sentencesCreate,
    get: sentencesGet,
  },
  notes: {
    list: notesList,
    create: notesCreate,
    get: notesGet,
    delete: notesDelete,
    update: notesUpdate,
    createCloze: notesCreateCloze,
    createChoice: notesCreateChoice,
    createError: notesCreateError,
    createClassifier: notesCreateClassifier,
    listDrafts: notesListDrafts,
    review: notesReview,
  },
  lemmas: {
    list: lemmasList,
    create: lemmasCreate,
    get: lemmasGet,
    delete: lemmasDelete,
    forms: lemmasForms,
    generateImage: lemmasGenerateImage,
  },
  forms: {
    generateAudio: formsGenerateAudio,
  },
  cards: {
    get: cardsGet,
    reviews: cardsReviews,
  },
  session: {
    due: sessionDue,
    review: sessionReview,
  },
  stats: {
    overview: statsOverview,
  },
  import: {
    preview: importPreview,
    commit: importCommit,
  },
  settings: {
    get: settingsGet,
    set: settingsSet,
  },
  generation: {
    generate: generationGenerate,
  },
  clusters: {
    create: clustersCreate,
    list: clustersList,
    get: clustersGet,
    addMember: clustersAddMember,
    removeMember: clustersRemoveMember,
    suggest: clustersSuggest,
  },
};

export type Router = typeof router;
