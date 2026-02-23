/**
 * @strus/api — oRPC router
 *
 * TODO: Verify exact oRPC package API (@orpc/server) once installed.
 *       The builder pattern below reflects the oRPC v0.x API as understood
 *       at scaffolding time. Adjust `os` / `oc` imports if the API differs.
 */

import { z } from "zod";
import { db } from "@strus/db";
import {
  vocabLists,
  lexemes,
  morphForms,
  learningTargets,
  reviews,
  vocabListLexemes,
} from "@strus/db";
import { generate } from "@strus/morph";
import { parseTag } from "@strus/morph";
import {
  scheduleReview,
  createLearningTarget,
  Rating,
  CardState,
} from "@strus/core";
import { eq, lte, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const zId = z.string().uuid();
const zDateFromTimestamp = z.number().int().transform((n) => new Date(n * 1000));

export const VocabListSchema = z.object({
  id: zId,
  name: z.string(),
  description: z.string().nullable().optional(),
  createdAt: z.date(),
});

export const LexemeSchema = z.object({
  id: zId,
  lemma: z.string(),
  pos: z.string(),
  notes: z.string().nullable().optional(),
  createdAt: z.date(),
});

export const LearningTargetSchema = z.object({
  id: zId,
  lexemeId: zId,
  tag: z.string(),
  state: z.nativeEnum(CardState),
  due: z.date(),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  lastReview: z.date().nullable().optional(),
});

// ---------------------------------------------------------------------------
// oRPC router definition
//
// TODO: Replace `any` stubs once the exact @orpc/server builder API is
//       confirmed. The intent is:
//
//   import { os } from '@orpc/server'
//   const procedure = os.input(InputSchema).output(OutputSchema).handler(fn)
//
// See https://orpc.unnoq.com for current docs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// lists procedures
// ---------------------------------------------------------------------------

async function listsList(_input: Record<string, never>) {
  return db.select().from(vocabLists).all();
}

async function listsCreate(input: { name: string; description?: string }) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(vocabLists).values({
    id,
    name: input.name,
    description: input.description ?? null,
    createdAt: now,
  });
  return { id, name: input.name, description: input.description, createdAt: now };
}

async function listsGet(input: { id: string }) {
  const [row] = await db
    .select()
    .from(vocabLists)
    .where(eq(vocabLists.id, input.id))
    .limit(1);
  if (!row) throw new Error(`VocabList not found: ${input.id}`);
  return row;
}

async function listsDelete(input: { id: string }) {
  await db.delete(vocabLists).where(eq(vocabLists.id, input.id));
  return { success: true };
}

async function listsAddLexeme(input: { listId: string; lexemeId: string }) {
  await db.insert(vocabListLexemes).values({
    listId: input.listId,
    lexemeId: input.lexemeId,
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// lexemes procedures
// ---------------------------------------------------------------------------

async function lexemesList(input: { listId?: string }) {
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
      .map((r) => r.lexeme);
  }
  return db.select().from(lexemes).all();
}

async function lexemesCreate(input: {
  lemma: string;
  pos: string;
  notes?: string;
  listId?: string;
}) {
  const id = crypto.randomUUID();
  const now = new Date();

  // Insert the lexeme
  await db.insert(lexemes).values({
    id,
    lemma: input.lemma,
    pos: input.pos,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // Add to list if requested
  if (input.listId) {
    await db.insert(vocabListLexemes).values({ listId: input.listId, lexemeId: id });
  }

  // Generate morphological forms via Morfeusz2
  // TODO: handle the case where morfeusz2 is not installed (warn, don't crash)
  let forms: Awaited<ReturnType<typeof generate>> = [];
  try {
    forms = await generate(input.lemma);
  } catch {
    // morfeusz2 may not be installed in dev — continue without forms
    console.warn(`[strus/api] morfeusz2 not available; skipping form generation for "${input.lemma}"`);
  }

  // Persist morph forms and create learning targets
  for (const form of forms) {
    const formId = crypto.randomUUID();
    const parsed = parseTag(form.tag);
    await db.insert(morphForms).values({
      id: formId,
      lexemeId: id,
      orth: form.orth,
      tag: form.tag,
      parsedTag: JSON.stringify(parsed),
      createdAt: now,
    });

    const target = createLearningTarget(id, form.tag);
    const targetId = crypto.randomUUID();
    await db.insert(learningTargets).values({
      id: targetId,
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

  return { id, lemma: input.lemma, pos: input.pos, notes: input.notes, createdAt: now };
}

async function lexemesGet(input: { id: string }) {
  const [row] = await db
    .select()
    .from(lexemes)
    .where(eq(lexemes.id, input.id))
    .limit(1);
  if (!row) throw new Error(`Lexeme not found: ${input.id}`);
  return row;
}

async function lexemesDelete(input: { id: string }) {
  await db.delete(lexemes).where(eq(lexemes.id, input.id));
  return { success: true };
}

// ---------------------------------------------------------------------------
// session procedures
// ---------------------------------------------------------------------------

async function sessionDue(input: { listId?: string; limit?: number }) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const limit = input.limit ?? 20;

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
      .limit(limit)
      .all()
      .map((r) => r.target);
  }

  return db
    .select()
    .from(learningTargets)
    .where(lte(learningTargets.due, nowSecs))
    .limit(limit)
    .all();
}

async function sessionReview(input: {
  learningTargetId: string;
  rating: Rating;
}) {
  const [row] = await db
    .select()
    .from(learningTargets)
    .where(eq(learningTargets.id, input.learningTargetId))
    .limit(1);

  if (!row) throw new Error(`LearningTarget not found: ${input.learningTargetId}`);

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
    // exactOptionalPropertyTypes: use spread to avoid assigning `undefined` to `lastReview?: Date`
    ...(row.lastReview != null ? { lastReview: new Date(row.lastReview * 1000) } : {}),
  };

  const updated = scheduleReview(target, input.rating, now);

  // Persist updated card state
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

  // Record the review
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

  return { id: reviewId, updated };
}

// ---------------------------------------------------------------------------
// stats procedures
// ---------------------------------------------------------------------------

async function statsOverview(_input: Record<string, never>) {
  const [lexemeCount] = await db
    .select({ count: lexemes.id })
    .from(lexemes)
    .all();
  const [listCount] = await db
    .select({ count: vocabLists.id })
    .from(vocabLists)
    .all();
  const nowSecs = Math.floor(Date.now() / 1000);
  const dueTargets = await db
    .select()
    .from(learningTargets)
    .where(lte(learningTargets.due, nowSecs))
    .all();

  return {
    lexemeCount: lexemeCount?.count !== undefined ? 1 : 0, // stub — replace with count()
    listCount: listCount?.count !== undefined ? 1 : 0,
    dueCount: dueTargets.length,
  };
}

// ---------------------------------------------------------------------------
// Router shape — consumed by the oRPC adapter in index.ts
//
// TODO: Wrap each handler in `os.input(...).output(...).handler(fn)` using the
//       actual @orpc/server builder once the exact API is confirmed.
//       For now, plain async functions are exported so index.ts can mount them.
// ---------------------------------------------------------------------------

export const router = {
  lists: {
    list:       listsList,
    create:     listsCreate,
    get:        listsGet,
    delete:     listsDelete,
    addLexeme:  listsAddLexeme,
  },
  lexemes: {
    list:   lexemesList,
    create: lexemesCreate,
    get:    lexemesGet,
    delete: lexemesDelete,
  },
  session: {
    due:    sessionDue,
    review: sessionReview,
  },
  stats: {
    overview: statsOverview,
  },
};

export type Router = typeof router;
