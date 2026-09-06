// ============================================================================
// Vorschau: die eigene Sprechblase im Blau der Poll-Balken
//
// Die Frage dahinter ist berechtigt: Seit die Balken in den Polls Xs Farben
// tragen, hat die Seite ZWEI Blautoene.
//
//   Sprechblase   #4b9aea   aus Xs DMs abgemessen
//   Poll-Balken   #2b5988   aus Xs Umfragen abgemessen
//
// Die beiden liegen 2,46:1 auseinander – das ist kein Nuancenunterschied,
// sondern deutlich sichtbar. X selbst haelt sich zwei Blaus, weil die beiden
// Dinge verschieden gross sind: Eine Sprechblase ist klein und soll leuchten,
// ein Balken ist gross und liegt unter Text.
//
// Was beim Zusammenlegen wirklich passiert – und der Grund, warum es hier
// gezeigt und nicht einfach gemacht wird: Es ist ein TAUSCH, kein Gewinn.
//
//   * Weiss auf der eigenen Blase geht von 2,95:1 auf 7,27:1. Das ist die
//     knappste Stelle der ganzen Seite, ausdruecklich unter der Richtlinie,
//     und sie waere damit weg.
//   * Dafuer ruecken die beiden Blasen zusammen: von 5,44:1 auf 2,21:1. Der
//     Unterschied zwischen "meine" und "deine" wird also flacher – er bleibt
//     ueber den Farbton bestehen, aber nicht mehr ueber die Helligkeit.
//
// Deshalb stehen hier vier Fassungen und nicht eine: das Jetzt zum Vergleich,
// die Frage woertlich genommen, dieselbe Frage konsequent zu Ende gedacht
// (dann auch das Grau aus den Polls), und ein Mittelweg.
//
// Erzeugt preview/dmpoll-*.png und preview/dmpoll-uebersicht.png
//   node scripts/vorschau-dm-pollblau.mjs
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

// Woertlich aus den echten Dateien geschnitten. Eine nachgebaute Blase wuerde
// zeigen, wie ich mir die DMs vorstelle, und nicht, wie sie sind.
const sn = (v, b) => {
  const i = appJs.indexOf(v), j = appJs.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`Nicht gefunden in app.js: ${v}`);
  return appJs.slice(i, j);
};
const zahlen = sn('const nfCompact =', '/* Ausgeschrieben statt');
const escFn = sn('const esc = (s) =>', '\n\n');
const linkify = sn('const LINK_MUSTER =', '\nfunction toast(');
const tage = sn('const tagBeginn =', 'const handleOf');
// Ab dmAutor und nicht erst ab dmQuoteHtml: Die Namenszeile ueber einer
// Antwort ("↩ 4bo") wird von dmAutor gebaut, und die steht eine Zeile ueber
// dem Ausschnitt. Faengt man erst darunter an, wirft jede Antwortnachricht
// still einen Fehler – die Blasen bleiben leer, und das Bild sieht nach einem
// Entwurf aus statt nach einem Fehler.
const handle = sn('const handleOf =', '\n');
const dmBau = sn('const dmAutor =', '\n// ------');

const a = html.indexOf('<main id="pane-dms"');
const b = html.indexOf('</main>', a);
const pane = html.slice(a, b + 7).replace('class="pane" hidden', 'class="pane"');

// --- Farbrechnung ----------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hx = (v) => '#' + v.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b2]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b2); };
const kon = (x, y) => { const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + .05) / (q + .05); };
const hol = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const mitte = (x, y) => x.map((c, i) => (c + y[i]) / 2);

const BG = hex(hol('bg'));
const BG3 = hex(hol('bg-3'));         // die eingehende Blase heute
const TEXT = hex(hol('text'));
const WEISS = [255, 255, 255];
const DM_BLAU = hex(hol('dm-eigen'));         // #4b9aea
const POLL_BLAU = hex(hol('fuellung-spitze')); // #2b5988
const POLL_GRAU = hex(hol('fuellung'));        // #343639
const MITTE = mitte(DM_BLAU, POLL_BLAU);

