-- Delete morph_form cards whose tag starts with 'brev' — these are Morfeusz2
-- abbreviation/punctuation noise entries (e.g. brev:pun) that were created
-- before the isUsable() filter was added to @rzyns/strus-morph. Quizzing on
-- abbreviation forms (["ks", "x"] for książę) is meaningless.
--
-- Cascade: reviews for these cards are deleted first (FK constraint), then
-- the cards themselves, then the corresponding morph_forms rows.

-- 1. Delete reviews referencing brev morph_form cards
DELETE FROM reviews
WHERE card_id IN (
  SELECT id FROM cards WHERE kind = 'morph_form' AND tag LIKE 'brev%'
);--> statement-breakpoint

-- 2. Delete the brev morph_form cards
DELETE FROM cards WHERE kind = 'morph_form' AND tag LIKE 'brev%';--> statement-breakpoint

-- 3. Delete the brev morph_forms rows (the raw paradigm data)
DELETE FROM morph_forms WHERE tag LIKE 'brev%';
