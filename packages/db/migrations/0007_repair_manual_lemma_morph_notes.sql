-- Backfill morph notes for existing manual lemmas that have none.
-- Idempotent: NOT EXISTS guard prevents duplicates.
INSERT INTO notes (id, kind, lemma_id, front, back, last_reviewed_at, created_at, updated_at)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  'morph',
  l.id,
  NULL, NULL, NULL,
  unixepoch(),
  unixepoch()
FROM lemmas l
WHERE l.source = 'manual'
  AND NOT EXISTS (
    SELECT 1 FROM notes n WHERE n.lemma_id = l.id AND n.kind = 'morph'
  );
