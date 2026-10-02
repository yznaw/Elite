-- 048_color_image_primary.sql (2026-10-02)
--
-- A colour can now carry several gallery images (product_color_images already
-- allowed more than one row per colour). is_primary marks the one shown as that
-- colour's image on collection cards, the cart and as the first image on the
-- product page. When no row is flagged, the lowest sort_order row is used.
--
-- Affected tables:
--   product_color_images   + is_primary

ALTER TABLE product_color_images
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
