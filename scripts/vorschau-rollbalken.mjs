// ============================================================================
// Wie lang ist der Rollbalken im Posteingang – und laesst er sich kuerzen?
//
// Zwei Dinge stehen hier im Weg, und beide muessen auf DEINEM Rechner
// beantwortet werden, nicht auf meinem:
//
//   1. Die Laenge des Schiebers ist nicht frei waehlbar. Sie ist der Anteil
//      des Sichtbaren am Ganzen: Wer sechs von vierzig Gespraechen sieht,
//      bekommt einen Schieber von einem Sechstel der Bahn. Keine Regel
//      aendert das.
//
//      Was sich aendern laesst, ist die BAHN. Wird sie oben und unten
//      eingerueckt, wird der Schieber im selben Verhaeltnis kuerzer.
//
//   2. Chrome kennt zwei Wege, eine Leiste zu gestalten: das alte
//      ::-webkit-scrollbar und das neue scrollbar-width/-color. In
//      styles.css steht beides, und wo das neue gesetzt ist, werden die
//      webkit-Regeln ignoriert. Die Einrueckung der Bahn gibt es aber NUR
//      im alten. Ob sie ueberhaupt ankommt, haengt also am Browser.
//
//      Im Chromium hier ist die Leiste eine ueberlagerte (sie nimmt keine
//      Breite weg und ist im Bild nicht zu fassen). Auf einem Mac ist das
//      anders, und ausgerechnet dieser Unterschied entscheidet die Frage.
//      Deshalb ein Blatt zum Selberansehen statt einer Messung von hier.
//
// Erzeugt preview/rollbalken.html – fuenf Fassungen nebeneinander, mit den
// echten Zeilen aus renderThreads() und der echten styles.css.
//
//   node scripts/vorschau-rollbalken.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Echter Quelltext, nicht nachgebaut: Sonst vergleicht man Fassungen einer
// Zeile, die es so nirgends gibt.
const teile = [
  schneide('const HANDLE_TONES', '\n'),
  schneide('const handleOf =', '\n'),
  schneide('function toneOf(wallet) {', '\n}') + '\n}',
  schneide('const esc =', '\n\n'),
  schneide('const STUFEN =', '\n'),
  schneide('function kurzUsd(', '\n}') + '\n}',
  schneide('function demoThreads(n) {', '\n}\n') + '\n}',
  schneide('function renderThreads() {', '\n}\n') + '\n}',
].join('\n');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vorschau */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
    const openThread = () => {};
    const state = {
      cfg: { symbol: 'ANSEM', min_dm_usd: 0 }, dmMinEntwurf: null,
      zeigeVerborgene: false, activeThread: null, dmHideAvailable: true,
      dmThreads: [],
    };
    ${teile}
    state.dmThreads = demoThreads(40);
    window.renderThreads = renderThreads;
  `,
});
const zeilen = await seite.evaluate(() => {
  window.renderThreads();
  return document.querySelector('#thread-items').innerHTML;
});
await browser.close();
server.close();

// ---------------------------------------------------------------------------
// Die Fassungen
// ---------------------------------------------------------------------------
const FASSUNGEN = [
  { nr: 1, name: 'Wie es jetzt ist',
    was: 'scrollbar-width: thin steht daneben – dort, wo es gilt, sind die '
       + 'webkit-Regeln darunter wirkungslos',
    css: '' },
  { nr: 2, name: 'Ohne die neuen Eigenschaften',
    was: 'scrollbar-width/-color weg, damit die webkit-Regeln wieder greifen. '
       + 'Gleiche Laenge, aber die Leiste kann jetzt dauerhaft sichtbar sein '
       + 'und Breite wegnehmen – genau das ist die Frage',
    css: `#F2 .thread-list { scrollbar-width: auto; scrollbar-color: auto; }` },
  { nr: 3, name: 'Bahn 12 px eingerueckt',
    was: 'oben und unten je 12 px – der Schieber wird im selben Verhaeltnis kuerzer',
    css: `#F3 .thread-list { scrollbar-width: auto; scrollbar-color: auto; }
          #F3 .thread-list::-webkit-scrollbar-track { margin: 12px 0; }` },
  { nr: 4, name: 'Bahn 28 px eingerueckt',
    was: 'deutlich abgesetzt – beginnt erst unter der ersten Zeile',
    css: `#F4 .thread-list { scrollbar-width: auto; scrollbar-color: auto; }
          #F4 .thread-list::-webkit-scrollbar-track { margin: 28px 0; }` },
  { nr: 5, name: 'Bahn 28 px, Leiste 3 px',
    was: 'kuerzer und noch einen Hauch schmaler',
    css: `#F5 .thread-list { scrollbar-width: auto; scrollbar-color: auto; }
          #F5 .thread-list::-webkit-scrollbar { width: 3px; }
          #F5 .thread-list::-webkit-scrollbar-track { margin: 28px 0; }` },
];

