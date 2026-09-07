// ============================================================================
// The diagram for X
//
// Three columns in monospace on the page's own background, in the style of
// the architecture block from the README. Left the step, in the middle
// what happens, right what's ruled out by it.
//
// The payoff of this layout is that you can read it VERTICALLY: skim just
// the left column and you have the flow. Read just the right one and you
// have the answer to "can this take something from me".
//
// ----------------------------------------------------------------------------
// No arrows
//
// In an aligned table, the column already says that left belongs to right.
// It used to have a dash-arrow there, and that looked jittery: the shaft
// comes from the box-drawing block, the tip from a different one, and the
// browser pulls them from two different fonts if it has to.
//
// ----------------------------------------------------------------------------
// No full sentences
//
// The first version explained things ("SIZED sees it arrive and knows the
// address belongs to you"). That reads like ad copy, not a diagram. This
// labels, it doesn't narrate: no verbs you can infer for yourself, no
// periods at the end of a line.
//
// ----------------------------------------------------------------------------
// Why the lines are short
//
// In the timeline, every image gets squeezed down to phone width. A line
// of 100 characters is three millimeters tall there and nobody reads it.
// MAX_COLUMNS caps it at 64, and the script reports a violation before the
// image ever goes out.
//
// Colors and type come from public/styles.css, not from taste: a gray that's
// a shade off from the page's own gray looks wrong next to the screenshots,
// and nobody can say why.
//
//   node scripts/schaubild.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const color = (n) => {
  const t = new RegExp(`--${n}:\\s*([^;]+);`).exec(css);
  if (!t) throw new Error(`--${n} fehlt in styles.css`);
  return t[1].trim();
};
const C = { bg: color('bg'), text: color('text'), dim: color('dim'),
  dimmer: color('dimmer'), accent: color('accent') };

const MAX_COLUMNS = 64;

// ---------------------------------------------------------------------------
// The two versions
// ---------------------------------------------------------------------------
//
// Same structure, different vocabulary. F1 talks to someone who holds
// $ANSEM and isn't a developer - "rules live in the database, not in the
// website" instead of "postgres rls, frontend is not a boundary". F2 keeps
// two technical terms, because for whoever already knows them, they're
// more precise.
//
// Nothing gets lost in F1 that anyone could go check: whoever wants to know
// exactly finds it at the address in the footer.

const BILDER = [
  {
    nr: 1,
    name: 'F1 – gleiche Ordnung, verstaendliche Woerter',
    pollQuestion: 'fuer Halter, nicht fuer Entwickler',
    text: `
sized.gg  ·  token-gated polls and dms  ·  no wallet connect

address    you type it            nothing connected
amount     SIZED names one        the last decimals are yours
payment    you send it            your wallet, nothing signed
match      SIZED sees it          that exact amount, once
access     you are in

balance    read from the chain    never sent by your browser
polls      your vote weighs       what you hold
dms        ansem's inbox          sorted by what you hold
rules      live in the database   not in the website

github.com/sizedgg/sized
`,
  },
  {
    nr: 2,
    name: 'F2 – ein Schritt technischer',
    pollQuestion: 'on-chain bleibt drin',
    text: `
sized.gg  ·  token-gated polls and dms  ·  no wallet connect

address    you type it              nothing connected
amount     SIZED names one          the last decimals are yours
payment    you send it              your wallet, nothing signed
match      SIZED sees it on-chain   that exact amount, once
access     you are in

balance    read on-chain            never sent by your browser
polls      vote weight              what you hold
dms        inbox order              what you hold
rules      in the database          the website enforces nothing

github.com/sizedgg/sized
`,
  },
];

// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

console.log('\nSchaubilder fuer X\n');

for (const b of BILDER) {
  const lines = b.text.replace(/^\n|\n$/g, '').split('\n');
  const widest = Math.max(...lines.map((z) => z.length));
  if (widest > MAX_COLUMNS) {
    console.log(`  ${b.nr}. ${b.name}  << ZU BREIT: ${widest} Spalten`);
  }

  // Render large first, then crop to the content - the same rule as for
  // the post images: an image with a third of empty space gets shrunk
  // along with everything else in the timeline, and the text shrinks
  // right along with it.
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2,
  });
  await page.setContent(`
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: ${C.bg}; color: ${C.text};
             font-family: "DejaVu Sans Mono", ui-monospace, monospace;
             padding: 46px 52px; width: max-content; }
      pre { font-size: 21px; line-height: 1.55; white-space: pre; }
      /* Header and footer quieter than the table: they say WHAT the
         image is about, not what's actually in it. */
      .leise { color: ${C.dim}; }
    </style>
    <pre id="t"></pre>
    <script>
      const roh = ${JSON.stringify(lines.join('\n'))};
      // First and last line quieter: header and footer are framing, not
      // content. The \\n is double-escaped: the outer string here in the
      // script would otherwise turn a plain \\n into a real line break,
      // and in the browser there'd then be a string spanning two lines -
      // a syntax error that leaves the page blank. That's exactly what
      // happened on the first attempt: image 208x184 instead of
      // 1752x1096.
      const parts = roh.split('\\n');
      document.getElementById('t').innerHTML = parts.map((z, i) =>
        (i === 0 || i === parts.length - 1) && z.trim()
          ? '<span class="leise">' + z + '</span>' : z).join('\\n');
    <\/script>`, { waitUntil: 'load' });

  // Measured against the <pre>, not the body: the body fills the window
  // even when there's nothing in it - so measuring it always returned 900
  // and the crop did nothing. It got noticed because all three images had
  // the same height.
  const mass = await page.evaluate(() => {
    const r = document.getElementById('t').getBoundingClientRect();
    const p = parseFloat(getComputedStyle(document.body).paddingLeft);
    const q = parseFloat(getComputedStyle(document.body).paddingTop);
    return { w: Math.ceil(r.width + 2 * p), h: Math.ceil(r.height + 2 * q) };
  });
  await page.setViewportSize({ width: mass.w, height: mass.h });

  const file = path.join(root, 'preview', `schaubild-${b.nr}.png`);
  await page.screenshot({ path: file });
  await page.close();

  console.log(`  ${b.nr}. ${b.name}  –  "${b.pollQuestion}"`);
  console.log(`     ${widest} Spalten, ${lines.length} Zeilen`
    + `, Bild ${mass.w * 2}x${mass.h * 2}`);
  console.log(`     ${path.relative(root, file)}\n`);
}

await browser.close();
