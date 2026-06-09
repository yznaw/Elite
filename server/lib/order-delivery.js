const nbox = require('./nbox');

function fromCents(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function nboxQuoteMetadata(quote) {
  if (!quote) return null;
  return {
    id: quote.id || quote.rateId || null,
    serviceName: quote.serviceName || quote.service_name || null,
    serviceCode: quote.serviceCode || quote.service_code || null,
    amount: Number(quote.amount || 0),
    currency: quote.currency || 'QAR',
    eta: quote.eta || null,
  };
}

function nboxQuoteFromOrder(order) {
  return order.metadata?.nbox?.quote || null;
}

function nboxItems(rows) {
  return rows.map((item) => ({
    id: item.product_id,
    productId: item.product_id,
    sku: item.sku,
    name: item.product_name,
    productName: item.product_name,
    qty: item.quantity,
    quantity: item.quantity,
    price: fromCents(item.unit_price_cents),
  }));
}

async function withOrderDeliveryLock(client, tenantId, orderId, fn) {
  const lockKey = `nbox:${tenantId}:${orderId}`;
  await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [lockKey]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [lockKey]).catch(() => {});
  }
}

async function recordNboxBookingFailure(client, tenantId, orderId, err) {
  await client.query(
    `
      UPDATE orders
         SET metadata = metadata || jsonb_build_object(
               'nbox',
               COALESCE(metadata->'nbox', '{}'::jsonb) || jsonb_build_object(
                 'bookingFailedAt', $3::text,
                 'bookingError', $4::text
               )
             )
       WHERE tenant_id = $1 AND id = $2
    `,
    [
      tenantId,
      orderId,
      new Date().toISOString(),
      err.message,
    ],
  ).catch(() => {});

  await client.query(
    `
      INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
      VALUES ($1, $2, 'note', $3, $4::jsonb)
    `,
    [
      tenantId,
      orderId,
      'NBOX shipment booking failed after payment was confirmed.',
      JSON.stringify({
        provider: 'nbox',
        error: err.message,
        details: err.details || null,
      }),
    ],
  ).catch(() => {});
}

async function bookNboxForPaidOrder(client, tenantId, orderId) {
  if (!nbox.isConfigured()) {
    return { created: false, skipped: true, reason: 'nbox_not_configured' };
  }

  return withOrderDeliveryLock(client, tenantId, orderId, async () => {
    const existing = await client.query(
      "SELECT id, tracking_number FROM shipments WHERE tenant_id = $1 AND order_id = $2 AND carrier = 'nbox' LIMIT 1",
      [tenantId, orderId],
    );
    if (existing.rowCount > 0) {
      return {
        created: false,
        skipped: true,
        reason: 'already_booked',
        shipmentId: existing.rows[0].id,
        trackingNumber: existing.rows[0].tracking_number,
      };
    }

    const orderResult = await client.query(
      'SELECT * FROM orders WHERE tenant_id = $1 AND id = $2',
      [tenantId, orderId],
    );
    if (orderResult.rowCount === 0) {
      return { created: false, skipped: true, reason: 'order_not_found' };
    }

    const order = orderResult.rows[0];
    if (order.payment_status !== 'paid') {
      return { created: false, skipped: true, reason: 'order_not_paid' };
    }

    const itemResult = await client.query(
      `
        SELECT product_id, sku, product_name, quantity, unit_price_cents
          FROM order_items
         WHERE tenant_id = $1 AND order_id = $2
         ORDER BY created_at
      `,
      [tenantId, orderId],
    );

    let shipment;
    try {
      shipment = await nbox.createShipment({
        orderNumber: order.public_number,
        customer: {
          name: order.customer_name,
          email: order.customer_email,
          phone: order.customer_phone,
        },
        shippingAddress: order.shipping_address || {},
        items: nboxItems(itemResult.rows),
        shippingQuote: nboxQuoteFromOrder(order),
      });
    } catch (err) {
      await recordNboxBookingFailure(client, tenantId, orderId, err);
      return {
        created: false,
        failed: true,
        reason: 'nbox_booking_failed',
        error: err.message,
      };
    }

    await client.query(
      `
        INSERT INTO shipments (
          tenant_id, order_id, carrier, service, tracking_number, tracking_url, status, address
        )
        VALUES ($1, $2, 'nbox', $3, $4, $5, 'processing', $6::jsonb)
      `,
      [
        tenantId,
        order.id,
        shipment.id || nboxQuoteFromOrder(order)?.serviceName || 'NBOX',
        shipment.trackingNumber || null,
        shipment.trackingUrl || null,
        JSON.stringify(order.shipping_address || {}),
      ],
    );

    await client.query(
      `
        UPDATE orders
           SET fulfillment_status = CASE
                 WHEN fulfillment_status = 'awaiting' THEN 'processing'
                 ELSE fulfillment_status
               END,
               metadata = metadata || $3::jsonb
         WHERE tenant_id = $1 AND id = $2
      `,
      [
        tenantId,
        order.id,
        JSON.stringify({
          nbox: {
            quote: nboxQuoteFromOrder(order),
            shipment,
            bookedAt: new Date().toISOString(),
          },
        }),
      ],
    );

    await client.query(
      `
        INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
        SELECT $1, $2, 'processing', $3, $4::jsonb
        WHERE NOT EXISTS (
          SELECT 1
            FROM order_timeline_entries
           WHERE order_id = $2
             AND kind = 'processing'
             AND metadata->>'provider' = 'nbox'
        )
      `,
      [
        tenantId,
        order.id,
        shipment.trackingNumber
          ? `NBOX shipment booked. Tracking: ${shipment.trackingNumber}`
          : 'NBOX shipment booked.',
        JSON.stringify({ provider: 'nbox', shipment }),
      ],
    );

    return { created: true, shipment };
  });
}

module.exports = {
  bookNboxForPaidOrder,
  nboxQuoteMetadata,
};
