#!/usr/bin/env node
/**
 * Idempotent seed for the Elite admin portal.
 *
 * Inserts a small but realistic dataset:
 *   - default tenant + default admin user (delegated to tenant.js)
 *   - 8 products with 2-3 variants each
 *   - 3 collections referencing those products
 *   - 6 customers
 *   - 8 orders + line items + a few timeline entries / notes
 *
 * The catalog here is NOT a copy of the frontend mock — it's a smaller,
 * distinct fixture so existing dev data isn't churned, and the admin UI has
 * something meaningful to render after `npm run db:migrate`.
 *
 *   node db/seed.js
 *   # or
 *   npm run db:seed
 */
require('dotenv').config();
const db = require('./client');
const { ensureDefaultTenant } = require('./tenant');

const CATALOG = [
  {
    sku: 'EC-AMO-2026',
    name: 'Al-Mahmal Oxford',
    brand: 'Elite Atelier',
    price: 2800,
    stock: 14,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Hand-stitched in our Doha atelier from full-grain camel leather.</p>',
    descriptionAr: '<p>مصنوع يدوياً في ورشتنا بالدوحة من جلد الجمل الكامل.</p>',
    variants: [
      { sku: 'EC-AMO-2026-42-BLK', size: '42', color: 'Black', material: 'Calf Leather', price: 2800, stock: 4 },
      { sku: 'EC-AMO-2026-43-BLK', size: '43', color: 'Black', material: 'Calf Leather', price: 2800, stock: 5 },
      { sku: 'EC-AMO-2026-44-BRN', size: '44', color: 'Brown', material: 'Camel Leather', price: 2950, stock: 3 },
    ],
  },
  {
    sku: 'EC-NDB-2026',
    name: 'Najd Derby',
    brand: 'Elite Atelier',
    price: 2200,
    stock: 9,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Classic derby silhouette refined in supple Najd-tanned leather.</p>',
    descriptionAr: '<p>تصميم ديربي كلاسيكي بجلد نجدي رفيع.</p>',
    variants: [
      { sku: 'EC-NDB-2026-41-BLK', size: '41', color: 'Black', material: 'Calf Leather', price: 2200, stock: 3 },
      { sku: 'EC-NDB-2026-42-BLK', size: '42', color: 'Black', material: 'Calf Leather', price: 2200, stock: 4 },
    ],
  },
  {
    sku: 'EC-HLF-2026',
    name: 'Hijaz Loafer',
    brand: 'Elite Atelier',
    price: 1950,
    stock: 22,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Featherweight loafer with hand-finished braided trim.</p>',
    descriptionAr: '<p>حذاء لوفر خفيف بتطعيمات يدوية مجدولة.</p>',
    variants: [
      { sku: 'EC-HLF-2026-42-TAN', size: '42', color: 'Tan', material: 'Suede', price: 1950, stock: 8 },
      { sku: 'EC-HLF-2026-43-TAN', size: '43', color: 'Tan', material: 'Suede', price: 1950, stock: 9 },
      { sku: 'EC-HLF-2026-44-NVY', size: '44', color: 'Navy', material: 'Suede', price: 2050, stock: 5 },
    ],
  },
  {
    sku: 'EC-RKB-2026',
    name: 'Rub Al Khali Boot',
    brand: 'Elite Atelier',
    price: 3400,
    stock: 5,
    has3d: false,
    image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Desert-tested boot with hand-burnished cap toe.</p>',
    descriptionAr: '<p>بوت صحراوي بمقدّمة يدوية ملمّعة.</p>',
    variants: [
      { sku: 'EC-RKB-2026-43-BRN', size: '43', color: 'Brown', material: 'Camel Leather', price: 3400, stock: 3 },
      { sku: 'EC-RKB-2026-44-BRN', size: '44', color: 'Brown', material: 'Camel Leather', price: 3400, stock: 2 },
    ],
  },
  {
    sku: 'EC-QCH-2026',
    name: 'Quraish Chelsea',
    brand: 'Elite Atelier',
    price: 2650,
    stock: 11,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Hand-lasted Chelsea boot with elastic gussets and pull-tab.</p>',
    descriptionAr: '<p>حذاء تشيلسي بشريط مطاطي وحلقة سحب يدوية.</p>',
    variants: [
      { sku: 'EC-QCH-2026-42-BLK', size: '42', color: 'Black', material: 'Calf Leather', price: 2650, stock: 6 },
      { sku: 'EC-QCH-2026-43-BLK', size: '43', color: 'Black', material: 'Calf Leather', price: 2650, stock: 5 },
    ],
  },
  {
    sku: 'NKE-AM90-WHT',
    name: 'Nike Air Max 90',
    brand: 'Nike',
    price: 680,
    stock: 42,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Iconic 1990 silhouette in cool grey and infrared accents.</p>',
    descriptionAr: '<p>تصميم 1990 الأيقوني برمادي بارد ولمسات إنفراريد.</p>',
    variants: [
      { sku: 'NKE-AM90-WHT-42', size: '42', color: 'White', material: 'Mesh', price: 680, stock: 14 },
      { sku: 'NKE-AM90-WHT-43', size: '43', color: 'White', material: 'Mesh', price: 680, stock: 18 },
      { sku: 'NKE-AM90-WHT-44', size: '44', color: 'White', material: 'Mesh', price: 680, stock: 10 },
    ],
  },
  {
    sku: 'NB-990V6-GRY',
    name: 'New Balance 990v6',
    brand: 'New Balance',
    price: 980,
    stock: 18,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Made-in-USA 990v6 with ENCAP cushioning.</p>',
    descriptionAr: '<p>إصدار 990v6 الأمريكي بوسادة ENCAP.</p>',
    variants: [
      { sku: 'NB-990V6-GRY-42', size: '42', color: 'Grey', material: 'Suede/Mesh', price: 980, stock: 9 },
      { sku: 'NB-990V6-GRY-43', size: '43', color: 'Grey', material: 'Suede/Mesh', price: 980, stock: 9 },
    ],
  },
  {
    sku: 'CP-ACH-WHT',
    name: 'Common Projects Achilles Low',
    brand: 'Common Projects',
    price: 1740,
    stock: 7,
    has3d: true,
    image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&q=80&auto=format&fit=crop',
    descriptionEn: '<p>Minimal Italian sneaker with gold-foiled heel stamp.</p>',
    descriptionAr: '<p>حذاء رياضي إيطالي بسيط مع طبعة كعب ذهبية.</p>',
    variants: [
      { sku: 'CP-ACH-WHT-42', size: '42', color: 'White', material: 'Nappa Leather', price: 1740, stock: 4 },
      { sku: 'CP-ACH-WHT-43', size: '43', color: 'White', material: 'Nappa Leather', price: 1740, stock: 3 },
    ],
  },
];

