-- Opt-in multi-origin fulfillment. Existing orders keep their original flow.
ALTER TABLE order_stock_holds DROP CONSTRAINT IF EXISTS order_stock_holds_status_check;
ALTER TABLE order_stock_holds ADD CONSTRAINT order_stock_holds_status_check
  CHECK (status IN ('held', 'reserved', 'allocated', 'released'));
CREATE TABLE IF NOT EXISTS fulfillment_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_hash text NOT NULL,
  fingerprint text NOT NULL,
  plan jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fulfillment_quotes_expiry ON fulfillment_quotes(expires_at);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_version integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS allocation_state text
  CHECK (allocation_state IN ('reserved','allocated','released','exception'));
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_location_id uuid REFERENCES stocktake_locations(id) ON DELETE RESTRICT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_snapshot jsonb;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS quote_snapshot jsonb;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS external_reference text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_shipment_id text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_cents integer CHECK (delivery_cents >= 0);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS booking_state text
  CHECK (booking_state IN ('waiting_payment','pending','booking','booked','failed','uncertain','cancelled'));
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS booking_error text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS booking_started_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_event_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS shipments_external_reference ON shipments(tenant_id, external_reference) WHERE external_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipments_provider_id ON shipments(tenant_id, provider_shipment_id) WHERE provider_shipment_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS fulfillment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  state text NOT NULL CHECK (state IN ('reserved','allocated','released','restored')),
  UNIQUE (order_item_id, location_id)
);
CREATE INDEX IF NOT EXISTS fulfillment_allocations_reserved ON fulfillment_allocations(variant_id, location_id) WHERE state = 'reserved';
CREATE INDEX IF NOT EXISTS fulfillment_allocations_order ON fulfillment_allocations(tenant_id, order_id);
CREATE TABLE IF NOT EXISTS fulfillment_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, shipment_id, event_key)
);
-- All stock writers lock variants before locations. This final guard also
-- protects absolute stocktake/import writes from consuming reserved units.
CREATE OR REPLACE FUNCTION protect_fulfillment_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reserved integer;
BEGIN
  SELECT COALESCE(sum(quantity),0) INTO reserved FROM fulfillment_allocations
    WHERE variant_id = OLD.variant_id AND location_id = OLD.location_id AND state = 'reserved';
  IF (TG_OP = 'DELETE' AND reserved > 0) OR (TG_OP = 'UPDATE' AND NEW.quantity < reserved) THEN
    RAISE EXCEPTION 'Stock is reserved for an online payment; release the reservation before reducing it.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_fulfillment_reservations ON variant_location_stock;
CREATE TRIGGER protect_fulfillment_reservations BEFORE UPDATE OR DELETE ON variant_location_stock
  FOR EACH ROW EXECUTE FUNCTION protect_fulfillment_reservations();
CREATE TABLE IF NOT EXISTS fulfillment_payment_claims (
  provider_reference text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
