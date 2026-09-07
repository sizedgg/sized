// ============================================================================
// The announcement image for the post on @Sizedgg
//
// The mark, "LIVE SOON" underneath. Nothing else.
//
// Two formats, because X shows them differently:
//
//   16:9 (1600 x 900)  - the default format for a single image
//   1:1  (1200 x 1200) - takes up more height in the timeline and stands
//                        out more because of it
//
// Colors, font and mark come from the same source as the banner:
// public/styles.css and public/index.html. The reasoning is spelled out
// there in full; short version: a gray a shade off from the page's gray
// looks wrong next to the screenshots, and nobody can say why.
//
//   node scripts/live-soon.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

const MARKER = (() => {
  const a = html.indexOf('<svg viewBox="29 16 42 64"');
  const b = html.indexOf('</svg>', a) + 6;
  if (a < 0) throw new Error('Zeichen nicht in index.html gefunden');
  return html.slice(a, b);
})();

const color = (name) => {
  const t = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!t) throw new Error(`--${name} nicht in styles.css gefunden`);
  return t[1].trim();
};
const C = { bg: color('bg'), text: color('text'), dim: color('dim'),
  accent: color('accent') };

// The line.
//
// The closed site says "Launching soon." - here it says "LIVE SOON",
// because that's what was wanted. That's not a contradiction as long as
// you know it: one line lives on the site, the other on the account.
const SATZ = 'LIVE SOON';

// With and without the mark.
//
// Without it, the line gets bigger and brighter: alone on the canvas it
// becomes the image, not the caption underneath one. At --dim and 30px it
// would read like a note somebody forgot to remove.
const FORMATE = [
  { nr: 1, name: '16:9, mit Zeichen', w: 1600, h: 900, marker: 96, satz: 30 },
  { nr: 2, name: '1:1, mit Zeichen', w: 1200, h: 1200, marker: 88, satz: 28 },
  { nr: 3, name: '16:9, nur der Satz', w: 1600, h: 900, marker: 0, satz: 84 },
  { nr: 4, name: '1:1, nur der Satz', w: 1200, h: 1200, marker: 0, satz: 72 },
];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

console.log('\nAnkuendigungsbild fuer @Sizedgg\n');

for (const f of FORMATE) {
  const page = await browser.newPage({
    viewport: { width: f.w, height: f.h }, deviceScaleFactor: 2,
  });
  await page.setContent(`
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${f.w}px; height: ${f.h}px; overflow: hidden;
        background: ${C.bg}; color: ${C.text};
        font-family: "DejaVu Sans Mono", ui-monospace, monospace;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        /* The gap between the mark and the line is tied to the font size,
           not a fixed number: this keeps the ratio the same if someone
           changes the sizes above. */
        gap: ${Math.round((f.marker || f.satz) * 0.42)}px;
      }
      .marker { display: flex; align-items: center; gap: .42em;
        font-size: ${f.marker}px; font-weight: 700; letter-spacing: .18em; }
      .marker svg { width: .82em; height: 1.18em; fill: ${C.accent}; }
      /* More letter-spaced than the mark and clearly smaller: it's the
         caption below the mark, not a title's second line. Equal size
         would have read as two marks. */
      .satz { font-size: ${f.satz}px; letter-spacing: .38em;
        color: ${f.marker ? C.dim : C.text}; text-indent: .38em;
        ${f.marker ? '' : 'font-weight: 700;'} }
    </style>
    ${f.marker ? `<div class="marker">${MARKER}SIZED</div>` : ''}
    <div class="satz">${SATZ}</div>`, { waitUntil: 'load' });

  // Verify by measuring: the group has to be truly centered. A
  // text-indent, letter-spacing, a margin - any of these can shift it by a
  // few pixels, and on an empty canvas that's exactly what shows.
  const lage = await page.evaluate(() => {
    const r = [...document.body.children].map((t) => t.getBoundingClientRect());
    const left = Math.min(...r.map((x) => x.left));
    const right = innerWidth - Math.max(...r.map((x) => x.right));
    return {
      seitlich: Math.round(left - right),
      peek: Math.round(Math.min(...r.map((x) => x.top))),
      bottom: Math.round(innerHeight - Math.max(...r.map((x) => x.bottom))),
    };
  });

  const file = path.join(root, 'preview', `live-soon-${f.nr}.png`);
  await page.screenshot({ path: file });
  await page.close();

  console.log(`  ${f.nr}. ${f.name}  ${f.w * 2}x${f.h * 2}`);
  console.log(`     mittig: ${Math.abs(lage.seitlich)} px Unterschied left/right`
    + `, ${lage.peek} peek / ${lage.bottom} bottom`);
  console.log(`     ${path.relative(root, file)}\n`);
}

await browser.close();
