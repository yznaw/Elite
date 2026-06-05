-- 004_product_meta_seo.sql
-- Adds SEO meta fields to products table.
-- These fields are editable from the admin portal product drawer.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS meta_title text,
  ADD COLUMN IF NOT EXISTS meta_desc  text;
