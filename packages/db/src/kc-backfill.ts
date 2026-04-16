/**
 * Shared KC backfill logic — usable by both the standalone backfill script
 * and the API endpoint.
 *
 * Exports:
 *   backfillKCs(db) — populates card_knowledge_components for all morph_form cards
 */
import { eq } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { createInitialKnowledgeComponentFsrsState } from "./kc-fsrs.js";
import {
  knowledgeComponents,
  cardKnowledgeComponents,
  cards,
  notes,
} from "./schema.js";
import { mapCardToKCs } from "./kc-engine.js";

export interface BackfillKCsResult {
  cardsProcessed: number;
  linksCreated: number;
  lemmaKCsCreated: number;
}

/**
 * Populate card_knowledge_components for all existing morph_form cards.
 *
 * For each morph_form card:
 *   1. Runs the tag engine to find matching structural KCs
 *   2. Finds or creates the lemma-kind KC for the card's lemma
 *   3. Inserts all matches (idempotent via onConflictDoNothing)
 *
 * Idempotent — safe to call multiple times.
 */
export async function backfillKCs(db: DbClient): Promise<BackfillKCsResult> {
  // Load all structural KCs
  const allKCs = db.select().from(knowledgeComponents).all();
  const structuralKCs = allKCs.filter((kc) => kc.kind !== "lemma");
  const lemmaKCByLemmaId = new Map(
    allKCs
      .filter((kc) => kc.kind === "lemma" && kc.lemmaId)
      .map((kc) => [kc.lemmaId!, kc]),
  );

  // Load all morph_form cards with their note's lemma_id
  const morphCards = db
    .select({
      cardId: cards.id,
      tag: cards.tag,
      noteId: cards.noteId,
      lemmaId: notes.lemmaId,
    })
    .from(cards)
    .innerJoin(notes, eq(cards.noteId, notes.id))
    .where(eq(cards.kind, "morph_form"))
    .all();

  const now = new Date();
  let lemmaKCsCreated = 0;
  const pairsToInsert: { cardId: string; kcId: string }[] = [];

  for (const card of morphCards) {
    if (!card.tag) continue;

    // 1. Structural KCs via tag engine
    const matchingKcIds = mapCardToKCs(card.tag, structuralKCs);

    // 2. Lemma KC
    if (card.lemmaId) {
      let lemmaKC = lemmaKCByLemmaId.get(card.lemmaId);
      if (!lemmaKC) {
        const kcId = `kc-lemma-${card.lemmaId}`;
        const fsrs = createInitialKnowledgeComponentFsrsState();
        db.insert(knowledgeComponents).values({
          id: kcId,
          kind: "lemma",
          label: `lemma:${card.lemmaId}`,
          labelPl: null,
          tagPattern: null,
          lemmaId: card.lemmaId,
          ...fsrs,
          createdAt: now,
        }).run();
        lemmaKC = {
          id: kcId,
          kind: "lemma",
          label: `lemma:${card.lemmaId}`,
          labelPl: null,
          tagPattern: null,
          lemmaId: card.lemmaId,
          ...fsrs,
          createdAt: now,
        };
        lemmaKCByLemmaId.set(card.lemmaId, lemmaKC);
        lemmaKCsCreated++;
      }
      matchingKcIds.push(lemmaKC.id);
    }

    for (const kcId of matchingKcIds) {
      pairsToInsert.push({ cardId: card.cardId, kcId });
    }
  }

  // Bulk insert in batches using onConflictDoNothing (idempotent)
  const BATCH_SIZE = 200;
  let linksCreated = 0;

  for (let i = 0; i < pairsToInsert.length; i += BATCH_SIZE) {
    const batch = pairsToInsert.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    db.insert(cardKnowledgeComponents)
      .values(batch)
      .onConflictDoNothing()
      .run();
    linksCreated += batch.length;
  }

  return {
    cardsProcessed: morphCards.length,
    linksCreated,
    lemmaKCsCreated,
  };
}
