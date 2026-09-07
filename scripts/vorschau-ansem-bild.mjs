// ============================================================================
// Preview: Ansem with a round profile picture instead of the three characters
//
// The question sounds like a picture question and is really a layout
// question. The reason is in the stylesheet, in a comment above .msg:
//
//   grid-template-columns: 1.75rem minmax(0, 1fr) auto auto;
//
// The first column is 28 px wide and FIXED. It's exactly that wide because a
// handle made of three monospace characters measures 25 px - and because
// every real handle is exactly three characters long, the text in every row
// of the list starts at the same spot. That's the reason the chat reads as a
// list and not as a pile of paragraphs.
//
// So putting a picture into that column means: either it fits in 28 px -
// then nothing about the list's structure changes - or the column grows,
// and then the text of EVERY row shifts right, not just Ansem's. That's
// exactly what gets measured here, not guessed.
//
// The second thing to watch for: align-items: baseline. Text has a
// baseline, a picture doesn't - the browser then uses its bottom edge. So a
// picture sitting in a row with a text baseline behaves differently than
// you'd expect.
//
// None of this is wired in; the picture only lives under preview/.
//
// Produces preview/ansembild-*.png and preview/ansembild-uebersicht.png
//   node scripts/vorschau-ansem-bild.mjs
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

const imageFile = path.join(root, 'preview', 'ansem-avatar.jpg');
if (!fs.existsSync(imageFile)) throw new Error(`Fehlt: ${imageFile}`);
const AVATAR = 'data:image/jpeg;base64,' + fs.readFileSync(imageFile).toString('base64');

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

// Read the column width from the stylesheet rather than hardcoding it - it
// has already been changed once, from 3.4rem to 1.75rem, and this text
// shouldn't lie about it next time either.
//
// And rem is NOT 16 px here: html, body are set to 15 px. So 1.75rem comes
// to 26, not 28 - a picture sized "28 px, fits exactly" would have stuck out
// two pixels past the column. So the base size gets read too, not assumed.
const COLUMN = /grid-template-columns: ([\d.]+)rem minmax/.exec(css)?.[1];
if (!COLUMN) throw new Error('Die first Spalte von .msg sieht anders aus als erwartet');
const BASE_SIZE = Number(/font-family: var\(--mono\); font-size: (\d+)px/.exec(css)?.[1]);
if (!BASE_SIZE) throw new Error('Die Grundgroesse steht nicht mehr, wo sie stand');
const COLUMN_PX = Math.round(Number(COLUMN) * BASE_SIZE);

// The picture gets placed in the row via CSS, without touching app.js: the
// three characters stay in the markup and just get made invisible. That's
// enough for a preview - and it shows honestly what the layout does, since
// the rest of the row stays real.
const alsBild = (groesse, mitZeichen) => `
  /* align-self: center, not the row's text baseline.
     A picture has no baseline - the browser then uses its bottom edge, and
     the picture sticks out past the row instead of sitting inside it.
     Without this one line, Ansem's row ends up taller than it needs to be. */
  .msg.is-admin .who { align-self: center; }
  .msg.is-admin .who .admin-name {
    ${mitZeichen ? '' : 'font-size: 0;'}
    display: inline-flex; align-items: center; gap: .35rem;
  }
  .msg.is-admin .who .admin-name::before {
    content: ''; flex: none;
    width: ${groesse}px; height: ${groesse}px; border-radius: 50%;
    background: url('${AVATAR}') center/cover no-repeat;
  }`;

const columnRule = (px) => px <= COLUMN_PX ? ''
  : `.msg, .msg.has-quote { grid-template-columns: ${px}px minmax(0, 1fr) auto auto; }`;