const FASSUNGEN = [
  {
    datei: 'jetzt', name: 'Jetzt – Xs DM-Blau',
    eigen: DM_BLAU, fremd: BG3,
    text: 'Der Stand. Die Blase leuchtet, und die beiden Seiten sind über die '
      + 'Helligkeit klar getrennt. Der Preis steht seit dem ersten Tag im Blatt: '
      + 'Weiss darauf sind 2,95:1 – X liefert das so aus, für 15px-Schrift wären '
      + '4,5:1 nötig. Es ist die knappste Stelle der ganzen Seite.',
  },
  {
    datei: 'pollblau', name: 'Das Blau aus den Polls',
    eigen: POLL_BLAU, fremd: BG3,
    text: 'Die Frage wörtlich. Ein Blau statt zwei, und die knappe Stelle ist weg – '
      + 'Weiss steht jetzt bei 7,27:1. Dafür rücken die Blasen zusammen: Sie '
      + 'unterscheiden sich nur noch über den Farbton, kaum noch über die '
      + 'Helligkeit. Ob das reicht, sieht man am besten an der kurzen Antwort unten.',
  },
  {
    datei: 'beides', name: 'Beide Farben aus den Polls',
    eigen: POLL_BLAU, fremd: POLL_GRAU,
    text: 'Dieselbe Frage zu Ende gedacht: Wenn das Blau aus den Polls kommt, dann '
      + 'auch das Grau. Dann trägt die ganze Seite dieselben zwei Töne, und die '
      + 'eingehende Blase wird nebenbei heller als heute. Kostet aber genau das, '
      + 'was Fassung 1 spart – die beiden Blasen liegen dann am engsten beieinander.',
  },
  {
    datei: 'mitte', name: 'Mittelweg zwischen den beiden Blaus',
    eigen: MITTE, fremd: BG3,
    text: `Genau zwischen ${hx(DM_BLAU)} und ${hx(POLL_BLAU)}. Nicht dasselbe Blau `
      + 'wie die Balken, aber nah genug, dass es als eine Familie durchgeht – und '
      + 'Weiss darauf reicht für kleine Schrift. Der Kompromiss, falls dir '
      + 'Fassung 1 zu flach und der Stand zu grell ist.',
  },
];

console.log('\n  Alle Werte gerechnet, nicht geschaetzt.\n');
console.log('  ' + 'Fassung'.padEnd(34) + 'Weiss auf'.padEnd(12) + 'Text auf'.padEnd(11)
  + 'Blasen zu-'.padEnd(12) + 'eigene zu');
console.log('  ' + ' '.repeat(34) + 'eigener'.padEnd(12) + 'eingeh.'.padEnd(11)
  + 'einander'.padEnd(12) + 'Grund');

for (const f of FASSUNGEN) {
  f.weiss = kon(WEISS, f.eigen);
  f.tFremd = kon(TEXT, f.fremd);
  f.zwischen = kon(f.eigen, f.fremd);
  f.zuGrund = kon(f.eigen, BG);
  f.knapp = f.weiss < 4.5;
  console.log('  ' + f.name.padEnd(34)
    + `${f.weiss.toFixed(2)}:1`.padEnd(12) + `${f.tFremd.toFixed(1)}:1`.padEnd(11)
    + `${f.zwischen.toFixed(2)}:1`.padEnd(12) + `${f.zuGrund.toFixed(2)}:1`
    + (f.knapp ? '   ACHTUNG: unter 4,5:1' : ''));
}
console.log('\n  "Blasen zueinander" ist die Zahl, die beim Zusammenlegen faellt.'
  + '\n  Sie sagt aber nur, wie weit die HELLIGKEIT trennt – der Farbton trennt'
  + '\n  weiter, und den misst kein Kontrastwert.\n');

