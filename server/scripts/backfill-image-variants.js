require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const db = require('../db/client');
const { storage, uploadsDir } = require('../lib/storage');

/**
 * Where the bytes for an asset actually are.
 *
 * `metadata.storagePath` is the reliable answer and is what an upload records
 * today, but the catalogue also holds older rows that predate it: same files on
 * disk, no path in the row. Those are not a rare edge case, they are the rows
 * the live product galleries link to, so a backfill that only reads
 * `storagePath` repairs the unreferenced duplicates and leaves every image a
 * customer actually sees serving its full-size original.
 *
 * The fallback rebuilds the path from the public URL, which ends in the stored
 * filename either way (`/uploads/<slug>` or `https://host/api/uploads/<slug>`).
 * Remote URLs that are not ours resolve to null and are skipped: there is no
 * local file to derive variants from.
 */
function resolveSourcePath(row) {
  const recorded = row.metadata?.storagePath;
  if (recorded) return recorded;

  const url = String(row.storage_url || '');
  const match = url.match(/\/uploads\/([^/?#]+)$/);
  if (!match) return null;

  return path.join(uploadsDir, decodeURIComponent(match[1]));
}

async function main() {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query(
      `
        -- An asset is unprocessed when it has no imageVariants key at all, and
        -- also when it has one holding an empty object: that is what an upload
        -- writes when sharp is unavailable or the derive step throws, so the
        -- key exists while no variant does. Matching only on the missing key
        -- left those rows permanently unreachable by this script, which is the
        -- state they are in whenever they are found serving originals.
        SELECT id, storage_url, preview_url, metadata
        FROM media_assets
        WHERE kind = 'image'
          AND COALESCE(metadata->'imageVariants', '{}'::jsonb) = '{}'::jsonb
        ORDER BY uploaded_at
      `,
    );

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const storagePath = resolveSourcePath(row);
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
            JSON.stringify({ imageVariants: variants, storagePath }),
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