const FASSUNGEN = [
  {
    file: 'jetzt', name: 'Jetzt – drei Zeichen', css: '',
    text: 'Der Stand. Die first Spalte ist ' + COLUMN_PX + ' px wide und fest; alle Kürzel '
      + 'sind exakt drei Zeichen long, deshalb beginnt der Text in jeder Zeile an derselben '
      + 'Stelle.',
  },
  {
    file: 'zeilenhoch', name: 'Bild in 20 px – so hoch wie die Zeile',
    css: alsBild(20, false),
    text: 'Klein genug, dass es in die Zeile passt, die ohnehin da ist. Als einzige Fassung '
      + 'lässt sie den Aufbau der Liste in Ruhe: gleiche Spalte, gleicher Textanfang, und '
      + 'Ansems Zeilen werden nicht höher (sie sind sogar 3 px flacher, weil die drei '
      + 'Zeichen wegfallen). Dafür ist ein Gesicht in 20 px kaum mehr als ein Fleck.',
  },
  {
    file: 'klein', name: `Bild in ${COLUMN_PX} px – so wide wie die Spalte`,
    css: alsBild(COLUMN_PX, false),
    text: 'So wide, wie die Spalte ohnehin ist – die Spalte hält also, und der Text aller '
      + 'Zeilen beginnt next an derselben Stelle. Aber: Ansems Zeilen werden 3 px höher '
      + 'als die anderen, weil das Bild höher ist als eine Textzeile. Bei drei Nachrichten '
      + 'in einer langen Liste ist das ein leicht unruhiger Rhythmus, kein Bruch.',
  },
  {
    file: 'big', name: 'Bild in 34 px – die Spalte wächst',
    css: alsBild(34, false) + columnRule(34),
    text: 'Deutlich erkennbar, aber die first Spalte muss dafür wachsen – und die gilt für '
      + 'ALLE Zeilen. Der Text jeder Nachricht rückt 8 px nach right, auch der von Leuten '
      + 'ohne Bild, und hinter deren drei Zeichen steht dann eine Lücke. Genau dieser '
      + 'Zustand war schon einmal da (3,4rem Spalte für Ansems Tokenkürzel) und wurde '
      + 'abgeschafft.',
  },
  {
    file: 'beides', name: 'Bild und Zeichen',
    css: alsBild(22, true) + columnRule(60),
    text: 'Bild plus Kürzel. Ansems Zeilen bleiben genauso hoch wie die anderen – aber die '
      + 'Spalte wächst auf 60 px, und der Text jeder Nachricht rückt 34 px nach right. '
      + 'Das ist die teuerste Fassung, und die drei Zeichen sagen neben einem Gesicht kaum '
      + 'noch etwas, das man nicht schon sieht.',
  },
];

