/**
 * Storage adapter for media uploads.
 *
 * The default driver writes to `<server>/uploads` and exposes the files via
 * `app.use('/uploads', express.static(...))`. The adapter shape (constructor
 * + `save({ buffer, filename, mimeType })` returning `{ url, storagePath }`)
 * is the same one S3 / Supabase / R2 drivers will implement, so the route
 * code never sees the underlying provider.
 *
 * Switching to S3 in production becomes:
 *   STORAGE_DRIVER=s3 STORAGE_BUCKET=… AWS_ACCESS_KEY_ID=…
 * with a new `s3.driver.js` that conforms to the same interface.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const IMAGE_VARIANTS = [
  { key: 'thumb', width: 240, quality: 74 },
  { key: 'card', width: 640, quality: 78 },
  { key: 'grid', width: 900, quality: 80 },
  { key: 'pdp', width: 1400, quality: 82 },
  { key: 'zoom', width: 1800, quality: 84 },
];

class DiskStorage {
  constructor(options = {}) {
    this.uploadsDir = options.uploadsDir ? path.resolve(options.uploadsDir) : path.resolve(__dirname, '..', 'uploads');
    this.publicBase = options.publicBase || '/uploads';
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Persist a file buffer. Returns the public URL (relative — the client
   * resolves against the API base) and the absolute path on disk.
   *
   * Filenames are normalised to `<timestamp>-<random>.<ext>` so the same
   * filename uploaded twice never collides and so the original (potentially
   * unsafe) name never lands on disk.
   */
  async save({ buffer, filename, mimeType }) {
    const ext = (path.extname(filename || '') || extFromMime(mimeType) || '').toLowerCase();
    const baseSlug = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const slug = `${baseSlug}${ext}`;
    const fullPath = path.join(this.uploadsDir, slug);
    await fs.promises.writeFile(fullPath, buffer);
    const dimensions = (sharp && isOptimizableImage(mimeType, ext))
      ? await sharp(buffer, { animated: false }).metadata().then((meta) => ({
        width: meta.width || null,
        height: meta.height || null,
      })).catch(() => ({ width: null, height: null }))
      : { width: null, height: null };
    const variants = (sharp && isOptimizableImage(mimeType, ext))
      ? await this.createImageVariants({ buffer, baseSlug }).catch(() => ({}))
      : {};

    return {
      url: `${this.publicBase}/${slug}`,
      previewUrl: variants.card?.url || variants.grid?.url || `${this.publicBase}/${slug}`,
      storagePath: fullPath,
      mimeType: mimeType || mimeFromExt(ext) || 'application/octet-stream',
      width: dimensions.width,
      height: dimensions.height,
      variants,
    };
  }

  async remove(storagePath) {
    if (!storagePath) return;
    try {
      await fs.promises.unlink(storagePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async removeMany(storagePaths = []) {
    await Promise.all(
      storagePaths
        .filter(Boolean)
        .map((storagePath) => this.remove(storagePath).catch(() => undefined)),
    );
  }

  async createImageVariants({ buffer, baseSlug }) {
    if (!sharp) return {};
    const image = sharp(buffer, { animated: false }).rotate();
    const metadata = await image.metadata();
    const sourceWidth = metadata.width || 0;
    const entries = await Promise.all(
      IMAGE_VARIANTS
        .filter((variant) => !sourceWidth || sourceWidth >= variant.width * 0.75)
        .map(async (variant) => {
          const slug = `${baseSlug}-${variant.key}.webp`;
          const fullPath = path.join(this.uploadsDir, slug);
          await sharp(buffer, { animated: false })
            .rotate()
            .resize({
              width: variant.width,
              withoutEnlargement: true,
            })
            .webp({
              quality: variant.quality,
              effort: 5,
            })
            .toFile(fullPath);

          return [variant.key, {
            url: `${this.publicBase}/${slug}`,
            storagePath: fullPath,
            width: variant.width,
            mimeType: 'image/webp',
          }];
        }),
    );

    return Object.fromEntries(entries);
  }
}

function isOptimizableImage(mime, ext) {
  const normalizedMime = String(mime || '').toLowerCase();
  const normalizedExt = String(ext || '').toLowerCase();
  if (normalizedMime === 'image/gif' || normalizedExt === '.gif') return false;
  return ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(normalizedMime)
    || ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(normalizedExt);
}

function extFromMime(mime) {
  if (!mime) return '';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/avif') return '.avif';
  if (mime === 'model/gltf-binary' || mime === 'application/octet-stream') return '.glb';
  return '';
}

function mimeFromExt(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png':  return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif':  return 'image/gif';
    case '.avif': return 'image/avif';
    case '.glb':  return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    default: return null;
  }
}

const driver = (process.env.STORAGE_DRIVER || 'disk').toLowerCase();

let instance;
if (driver === 'disk') {
  instance = new DiskStorage({
    uploadsDir: process.env.UPLOADS_DIR,
    publicBase: process.env.UPLOADS_PUBLIC_BASE,
  });
  if (process.env.NODE_ENV === 'production' && !process.env.UPLOADS_DIR) {
    console.warn(
      'STORAGE_DRIVER=disk in production without UPLOADS_DIR. Set UPLOADS_DIR to a shared persistent volume, or uploaded media will not be shared across instances.',
    );
  }
} else {
  // Future: 's3' / 'supabase' / 'r2' adapters live here.
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}. Supported: disk.`);
}

module.exports = {
  storage: instance,
  uploadsDir: instance.uploadsDir,
  publicBase: instance.publicBase,
};