const spalte = (f) => `
    <section class="fassung">
      <h2>${f.nr}. ${f.name}</h2>
      <p>${f.was}</p>
      <div id="F${f.nr}" class="rahmen">
        <aside class="thread-list scroll">
          <div id="thread-items">${zeilen}</div>
        </aside>
      </div>
    </section>`;

const blatt = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Rollbalken im Posteingang</title>
<!-- Die echte styles.css, Wort fuer Wort hineinkopiert statt verlinkt: So
     laesst sich das Blatt auch aus dem Download-Ordner oeffnen. -->
<style>
${fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8')}
</style>
<style>
  body { margin: 0; padding: 1.5rem; font-family: system-ui, sans-serif;
         background: #0d0d0f; color: #e6e6e6; }
  h1 { font-size: 1.1rem; margin: 0 0 .3rem; }
  .hinweis { max-width: 62rem; font-size: .85rem; line-height: 1.55; color: #a0a0a8;
             margin: 0 0 1.6rem; }
  .reihe { display: flex; gap: 1.1rem; align-items: flex-start; flex-wrap: wrap; }
  .fassung { width: 290px; }
  .fassung h2 { font-size: .8rem; margin: 0 0 .25rem; color: #e6e6e6; }
  .fassung p { font-size: .72rem; line-height: 1.5; color: #8b8b93;
               margin: 0 0 .5rem; min-height: 4.5em; }
  /* Der Rahmen gibt der Liste eine feste Hoehe – sonst waere nichts zu rollen. */
  .rahmen { height: 360px; display: flex; }
  .rahmen .thread-list { height: 360px; width: 290px; }
</style>
${FASSUNGEN.map((f) => `<style>${f.css}</style>`).join('\n')}
</head>
<body>
  <h1>Rollbalken im Posteingang</h1>
  <p class="hinweis">
    Fuenfmal dieselben 40 Gespraeche. Roll in jeder Spalte einmal durch und sieh,
    welche Leiste dabei erscheint.<br><br>
    Der Schieber ist immer der Anteil des Sichtbaren am Ganzen – kuerzer wird er
    nur, wenn die BAHN oben und unten eingerueckt wird. Das geht ausschliesslich
    ueber die alten webkit-Regeln, und die gelten nur, wo
    <code>scrollbar-width</code> nicht gesetzt ist. Ob 2 bis 5 sich von 1
    unterscheiden, beantwortet dein Browser – meiner zeichnet ueberlagerte
    Leisten und kann es nicht.
  </p>
  <div class="reihe">
${FASSUNGEN.map(spalte).join('\n')}
  </div>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const ziel = path.join(root, 'preview', 'rollbalken.html');
fs.writeFileSync(ziel, blatt);
console.log(`\n  ${FASSUNGEN.length} Fassungen in ${path.relative(root, ziel)}\n`);
