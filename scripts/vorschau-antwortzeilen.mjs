// ============================================================================
// Die Antwortzeilen einer Abstimmung auf dem Handy
//
// Das Problem, im Bild bei 375 px:
//
//   "Wait for | the audit"     <- die Kante der Füllung läuft durch das Wort
//   "Do | neither and keep building quietly"
//
// Der Antworttext liegt ÜBER dem Balken. Endet die Füllung mitten in einer
// Zeile, steht dort eine senkrechte Helligkeitskante quer durch die Schrift.
// Auf breiten Bildschirmen fällt das kaum auf, weil die Beschriftung dann in
// eine Zeile passt und die Kante meist daneben liegt. Auf dem Handy bricht sie
// um und trifft die Kante mehrfach.
//
// Im Stylesheet steht dazu schon eine Begründung: Der Text sei auf beiden
// Seiten der Kante gut lesbar, gemessen in Kontrastwerten. Das stimmt auch –
// nur ist Lesbarkeit nicht der Einwand. Der Einwand ist, dass es nach einem
// Anzeigefehler aussieht.
//
// ----------------------------------------------------------------------------
// Was hier gemessen wird
//
// Nicht "sieht besser aus", sondern: WIE OFT liegt die Kante der Füllung
// innerhalb einer Textzeile? Diese Zahl muss auf null, alles andere ist
// Geschmack. Dazu die Höhen der drei Antwortzeilen – gleich hohe Zeilen sind
// der zweite Teil von "übersichtlich".
//
// Gezeichnet mit der echten index.html, der echten styles.css und dem echten
// pollHtml() aus app.js.
//
//   node scripts/vorschau-antwortzeilen.mjs
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
const POLL_CODE = [
  schneide('const esc = (s) =>', '\n\n'),
  schneide('const nfGanz =', 'const ganzeZahl'),
  schneide('const ganzeZahl =', '\n'),
  schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen'),
  schneide('function fristText(closesAt)', '\n// Unter einer Stunde'),
  schneide('const BALD_MS =', '\n/**\n * Der Zeiger'),
  schneide('const fuehrenderAnteil =', '\nasync function zeichnePoll'),
  schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen'),
].join('\n');

// Eine offene Abstimmung mit drei Antworten – kurz, mittel, lang. Genau die
// Mischung, bei der die Kante heute dreimal trifft.
const POLLS = [
  { id: 1, closed: false, myOptionId: 1, totalUsd: 781420,
    closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
    question: 'Should we open the token gate to smaller holders?',
    options: [
      { id: 1, label: 'Ship it this week', usd: 482900, share: 0.618 },
      { id: 2, label: 'Wait for the audit', usd: 210400, share: 0.269 },
      { id: 3, label: 'Do neither and keep building quietly', usd: 88120, share: 0.113 },
    ] },
];

const FASSUNGEN = [
  {
    nr: 1, name: 'Wie es jetzt ist',
    was: 'Die Füllung ist eine deckende Fläche mit harter Kante. Der Text '
       + 'liegt darauf. Zum Vergleich.',
    css: '',
  },
  {
    nr: 2, name: 'Weiche Kante',
    was: 'Dieselbe Fläche, aber die Kante läuft über 28 px aus. Genau so war '
       + 'es früher schon einmal, mit derselben Begründung. Die Kante sagt '
       + 'dann nicht mehr genau, wo der Anteil endet – dafür sieht kein Wort '
       + 'mehr zerschnitten aus.',
    css: `.opt-fill { -webkit-mask-image: linear-gradient(to right,
            #000 calc(100% - 28px), transparent 100%);
            mask-image: linear-gradient(to right,
            #000 calc(100% - 28px), transparent 100%); }`,
  },
  {
    nr: 3, name: 'Füllung als Streifen unter dem Text',
    was: 'Der Balken wird ein 4 px hoher Streifen an der Unterkante der Zeile. '
       + 'Der Text steht auf ruhigem Grund, die Kante kann ihn gar nicht mehr '
       + 'treffen – und der Anteil bleibt exakt ablesbar. Die Zeile verliert '
       + 'dafür ihre Fläche als Signal.',
    css: `.opt-fill { inset: auto 0 0 auto; left: 0; height: 4px;
            border-radius: 0 2px 2px 0; }
          .opt-text { padding-bottom: .75rem; }`,
  },
  {
    nr: 4, name: 'Fläche gedämpft, Kante weich, Betrag rechts',
    was: 'Die Fläche bleibt, wird aber deutlich zurückhaltender und läuft weich '
       + 'aus; der Betrag rückt wieder nach rechts neben die Antwort. Damit '
       + 'sind alle drei Zeilen gleich hoch, solange die Antwort in eine Zeile '
       + 'passt – bei der langen bricht sie weiter um.',
    css: `.opt-fill { opacity: .5;
            -webkit-mask-image: linear-gradient(to right,
              #000 calc(100% - 24px), transparent 100%);
            mask-image: linear-gradient(to right,
              #000 calc(100% - 24px), transparent 100%); }
          .opt-text { flex-direction: row; align-items: center; gap: .8rem; }
          .opt-num { margin-left: auto; text-align: right; display: block; }`,
  },
];

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
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

