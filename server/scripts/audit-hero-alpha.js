require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const db = require('../db/client');

/**
 * Read-only alpha audit for the images the home hero actually renders.
 *
 * Written for docs/26 Phase 1A. The point is to answer "which cut-outs need
 * re-doing, and where", before anyone opens Photoshop. The plan named a single
 * production file from a browser session; that is not an inventory, and on the
 * development dataset that filename does not exist at all. Whoever is about to
 * do the retouching should run this against the environment they are fixing and
 * work from its output.
 *
 * It never writes. There is no repair flag and there should not be one: the
 * repair is a human re-cut from the source photography, not a filter.
 *
 * Usage:
 *   node scripts/audit-hero-alpha.js
 *   node scripts/audit-hero-alpha.js --sheets   also write QA contact sheets
 *
 * The numbers below are triage, not a verdict. They are tuned to surface the
 * two defects that actually shipped: semi-transparent streaks trailing off the
 * product, and detached islands of leftover background. A clean cut-out still
 * carries a thin band of partial alpha, because that band is the antialiased
 * outline of the shoe. Judge the contact sheet, not the percentage.
 */

/** Alpha at or below this is background. Above it, something is painted. */
const FAINT_ALPHA = 8;
/** Alpha above this is the product proper rather than its antialiased edge. */
const SOLID_ALPHA = 250;
/**
 * A clean edge is a couple of pixels wide. Partial alpha reaching much further
 * than this from the solid silhouette is a streak or a matte halo, not an edge.
 */
const EDGE_TOLERANCE_PX = 6;
/**
 * A row with no product in it that is nonetheless painted across a wide stretch
 * is the streak signature from the plan: it reads as the rectangular boundary
 * of the image on a retina screen.
 */
const STREAK_ROW_COVERAGE = 0.25;
/** Below this, a source cannot produce the responsive sizes the hero wants. */
const MIN_SOURCE_WIDTH = 1800;

async function heroImages(client) {
  const { rows } = await client.query(
    `SELECT tenant_id, home_content->'heroSlider'->'items' AS items
       FROM store_settings
      WHERE jsonb_array_length(COALESCE(home_content->'heroSlider'->'items', '[]'::jsonb)) > 0`,
  );

  const uses = new Map();
  for (const row of rows) {
    for (const item of row.items || []) {
      const note = (url, label) => {
        if (!url) return;
        if (!uses.has(url)) uses.set(url, { tenantId: row.tenant_id, used: [] });
        uses.get(url).used.push(label);
      };
      note(item.imageUrl, `${item.name || item.id} (slide default)`);
      for (const colour of item.colors || []) {
        note(colour.imageUrl, `${item.name || item.id} / ${colour.label}`);
      }
    }
  }
  return uses;
}

async function inspect(filePath) {
  const image = sharp(filePath);
  const meta = await image.metadata();
  if (!meta.hasAlpha) {
    return { width: meta.width, height: meta.height, hasAlpha: false, findings: ['no alpha channel'] };
  }

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;

  const solidCols = new Uint32Array(w);
  const solidRows = new Uint32Array(h);
  const faintCols = new Uint32Array(w);
  const faintRows = new Uint32Array(h);
  let faintTotal = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * c + c - 1];
      if (alpha > SOLID_ALPHA) {
        solidCols[x] += 1;
        solidRows[y] += 1;
      } else if (alpha > FAINT_ALPHA) {
        faintCols[x] += 1;
        faintRows[y] += 1;
        faintTotal += 1;
      }
    }
  }

  const extent = (counts) => {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > 0) {
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    return [lo, hi];
  };

  // Union of solid and faint, because the question is how far anything painted
  // reaches beyond the silhouette.
  const anyCols = solidCols.map((v, i) => v + faintCols[i]);
  const anyRows = solidRows.map((v, i) => v + faintRows[i]);

  const [solidLeft, solidRight] = extent(solidCols);
  const [solidTop, solidBottom] = extent(solidRows);
  const [anyLeft, anyRight] = extent(anyCols);
  const [anyTop, anyBottom] = extent(anyRows);

  const overhang = {
    left: solidLeft - anyLeft,
    right: anyRight - solidRight,
    top: solidTop - anyTop,
    bottom: anyBottom - solidBottom,
  };

  const streakRows = [];
  for (let y = 0; y < h; y++) {
    if (solidRows[y] === 0 && faintRows[y] > w * STREAK_ROW_COVERAGE) streakRows.push(y);
  }

  const findings = [];
  for (const [side, px] of Object.entries(overhang)) {
    if (px > EDGE_TOLERANCE_PX) {
      findings.push(`partial alpha reaches ${px}px past the product on the ${side}`);
    }
  }
  if (streakRows.length > 0) {
    const sample = streakRows.slice(0, 5).join(', ');
    findings.push(
      `${streakRows.length} row(s) painted with no product in them (streaks) — e.g. y=${sample}`,
    );
  }
  if (w < MIN_SOURCE_WIDTH) {
    findings.push(`source is ${w}px wide; under ${MIN_SOURCE_WIDTH}px the largest variants are skipped`);
  }

  return {
    width: w,
    height: h,
    hasAlpha: true,
    faintPercent: (100 * faintTotal) / (w * h),
    solidBox: [solidLeft, solidTop, solidRight, solidBottom],
    overhang,
    findings,
  };
}

