// ============================================================================
// The banner for the article - three drafts, 5:2
//
// 1600 x 640 CSS pixels at double pixel density, so 3200 x 1280 in the
// image. That's large enough for any article header and divides cleanly by
// two.
//
// ----------------------------------------------------------------------------
// Where the colors and the font come from
//
// Not picked, but read from public/styles.css: ground, lines, text colors
// and the blue of the leading answer live there as variables, and this
// script pulls them from there. A banner whose gray sits a shade off from
// the page's gray looks wrong next to the screenshots, and nobody can say
// why.
//
// The same goes for the font: the preview images were made in this
// container, so with DejaVu Sans Mono. The banner takes the same one. On an
// iPhone it would be SF Mono - but a PNG is finished once it's made here,
// and then it should match the images it stands next to.
//
// ----------------------------------------------------------------------------
// The mark
//
// Two bars, cut verbatim from index.html. Redrawn, it would be the fourth
// copy of the same shape - and the first one that goes stale at the next
// change.
//
//   node scripts/banner.mjs
// ============================================================================

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

/** The mark from index.html - just the SVG. */
const MARKER = (() => {
  const a = html.indexOf('<svg viewBox="29 16 42 64"');
  const b = html.indexOf('</svg>', a) + 6;
  if (a < 0) throw new Error('Zeichen nicht in index.html gefunden');
  return html.slice(a, b);
})();

/** A color variable from styles.css. */
const color = (name) => {
  const t = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!t) throw new Error(`--${name} nicht in styles.css gefunden`);
  return t[1].trim();
};
const C = {
  bg: color('bg'), bg1: color('bg-1'), bg2: color('bg-2'), bg3: color('bg-3'),
  line: color('line'), text: color('text'), dim: color('dim'),
  dimmer: color('dimmer'), accent: color('accent'),
  fuellung: color('fuellung'), spitze: color('fuellung-spitze'),
};

const B = { w: 1600, h: 640 };   // 5:2

/**
 * How many pixels of a PNG actually have a color at all?
 *
 * No image library: the PNG gets inflated and un-filtered line by line -
 * that's just how PNG writes it, every line refers back to the one before.
 * "Colored" here means: the three channels are more than 24 apart. The
 * banner is gray on gray, an ox is brown.
 */
