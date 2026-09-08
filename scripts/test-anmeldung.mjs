// ============================================================================
// What ends up in the clipboard when copying amount and address.
//
// The two rows on the login screen are copy buttons - but not everyone uses
// them. Many people select the address by hand, and the selection easily
// drags along "SEND TO" or "Tap to copy" with it.
//
// Why this deserves its own check: money is on the line here. A transfer to
// an address with trailing text goes nowhere, and the money is gone - there
// is no chargeback. A wrongly selected amount is more harmless, but it costs
// the login: the treasury listens for one exact number.
//
// So what's checked isn't the CSS rule, but what the browser actually
// selects - with real mouse clicks and double-clicks. A rule can be sitting
// right there and still do nothing; only the measurement tells you that.
//
//   node scripts/test-anmeldung.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// The real copy logic, cut out verbatim. A reconstructed copy would pass
// this test while the page kept showing the blue selection block - and that
// is exactly what's at stake here.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const kopierCode = cut('async function copyText(', '\n// ---');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(root, 'public', pfad);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    return res.writeHead(404).end('');
  }
  // app.js needs a database; here it's only about markup and styling.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Test */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Next to "Waiting for payment" there used to be a pulsing dot in the accent
// color. It's gone now - and so it doesn't quietly creep back in on the next
// rework, that's pinned down here. The accent color is the loudest one on
// the page; blinking, it reads as a warning, right at the moment someone has
// just sent money.
const sheetSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

const AMOUNT = '0.002042779 SOL';
const ADRESSE = '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo';

const kontext = await browser.newContext({ viewport: { width: 520, height: 900 } });
await kontext.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await kontext.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.evaluate(([amount, adresse]) => {
  document.querySelector('#login').hidden = false;
  document.querySelector('#step-address').hidden = true;
  document.querySelector('#step-pay').hidden = false;
  document.querySelector('#pay-amount').textContent = amount;
  document.querySelector('#pay-treasury').textContent = adresse;
}, [AMOUNT, ADRESSE]);

// Erst jetzt die Zuhoerer anhaengen, mit gefuellten Feldern.
await page.addScriptTag({ content: `
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  window.meldungen = [];
  const toast = (m, err) => window.meldungen.push({ m, err: Boolean(err) });
  ${kopierCode}
  window.copyText = copyText;
` });

const clear = () => page.evaluate(() => getSelection().removeAllRanges());
const markiert = () => page.evaluate(() => String(getSelection()));

/**
 * Drags with the mouse button held down across the row.
 *
 * `vonOben` decides where the drag starts - and that's the difference
 * between the two rules working together here:
 *
 *   Starting IN the value, user-select: all holds it together.
 *   Starting on the LABEL, that no longer applies; there only
 *   user-select: none keeps the extra text out of the selection.
 *
 * Both cases happen: whoever wants to select a long address often starts a
 * bit above it.
 */
const ziehen = async (sel, { vonOben = false } = {}) => {
  await clear();
  const k = await page.evaluate(([s, peek]) => {
    const wert = document.querySelector(s).getBoundingClientRect();
    const line = document.querySelector(s).closest('.pay-row').getBoundingClientRect();
    return peek
      ? { x1: line.left + 4, y1: line.top + 4, x2: wert.right - 3, y2: wert.bottom - 3 }
      : { x1: wert.left + 3, y1: wert.top + wert.height / 2,
          x2: line.right - 3, y2: line.top + 3 };
  }, [sel, vonOben]);
  await page.mouse.move(k.x1, k.y1);
  await page.mouse.down();
  await page.mouse.move(k.x2, k.y2, { steps: 14 });
  await page.mouse.up();
  return markiert();
};

console.log('\nBetrag und Adresse kopieren\n');

const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());

