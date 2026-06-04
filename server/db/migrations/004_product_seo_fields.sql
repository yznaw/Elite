-- Add SEO metadata columns to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS meta_title text,
  ADD COLUMN IF NOT EXISTS meta_desc  text;
