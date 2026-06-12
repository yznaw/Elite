-- Migration 008: Add home_content_draft column for staged content editing
-- Allows admins to save draft content and preview before publishing live.
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS home_content_draft jsonb;
