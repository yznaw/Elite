-- Bring products.base_price_cents in line with the sizes that are actually sold.
--
-- The shop sells at the variant's price: that is what the storefront shows, what the bag
-- charges and what the till rings up. `base_price_cents` is a fallback for variants that
-- carry no price of their own, the value a newly added size is created with, and the key the
-- admin list sorts and filters by. Typed by hand, it drifted: on live data one product
-- advertised 1,000 while a colour cost 1,300, and two others sat above their cheapest size.
--
-- Application code now derives this column on every product save and catalog import. This is
-- the one-time catch-up for rows written before that, and it is safe to re-run: products
-- whose column already equals their cheapest active variant are left untouched, and products
-- with no priced variants keep what they have.

BEGIN;

UPDATE products p
   SET base_price_cents = v.min_price,
       updated_at = now()
  FROM (
    SELECT product_id, min(price_cents) AS min_price
      FROM product_variants
     WHERE is_active AND price_cents > 0
     GROUP BY product_id
  ) v
 WHERE v.product_id = p.id
   AND p.base_price_cents IS DISTINCT FROM v.min_price;

COMMIT;