const COLLECTIONS = [
  {
    handle: 'summer-2026',
    title: 'Summer 2026',
    description: 'Lightweight leathers and bright accents.',
    imageUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80',
    productSkus: ['EC-HLF-2026', 'NKE-AM90-WHT', 'CP-ACH-WHT'],
  },
  {
    handle: 'classic-oxfords',
    title: 'Classic Oxfords',
    description: 'Timeless elegance for formal occasions.',
    imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&q=80',
    productSkus: ['EC-AMO-2026', 'EC-NDB-2026'],
  },
  {
    handle: 'street-style',
    title: 'Street Style',
    description: 'Premium sneakers for everyday wear.',
    imageUrl: 'https://images.unsplash.com/photo-1527090526205-beaac8dc3c62?w=800&q=80',
    productSkus: ['NKE-AM90-WHT', 'NB-990V6-GRY', 'CP-ACH-WHT'],
  },
];

const CUSTOMERS = [
  { email: 'khalid@gulfmail.qa',     name: 'Khalid Al-Mansoori',  city: 'Doha',      sizePref: 43, notes: 'Prefers Oxford styles. Bespoke client.' },
  { email: 'fatima@althani.qa',      name: 'Fatima Al-Thani',     city: 'Doha',      sizePref: 38, notes: 'Twice-yearly orders. Favours suede.' },
  { email: 'ahmed.k@elitemail.com',  name: 'Ahmed Al-Kuwari',     city: 'Doha',      sizePref: 44, notes: 'VIP. Personal advisor: Yusuf.' },
  { email: 'layla.hassan@gmail.com', name: 'Layla Hassan',        city: 'Lusail',    sizePref: 39, notes: 'New client. Onboarding in progress.' },
  { email: 'omar@alsulaiti.me',      name: 'Omar Al-Sulaiti',     city: 'Al Wakrah', sizePref: 42, notes: 'Likes limited editions.' },
  { email: 'noor.attiyah@gulfnet.qa', name: 'Noor Al-Attiyah',    city: 'Doha',      sizePref: 39, notes: 'Bridal gift commissions.' },
];

