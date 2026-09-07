// ============================================================================
// Preview: the color of a chat row under the cursor
//
// The problem, measured: the hover background is --bg-2 (#161923), Ansem's
// rows sit at #141c28. Between the two is 1.02:1 - that's not "a little
// too close", that's the same shade. Moving the mouse through the
// history produces, under the cursor, exactly the picture that otherwise
// means "Ansem is speaking here".
//
// Two things need to be kept apart here:
//
//   1. The distance from the hover background to ANSEM'S RESTING STATE.
//      That's the confusion this is about.
//   2. The distance from the hover background to the normal background.
//      If that gets too small, you can't see the hover at all anymore -
//      nothing would be gained.
//
// And a third that's easy to overlook: what happens when you hover over
// ANSEM'S row? Today the hover background fully replaces his tint, so his
// row looks like any other under the cursor. Version 4 turns this into an
// additional layer instead of a swap - then it stays recognizable whose
// row you're hovering over.
//
// Each image has five rows: two normal ones, one of them hovered, and two
// from Ansem, one of them hovered. Only this way can all four states be
// seen side by side - a single screenshot can only ever really hover one
// row.
//
// None of this is built in.
//
// Produces preview/hover-*.png and preview/hover-uebersicht.png
//   node scripts/vorschau-hover-farbe.mjs
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const piece = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};
const numbers = cut('const nfCompact =', 'const nfGanz = new Intl.NumberFormat(\'en-US\', { maximumFractionDigits: 0 });');
const short = cut('const TIERS =', 'const tagBeginn = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();');
const tage = cut('const tagBeginn =', 'const handleOf');
const namen = cut('const handleOf =', '\nconst esc =');
const escFn = cut('const esc = (s) =>', '\n\n');
const linkify = cut('const LINK_MUSTER =', '\nfunction toast(');
const chatBau = cut('const istAdmin =', '\nfunction appendMessage');
const chatScaffold = piece('<main id="pane-chat"', '</main>');

// --- Color math ----------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hx = (v) => '#' + v.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (x, y) => { const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + .05) / (q + .05); };
const get = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, a, grund) => v.map((c, i) => a * c + (1 - a) * grund[i]);
const spreizung = (v) => Math.max(...v) - Math.min(...v);

const GRUND = hex(get('bg-1'));      // the chat background the rows sit on
const BG2 = hex(get('bg-2'));
const BG3 = hex(get('bg-3'));
const LINE = hex(get('line'));
const WEISS = [255, 255, 255];

