-- Per-location stock: each store and the warehouse hold their own quantity.
-- 2026-09-26. Runs from db/pos-schema.js (after 037, which created
-- stocktake_locations) on every boot, so everything here is idempotent.
--
-- The model (see server/lib/location-stock.js):
--
--   product_variants.stock_quantity = SUM(location quantities) - SUM(held)
--
-- stock_quantity stays the *sellable total* the storefront, carts, restock
-- alerts and reports already read, so none of them change. Locations reuse
-- stocktake_locations (one 'store' row per pos_branches row + one
-- 'warehouse'), which until now only labelled counts (037 said so).
--
-- Nothing here changes behaviour on its own. Location balances are only
-- written while tenants.config.inventory.perLocation is true, and switching
-- that on (activatePerLocation) seeds every variant's current total into the
-- warehouse in one transaction. No backfill runs here, so a boot never
-- touches stock.

CREATE TABLE IF NOT EXISTS variant_location_stock (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  -- RESTRICT: a location that still holds stock must not silently vanish.
  location_id uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  quantity    integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, location_id)
);

CREATE INDEX IF NOT EXISTS variant_location_stock_location_idx
  ON variant_location_stock (tenant_id, location_id);

-- A paid website order reserves units from the sellable total before anyone
-- has chosen which location ships it. 'held' = not yet allocated (counts
-- against the total, not against any location); 'allocated' = deducted from
-- location_id at approval; 'released' = order cancelled before approval.
CREATE TABLE IF NOT EXISTS order_stock_holds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity     integer NOT NULL CHECK (quantity > 0),
  status       text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'allocated', 'released')),
  location_id  uuid REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  allocated_at timestamptz,
  released_at  timestamptz,
  UNIQUE (order_id, variant_id),
  CHECK (status <> 'allocated' OR location_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS order_stock_holds_held_idx
  ON order_stock_holds (tenant_id, variant_id)
  WHERE status = 'held';

-- Every location write records which location it touched. NULL for
-- total-only events (a web hold or its release) and for all history before
-- per-location stock was switched on.
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES stocktake_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_location_idx
  ON inventory_movements (location_id, occurred_at DESC)
  WHERE location_id IS NOT NULL;

-- order-stock.js looks movements up by reference on every paid-order call;
-- there was no index for it.
CREATE INDEX IF NOT EXISTS inventory_movements_reference_idx
  ON inventory_movements (tenant_id, reference_type, reference_id);

-- Web-order approval (staff choose the pickup location).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_location_id uuid REFERENCES stocktake_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- One-step moves between locations. The units themselves are two
-- inventory_movements rows per line (reference_type 'transfer').
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_location_id   uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  to_location_id     uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  note               text,
  line_count         integer NOT NULL DEFAULT 0,
  unit_count         integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (from_location_id <> to_location_id)
);

CREATE INDEX IF NOT EXISTS stock_transfers_tenant_idx
  ON stock_transfers (tenant_id, created_at DESC);

-- A stocktake started while per-location stock is on snapshots what each
-- location should hold, so posting can apply (counted - expected) per
-- location instead of against the combined figure.
CREATE TABLE IF NOT EXISTS stocktake_location_expected (
  stocktake_id      uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  location_id       uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  variant_id        uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  expected_quantity integer NOT NULL CHECK (expected_quantity >= 0),
  PRIMARY KEY (stocktake_id, location_id, variant_id)
);