// --- 1. Tapping copies - and selects nothing ------------------------------
//
// That's the point: the row IS the copy button. A blue selection next to it
// isn't a second aid, it's a second response to the same tap - you tap once
// and get "Copied ✓" AND a blue block.
for (const [sel, erwartet, name] of [
  ['#pay-treasury', ADRESSE, 'die Adresse'],
  ['#pay-amount', AMOUNT.replace(' SOL', ''), 'den Betrag'],
]) {
  await clear();
  await page.click(sel);
  check(`Antippen kopiert ${name}`,
    (await readClipboard()) === erwartet,
    JSON.stringify(await readClipboard()));
  check(`Und markiert dabei nichts (${name.slice(4)})`,
    (await markiert()) === '', JSON.stringify(await markiert()));
}

// The amount gets copied WITHOUT " SOL" - a wallet field wants the number,
// not the unit. That's already covered by the check above; stated again
// explicitly here because it's easy to lose during a rework.
check('Beim Betrag bleibt die Einheit aussen vor',
  !(await readClipboard()).includes('SOL'), await readClipboard());

// --- 2. Dragging doesn't reveal anything either ---------------------------
check('Ueber die Zeile zu ziehen markiert nichts (Adresse)',
  (await ziehen('#pay-treasury')) === '');
check('Und von der Beschriftung aus auch nicht',
  (await ziehen('#pay-treasury', { vonOben: true })) === '');

// --- 3. Nor does a double-click --------------------------------------------
await clear();
await page.dblclick('#pay-treasury');
check('Doppelklick markiert nichts', (await markiert()) === '',
  JSON.stringify(await markiert()));

// --- 4. But the fallback has to allow selecting ---------------------------
//
// When copying fails - no HTTPS, an embedded browser with no clipboard - -
// app.js selects the value itself and says so. If the row were then still
// not selectable, that message would point at nothing: the worst of all
// outcomes, because it claims to have helped.
//
// The failure is reconstructed at the root: both clipboard paths are
// disabled.
{
  await clear();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = () => false;
    window.meldungen = [];
  });
  await page.click('#pay-treasury');
  await page.waitForTimeout(60);

  const line = await page.evaluate(() =>
    document.querySelector('[data-copy="#pay-treasury"]').className);
  check('Im Fehlerfall wird die Zeile markierbar gemacht',
    /zum-markieren/.test(line), line);
  check('Und der Wert ist dann wirklich markiert',
    (await markiert()) === ADRESSE, JSON.stringify(await markiert()));
  check('Die Meldung sagt es auch',
    await page.evaluate(() => window.meldungen.some((m) => m.err && /selected/i.test(m.m))));
}

check('Kein pulsierender Punkt neben "Waiting for payment"',
  !/class="pulse"/.test(sheetSource) && !/@keyframes pulse/.test(styleSource));

// Copied: only the outline, brief, and not harsh.
// ---------------------------------------------------------------------------
// This used to have the accent color on the outline AND a filled background
// - two signals in the brightest color on the page. On a phone the whole
// row would flash.
const kopiertRegel = styleSource.slice(
  styleSource.indexOf('.pay-row.is-copied {'),
  styleSource.indexOf('}', styleSource.indexOf('.pay-row.is-copied {')) + 1);
check('Beim Kopieren wird nur der Umriss hell',
  /border-color/.test(kopiertRegel) && !/background/.test(kopiertRegel),
  kopiertRegel.trim());
