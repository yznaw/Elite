async function ensureRestockNotificationsSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS restock_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      email citext NOT NULL,
      name text,
      phone text,
      size text NOT NULL,
      color text,
      locale text NOT NULL DEFAULT 'en',
      status text NOT NULL DEFAULT 'pending',
      requested_at timestamptz NOT NULL DEFAULT now(),
      notified_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT restock_notifications_status_check CHECK (status IN ('pending', 'notified', 'cancelled'))
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS restock_notifications_pending_product_idx
    ON restock_notifications (tenant_id, product_id, size, status, requested_at)
    WHERE status = 'pending'
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS restock_notifications_pending_unique_idx
    ON restock_notifications (tenant_id, product_id, email, size, lower(COALESCE(color, '')))
    WHERE status = 'pending'
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'restock_notifications_set_updated_at'
      ) THEN
        CREATE TRIGGER restock_notifications_set_updated_at
        BEFORE UPDATE ON restock_notifications
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END
    $$;
  `);
}

module.exports = {
  ensureRestockNotificationsSchema,
};