const ORDERS = [
  {
    publicNumber: 'EC-26-2001',
    customerEmail: 'ahmed.k@elitemail.com',
    placedAt: '2026-04-28T09:14:00Z',
    payment: 'paid',
    fulfillment: 'shipped',
    shipping: { line1: 'Villa 14, Al-Dafna, Doha', country: 'QA' },
    tracking: 'QPS-2026-009124',
    items: [
      { sku: 'EC-AMO-2026-44-BRN', name: 'Al-Mahmal Oxford', size: '44', qty: 1, price: 2950 },
      { sku: 'EC-HLF-2026-43-TAN', name: 'Hijaz Loafer',     size: '43', qty: 1, price: 1950 },
    ],
    notes: [
      'Customer asked for gift-wrapping with a handwritten card. Coordinate with concierge.',
    ],
  },
  {
    publicNumber: 'EC-26-2002',
    customerEmail: 'khalid@gulfmail.qa',
    placedAt: '2026-04-27T11:30:00Z',
    payment: 'paid',
    fulfillment: 'processing',
    shipping: { line1: 'Villa 27, West Bay, Doha', country: 'QA' },
    items: [
      { sku: 'EC-RKB-2026-43-BRN', name: 'Rub Al Khali Boot', size: '43', qty: 1, price: 3400 },
    ],
  },
  {
    publicNumber: 'EC-26-2003',
    customerEmail: 'fatima@althani.qa',
    placedAt: '2026-04-26T16:08:00Z',
    payment: 'paid',
    fulfillment: 'delivered',
    shipping: { line1: 'Tower B 1208, The Pearl, Doha', country: 'QA' },
    tracking: 'QPS-2026-008892',
    items: [
      { sku: 'EC-NDB-2026-41-BLK', name: 'Najd Derby', size: '41', qty: 1, price: 2200 },
    ],
  },
  {
    publicNumber: 'EC-26-2004',
    customerEmail: 'layla.hassan@gmail.com',
    placedAt: '2026-04-25T08:00:00Z',
    payment: 'pending',
    fulfillment: 'awaiting',
    shipping: { line1: 'Lusail Boulevard 18, Lusail', country: 'QA' },
    items: [
      { sku: 'CP-ACH-WHT-42', name: 'Common Projects Achilles Low', size: '42', qty: 1, price: 1740 },
    ],
    notes: ['Payment failed once — customer retrying via WhatsApp.'],
  },
  {
    publicNumber: 'EC-26-2005',
    customerEmail: 'omar@alsulaiti.me',
    placedAt: '2026-04-24T19:42:00Z',
    payment: 'paid',
    fulfillment: 'delivered',
    shipping: { line1: 'Apartment 402, Al Wakrah Marina', country: 'QA' },
    tracking: 'QPS-2026-008410',
    items: [
      { sku: 'EC-QCH-2026-42-BLK', name: 'Quraish Chelsea', size: '42', qty: 1, price: 2650 },
    ],
  },
  {
    publicNumber: 'EC-26-2006',
    customerEmail: 'noor.attiyah@gulfnet.qa',
    placedAt: '2026-04-23T14:00:00Z',
    payment: 'paid',
    fulfillment: 'shipped',
    shipping: { line1: 'Villa 9, Onaiza, Doha', country: 'QA' },
    tracking: 'QPS-2026-008127',
    items: [
      { sku: 'NKE-AM90-WHT-43', name: 'Nike Air Max 90', size: '43', qty: 1, price: 680 },
      { sku: 'NB-990V6-GRY-43', name: 'New Balance 990v6', size: '43', qty: 1, price: 980 },
    ],
  },
  {
    publicNumber: 'EC-26-2007',
    customerEmail: 'ahmed.k@elitemail.com',
    placedAt: '2026-04-22T12:18:00Z',
    payment: 'refunded',
    fulfillment: 'returned',
    shipping: { line1: 'Villa 14, Al-Dafna, Doha', country: 'QA' },
    items: [
      { sku: 'EC-NDB-2026-42-BLK', name: 'Najd Derby', size: '42', qty: 1, price: 2200 },
    ],
    notes: ['Returned due to sizing mismatch — refunded in full.'],
  },
  {
    publicNumber: 'EC-26-2008',
    customerEmail: 'fatima@althani.qa',
    placedAt: '2026-04-20T10:30:00Z',
    payment: 'paid',
    fulfillment: 'delivered',
    shipping: { line1: 'Tower B 1208, The Pearl, Doha', country: 'QA' },
    tracking: 'QPS-2026-007988',
    items: [
      { sku: 'EC-HLF-2026-42-TAN', name: 'Hijaz Loafer', size: '42', qty: 1, price: 1950 },
    ],
  },
];

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