// --- Daten -----------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  b: '7xK9zYxWvUtSrQpOnMlKjIhGfEdCbA1234567890abc',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
};
const std = (h) => Date.now() - h * 3600e3, min2 = (m) => Date.now() - m * 60_000;
const CHAT = [
  { id: 1, wallet: W.c, usd: 1240, body: 'gm', createdAt: std(5) },
  { id: 2, wallet: W.a, usd: 86400, body: 'is the gate still at $10 or did that change', createdAt: std(5) },
  { id: 3, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'still $10. read the pinned poll before asking again', createdAt: std(4) },
  { id: 4, wallet: W.b, usd: 0.4, body: 'made it in with dust lol', createdAt: std(4) },
  { id: 5, wallet: W.d, usd: 3420, body: 'voted. ship it', createdAt: std(3) },
  { id: 6, wallet: W.ansem, usd: 12400000, isAdmin: true, body: 'new poll is live. 24h. go', createdAt: std(3) },
  { id: 7, wallet: W.a, usd: 86400, replyTo: 6, body: 'done', createdAt: min2(52) },
  { id: 8, wallet: W.b, usd: 0.4, body: 'yeah it catches up', createdAt: min2(31) },
  { id: 9, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'counts for less. weight follows the balance while the poll is open', createdAt: min2(12) },
  { id: 10, wallet: W.c, usd: 1240, body: 'fair', createdAt: min2(2) },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">${chatScaffold}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');

const bilder = [];
for (const f of FASSUNGEN) {
  // 900 px, not less. Below 761 px, @media (max-width: 760px) kicks in, and
  // there .msg has a DIFFERENT grid - handle and amount on one line, the
  // text below. Measuring narrower than that measures the phone layout and
  // doesn't answer the column question at all. (This trap has already
  // snapped shut once in this project, back then at exactly 760 px.)
  const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
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
    const daten = ${JSON.stringify(CHAT)};
    for (const m of daten) state.quoted.set(m.id, m);
    document.querySelector('#chat-list').innerHTML = daten.map(msgHtml).join('');
    document.querySelector('#chat-list').scrollTop = 1e6;` });
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);

  // Measured, not assumed: where does the text start, how tall is a row
  // with a picture versus one without, and does the money column still
  // line up?
  f.mass = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.msg')];
    const ansem = lines.find((z) => z.classList.contains('is-admin'));
    const andere = lines.find((z) => !z.classList.contains('is-admin'));
    const left = (z) => Math.round(z.querySelector('.body').getBoundingClientRect().left);
    const hoch = (z) => Math.round(z.getBoundingClientRect().height);
    // The money column is deliberately NOT measured here. Every message is
    // its own grid; the right edge depends on the width of the timestamp
    // next to it, and that varies in the test data. A measurement that
    // already reports "broken" in the current state is measuring the test
    // data, not the question at hand.
    return {
      textAb: left(andere), textAbAnsem: left(ansem),
      hochAnsem: hoch(ansem), hochAndere: hoch(andere),
      column: Math.round(parseFloat(getComputedStyle(lines[0]).gridTemplateColumns.split(' ')[0])),
    };
  });

  const bild = await page.locator('#chat-list').screenshot();
  await page.close();
  fs.writeFileSync(path.join(ausgabe, `ansembild-${f.file}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

console.log('\n  Was das Layout dazu sagt\n');
console.log('  ' + 'Fassung'.padEnd(34) + 'Spalte'.padEnd(9) + 'Text ab'.padEnd(10)
  + 'Zeilenhöhe');
console.log('  ' + ' '.repeat(34) + ''.padEnd(9) + 'andere/Ansem'.padEnd(10)
  + 'Ansem/andere'.padEnd(13) + '');
for (const f of FASSUNGEN) {
  const m = f.mass;
  console.log('  ' + f.name.padEnd(34) + `${m.column} px`.padEnd(9)
    + `${m.textAb}/${m.textAbAnsem}`.padEnd(10)
    + `${m.hochAnsem}/${m.hochAndere} px`
    + (m.hochAnsem > m.hochAndere ? '   Ansems Zeilen sind höher' : ''));
}
const grund = FASSUNGEN[0].mass;
console.log(`\n  "Text ab" ist der linke Rand des Nachrichtentextes. Steht dort in einer`
  + `\n  Fassung eine groessere Zahl als ${grund.textAb}, ist die ganze Liste nach right`
  + `\n  gerueckt – auch fuer alle, die gar kein Bild haben.\n`);

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #0a0b0f; padding: 10px; border-radius: 12px; border: 1px solid #1d212d; }
</style>
<h1>Ansem mit rundem Profilbild</h1>
<p class="lead">Dieselben zehn Nachrichten, drei davon von Ansem. Die Frage sieht nach einer Bildfrage aus und
ist eine Layoutfrage: Die first Spalte im Chat ist <b>${COLUMN_PX} px wide und fest</b>, weil alle Kürzel
exakt drei Zeichen long sind – deshalb beginnt der Text in jeder Zeile an derselben Stelle. Ein Bild passt
entweder hinein, oder die Spalte wächst, und dann rückt der Text <i>aller</i> Zeilen nach right, auch der von
Leuten ohne Bild. Unter jeder Fassung stehen die gemessenen Werte. Nichts hiervon ist eingebaut.</p>
<div class="row">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.mass.textAb > grund.textAb ? 'knapp' : ''}">Spalte ${f.mass.column} px
      · Text ab ${f.mass.textAb} px${f.mass.textAb > grund.textAb ? ` (statt ${grund.textAb})` : ''}
      · Zeile ${f.mass.hochAnsem} px gegen ${f.mass.hochAndere} px</span></h2>
  <p class="t">${f.text}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(700);
await s.screenshot({ path: path.join(ausgabe, 'ansembild-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'ansembild-uebersicht.png')}\n`);
