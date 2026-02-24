import { os, ORPCError } from "@orpc/server";
import { z } from "zod";
import { count, eq, lte, and } from "drizzle-orm";
import { db } from "@strus/db";
import {
  vocabLists,
  lemmas,
  morphForms,
  learningTargets,
  reviews,
  vocabListLemmas,
} from "@strus/db";
import { generate, parseTag, analyseText } from "@strus/morph";
import {
  scheduleReview,
  createLearningTarget,
  Rating,
  CardState,
  type LearningTarget,
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
  createdAt: zIso.describe("When this lemma was added"),
  updatedAt: zIso.describe("When this lemma was last modified"),
});

const LearningTargetOutput = z.object({
  id: zId,
  lemmaId: zId.describe("ID of the parent lemma"),
  tag: z
    .string()
    .describe(
      "Full NKJP morphosyntactic tag identifying the specific form being drilled, e.g. 'subst:sg:inst:m3'",
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

const SuccessOutput = z.object({
  success: z.literal(true).describe("Always true; present to confirm the operation completed"),
});

const StatsOutput = z.object({
  lemmaCount: z.number().int().describe("Total number of lemmas in the database"),
  listCount: z.number().int().describe("Total number of vocabulary lists"),
  dueCount: z.number().int().describe("Number of learning targets currently due for review"),
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
  return {
    id: row.id,
    lemma: row.lemma,
    pos: row.pos,
    source: row.source,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps a raw DB row from learningTargets (due/lastReview are Unix seconds). */
function mapLearningTargetRow(row: typeof learningTargets.$inferSelect) {
  return {
    id: row.id,
    lemmaId: row.lemmaId,
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

/** Maps a domain LearningTarget (due/lastReview are Date objects). */
function mapLearningTargetDomain(target: LearningTarget) {
  return {
    id: target.id,
    lemmaId: target.lemmaId,
    tag: target.tag,
    state: target.state,
    due: target.due.toISOString(),
    stability: target.stability,
    difficulty: target.difficulty,
    elapsedDays: target.elapsedDays,
    scheduledDays: target.scheduledDays,
    reps: target.reps,
    lapses: target.lapses,
    lastReview: target.lastReview?.toISOString() ?? null,
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

    const distinctLemmas = [...new Set(nonStop.map((f) => f.lemma))];
    const ambiguous = distinctLemmas.length > 1;

    for (const lemma of distinctLemmas) {
      const representativeTag = nonStop.find((f) => f.lemma === lemma)!.tag;
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
      "Deletes the list and removes all its lemma associations. Lemmas themselves are not deleted.",
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
    description: "Associates an existing lemma with a vocabulary list. The lemma must already exist.",
  })
  .input(z.object({
    listId: zId.describe("ID of the vocabulary list"),
    lemmaId: zId.describe("ID of the lemma to add"),
  }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.insert(vocabListLemmas).values({
      listId: input.listId,
      lemmaId: input.lemmaId,
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
          vocabListLemmas,
          and(
            eq(vocabListLemmas.lemmaId, lemmas.id),
            eq(vocabListLemmas.listId, input.listId),
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
      "generates all morphological word forms and seeds one FSRS learning target per form. " +
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

    if (input.listId) {
      await db.insert(vocabListLemmas).values({ listId: input.listId, lemmaId: id });
    }

    if (input.source === "morfeusz") {
      let forms: Awaited<ReturnType<typeof generate>> = [];
      try {
        forms = await generate(input.lemma);
      } catch {
        console.warn(`[morph] morfeusz2 unavailable; skipping form generation for "${input.lemma}"`);
      }

      for (const form of forms) {
        const parsed = parseTag(form.tag);
        await db.insert(morphForms).values({
          id: crypto.randomUUID(),
          lemmaId: id,
          orth: form.orth,
          tag: form.tag,
          parsedTag: JSON.stringify(parsed),
          createdAt: now,
        });

        const target = createLearningTarget(id, form.tag);
        await db.insert(learningTargets).values({
          id: crypto.randomUUID(),
          lemmaId: target.lemmaId,
          tag: target.tag,
          state: target.state,
          due: Math.floor(target.due.getTime() / 1000),
          stability: target.stability,
          difficulty: target.difficulty,
          elapsedDays: target.elapsedDays,
          scheduledDays: target.scheduledDays,
          reps: target.reps,
          lapses: target.lapses,
          lastReview: target.lastReview
            ? Math.floor(target.lastReview.getTime() / 1000)
            : null,
        });
      }
    }

    return mapLemma({
      id,
      lemma: input.lemma,
      pos: input.pos,
      source: input.source,
      notes: input.notes ?? null,
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
      "Deletes a lemma along with all its morphological forms and learning targets (cascade). " +
      "Review history is also removed.",
  })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(lemmas).where(eq(lemmas.id, input.id));
    return { success: true as const };
  });

// ---------------------------------------------------------------------------
// Session procedures
// ---------------------------------------------------------------------------

const sessionDue = os
  .route({
    method: "GET",
    path: "/session/due",
    tags: ["Session"],
    summary: "Get cards due for review",
    description:
      "Returns learning targets whose due date has passed, ordered by due date ascending. " +
      "Optionally scoped to a single vocabulary list.",
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
      .max(100)
      .default(20)
      .describe("Maximum number of cards to return (default: 20, max: 100)"),
  }))
  .output(z.array(LearningTargetOutput))
  .handler(async ({ input }) => {
    const nowSecs = Math.floor(Date.now() / 1000);

    if (input.listId) {
      return db
        .select({ target: learningTargets })
        .from(learningTargets)
        .innerJoin(
          vocabListLemmas,
          and(
            eq(vocabListLemmas.lemmaId, learningTargets.lemmaId),
            eq(vocabListLemmas.listId, input.listId),
          ),
        )
        .where(lte(learningTargets.due, nowSecs))
        .limit(input.limit)
        .all()
        .map((r) => mapLearningTargetRow(r.target));
    }

    return db
      .select()
      .from(learningTargets)
      .where(lte(learningTargets.due, nowSecs))
      .limit(input.limit)
      .all()
      .map(mapLearningTargetRow);
  });

const sessionReview = os
  .route({
    method: "POST",
    path: "/session/review",
    tags: ["Session"],
    summary: "Record a review",
    description:
      "Submits a review rating for a learning target. The FSRS algorithm computes the next " +
      "due date and updates the card's stability and difficulty. The review event is logged " +
      "for retention analytics.",
  })
  .input(z.object({
    learningTargetId: zId.describe("ID of the learning target being reviewed"),
    rating: z.nativeEnum(Rating).describe(
      "Review outcome: 1 = Again (forgot), 2 = Hard (correct but difficult), " +
      "3 = Good (correct), 4 = Easy (too easy)",
    ),
  }))
  .output(z.object({
    reviewId: zId.describe("ID of the newly created review record"),
    updated: LearningTargetOutput.describe("The learning target with its updated FSRS state"),
  }))
  .handler(async ({ input }) => {
    const [row] = await db
      .select()
      .from(learningTargets)
      .where(eq(learningTargets.id, input.learningTargetId))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: `LearningTarget not found: ${input.learningTargetId}`,
      });
    }

    const now = new Date();
    const dueDateBefore = new Date(row.due * 1000);

    const target = {
      id: row.id,
      lemmaId: row.lemmaId,
      tag: row.tag,
      state: row.state as CardState,
      due: dueDateBefore,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsedDays: row.elapsedDays,
      scheduledDays: row.scheduledDays,
      reps: row.reps,
      lapses: row.lapses,
      ...(row.lastReview != null ? { lastReview: new Date(row.lastReview * 1000) } : {}),
    };

    const updated = scheduleReview(target, input.rating, now);

    await db
      .update(learningTargets)
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
      .where(eq(learningTargets.id, input.learningTargetId));

    const reviewId = crypto.randomUUID();
    await db.insert(reviews).values({
      id: reviewId,
      learningTargetId: input.learningTargetId,
      rating: input.rating,
      stateBefore: target.state,
      due: Math.floor(dueDateBefore.getTime() / 1000),
      reviewedAt: Math.floor(now.getTime() / 1000),
      elapsedDays: updated.elapsedDays,
      scheduledDays: updated.scheduledDays,
      stabilityAfter: updated.stability,
      difficultyAfter: updated.difficulty,
    });

    return {
      reviewId,
      updated: mapLearningTargetDomain(updated),
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
      .from(learningTargets)
      .where(lte(learningTargets.due, nowSecs));

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
      "(Morfeusz2 will generate their inflected forms). Ambiguous candidates are skipped by default.",
  })
  .input(
    ImportTextInput.extend({
      skipAmbiguous: z
        .boolean()
        .default(true)
        .describe("Skip ambiguous candidates (default: true). Set false to commit all candidates."),
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

      // Skip ambiguous if requested
      if (c.ambiguous && input.skipAmbiguous) {
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

      if (input.listId !== undefined) {
        await db.insert(vocabListLemmas).values({ listId: input.listId, lemmaId: id });
      }

      // Generate morphological forms for non-manual lemmas
      if (source === "morfeusz") {
        let forms: Awaited<ReturnType<typeof generate>> = [];
        try {
          forms = await generate(c.lemma);
        } catch {
          console.warn(`[morph] morfeusz2 unavailable; skipping form generation for "${c.lemma}"`);
        }

        for (const form of forms) {
          const parsed = parseTag(form.tag);
          await db.insert(morphForms).values({
            id: crypto.randomUUID(),
            lemmaId: id,
            orth: form.orth,
            tag: form.tag,
            parsedTag: JSON.stringify(parsed),
            createdAt: now,
          });

          const target = createLearningTarget(id, form.tag);
          await db.insert(learningTargets).values({
            id: crypto.randomUUID(),
            lemmaId: target.lemmaId,
            tag: target.tag,
            state: target.state,
            due: Math.floor(target.due.getTime() / 1000),
            stability: target.stability,
            difficulty: target.difficulty,
            elapsedDays: target.elapsedDays,
            scheduledDays: target.scheduledDays,
            reps: target.reps,
            lapses: target.lapses,
            ...(target.lastReview !== undefined
              ? { lastReview: Math.floor(target.lastReview.getTime() / 1000) }
              : { lastReview: null }),
          });
        }
      }

      created.push({ lemmaId: id, lemma: c.lemma, pos: c.pos, source });
    }

    return { created, skipped, unknownTokens };
  });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const router = {
  lists: {
    list: listsList,
    create: listsCreate,
    get: listsGet,
    delete: listsDelete,
    addLemma: listsAddLemma,
  },
  lemmas: {
    list: lemmasList,
    create: lemmasCreate,
    get: lemmasGet,
    delete: lemmasDelete,
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
};

export type Router = typeof router;
