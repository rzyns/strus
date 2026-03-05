import { os, ORPCError } from "@orpc/server";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { count, eq, lte, ne, like, and, or, inArray, asc, sql } from "drizzle-orm";
import { db } from "@strus/db";
import {
  vocabLists,
  lemmas,
  morphForms,
  cards,
  notes,
  reviews,
  vocabListNotes,
} from "@strus/db";
import { generate, parseTag, tagGender, analyseText } from "@strus/morph";
import { generateAudio, generateImage, getMediaBaseUrl } from "./media.js";
import { getSetting, setSetting, SETTINGS_KEYS, DEFAULTS } from "./settings.js";
import {
  scheduleReview,
  createCard,
  getNextReviewDates,
  Rating,
  CardState,
  type Card,
} from "@strus/core";

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
    .enum(["morph_form", "gloss_forward", "gloss_reverse", "basic_forward"])
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
});

const NoteOutput = z.object({
  id: zId,
  kind: z.enum(["morph", "gloss", "basic"]).describe("Note kind: morph for morphological drill, gloss for translation, basic for custom flashcards"),
  lemmaId: zId.nullable().describe("ID of the associated lemma; null for basic notes"),
  lemmaText: z.string().nullable().describe("Citation form of the associated lemma; null for basic notes"),
  front: z.string().nullable().describe("Prompt text for gloss/basic notes; null for morph notes"),
  back: z.string().nullable().describe("Answer text for gloss/basic notes; null for morph notes"),
  createdAt: zIso.describe("When this note was created"),
  updatedAt: zIso.describe("When this note was last modified"),
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

function mapNote(row: typeof notes.$inferSelect, lemmaText: string | null = null) {
  return {
    id: row.id,
    kind: row.kind,
    lemmaId: row.lemmaId,
    lemmaText,
    front: row.front,
    back: row.back,
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
  const allForms = await analyseText(text);

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
    forms = await generate(lemmaText);
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
    } else if (input.listId) {
      // Manual source: create a morph note (with no forms) and add to list
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
      await db.insert(vocabListNotes).values({ listId: input.listId, noteId });
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

    const result = await generateImage(row.lemma, citationTag);
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
      .array(z.enum(["morph_form", "gloss_forward", "gloss_reverse", "basic_forward"]))
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
        ...(r.card.tag != null ? { tag: r.card.tag } : {}),
        ...(r.card.lastReview != null ? { lastReview: new Date(r.card.lastReview * 1000) } : {}),
      };
      const dates = getNextReviewDates(domainCard, now);

      // Resolve media URLs
      const formKey = r.lemmaId && r.card.tag ? `${r.lemmaId}::${r.card.tag}` : null;
      const formInfo = formKey ? formInfoByKey.get(formKey) : undefined;
      const audioPath = formInfo?.audioPath ?? null;
      const imagePath = r.lemmaId ? lemmaImagePaths.get(r.lemmaId) ?? null : null;

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

    return {
      lemmaCount: lemmaResult?.value ?? 0,
      listCount: listResult?.value ?? 0,
      dueCount: dueResult?.value ?? 0,
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
// Notes procedures
// ---------------------------------------------------------------------------

/** Helper to insert a card row from a createCard() result. */
function insertCardValues(cardData: Omit<import("@strus/core").Card, "id">) {
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
    kind: z.enum(["morph", "gloss", "basic"]).optional().describe("Filter by note kind"),
    listId: z.string().uuid().optional().describe("Filter to notes in this vocabulary list"),
    lemmaId: z.string().uuid().optional().describe("Filter to notes associated with this lemma"),
  }))
  .output(z.array(NoteOutput))
  .handler(async ({ input }) => {
    // Build WHERE conditions
    const conditions = [];
    if (input.kind) conditions.push(eq(notes.kind, input.kind));
    if (input.lemmaId) conditions.push(eq(notes.lemmaId, input.lemmaId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    if (input.listId) {
      const q = db
        .select({ note: notes, lemmaText: lemmas.lemma })
        .from(notes)
        .leftJoin(lemmas, eq(lemmas.id, notes.lemmaId))
        .innerJoin(
          vocabListNotes,
          and(
            eq(vocabListNotes.noteId, notes.id),
            eq(vocabListNotes.listId, input.listId),
          ),
        );
      const rows = whereClause ? q.where(whereClause).all() : q.all();
      return rows.map((r) => mapNote(r.note, r.lemmaText ?? null));
    }

    const rows = whereClause
      ? db.select({ note: notes, lemmaText: lemmas.lemma }).from(notes).leftJoin(lemmas, eq(lemmas.id, notes.lemmaId)).where(whereClause).all()
      : db.select({ note: notes, lemmaText: lemmas.lemma }).from(notes).leftJoin(lemmas, eq(lemmas.id, notes.lemmaId)).all();
    return rows.map((r) => mapNote(r.note, r.lemmaText ?? null));
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

    return {
      ...mapNote(row, lemmaText),
      cards: noteCards.map(mapCardRow),
      lemma: lemmaText,
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
  },
  notes: {
    list: notesList,
    create: notesCreate,
    get: notesGet,
    delete: notesDelete,
    update: notesUpdate,
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
};

export type Router = typeof router;
