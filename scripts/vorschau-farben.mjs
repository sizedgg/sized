// ============================================================================
// Color proposals: the same page, six palettes.
//
// Why not color swatches but the whole page: a palette isn't judged on a
// single tone, it's judged on how twenty amounts look stacked on top of each
// other and whether the bar of a leading answer washes out the row. That's
// exactly been the reason, twice now, to change a color that looked right on
// its own.
//
// Built with the REAL index.html and the real stylesheet; only the variables
// in :root get overridden. That way a trial stays without consequence -
// nothing changes in the stylesheet until a palette is chosen.
//
// The sample content comes verbatim from preview-mobile.mjs. A second copy
// of the setup instructions would be the usual trap: it eventually drifts
// alongside the real page, and then you're comparing colors on an interface
// that no longer looks like that.
//
// For every palette, the contrasts are COMPUTED and printed - a color that
// looks good and makes the vote count on the bar disappear isn't an
// alternative, it's a regression. The thresholds are in styles.css next to
// the respective variables.
//
//   node scripts/vorschau-farben.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'preview', 'farben');
fs.mkdirSync(outDir, { recursive: true });

// --- The sample content, verbatim from preview-mobile.mjs -------------------
const vorschau = fs.readFileSync(path.join(root, 'scripts', 'preview-mobile.mjs'), 'utf8');
const cut = (von, bis) => {
  const a = vorschau.indexOf(von);
  const b = vorschau.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in preview-mobile.mjs: ${von}`);
  return vorschau.slice(a, b);
};
// Both blocks end at the closing backtick line.
const FIXTURE = cut('const FIXTURE = `', '\n`;\n') + '\n`;\n';
const ADMIN_FIXTURE = cut('const ADMIN_FIXTURE = `', '\n`;\n') + '\n`;\n';

// ---------------------------------------------------------------------------
// The palettes
//
// Each only changes :root variables. What a color means stays the same
// across all of them: neutral is action, gold is Ansem, red is a problem.
// Anyone who shifts that isn't shifting the color, they're shifting the
// page's language.
// ---------------------------------------------------------------------------
const PALETTEN = [
  {
    nr: 1,
    name: 'jetzt',
    titel: 'Jetzt',
    was: 'Blaustichiges Fast-Schwarz, knochenweisser Akzent. Der Vergleichspunkt.',
    vars: {},
  },
  {
    nr: 2,
    name: 'neutral',
    titel: 'Neutral',
    was: 'Dieselbe Helligkeit, aber der Blaustich raus. Damit ist das Blau des '
       + 'fuehrenden Balkens die einzige Farbe der Seite – es traegt mehr.',
    vars: {
      '--bg': '#0b0b0b', '--bg-1': '#111111', '--bg-2': '#171717',
      '--bg-3': '#1e1e1e', '--line': '#292929',
      '--text': '#e9e9e9', '--dim': '#969696', '--dimmer': '#656565',
      '--accent': '#f0f0f0', '--accent-rgb': '240, 240, 240',
      '--accent-fill': '#b0b0b0', '--worth': '#c0c0c0', '--votes': '#cfcfcf',
      '--fokus': '#969696',
    },
  },
  {
    nr: 3,
    name: 'warm',
    titel: 'Warm',
    was: 'Grautoene ins Warme gedreht, Akzent als Creme. Liest sich weniger '
       + 'nach Handelsplatz, mehr nach Papier. Der Balken bleibt blau und '
       + 'steht damit als Gegenfarbe – der einzige kalte Ton der Seite.',
    vars: {
      '--bg': '#0d0b09', '--bg-1': '#14110e', '--bg-2': '#1b1714',
      '--bg-3': '#231e19', '--line': '#2e2822',
      '--text': '#efeae2', '--dim': '#a79b8b', '--dimmer': '#756a5c',
      '--accent': '#f5efe2', '--accent-rgb': '245, 239, 226',
      '--accent-fill': '#c2b6a2', '--worth': '#d0c6b4', '--votes': '#d9d0c0',
      '--fokus': '#a79b8b', '--fuellung': '#3a3733',
    },
  },
  {
    nr: 4,
    name: 'gruen',
    titel: 'Solana-Gruen',
    was: 'Der Akzent, der beim Bauen verworfen wurde – hier zum Ansehen statt '
       + 'zum Nachlesen. Das Argument dagegen steht im Blatt: Ein gesaettigter '
       + 'Akzent kommt einer der vier Namensfarben immer nahe.',
    vars: {
      '--accent': '#14f195', '--accent-rgb': '20, 241, 149',
      '--accent-fill': '#0e9e63',
    },
  },
  {
    nr: 5,
    name: 'blau',
    titel: 'Ein Blau, konsequent',
    was: 'Statt Blaustich im Grau ein richtiges Blau, und der Akzent zieht mit. '
       + 'Die Seite bekennt sich zu einer Farbe, statt sie nur anzudeuten.',
    vars: {
      '--bg': '#080b14', '--bg-1': '#0d1220', '--bg-2': '#12192b',
      '--bg-3': '#182238', '--line': '#223049',
      '--text': '#e6ecf7', '--dim': '#8e9cb8', '--dimmer': '#5f6b85',
      '--accent': '#cfe0ff', '--accent-rgb': '207, 224, 255',
      '--accent-fill': '#7d9bd0', '--worth': '#b3c6e8', '--votes': '#c9d7ef',
      '--fokus': '#8e9cb8',
      // #3b6fb5 stood here first - a brighter, bolder blue that would have
      // matched the claim "one color, consistently". Computed, the vote
      // count on it came out to 3.5:1 and the text to 4.3:1, both under the
      // threshold. #3457a2 is the brightest value that still carries both.
      '--fuellung': '#2a3242', '--fuellung-spitze': '#3457a2',
    },
  },
  {
    nr: 6,
    name: 'weicher',
    titel: 'Weicher Grund',
    was: 'Dieselben Farbtoene, aber der Grund eine Stufe heller. Weniger harter '
       + 'Anschlag, dafuer weniger Tiefe. Nur die Flaechen bewegen sich, '
       + 'kein Text.',
    vars: {
      '--bg': '#14161d', '--bg-1': '#1a1d26', '--bg-2': '#21252f',
      '--bg-3': '#2a2f3b', '--line': '#363c4a',
    },
  },
];

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------
const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => kanal(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kon = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Read the baseline values from the real stylesheet instead of writing them
// out again here: otherwise the trial would compute against a palette that
// no longer exists in the stylesheet.
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const wurzel = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const grundwerte = Object.fromEntries(
  [...wurzel.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));

/**
 * The spots where a color decision can go wrong.
 *
 * Not every pairing in the palette - only the ones that have already come
 * close during development or where a number became unreadable. Each one
 * carries its own threshold, and the thresholds match what's in styles.css.
 */
const CHECKPOINTS = [
  ['Text auf Grund',            '--text',   '--bg',               7.0],
  ['Nebentext auf Grund',       '--dim',    '--bg',               4.5],
  ['Betrag auf Grund',          '--worth',  '--bg',               4.5],
  ['Stimmenzahl auf Grau',      '--votes',  '--fuellung',         4.5],
  ['Stimmenzahl auf Blau',      '--votes',  '--fuellung-spitze',  4.5],
  ['Text auf Blau',             '--text',   '--fuellung-spitze',  4.5],
  ['Knopfschrift auf Knopf',    '--bg',     '--accent-fill',      4.5],
  ['Rahmen im Fokus',           '--fokus',  '--bg',               3.0],
];

const wert = (p, name) => p.vars[name] ?? grundwerte[name];

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const abs = path.join(root, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(path.join(root, 'public')) || !fs.existsSync(abs)) {
    return res.writeHead(404).end('');
  }
  // app.js gets replaced: the real app would try to log in.
  if (file === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Probe */');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Two views, and both are needed: in the polls, the bar makes the
// decision, in the DMs, the message bubble does. A palette can look good in
// one of the two and not in the other.
const ANSICHTEN = [
  ['polls', `document.querySelector('#pane-polls').hidden = false;`],
  ['dms', `document.querySelectorAll('.tab')[1].classList.add('is-active');
     document.querySelectorAll('.tab')[0].classList.remove('is-active');
     document.querySelector('#pane-polls').hidden = true;
     document.querySelector('#pane-dms').hidden = false;
     document.querySelector('#dm-admin').classList.add('viewing');`],
];

console.log('\nFarbvorschlaege\n');

for (const p of PALETTEN) {
  const regeln = Object.entries(p.vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  for (const [ansicht, aufbau] of ANSICHTEN) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    // First DECLARE both blocks, then execute their contents. What's
    // extracted is the source including "const FIXTURE = `…`;" - anyone who
    // just inserts that has created two strings and done nothing. That's
    // exactly what happened on the first attempt: six empty pages in six
    // colors. The content is a template with its own ${} placeholders, so it
    // has to be evaluated as one - hence eval, not insertion.
    await page.addScriptTag({
      content: `${FIXTURE}${ADMIN_FIXTURE}
        eval(FIXTURE + ADMIN_FIXTURE + ${JSON.stringify(aufbau)});`,
    });
    if (regeln) await page.addStyleTag({ content: `:root { ${regeln} }` });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, `${p.nr}-${p.name}-${ansicht}.png`) });
    await page.close();
  }

  // And the numbers to go with it. A palette that breaks a threshold isn't
  // a matter of taste anymore.
  const lines = CHECKPOINTS.map(([was, a, b, grenze]) => {
    const v = kon(wert(p, a), wert(p, b));
    return { was, v, grenze, ok: v >= grenze };
  });
  const durch = lines.filter((z) => !z.ok);
  console.log(`${p.nr}. ${p.titel}`);
  console.log(`   ${p.was.replace(/\s+/g, ' ')}`);
  console.log('   ' + lines.map((z) => `${z.was} ${z.v.toFixed(1)}:1${z.ok ? '' : ' ✗'}`).join('  ·  '));
  if (durch.length) {
    console.log(`   ACHTUNG: ${durch.length} under der Grenze – `
      + durch.map((z) => `${z.was} braucht ${z.grenze}:1`).join(', '));
  }
  console.log('');
}

await browser.close();
server.close();
console.log(`Bilder in preview/farben/\n`);
