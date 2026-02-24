import { os, ORPCError } from "@orpc/server";
import { z } from "zod";
import { count, eq, lte, and } from "drizzle-orm";
import { db } from "@strus/db";
import {
  vocabLists,
  lexemes,
  morphForms,
  learningTargets,
  reviews,
  vocabListLexemes,
} from "@strus/db";
import { generate, parseTag } from "@strus/morph";
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

// ---------------------------------------------------------------------------
// Output schemas with field-level descriptions
// ---------------------------------------------------------------------------

const VocabListOutput = z.object({
  id: zId,
  name: z.string().describe("Human-readable name for the list"),
  description: z.string().nullable().describe("Optional longer description; null if not set"),
  createdAt: zIso.describe("When this list was created"),
});

const LexemeOutput = z.object({
  id: zId,
  lemma: z.string().describe("Dictionary/base form of the word, e.g. 'dom', 'iść', 'dobry'"),
  pos: z
    .string()
    .describe(
      "Part of speech from the NKJP tagset: subst (noun), verb, adj (adjective), adv (adverb), etc.",
    ),
  notes: z.string().nullable().describe("Free-form notes about this lexeme; null if not set"),
  createdAt: zIso.describe("When this lexeme was added"),
  updatedAt: zIso.describe("When this lexeme was last modified"),
});

const LearningTargetOutput = z.object({
  id: zId,
  lexemeId: zId.describe("ID of the parent lexeme"),
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
  lexemeCount: z.number().int().describe("Total number of lexemes in the database"),
  listCount: z.number().int().describe("Total number of vocabulary lists"),
  dueCount: z.number().int().describe("Number of learning targets currently due for review"),
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

function mapLexeme(row: typeof lexemes.$inferSelect) {
  return {
    id: row.id,
    lemma: row.lemma,
    pos: row.pos,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps a raw DB row from learningTargets (due/lastReview are Unix seconds). */
function mapLearningTargetRow(row: typeof learningTargets.$inferSelect) {
  return {
    id: row.id,
    lexemeId: row.lexemeId,
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
    lexemeId: target.lexemeId,
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
      "Deletes the list and removes all its lexeme associations. Lexemes themselves are not deleted.",
  })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(vocabLists).where(eq(vocabLists.id, input.id));
    return { success: true as const };
  });

const listsAddLexeme = os
  .route({
    method: "POST",
    path: "/lists/{listId}/lexemes",
    tags: ["Lists"],
    summary: "Add a lexeme to a vocabulary list",
    description: "Associates an existing lexeme with a vocabulary list. The lexeme must already exist.",
  })
  .input(z.object({
    listId: zId.describe("ID of the vocabulary list"),
    lexemeId: zId.describe("ID of the lexeme to add"),
  }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.insert(vocabListLexemes).values({
      listId: input.listId,
      lexemeId: input.lexemeId,
    });
    return { success: true as const };
  });

// ---------------------------------------------------------------------------
// Lexemes procedures
// ---------------------------------------------------------------------------

const lexemesList = os
  .route({
    method: "GET",
    path: "/lexemes",
    tags: ["Lexemes"],
    summary: "List lexemes",
    description: "Returns all lexemes, optionally filtered to those belonging to a specific vocabulary list.",
  })
  .input(z.object({
    listId: z.string().uuid().optional().describe("Filter to lexemes in this vocabulary list"),
  }))
  .output(z.array(LexemeOutput))
  .handler(async ({ input }) => {
    if (input.listId) {
      return db
        .select({ lexeme: lexemes })
        .from(lexemes)
        .innerJoin(
          vocabListLexemes,
          and(
            eq(vocabListLexemes.lexemeId, lexemes.id),
            eq(vocabListLexemes.listId, input.listId),
          ),
        )
        .all()
        .map((r) => mapLexeme(r.lexeme));
    }
    return db.select().from(lexemes).all().map(mapLexeme);
  });

const lexemesCreate = os
  .route({
    method: "POST",
    path: "/lexemes",
    tags: ["Lexemes"],
    summary: "Create a lexeme",
    description:
      "Creates a lexeme and, if Morfeusz2 is available, automatically generates all " +
      "morphological forms and seeds one FSRS learning target per form. " +
      "Optionally associates the new lexeme with a vocabulary list.",
  })
  .input(z.object({
    lemma: z.string().min(1).describe("Dictionary/base form of the word, e.g. 'dom', 'iść'"),
    pos: z
      .string()
      .min(1)
      .describe("Part of speech (NKJP tag prefix): subst, verb, adj, adv, etc."),
    notes: z.string().optional().describe("Optional free-form notes"),
    listId: z.string().uuid().optional().describe("Vocabulary list to add this lexeme to"),
  }))
  .output(LexemeOutput)
  .handler(async ({ input }) => {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(lexemes).values({
      id,
      lemma: input.lemma,
      pos: input.pos,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });

    if (input.listId) {
      await db.insert(vocabListLexemes).values({ listId: input.listId, lexemeId: id });
    }

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
        lexemeId: id,
        orth: form.orth,
        tag: form.tag,
        parsedTag: JSON.stringify(parsed),
        createdAt: now,
      });

      const target = createLearningTarget(id, form.tag);
      await db.insert(learningTargets).values({
        id: crypto.randomUUID(),
        lexemeId: target.lexemeId,
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

    return mapLexeme({
      id,
      lemma: input.lemma,
      pos: input.pos,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });
  });

const lexemesGet = os
  .route({
    method: "GET",
    path: "/lexemes/{id}",
    tags: ["Lexemes"],
    summary: "Get a lexeme",
  })
  .input(z.object({ id: zId }))
  .output(LexemeOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(lexemes).where(eq(lexemes.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Lexeme not found: ${input.id}` });
    return mapLexeme(row);
  });

const lexemesDelete = os
  .route({
    method: "DELETE",
    path: "/lexemes/{id}",
    tags: ["Lexemes"],
    summary: "Delete a lexeme",
    description:
      "Deletes a lexeme along with all its morphological forms and learning targets (cascade). " +
      "Review history is also removed.",
  })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(lexemes).where(eq(lexemes.id, input.id));
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
          vocabListLexemes,
          and(
            eq(vocabListLexemes.lexemeId, learningTargets.lexemeId),
            eq(vocabListLexemes.listId, input.listId),
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
      lexemeId: row.lexemeId,
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
    const [lexResult] = await db.select({ value: count() }).from(lexemes);
    const [listResult] = await db.select({ value: count() }).from(vocabLists);
    const [dueResult] = await db
      .select({ value: count() })
      .from(learningTargets)
      .where(lte(learningTargets.due, nowSecs));

    return {
      lexemeCount: lexResult?.value ?? 0,
      listCount: listResult?.value ?? 0,
      dueCount: dueResult?.value ?? 0,
    };
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
    addLexeme: listsAddLexeme,
  },
  lexemes: {
    list: lexemesList,
    create: lexemesCreate,
    get: lexemesGet,
    delete: lexemesDelete,
  },
  session: {
    due: sessionDue,
    review: sessionReview,
  },
  stats: {
    overview: statsOverview,
  },
};

export type Router = typeof router;
