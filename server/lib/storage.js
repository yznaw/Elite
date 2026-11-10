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
const sharp = require('sharp');
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);

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
  async save({ buffer }) {
    // Decode and rewrite before storage. Neither the MIME declaration nor the
    // filename can select an executable format or preserve unvalidated bytes.
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('An image must be between 1 byte and 50 MB.'), { status: 413 });
    }
    let encoded;
    try {
      const input = sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' });
      const meta = await input.metadata();
      if (!IMAGE_FORMATS.has(meta.format) || !meta.width || !meta.height ||
          meta.width * (meta.pageHeight || meta.height) * (meta.pages || 1) > MAX_INPUT_PIXELS || (meta.pages || 1) > 100) {
        throw new Error('Unsupported image');
      }
      // Strips metadata and trailing content; preserves supported animation.
      const normalized = (meta.pages || 1) > 1 ? input : input.rotate();
      encoded = await normalized.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    } catch {
      throw Object.assign(new Error('Upload a valid JPEG, PNG, WebP, GIF or AVIF image within the image limits.'), {
        status: 415, code: 'INVALID_IMAGE',
      });
    }
    const baseSlug = `${Date.now().toString(36)}-${crypto.randomBytes(16).toString('hex')}`;
    const slug = `${baseSlug}.webp`;
    const fullPath = path.join(this.uploadsDir, slug);
    await fs.promises.writeFile(fullPath, encoded.data, { flag: 'wx' });
    const variants = await this.createImageVariants({ buffer: encoded.data, baseSlug }).catch(() => ({}));
    return {
      url: `${this.publicBase}/${slug}`,
      previewUrl: variants.card?.url || variants.grid?.url || `${this.publicBase}/${slug}`,
      storagePath: fullPath,
      mimeType: 'image/webp',
      sizeBytes: encoded.data.length,
      width: encoded.info.width,
      height: encoded.info.height,
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
  DiskStorage,
  storage: instance,
  uploadsDir: instance.uploadsDir,
  publicBase: instance.publicBase,
  // Exported so callers can recognise a generated derivative by its filename
  // instead of keeping their own copy of the suffix list and drifting from it.
  IMAGE_VARIANT_KEYS: IMAGE_VARIANTS.map((variant) => variant.key),
};
