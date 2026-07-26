# Product System Fixes — June 2026

> Plain-language summary of everything that was found and fixed in the product, variant, and bulk-import system.

---

## What was broken and what we fixed

### 1. Variants were showing up in the wrong order

**What users saw:** After saving a product, the color and size variants would sometimes appear in a different order than what was entered.

**Why it happened:** The database query used a special aggregation function that collected all variants into a list, but that function does not support sorting in PostgreSQL. Variants came back in whatever order the database felt like.

**What we fixed:** Rewrote the query to collect variants in a proper sorted order (by their manual `sort_order` position, then by creation date). This affects the admin product list, the single-product view, and the customer-facing storefront. The same bug existed in the orders and customer pages for order line items — fixed there too.

---

### 2. Product descriptions were not loading in the editor

**What users saw:** Opening an existing product in the admin editor showed empty description fields, even though descriptions had been saved before.

**Why it happened:** The server was sending the description as a combined JSON object (`{ en: "...", ar: "..." }`) but the frontend was not unpacking it — it was just leaving the fields blank.

**What we fixed:** The server now unpacks the description and sends `enDesc` and `arDesc` as two separate plain text fields. The editor picks them up correctly.

---

### 3. Renaming a color did not update the variant SKUs

**What users saw:** Renaming a color group (e.g. "Black" → "Onyx") updated the color label in the variant rows, but the SKU codes in those variants still had the old color abbreviation (e.g. `ELT-BLA-M` stayed as-is instead of becoming `ELT-ONY-M`).

**Why it happened:** The color rename logic was updating the color name but not touching the SKU string.

**What we fixed:** When a color group is renamed, the system now finds the color segment inside each variant's SKU and replaces it with the new color's abbreviation.

---

### 4. Stock total on the product was not updating after a save

**What users saw:** After editing a product's variant stock quantities and saving, the total stock shown on the product list sometimes did not match the sum of the variants.

**Why it happened:** The product-level stock was only updated if something explicitly changed it; saving variants did not trigger a recalculation.

**What we fixed:** Every time variants are saved, the product's total stock is automatically recalculated as the sum of all variant quantities.

---

### 5. Bulk import was erasing Arabic descriptions

**What users saw:** Re-importing a product CSV to update prices or stock would wipe out any Arabic description that had been written in the admin editor.

**Why it happened:** The import always wrote the description as `{ en: "...", ar: "" }`, not checking whether an Arabic description already existed.

**What we fixed:** Before updating an existing product, the import now reads the current Arabic description from the database and keeps it. Only the English description (which comes from the CSV) is updated.

---

### 6. Bulk import was zeroing out existing stock

**What users saw:** If a CSV row had 0 in the stock column (or stock was left blank), re-importing would set that variant's stock to 0, even if it had real stock in the system.

**Why it happened:** The import treated every CSV stock value as authoritative, including zero.

**What we fixed:** A zero in the CSV now means "no data" — the existing stock is preserved. Only positive stock values from the CSV overwrite existing stock. (When saving through the admin editor, zero still means zero — it is only the import that ignores zeros.)

---

### 7. Bulk import was not linking variants to the color reference table

**What users saw:** After a bulk import, variants existed with a color name but were not linked to the brand's canonical color list (the reference colors set up in the Reference page).

**Why it happened:** The import SQL was not populating the `color_ref_id` column that connects a variant to its official color entry.

**What we fixed:** The import now does an automatic lookup against the color reference table and links each variant to the matching color entry by name.

---

### 8. Bulk import was using the wrong brand name

**What users saw:** Products imported via CSV were always tagged with the brand name "Elite", even when the platform was configured with a different tenant name.

**Why it happened:** The brand name was hardcoded as `'Elite'` in the import code.

**What we fixed:** The brand name now comes from the tenant configuration, so it is always correct regardless of which brand is using the platform.

---

### 9. Bulk import was not updating the base SKU on re-import

**What users saw:** Re-importing a product with a corrected SKU would update the variants but leave the product's base SKU unchanged.

**Why it happened:** The `UPDATE` query for existing products was not including the SKU field.

**What we fixed:** The base SKU is now updated along with the other product fields when re-importing.

---

### 10. Duplicate fields in the API response were causing data to be overwritten

**What users saw:** Certain product fields (meta title, meta description, slug, related products) would sometimes lose their values after a save.

**Why it happened:** The server response mapper was outputting the same field names twice — the second one overwrote the first one with an empty or wrong value.

**What we fixed:** Removed the duplicate field entries from the response mapper so each field is sent exactly once with the correct value.

---

### 11. Color image linking failed when images had the `/api/` prefix in their URL

**What users saw:** Linking a color to a gallery image worked sometimes but failed silently for images whose URL had `/api/` at the start.

**Why it happened:** The database lookup was comparing the URL as-is, but the stored URL format does not include the `/api/` prefix. The mismatch meant no match was found.

**What we fixed:** The URL is normalized (the `/api/` prefix is stripped) before doing the database lookup.

---

### 12. Product name grouping in bulk import was sensitive to extra spaces

**What users saw:** A CSV with a product name like `"Leather Bag"` (two spaces) would create a duplicate product instead of updating the existing one named `"Leather Bag"` (one space).

**Why it happened:** The grouping logic compared names character-for-character, so any formatting difference in the CSV created a separate product.

**What we fixed:** Internal whitespace in product names is collapsed to a single space before grouping, so minor CSV formatting differences no longer create duplicate products.

---

## Files changed

| File | What changed |
|---|---|
| `server/routes/admin-products.route.js` | `mapAdminProduct()` cleanup, correlated subquery for variants, stock auto-sum, `trustZeroStock` flag, color image URL fix |
| `server/routes/admin-bulk-import.route.js` | Arabic preservation, brand from tenant, SKU update on re-import, `color_ref_id` linking, stock preservation, whitespace normalization |
| `server/routes/products.route.js` | Storefront variants query converted to correlated subquery with ordering |
| `server/routes/admin-orders.route.js` | Order items query converted to correlated subquery with ordering |
| `server/routes/admin-customers.route.js` | Order items in customer history converted to correlated subquery |
| `client/.../models/index.ts` | Added `enDesc?` and `arDesc?` to `Product` interface |
| `client/.../product-drawer.component.ts` | Description pre-fill, `colorToSkuCode()` helper, `extractColorCodeFromSku()` helper, color rename SKU update, description sync after save |
