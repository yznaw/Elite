const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { DiskStorage } = require('../lib/storage');

test('image rewriting preserves supported raster formats and rejects active/truncated content without a file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elite-storage-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storage = new DiskStorage({ uploadsDir: dir });
  for (const format of ['jpeg', 'png', 'gif', 'webp', 'avif']) {
    const image = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#bbaacc' } }).toFormat(format).toBuffer();
    const saved = await storage.save({ buffer: image, filename: '../../active.html', mimeType: 'text/html' });
    assert.ok(saved.storagePath.startsWith(dir + path.sep));
    assert.match(saved.url, /\.webp$/);
    const meta = await sharp(await fs.readFile(saved.storagePath)).metadata();
    assert.equal(meta.format, 'webp');assert.equal(meta.width, 12);assert.equal(meta.height, 10);
  }
  const before = await fs.readdir(dir);
  for (const body of ['<html><script>alert(1)</script></html>', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'PNG']) {
    await assert.rejects(storage.save({ buffer: Buffer.from(body), filename: 'fake.png', mimeType: 'image/png' }), { status: 415 });
  }
  assert.deepEqual(await fs.readdir(dir), before, 'rejected content must never be written');
});

test('animated GIF remains animated after safe WebP rewriting', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elite-animation-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const gif = await sharp(Buffer.from([255,0,0, 0,0,255]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  }).gif({ delay: [100,100], loop: 0 }).toBuffer();
  assert.equal((await sharp(gif,{animated:true}).metadata()).pages,2);
  const saved = await new DiskStorage({ uploadsDir: dir }).save({ buffer: gif });
  assert.equal((await sharp(saved.storagePath,{animated:true}).metadata()).pages,2);
});