// Read Ansem's tint from the stylesheet instead of hardcoding it - it
// only recently switched from teal to this blue.
const m = /\.msg\.is-admin \{ background: rgba\((\d+), (\d+), (\d+), (\.\d+)\)/.exec(css);
if (!m) throw new Error('Ansems Toenung sieht im Blatt anders aus als erwartet');
const ANSEM = mix([+m[1], +m[2], +m[3]], +m[4], GRUND);

const fassung = (file, name, color, text, { schicht = null } = {}) => ({
  file, name, text,
  // The same declaration for :hover and for the class the image uses to
  // show two rows "hovered" at once. That way what's in the image really
  // is the proposal, not some second version of it.
  css: schicht
    ? `.msg:hover, .msg.zeigt-hover { background-image:
         linear-gradient(${schicht}, ${schicht}); }`
    : `.msg:hover, .msg.zeigt-hover { background: ${color}; }`,
  // What you actually SEE - with the layer it sits on top of the
  // respective background, otherwise the color replaces it.
  normalHover: schicht ? mix(WEISS, schicht.anteil, GRUND) : hex(color),
  ansemHover: schicht ? mix(WEISS, schicht.anteil, ANSEM) : hex(color),
});

// A small object instead of a string: the opacity is needed twice - once
// as CSS text, once to recompute the color it produces. Two separate
// values would be two places that could drift apart.
const veil = (anteil) => ({ toString: () => `rgba(255, 255, 255, ${anteil})`, anteil });

const FASSUNGEN = [
  // "Before" and not "Now": as of this round, version 2 is what's in the
  // stylesheet. A comparison image whose one half silently moves along
  // with it compares nothing.
  fassung('vorher', 'Vorher – --bg-2', hx(BG2),
    'Der Stand vor dieser Runde. 1,02:1 von Ansems Tönung entfernt, also praktisch '
    + 'derselbe Ton. Genau darum ging es.'),
  fassung('bg3', '--bg-3', hx(BG3),
    'Eine Palettenstufe höher. Deutlich sichtbarer als Zeiger, aber immer noch '
    + 'blaustichig wie Ansems Tönung – der Abstand kommt allein aus der Helligkeit.'),
  fassung('line', '--line – so ist es jetzt', hx(LINE),
    'Die eingebaute Fassung. Die hellste Fläche der Palette. Der grösste Abstand, den ein vorhandener Ton '
    + 'hergibt. Der Preis: --line ist auch die Farbe der Trennlinien zwischen den '
    + 'Zeilen – under dem Zeiger verschwindet die Linie also in der Fläche.'),
  fassung('weiss', 'Weisser Schleier, 8 %', hx(mix(WEISS, .08, GRUND)),
    'Kein Palettenton, sondern ein Hauch Weiss auf dem Chatgrund. Das Ergebnis ist '
    + 'NEUTRAL, während Ansems Tönung blau ist – der Unterschied kommt hier also '
    + 'nicht nur aus der Helligkeit, sondern auch aus dem Farbton. Das trennt '
    + 'besser, als die Zahl allein vermuten lässt.'),
  fassung('schicht', 'Schleier als zusätzliche Schicht', null,
    'Wie Fassung 3, aber der Zeiger ERSETZT den Grund nicht mehr, sondern legt sich '
    + 'darüber. Damit behält Ansems Zeile ihre Tönung, während man sie überfährt – '
    + 'heute verliert sie sie, und seine Zeile sieht under dem Zeiger aus wie jede '
    + 'andere. Die einzige Fassung, in der alle vier Zustände unterscheidbar sind.',
    { schicht: veil(.06) }),
];

// --- Numbers ----------------------------------------------------------------
console.log('\n  Ansems Ruhezustand liegt auf ' + hx(ANSEM) + ', der Chatgrund auf ' + hx(GRUND) + '\n');
console.log('  ' + 'Fassung'.padEnd(34) + 'Zeiger'.padEnd(10) + 'gegen'.padEnd(9)
  + 'gegen'.padEnd(9) + 'Ansem überfahren');
console.log('  ' + ' '.repeat(34) + ''.padEnd(10) + 'Ansem'.padEnd(9)
  + 'Grund'.padEnd(9) + 'gegen normal überfahren');
for (const f of FASSUNGEN) {
  f.gegenAnsem = kon(f.normalHover, ANSEM);
  f.gegenGrund = kon(f.normalHover, GRUND);
  f.beideHover = kon(f.ansemHover, f.normalHover);
  f.tonUnterschied = Math.abs(spreizung(f.normalHover) - spreizung(ANSEM));
  console.log('  ' + f.name.padEnd(34) + hx(f.normalHover).padEnd(10)
    + `${f.gegenAnsem.toFixed(2)}:1`.padEnd(9)
    + `${f.gegenGrund.toFixed(2)}:1`.padEnd(9)
    + `${f.beideHover.toFixed(2)}:1`);
}
console.log('\n  Die last Spalte ist die, die heute niemand beachtet: Faehrt man ueber'
  + '\n  ANSEMS Zeile, ersetzt der Zeigergrund seine Toenung. 1,00:1 heisst dort:'
  + '\n  Seine Zeile ist under dem Zeiger von jeder anderen nicht zu unterscheiden.\n');

// --- Data -----------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
};
const min2 = (m2) => Date.now() - m2 * 60_000;
const CHAT = [
  { id: 1, wallet: W.c, usd: 1240, body: 'normale Zeile, in Ruhe', createdAt: min2(50) },
  { id: 2, wallet: W.d, usd: 3420, body: 'normale Zeile, UNTER DEM ZEIGER', createdAt: min2(40) },
  { id: 3, wallet: W.ansem, usd: 12400000, isAdmin: true, body: 'Ansem, in Ruhe', createdAt: min2(30) },
  { id: 4, wallet: W.ansem, usd: 12400000, isAdmin: true, body: 'Ansem, UNTER DEM ZEIGER', createdAt: min2(20) },
  { id: 5, wallet: W.a, usd: 86400, body: 'normale Zeile, in Ruhe', createdAt: min2(10) },
];

