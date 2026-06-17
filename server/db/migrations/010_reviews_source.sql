-- Migration 010: add source column to product_reviews
-- Tracks whether feedback came from the storefront or the in-store iPad kiosk.
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS source text DEFAULT 'storefront';