// --- Bilder ----------------------------------------------------------------
const std = (h) => Date.now() - h * 3600e3, min = (m) => Date.now() - m * 60_000;
const DM = [
  { id: 1, from_admin: false, body: 'hey — congrats on the launch', created_at: std(30) },
  { id: 2, from_admin: true, body: 'thanks', created_at: std(29) },
  { id: 3, from_admin: false, body: 'quick one: is the token gate number final or are you still moving it around', created_at: std(28) },
  { id: 4, from_admin: true, reply_to: 3, body: 'final for now. i will say something in chat if it changes', created_at: std(28) },
  { id: 5, from_admin: false, body: 'sent you the numbers: https://sized.gg/p/12', created_at: min(90) },
  { id: 6, from_admin: true, body: 'looking', created_at: min(60) },
  { id: 7, from_admin: false, reply_to: 6, body: 'no rush', created_at: min(20) },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body style="margin:0">
       <div style="display:flex;flex-direction:column;height:100vh;background:var(--bg)">${pane}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const bilder = [];
for (const f of FASSUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 720, height: 640 }, deviceScaleFactor: 2 });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  // Nur die beiden Variablen werden umgesetzt, keine Regel angefasst. Damit
  // laeuft das Zitat in der Antwort automatisch mit – es holt sich --dm-fremd
  // aus derselben Stelle wie die Blase.
  await seite.addStyleTag({ content:
    `:root { --dm-eigen: ${hx(f.eigen)}; --dm-fremd: ${hx(f.fremd)}; }` });
  await seite.addScriptTag({ content: `
    const state = { me: { isAdmin: false, wallet: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo' },
      cfg: { admin_wallet: 'AnsEmXk9vQ2p7ZrT4hB6yLdW3sNcF8gJmR5uKtP1qVxY' },
      activeThread: null, dmMessages: [], dmRepliesAvailable: true };
    ${zahlen}${escFn}${linkify}${tage}${handle}${dmBau}
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-admin').hidden = true;
    state.dmMessages = ${JSON.stringify(DM)};
    document.querySelector('#dm-thread').innerHTML = dmListeHtml(state.dmMessages);
    document.querySelector('#dm-thread').scrollTop = 1e6;` });
  // Der Zeiger weg vom Bild: Sonst steht eine Blase im Hover-Zustand da und
  // sieht anders aus als die anderen.
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(300);
  const bild = await seite.locator('#dm-user').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, `dmpoll-${f.datei}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .reihe { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #16181c; padding: 10px; border-radius: 12px; }
</style>
<h1>Die eigene Sprechblase im Blau der Poll-Balken</h1>
<p class="lead">Die Seite hat seit den neuen Poll-Farben zwei Blautöne: <b>#4b9aea</b> in der Sprechblase
und <b>#2b5988</b> im Balken, 2,46:1 auseinander. X selbst hält sich beide – eine Blase ist klein und soll
leuchten, ein Balken ist gross und liegt unter Text. Sie zusammenzulegen ist deshalb ein Tausch und kein
Gewinn: Weiss auf der eigenen Blase wird von 2,95:1 auf 7,27:1 besser (die knappste Stelle der Seite wäre
damit weg), dafür fallen die beiden Blasen von 5,44:1 auf 2,21:1 zusammen – sie unterscheiden sich dann
über den Farbton, kaum noch über die Helligkeit. Nichts ist hier geändert; das sind nur Bilder.</p>
<div class="reihe">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.knapp ? 'knapp' : ''}">Weiss ${f.weiss.toFixed(2)}:1
      · Blasen zueinander ${f.zwischen.toFixed(2)}:1 · ${hx(f.eigen)} auf ${hx(f.fremd)}</span></h2>
  <p class="t">${f.text}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(600);
await s.screenshot({ path: path.join(ausgabe, 'dmpoll-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'dmpoll-uebersicht.png')}\n`);