const server = http.createServer((q, res) => {
  const file = path.join(root, 'public', decodeURIComponent(q.url.split('?')[0]));
  if (q.url !== '/' && file.startsWith(path.join(root, 'public'))
      && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(fs.readFileSync(file));
  }
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">${chatScaffold}</div>`);
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');

const bilder = [];
for (const f of FASSUNGEN) {
  // 900 px: below 761 px the phone layout kicks in, and then the image
  // would answer a different question than the one being asked.
  const page = await browser.newPage({ viewport: { width: 900, height: 330 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: `
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = {
      cfg: { symbol: 'ANSEM', admin_wallet: ${JSON.stringify(W.ansem)} },
      me: { isAdmin: false, wallet: ${JSON.stringify(W.a)} },
      live: new Map(), quoted: new Map(), filters: { usd: 0 },
    };
    const toast = () => {};
    ${escFn}${numbers}${short}${tage}${namen}${linkify}${chatBau}
    const usdOf = (m) => m.usd;
    const passesFilter = () => true;
    document.querySelector('#chat-list').innerHTML =
      ${JSON.stringify(CHAT)}.map(msgHtml).join('');
    // Rows 2 and 4 get the hover state as a class - a single image can
    // only ever really hover ONE row, and comparing all four states is
    // exactly the point here.
    const lines = document.querySelectorAll('#chat-list .msg');
    lines[1].classList.add('zeigt-hover');
    lines[3].classList.add('zeigt-hover');` });
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const bild = await page.locator('#chat-list').screenshot();
  await page.close();
  fs.writeFileSync(path.join(ausgabe, `hover-${f.file}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  /* Red is only flagged where the confusion REALLY remains: when the
     hover background sits close to Ansem's tint AND the two still can't
     be told apart in the hovered state either. Version 4 has the first
     half but not the second - it solves the problem somewhere else. */
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #0a0b0f; padding: 10px; border-radius: 12px; border: 1px solid #1d212d; }
</style>
<h1>Die Farbe einer Chatzeile under dem Zeiger</h1>
<p class="lead">Heute ist der Zeigergrund <b>#161923</b> und Ansems Tönung <b>${hx(ANSEM)}</b> –
<b>1,02:1</b> auseinander, also derselbe Ton. Wer mit der Maus durch den Verlauf fährt, erzeugt under dem
Zeiger genau das Bild, das sonst „hier spricht Ansem“ bedeutet. In jedem Bild stehen alle vier Zustände
untereinander: normale Zeile in Ruhe und under dem Zeiger, Ansems Zeile in Ruhe und under dem Zeiger.
Achte besonders auf die last Spalte der Werte – sie sagt, ob man Ansems Zeile noch erkennt,
<i>während</i> man sie überfährt. Nichts hiervon ist eingebaut.</p>
<div class="row">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.gegenAnsem < 1.1 && f.beideHover < 1.05 ? 'knapp' : ''}">gegen Ansem ${f.gegenAnsem.toFixed(2)}:1
      · gegen Grund ${f.gegenGrund.toFixed(2)}:1
      · Ansem überfahren ${f.beideHover.toFixed(2)}:1</span></h2>
  <p class="t">${f.text}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(700);
await s.screenshot({ path: path.join(ausgabe, 'hover-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'hover-uebersicht.png')}\n`);
