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

class DiskStorage {
  constructor(options = {}) {
    this.uploadsDir = options.uploadsDir || path.resolve(__dirname, '..', 'uploads');
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
    const slug = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const fullPath = path.join(this.uploadsDir, slug);
    await fs.promises.writeFile(fullPath, buffer);
    return {
      url: `${this.publicBase}/${slug}`,
      storagePath: fullPath,
      mimeType: mimeType || mimeFromExt(ext) || 'application/octet-stream',
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
  instance = new DiskStorage();
} else {
  // Future: 's3' / 'supabase' / 'r2' adapters live here.
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}. Supported: disk.`);
}

module.exports = {
  storage: instance,
  uploadsDir: instance.uploadsDir,
  publicBase: instance.publicBase,
};
