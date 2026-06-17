-- Migration 011: support general (non-product) feedback
-- Drops NOT NULL on product_id so a review can exist without a linked product.
-- Drops NOT NULL on body so kiosk users can submit rating-only feedback.
ALTER TABLE product_reviews ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE product_reviews ALTER COLUMN body DROP NOT NULL;
