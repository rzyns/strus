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
// Output schemas — all timestamps emitted as ISO 8601 strings
// ---------------------------------------------------------------------------

const zId = z.string().uuid();
const zIso = z.string().datetime();

const VocabListOutput = z.object({
  id: zId,
  name: z.string(),
  description: z.string().nullable(),
  createdAt: zIso,
});

const LexemeOutput = z.object({
  id: zId,
  lemma: z.string(),
  pos: z.string(),
  notes: z.string().nullable(),
  createdAt: zIso,
  updatedAt: zIso,
});

const LearningTargetOutput = z.object({
  id: zId,
  lexemeId: zId,
  tag: z.string(),
  state: z.number().int(),
  due: zIso,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  lastReview: zIso.nullable(),
});

const SuccessOutput = z.object({ success: z.literal(true) });

const StatsOutput = z.object({
  lexemeCount: z.number().int(),
  listCount: z.number().int(),
  dueCount: z.number().int(),
});

// ---------------------------------------------------------------------------
// Mappers — convert raw DB rows / domain objects to output shapes
//
// Drizzle returns Date objects for integer(..., { mode: "timestamp" }) columns
// and plain numbers for integer() columns (Unix seconds).
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
  .route({ method: "GET", path: "/lists" })
  .input(z.object({}))
  .output(z.array(VocabListOutput))
  .handler(async () =>
    db.select().from(vocabLists).all().map(mapVocabList)
  );

const listsCreate = os
  .route({ method: "POST", path: "/lists" })
  .input(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
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
  .route({ method: "GET", path: "/lists/{id}" })
  .input(z.object({ id: zId }))
  .output(VocabListOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(vocabLists).where(eq(vocabLists.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `VocabList not found: ${input.id}` });
    return mapVocabList(row);
  });

const listsDelete = os
  .route({ method: "DELETE", path: "/lists/{id}" })
  .input(z.object({ id: zId }))
  .output(SuccessOutput)
  .handler(async ({ input }) => {
    await db.delete(vocabLists).where(eq(vocabLists.id, input.id));
    return { success: true as const };
  });

const listsAddLexeme = os
  .route({ method: "POST", path: "/lists/{listId}/lexemes" })
  .input(z.object({ listId: zId, lexemeId: zId }))
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
  .route({ method: "GET", path: "/lexemes" })
  .input(z.object({ listId: z.string().uuid().optional() }))
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
  .route({ method: "POST", path: "/lexemes" })
  .input(z.object({
    lemma: z.string().min(1),
    pos: z.string().min(1),
    notes: z.string().optional(),
    listId: z.string().uuid().optional(),
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

    // Generate morphological forms via Morfeusz2 CLI
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

    return mapLexeme({ id, lemma: input.lemma, pos: input.pos, notes: input.notes ?? null, createdAt: now, updatedAt: now });
  });

const lexemesGet = os
  .route({ method: "GET", path: "/lexemes/{id}" })
  .input(z.object({ id: zId }))
  .output(LexemeOutput)
  .handler(async ({ input }) => {
    const [row] = await db.select().from(lexemes).where(eq(lexemes.id, input.id)).limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: `Lexeme not found: ${input.id}` });
    return mapLexeme(row);
  });

const lexemesDelete = os
  .route({ method: "DELETE", path: "/lexemes/{id}" })
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
  .route({ method: "GET", path: "/session/due" })
  .input(z.object({
    listId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
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
  .route({ method: "POST", path: "/session/review" })
  .input(z.object({
    learningTargetId: zId,
    rating: z.nativeEnum(Rating),
  }))
  .output(z.object({
    reviewId: zId,
    updated: LearningTargetOutput,
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
  .route({ method: "GET", path: "/stats" })
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
