/**
 * Shared multer config for media upload endpoints.
 *
 * Memory storage so the buffer is handed straight to the storage adapter
 * (disk today, S3 tomorrow). Per-file 50 MB cap matches the UI hint shown on
 * the media drop zone.
 */
const multer = require('multer');

const ACCEPTED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'model/gltf-binary', 'application/octet-stream', // .glb often comes through as octet-stream
]);

const MAX_SIZE_BYTES = Number.parseInt(process.env.UPLOAD_MAX_SIZE_BYTES, 10) || 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Allow .glb explicitly even when the browser reports octet-stream.
    const isGlb = (file.originalname || '').toLowerCase().endsWith('.glb');
    if (ACCEPTED.has(file.mimetype) || isGlb) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

module.exports = {
  upload,
  MAX_SIZE_BYTES,
};