function colorShare(png) {
  const pieces = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    const art = png.toString('ascii', i + 4, i + 8);
    if (art === 'IHDR') {
      var width = png.readUInt32BE(i + 8);
      var tiefe = png[i + 16];
      var typ = png[i + 17];
    }
    if (art === 'IDAT') pieces.push(png.subarray(i + 8, i + 8 + len));
    i += len + 12;
  }
  // Chromium writes with or without an alpha channel depending on content.
  // Both cases need to work: this used to only handle RGBA, and the check
  // returned -1 for every image - a check that always says the same thing
  // checks nothing.
  const bpp = typ === 6 ? 4 : typ === 2 ? 3 : 0;
  if (!bpp || tiefe !== 8) return -1;
  const roh = zlib.inflateSync(Buffer.concat(pieces));
  const line = width * bpp;
  const vor = Buffer.alloc(line);
  let jetzt = Buffer.alloc(line);
  let bunt = 0;
  for (let y = 0, p = 0; p < roh.length; y++) {
    const f = roh[p++];
    roh.copy(jetzt, 0, p, p + line); p += line;
    for (let x = 0; x < line; x++) {
      const a = x >= bpp ? jetzt[x - bpp] : 0;
      const b = vor[x];
      const c = x >= bpp ? vor[x - bpp] : 0;
      if (f === 1) jetzt[x] = (jetzt[x] + a) & 255;
      else if (f === 2) jetzt[x] = (jetzt[x] + b) & 255;
      else if (f === 3) jetzt[x] = (jetzt[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const q = a + b - c;
        const da = Math.abs(q - a); const db = Math.abs(q - b); const dc = Math.abs(q - c);
        jetzt[x] = (jetzt[x] + (da <= db && da <= dc ? a : db <= dc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < line; x += bpp) {
      const r = jetzt[x]; const g = jetzt[x + 1]; const bl = jetzt[x + 2];
      if (Math.max(r, g, bl) - Math.min(r, g, bl) > 24) bunt++;
    }
    jetzt.copy(vor);
  }
  return bunt;
}

const GRUND = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${B.w}px; height: ${B.h}px; overflow: hidden;
    background: ${C.bg}; color: ${C.text};
    font-family: "DejaVu Sans Mono", ui-monospace, monospace;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .marker { display: flex; align-items: center; gap: .42em;
    font-weight: 700; letter-spacing: .18em; }
  .marker svg { width: .82em; height: 1.18em; fill: ${C.accent}; }
  .satz { color: ${C.dim}; }
  /* Ansem's characters.
     -------------------------------------------------------------------------
     Two approaches, and the difference is visible - see the sets further
     below.

     As a font: its own font family, otherwise the browser falls back to the
     monospace font and sets two empty boxes. DejaVu Sans Mono has neither
     U+1F402 nor U+1F004, Noto Color Emoji has both.

     Letter-spacing between the two, because otherwise they stick together.
     The offset with text-indent still keeps the group centered:
     letter-spacing also trails behind the last character and would
     otherwise push the group to the left. */
  .zeichen {
    font-family: "Noto Color Emoji", "Apple Color Emoji", sans-serif;
    letter-spacing: .16em; text-indent: .16em; line-height: 1;
  }
  /* As an image: then it's not the machine's font that decides how the ox
     looks, but the file. Same height as the font size, so both approaches
     share the same scale and the comparison is a fair one. */
  .zeichen.bilder { display: flex; align-items: center; gap: .16em; }
  .zeichen.bilder img { height: 1em; width: 1em; }
`;

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------
//
// The SIZED ground and the mark small in the middle, nothing else.
//
// The ground really is just one color: styles.css used to have two soft
// glows in it, violet top right and bone-white bottom left; those are long
// gone. What's here isn't a simplified reconstruction, then, it's the same
// ground the page has.
//
// Three sizes, so the decision gets made from the image, not a number.
// "Small" is relative to the area, and 1600 px is wider than you picture it
// while typing.
// The size is settled: no. 3 from the first pass, re-measured against the
// chosen image (23.3% of mark width, matching to the decimal).
const SIZES = [{ nr: 0, name: 'chosen', px: 76 }];

// Below it, the characters Ansem uses on X.
//
// "A bit smaller" here means 0.62 of the mark, not a fixed pixel count: the
// mark comes in three sizes, and a fixed number would be too big for the
// smallest banner and lost on the largest.
//
// 0.62 and not 0.8: emoji characters look heavier than letters at the same
// font size, because they fill the whole line - a pair set "smaller" would
// otherwise look the same size as the word above it. And not 0.4, because
// then it reads as a footnote instead of part of the mark.
const CHARACTERS = '🐂🀄️';
const CHARACTER_SHARE = 0.62;
const ABSTAND_ANTEIL = 0.34;   // gap between mark and characters, relative to the mark

// ---------------------------------------------------------------------------
// Which ox?
// ---------------------------------------------------------------------------
//
// An emoji is a codepoint, not an image. How it looks is decided by the
// machine displaying it - and the sets look noticeably different. A banner,
// though, is a finished PNG: whatever gets rendered into it here, everyone
// sees, no matter what device they're on.
//
//   noto     - the font in this container. It came up because it was there,
//              not because it was chosen.
//   twemoji  - the set X itself uses. On X the banner then sits next to the
//              very same characters that appear next to Ansem's name.
//
// Apple is out: Apple Color Emoji lives on the Mac in front of it, not here,
// and can't be shipped along. Anyone who wants the ox exactly as it looks
// while typing would have to generate the image on the Mac.
//
// The Twemoji files live under scripts/zeichen/ - Twitter/X, CC-BY 4.0.
// Taken verbatim rather than redrawn, for the same reason as the mark's
// symbol.
const alsBild = (file) => 'data:image/svg+xml;base64,'
  + fs.readFileSync(path.join(root, 'scripts', 'zeichen', file)).toString('base64');

const SENTENCES = [
  { nr: 1, name: 'Noto (die Schrift hier)', klasse: '', content: CHARACTERS },
  { nr: 2, name: 'Twemoji (der Satz von X)', klasse: ' bilder',
    content: `<img src="${alsBild('1f402.svg')}" alt="">`
          + `<img src="${alsBild('1f004.svg')}" alt="">` },
];

const DRAFTS = SENTENCES.flatMap((s) => SIZES.map((g) => ({
  nr: s.nr,
  name: s.name,
  was: `Die Marke nimmt ${Math.round(g.px * 5.4 / B.w * 100)} % der Breite ein, `
     + `die Zeichen darunter ${Math.round(g.px * CHARACTER_SHARE)} px.`,
  css: `body { gap: ${Math.round(g.px * ABSTAND_ANTEIL)}px; }
        .marker { font-size: ${g.px}px; }
        .zeichen { font-size: ${Math.round(g.px * CHARACTER_SHARE)}px; }`,
  body: `<div class="marker">${MARKER}SIZED</div>
         <div class="zeichen${s.klasse}">${s.content}</div>`,
})));

// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

console.log(`\nBanner ${B.w}x${B.h} (5:2), doppelte Punktdichte\n`);

for (const e of DRAFTS) {
  const page = await browser.newPage({
    viewport: { width: B.w, height: B.h }, deviceScaleFactor: 2,
  });
  await page.setContent(
    `<style>${GRUND}${e.css}</style>${e.body}`, { waitUntil: 'load' });

  // Measure, don't trust: a banner whose content touches the edge looks
  // clipped on a narrow screen - and whether that happens depends on the
  // font, not the intent.
  const luft = await page.evaluate(() => {
    const parts = [...document.body.children];
    const r = parts.map((t) => t.getBoundingClientRect());
    return {
      left: Math.round(Math.min(...r.map((x) => x.left))),
      right: Math.round(innerWidth - Math.max(...r.map((x) => x.right))),
      peek: Math.round(Math.min(...r.map((x) => x.top))),
      bottom: Math.round(innerHeight - Math.max(...r.map((x) => x.bottom))),
    };
  });

  // Are the characters really characters - or two empty boxes?
  // -------------------------------------------------------------------------
  // If the font is missing, the browser sets fallback boxes. Those have a
  // width, sit in the right spot, and pass any check that only looks at
  // geometry. The difference is in the color: the ox and the mahjong tile
  // are colorful, a fallback box never is. So this counts how many pixels in
  // the field actually have a color at all.
  const zeichen = await page.evaluate(() => {
    const el = document.querySelector('.zeichen');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.left), y: Math.floor(r.top),
      width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });

  const file = path.join(root, 'preview', `banner-${e.nr}.png`);
  await page.screenshot({ path: file });
  const cutout = zeichen && zeichen.width > 0
    ? await page.screenshot({ clip: zeichen }) : null;
  await page.close();

  const bunt = cutout ? colorShare(cutout) : 0;

  const eng = Math.min(luft.left, luft.right, luft.peek, luft.bottom);
  console.log(`  ${e.nr}. ${e.name}`);
  console.log(`     Rand: ${luft.peek} peek, ${luft.right} right, `
    + `${luft.bottom} bottom, ${luft.left} left`
    + `${eng < 40 ? `   << eng (${eng} px)` : ''}`);
  console.log(`     ${e.was}`);
  console.log(`     Zeichen: ${bunt} farbige Bildpunkte`
    + `${bunt < 200 ? '   << ERSATZKASTEN? Schrift pruefen' : ''}`);
  console.log(`     ${path.relative(root, file)}\n`);
}

await browser.close();