async function schuss(f) {
  const seite = await browser.newPage({
    viewport: { width: 375, height: 667 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
  });
  await seite.goto(base);
  await seite.addScriptTag({ content:
    `const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false } };
     ${POLL_CODE}
     window.pollHtml = pollHtml;` });
  await seite.evaluate((polls) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h t0">7xK</span>';
    document.querySelector('#me-holdings').textContent = '$5,208';
    document.querySelector('#pane-polls').hidden = false;
    document.querySelector('#poll-list').innerHTML = polls.map(window.pollHtml).join('');
  }, POLLS);
  if (f.css) await seite.addStyleTag({ content: f.css });
  await seite.waitForTimeout(700);   // die Füllung wächst mit einer Bewegung

  // Die eigentliche Messung.
  //
  // Für jede Antwortzeile: Wo endet die Füllung, und liegt diese Kante
  // INNERHALB einer Textzeile? Dafür werden die einzelnen Zeilenkästen des
  // Textes geholt (getClientRects, nicht getBoundingClientRect – nur so sieht
  // man umgebrochene Zeilen einzeln).
  const mass = await seite.evaluate(() => {
    const treffer = [];
    const hoehen = [];
    for (const opt of document.querySelectorAll('.opt')) {
      const fill = opt.querySelector('.opt-fill');
      const bar = opt.querySelector('.opt-bar');
      hoehen.push(Math.round(bar.getBoundingClientRect().height));
      const fr = fill.getBoundingClientRect();
      // Ein Streifen an der Unterkante kann den Text gar nicht treffen.
      const kanteX = fr.right;
      const kanteOben = fr.top, kanteUnten = fr.bottom;
      for (const el of opt.querySelectorAll('.opt-label, .opt-num, .held')) {
        for (const z of el.getClientRects()) {
          const senkrecht = z.bottom > kanteOben + 1 && z.top < kanteUnten - 1;
          if (senkrecht && kanteX > z.left + 2 && kanteX < z.right - 2) {
            treffer.push(el.textContent.trim().slice(0, 28));
          }
        }
      }
    }
    return { treffer, hoehen };
  });

  const puffer = await seite.screenshot({
    clip: await seite.evaluate(() => {
      const r = document.querySelector('.poll').getBoundingClientRect();
      return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 };
    }),
  });
  await seite.close();
  return { bild: `data:image/png;base64,${puffer.toString('base64')}`, ...mass };
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) bilder.push({ ...f, ...(await schuss(f)) });

const blatt = await browser.newPage({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 26px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .reihe { display: flex; gap: 22px; align-items: flex-start; }
  .fall { width: 262px; }
  h2 { font-size: 13.5px; margin: 0 0 3px; line-height: 1.3; }
  p { font-size: 11px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px; }
  .mass { font-family: ui-monospace, Menlo, monospace; font-size: 10px; margin: 0 0 8px; }
  .gut { color: #6cc79a; } .schlecht { color: #e8b45c; }
  img { width: 262px; display: block; border-radius: 10px; border: 1px solid #23232a; }
</style>
<div class="reihe">
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <p class="mass ${b.treffer.length ? 'schlecht' : 'gut'}">
      ${b.treffer.length
        ? `Kante schneidet ${b.treffer.length}x durch Text`
        : 'Kante schneidet durch keinen Text'}<br>
      Zeilenhöhen ${b.hoehen.join(' / ')} px</p>
    <img src="${b.bild}">
  </div>`).join('')}
</div>
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'antwortzeilen.png'), fullPage: true });

console.log('');
for (const b of bilder) {
  console.log(`  ${b.nr}. ${b.name}`);
  console.log(`     Kante durch Text: ${b.treffer.length}x`
    + (b.treffer.length ? ` (${b.treffer.join(', ')})` : '')
    + `   Höhen: ${b.hoehen.join(' / ')} px`);
}
console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/antwortzeilen.png\n`);
await browser.close();
server.close();
