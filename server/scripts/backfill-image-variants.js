require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const db = require('../db/client');
const { storage } = require('../lib/storage');

async function main() {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query(
      `
        SELECT id, storage_url, preview_url, metadata
        FROM media_assets
        WHERE kind = 'image'
          AND metadata ? 'storagePath'
          AND NOT (metadata ? 'imageVariants')
        ORDER BY uploaded_at
      `,
    );

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const storagePath = row.metadata?.storagePath;
      if (!storagePath) {
        skipped += 1;
        continue;
      }

      try {
        await fs.access(storagePath);
        const buffer = await fs.readFile(storagePath);
        const meta = await sharp(buffer, { animated: false }).metadata();
        const baseSlug = path.basename(storagePath, path.extname(storagePath));
        const variants = await storage.createImageVariants({ buffer, baseSlug });
        if (Object.keys(variants).length === 0) {
          skipped += 1;
          continue;
        }

        await client.query(
          `
            UPDATE media_assets
            SET
              preview_url = $2,
              width = COALESCE(width, $3),
              height = COALESCE(height, $4),
              metadata = metadata || $5::jsonb,
              updated_at = now()
            WHERE id = $1
          `,
          [
            row.id,
            variants.card?.url || variants.grid?.url || row.preview_url || row.storage_url,
            meta.width || null,
            meta.height || null,
            JSON.stringify({ imageVariants: variants }),
          ],
        );
        updated += 1;
      } catch (err) {
        skipped += 1;
        console.warn(`Skipped ${row.id}: ${err.message}`);
      }
    }

    console.log(`Image variant backfill complete. Updated ${updated}, skipped ${skipped}.`);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