/**
 * Three backgrounds, one file. White and near-black are where a matte halo
 * shows; the checkerboard is where a large flat region of near-transparent
 * pixels shows, which neither solid colour reveals.
 */
async function contactSheet(filePath, outPath) {
  const panelWidth = 900;
  const shot = await sharp(filePath)
    .resize({ width: panelWidth, withoutEnlargement: true })
    .toBuffer();
  const { height: panelHeight } = await sharp(shot).metadata();

  // Small tiles on purpose. A large check reads as two flat backgrounds and
  // hides exactly what this panel exists to reveal: a broad, barely-there wash
  // of leftover background that neither white nor dark shows on its own.
  const tile = 16;
  const board = Buffer.from(
    `<svg width="${panelWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg">
       <defs>
         <pattern id="c" width="${tile * 2}" height="${tile * 2}" patternUnits="userSpaceOnUse">
           <rect width="${tile * 2}" height="${tile * 2}" fill="#ffffff"/>
           <rect width="${tile}" height="${tile}" fill="#cfcfcf"/>
           <rect x="${tile}" y="${tile}" width="${tile}" height="${tile}" fill="#cfcfcf"/>
         </pattern>
       </defs>
       <rect width="100%" height="100%" fill="url(#c)"/>
     </svg>`,
  );

  const panel = async (background) =>
    sharp(background)
      .composite([{ input: shot, gravity: 'center' }])
      .png()
      .toBuffer();

  const flat = (colour) => ({
    create: { width: panelWidth, height: panelHeight, channels: 4, background: colour },
  });

  const checker = await sharp(board).png().toBuffer();

  const panels = await Promise.all([
    panel(flat({ r: 255, g: 255, b: 255, alpha: 1 })),
    // The hero canvas, so a halo is judged against the background it ships on.
    panel(flat({ r: 245, g: 241, b: 234, alpha: 1 })),
    panel(flat({ r: 0, g: 69, b: 56, alpha: 1 })),
    panel(checker),
  ]);

  await sharp({
    create: {
      width: panelWidth * 2,
      height: panelHeight * 2,
      channels: 4,
      background: { r: 20, g: 20, b: 20, alpha: 1 },
    },
  })
    .composite([
      { input: panels[0], left: 0, top: 0 },
      { input: panels[1], left: panelWidth, top: 0 },
      { input: panels[2], left: 0, top: panelHeight },
      { input: panels[3], left: panelWidth, top: panelHeight },
    ])
    .png()
    .toFile(outPath);
}

async function main() {
  const writeSheets = process.argv.includes('--sheets');
  const uploadsDir = path.resolve(__dirname, '..', 'uploads');
  const sheetDir = path.resolve(__dirname, '..', 'uploads', 'alpha-qa');
  if (writeSheets) await fs.mkdir(sheetDir, { recursive: true });

  const client = await db.pool.connect();
  let uses;
  try {
    uses = await heroImages(client);
  } finally {
    client.release();
  }

  if (uses.size === 0) {
    console.log('No hero images are configured. Nothing to audit.');
    return;
  }

  console.log(`Auditing ${uses.size} hero image(s) from ${uploadsDir}\n`);

  let flagged = 0;
  for (const [url, meta] of [...uses.entries()].sort()) {
    const filePath = path.join(uploadsDir, path.basename(url));
    console.log(url);
    for (const label of meta.used) console.log(`   used by  ${label}`);

    let report;
    try {
      report = await inspect(filePath);
    } catch (err) {
      flagged += 1;
      console.log(`   FAIL     cannot read (${err.message})\n`);
      continue;
    }

    console.log(`   size     ${report.width}x${report.height}`);
    if (report.hasAlpha) {
      console.log(`   edge     partial alpha ${report.faintPercent.toFixed(2)}% of canvas, `
        + `overhang L${report.overhang.left} R${report.overhang.right} `
        + `T${report.overhang.top} B${report.overhang.bottom}`);
    }

    if (report.findings.length === 0) {
      console.log('   OK       no anomalies detected — still confirm on the contact sheet');
    } else {
      flagged += 1;
      for (const finding of report.findings) console.log(`   FLAG     ${finding}`);
    }

    if (writeSheets) {
      const out = path.join(sheetDir, `${path.basename(url, path.extname(url))}-qa.png`);
      try {
        await contactSheet(filePath, out);
        console.log(`   sheet    ${out}`);
      } catch (err) {
        console.log(`   sheet    failed (${err.message})`);
      }
    }
    console.log('');
  }

  console.log(flagged === 0
    ? 'No asset was flagged. Numeric checks are triage only: sign off on the contact sheets.'
    : `${flagged} asset(s) flagged. Re-cut from the source photography, do not filter in place.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