async function seedProducts(client, tenantId) {
  const idsBySku = new Map();

  for (const p of CATALOG) {
    const inserted = await client.query(
      `
        INSERT INTO products (
          tenant_id, sku, brand, name, slug, status, description,
          base_price_cents, currency, stock_quantity, has_3d
        )
        VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb, $7, 'QAR', $8, $9)
        ON CONFLICT (tenant_id, sku) DO UPDATE
        SET brand = EXCLUDED.brand,
            name = EXCLUDED.name,
            slug = EXCLUDED.slug,
            status = 'active',
            description = EXCLUDED.description,
            base_price_cents = EXCLUDED.base_price_cents,
            stock_quantity = EXCLUDED.stock_quantity,
            has_3d = EXCLUDED.has_3d
        RETURNING id
      `,
      [
        tenantId,
        p.sku,
        p.brand,
        p.name,
        slugify(`${p.brand}-${p.name}`),
        JSON.stringify({ en: p.descriptionEn, ar: p.descriptionAr }),
        toCents(p.price),
        p.stock,
        p.has3d,
      ],
    );
    const productId = inserted.rows[0].id;
    idsBySku.set(p.sku, productId);

    // Primary image — recorded as a media_assets row + media_links 'primary'.
    const media = await client.query(
      `
        INSERT INTO media_assets (tenant_id, filename, kind, storage_url, preview_url)
        VALUES ($1, $2, 'image', $3, $3)
        RETURNING id
      `,
      [tenantId, `${p.sku}-primary.jpg`, p.image],
    );
    const mediaId = media.rows[0].id;
    await client.query('UPDATE products SET primary_media_id = $1 WHERE id = $2', [mediaId, productId]);
    await client.query(
      `
        INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
        VALUES ($1, $2, $3, 'primary', 0)
        ON CONFLICT DO NOTHING
      `,
      [tenantId, mediaId, productId],
    );

    // Variants — replace on re-seed so price/stock edits stay deterministic.
    await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
    for (const [index, v] of p.variants.entries()) {
      await client.query(
        `
          INSERT INTO product_variants (
            tenant_id, product_id, sku, size, color, material,
            price_cents, stock_quantity, sort_order, is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        `,
        [tenantId, productId, v.sku, v.size, v.color, v.material, toCents(v.price), v.stock, index],
      );
    }
  }

  return idsBySku;
}

