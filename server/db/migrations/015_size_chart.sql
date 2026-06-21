-- Add size_chart column to ref_size_sets to store UK/EU/US conversion rows.
-- Each row: { uk: string, eu: string, us: string }
-- sizes array is kept for backward compat (variants match by EU size value).
-- tip: optional text shown below the chart (e.g. "If between sizes, select larger").
ALTER TABLE ref_size_sets
  ADD COLUMN IF NOT EXISTS size_chart jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS tip        text;
