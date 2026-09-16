// Regenerates docs/33-user-roles-guide.pdf from its HTML source.
//
//   cd client && node scripts/build-roles-guide-pdf.mjs
//
// Uses the Chromium that Playwright already installs for the e2e suite, so the
// Arabic text is shaped and laid out RTL by the same engine the browser's own
// "Save as PDF" would use. Do not hand-edit the PDF: edit the HTML and re-run.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// scripts/ -> client/ -> repo root
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = path.join(root, 'docs', '33-user-roles-guide.html');
const out = path.join(root, 'docs', '33-user-roles-guide.pdf');

if (!fs.existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`file://${src}`, { waitUntil: 'networkidle' });
  // The guide loads IBM Plex Sans Arabic from Google Fonts; without this the
  // PDF renders in a fallback face and the line breaks shift.
  await page.evaluate(() => document.fonts.ready);

  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });

  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`Wrote ${path.relative(root, out)} (${kb} KB)`);
} finally {
  await browser.close();
}