async function seedCollections(client, tenantId, productIdsBySku) {
  for (const [index, c] of COLLECTIONS.entries()) {
    const inserted = await client.query(
      `
        INSERT INTO collections (tenant_id, handle, title, description, status, sort_order, seo)
        VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb)
        ON CONFLICT (tenant_id, handle) DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            status = 'active',
            sort_order = EXCLUDED.sort_order,
            seo = EXCLUDED.seo
        RETURNING id
      `,
      [tenantId, c.handle, c.title, c.description, index, JSON.stringify({ imageUrl: c.imageUrl })],
    );
    const collectionId = inserted.rows[0].id;

    await client.query('DELETE FROM collection_products WHERE collection_id = $1', [collectionId]);
    for (const [order, sku] of c.productSkus.entries()) {
      const productId = productIdsBySku.get(sku);
      if (!productId) continue;
      await client.query(
        `
          INSERT INTO collection_products (tenant_id, collection_id, product_id, sort_order)
          VALUES ($1, $2, $3, $4)
        `,
        [tenantId, collectionId, productId, order],
      );
    }
  }
}

async function seedCustomers(client, tenantId) {
  const idsByEmail = new Map();
  for (const c of CUSTOMERS) {
    const inserted = await client.query(
      `
        INSERT INTO customers (tenant_id, email, full_name, city, size_preference, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            city = EXCLUDED.city,
            size_preference = EXCLUDED.size_preference,
            notes = EXCLUDED.notes
        RETURNING id
      `,
      [tenantId, c.email, c.name, c.city, c.sizePref, c.notes],
    );
    idsByEmail.set(c.email, inserted.rows[0].id);
  }
  return idsByEmail;
}

