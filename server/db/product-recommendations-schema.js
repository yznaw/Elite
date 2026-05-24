async function ensureProductRecommendationsSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_recommendations (
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      recommended_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (product_id, recommended_product_id),
      CONSTRAINT product_recommendations_not_self CHECK (product_id <> recommended_product_id)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS product_recommendations_tenant_product_idx
    ON product_recommendations (tenant_id, product_id, sort_order)
  `);
}

module.exports = {
  ensureProductRecommendationsSchema,
};
