-- 007 — Sub-collection support
-- Date: 2026-06-12
-- Affected tables: collections
-- Adds a self-referential parent_id so collections can be nested one or more
-- levels deep (e.g. "Men's" → "Watches", "Shirts"). Deleting a parent sets
-- children's parent_id to NULL (orphans them rather than cascading delete).

-- UP ─────────────────────────────────────────────────────────────────────────

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES collections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS collections_parent_idx ON collections (parent_id)
  WHERE parent_id IS NOT NULL;

-- DOWN ───────────────────────────────────────────────────────────────────────

-- DROP INDEX IF EXISTS collections_parent_idx;
-- ALTER TABLE collections DROP COLUMN IF EXISTS parent_id;