async function seedOrders(client, tenantId, customerIdsByEmail, productIdsBySku) {
  for (const o of ORDERS) {
    const subtotal = o.items.reduce((sum, it) => sum + toCents(it.price) * it.qty, 0);
    const total = subtotal;
    const customerId = customerIdsByEmail.get(o.customerEmail) || null;
    const customer = CUSTOMERS.find((c) => c.email === o.customerEmail);

    // Idempotent on public_number — delete the old order if present, then re-insert.
    await client.query(
      'DELETE FROM orders WHERE tenant_id = $1 AND public_number = $2',
      [tenantId, o.publicNumber],
    );

    const inserted = await client.query(
      `
        INSERT INTO orders (
          tenant_id, public_number, customer_id, customer_email, customer_name,
          status, payment_status, fulfillment_status, currency,
          subtotal_cents, total_cents,
          shipping_address, billing_address, placed_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, 'QAR',
          $9, $10,
          $11::jsonb, $12::jsonb, $13
        )
        RETURNING id
      `,
      [
        tenantId,
        o.publicNumber,
        customerId,
        o.customerEmail,
        customer?.name || o.customerEmail,
        statusFromFulfillment(o.fulfillment, o.payment),
        o.payment,
        o.fulfillment,
        subtotal,
        total,
        JSON.stringify(o.shipping),
        JSON.stringify(o.shipping),
        o.placedAt,
      ],
    );
    const orderId = inserted.rows[0].id;

    for (const item of o.items) {
      const unit = toCents(item.price);
      // Look up product/variant by SKU so analytics joins work.
      const productLookup = await client.query(
        `
          SELECT p.id AS product_id, v.id AS variant_id
          FROM products p
          LEFT JOIN product_variants v ON v.product_id = p.id AND v.sku = $2
          WHERE p.tenant_id = $1 AND (p.sku = $3 OR v.sku = $2)
          LIMIT 1
        `,
        [tenantId, item.sku, item.sku.split('-').slice(0, -1).join('-')],
      );
      const productId = productLookup.rows[0]?.product_id || null;
      const variantId = productLookup.rows[0]?.variant_id || null;

      await client.query(
        `
          INSERT INTO order_items (
            tenant_id, order_id, product_id, variant_id,
            sku, product_name, size, quantity, unit_price_cents, total_cents
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [tenantId, orderId, productId, variantId, item.sku, item.name, item.size, item.qty, unit, unit * item.qty],
      );
    }

    if (o.tracking) {
      await client.query(
        `
          INSERT INTO shipments (tenant_id, order_id, carrier, tracking_number, status, shipped_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [tenantId, orderId, 'Qatar Post', o.tracking, o.fulfillment === 'delivered' ? 'delivered' : 'shipped', o.placedAt],
      );
    }

    // Timeline — synthesise a realistic chain based on the current state.
    const timeline = [{ kind: 'placed', detail: 'Order placed', ts: o.placedAt }];
    if (o.payment === 'paid' || o.payment === 'refunded') {
      timeline.push({ kind: 'paid', detail: 'Payment captured', ts: bumpMinutes(o.placedAt, 1) });
    }
    if (['processing', 'shipped', 'delivered', 'returned'].includes(o.fulfillment)) {
      timeline.push({ kind: 'processing', detail: 'Order being prepared', ts: bumpMinutes(o.placedAt, 90) });
    }
    if (['shipped', 'delivered', 'returned'].includes(o.fulfillment)) {
      timeline.push({ kind: 'shipped', detail: o.tracking || 'Shipped', ts: bumpMinutes(o.placedAt, 180) });
    }
    if (o.fulfillment === 'delivered') {
      timeline.push({ kind: 'delivered', detail: 'Delivered to customer', ts: bumpMinutes(o.placedAt, 60 * 28) });
    }
    if (o.fulfillment === 'returned') {
      timeline.push({ kind: 'returned', detail: 'Returned by customer', ts: bumpMinutes(o.placedAt, 60 * 48) });
    }
    if (o.payment === 'refunded') {
      timeline.push({ kind: 'refunded', detail: 'Refund processed', ts: bumpMinutes(o.placedAt, 60 * 50) });
    }

    for (const entry of timeline) {
      await client.query(
        `
          INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, occurred_at)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [tenantId, orderId, entry.kind, entry.detail, entry.ts],
      );
    }

    for (const note of o.notes || []) {
      await client.query(
        `
          INSERT INTO order_notes (tenant_id, order_id, body)
          VALUES ($1, $2, $3)
        `,
        [tenantId, orderId, note],
      );
    }
  }
}

function statusFromFulfillment(fulfillment, payment) {
  if (fulfillment === 'delivered') return 'completed';
  if (fulfillment === 'returned') return 'returned';
  if (fulfillment === 'cancelled') return 'cancelled';
  if (payment === 'refunded') return 'refunded';
  if (fulfillment === 'shipped' || fulfillment === 'processing') return 'processing';
  return 'placed';
}

function bumpMinutes(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting seed.');
    process.exit(1);
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    console.log(`→ tenant ${tenant.slug} (${tenant.id})`);

    const productIds = await seedProducts(client, tenant.id);
    console.log(`→ ${productIds.size} products + variants seeded`);

    await seedCollections(client, tenant.id, productIds);
    console.log(`→ ${COLLECTIONS.length} collections seeded`);

    const customerIds = await seedCustomers(client, tenant.id);
    console.log(`→ ${customerIds.size} customers seeded`);

    await seedOrders(client, tenant.id, customerIds, productIds);
    console.log(`→ ${ORDERS.length} orders + items + timelines seeded`);

    await client.query('COMMIT');
    console.log('✅ Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