check('Und nicht in der Akzentfarbe',
  !/var\(--accent/.test(kopiertRegel), kopiertRegel.trim());
// Control check on the excerpt: without it, the search above would run
// against the whole file, and "background" appears there a hundred times
// over - the check would always fail, and so would "--accent".
check('Gegenprobe: der Ausschnitt ist wirklich nur diese eine Regel',
  kopiertRegel.length < 200 && kopiertRegel.startsWith('.pay-row.is-copied'),
  `${kopiertRegel.length} Zeichen`);
// And the duration. The range is deliberately wide: what's checked isn't
// the one correct number - that gets decided on the device - but that it
// stays a brief flash at all. 1800 ms looked like a persistent state; under
// 500 you don't notice it, now that the outline only lights up subtly.
const duration = Number(/const KOPIERT_MS = (\d+);/.exec(
  fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8'))?.[1]);
check('Der Umriss wird nach kurzer Zeit wieder normal',
  duration >= 500 && duration <= 1600, `${duration} ms`);

// ---------------------------------------------------------------------------
// Eine Kante, nicht zwei
// ---------------------------------------------------------------------------
// Reported: some things in the login card sit further in than others - the
// waiting line and "Start over" against everything above them.
//
// The cause was invisible: a ghost button has no visible edge, so its padding
// is invisible too, and the label sat one padding plus one transparent border
// further right than every line above it. 11.5 px. Nothing looked broken, it
// looked as if one line had been indented by accident.
//
// What is measured here is the LEFT EDGE OF THE TEXT, not of the box. Those
// are two different things, and only the first one is what an eye follows
// down a column. Measuring boxes would have called the old state correct: the
// button's box was where it belonged, its label was not.
//
// Both widths, because the card's padding differs between them and a fix that
// only works at one width is not a fix.
console.log('\nEine Kante im Login-Fenster\n');

// The page that is already open gets resized, rather than a fresh one opened.
// A second page had the login card at 0 px wide - not laid out at all - while
// the text edges still reported numbers, so all four checks passed on a card
// that was not on screen. The width check below is what caught it, and it
// stays in for that reason.
//
// The mock button only exists in the dev stack. Left visible it would start
// the row and push "Start over" to the right - the check would then be
// measuring the preview instead of the page.
await page.evaluate(() => { document.querySelector('#btn-mock-pay').hidden = true; });

for (const breite of [520, 390]) {
  const seite = page;
  await seite.setViewportSize({ width: breite, height: 900 });
  await seite.waitForTimeout(200);

  const kanten = await seite.evaluate(() => {
    const textLinks = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return Math.round(r.getBoundingClientRect().left * 10) / 10;
    };
    const q = (s) => document.querySelector(s);
    return {
      absatz: textLinks(q('#step-pay .lede')),
      warten: textLinks(q('#pay-status')),
      abbruch: textLinks(q('#btn-cancel')),
      // The copy rows are SUPPOSED to be indented - they are boxes with a
      // visible border, and their padding is doing visible work. Included so
      // that a future "fix" which pulls them onto the column too gets caught.
      kasten: Math.round(q('.pay-row').getBoundingClientRect().left * 10) / 10,
      kastenText: textLinks(q('.pay-label')),
      // Reported alongside, and not as decoration: the edges come out at the
      // same number at both widths, and a figure that does not move when the
      // window does is exactly how a check that measures nothing looks. So
      // something that DOES move is reported next to it. Here the edges are
      // genuinely the same - the padding does not change - and the card gets
      // narrower, which is what this line shows.
      //
      // '#login .login-card', not '.login-card': the markup has three of
      // them, and the first two belong to the install prompt and are hidden.
      // querySelector took the first, reported a width of 0, and the sanity
      // check I had added to catch a broken measurement was itself broken.
      karte: Math.round(q('#login .login-card').getBoundingClientRect().width),
      fenster: window.innerWidth,
    };
  });

  check(`${breite} px: Fenster und Karte sind wirklich so breit`,
    kanten.fenster === breite && kanten.karte > 200 && kanten.karte <= breite,
    `Fenster ${kanten.fenster} px, Karte ${kanten.karte} px`);
  check(`${breite} px: die Wartezeile steht auf der Spalte`,
    Math.abs(kanten.warten - kanten.absatz) < 0.5,
    `${kanten.warten} gegen ${kanten.absatz}`);
  check(`${breite} px: "Start over" steht auf der Spalte`,
    Math.abs(kanten.abbruch - kanten.absatz) < 0.5,
    `${kanten.abbruch} gegen ${kanten.absatz}`);
  check(`${breite} px: der Kasten steht mit seinem Rand auf der Spalte`,
    Math.abs(kanten.kasten - kanten.absatz) < 0.5,
    `${kanten.kasten} gegen ${kanten.absatz}`);
  check(`${breite} px: seine Beschriftung darf eingerueckt sein`,
    kanten.kastenText > kanten.absatz + 6,
    `${kanten.kastenText} gegen ${kanten.absatz}`);
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
