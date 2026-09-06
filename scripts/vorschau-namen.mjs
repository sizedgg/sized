// ============================================================================
// Vorschau: wie die drei Zeichen im Chat aussehen
//
// Was sie leisten muessen, bevor man ueber ihr Aussehen redet:
//
//   1. Sagen, wer spricht – bei einem Namen aus DREI Zeichen ist das wenig
//      Material. Deshalb tragen sie ueberhaupt eine Farbe.
//   2. Zwei Leute mit demselben Kuerzel auseinanderhalten. Bei 58³ = 195.112
//      moeglichen Kuerzeln passiert das selten, aber es passiert – in den
//      Daten unten stehen deshalb ZWEI mit "7xK", und in jeder Fassung sieht
//      man, ob sie noch zu unterscheiden sind.
//   3. Ansem erkennbar machen, ohne dass ihn jemand nachbauen kann.
//   4. Und dabei die Nachricht nicht ueberstrahlen. Der Name ist die Angabe,
//      der Satz ist der Inhalt.
//
// Die Fassungen aendern deshalb jeweils EINE Sache, nicht drei auf einmal:
// die Farbe, die Groesse, die Form, oder ob ueberhaupt etwas davorsteht.
//
// Gemessen wird in allen: der Kontrast des Namens auf seinem Grund, und der
// Abstand zum Nachrichtentext daneben. Ein Name, der lauter ist als der Satz,
// ist keine Angabe mehr, sondern eine Ueberschrift.
//
// Nichts hiervon ist eingebaut – das sind nur Bilder.
//
// Erzeugt preview/namen-*.png und preview/namen-uebersicht.png
//   node scripts/vorschau-namen.mjs
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const stueck = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};

const zahlen = schneide('const nfCompact =', '/* Ausgeschrieben statt');
const kurz = schneide('const STUFEN =', '\n/**\n * Datumstrenner');
const tage = schneide('const tagBeginn =', 'const handleOf');
const namen = schneide('const handleOf =', '\nconst esc =');
const escFn = schneide('const esc = (s) =>', '\n\n');
const linkify = schneide('const LINK_MUSTER =', '\nfunction toast(');
const chatBau = schneide('const istAdmin =', '\nfunction appendMessage');
const chatGeruest = stueck('<main id="pane-chat"', '</main>');

// --- Farbrechnung ----------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hx = (v) => '#' + v.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (x, y) => { const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + .05) / (q + .05); };
const hol = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const tonWert = (n) => new RegExp(`\\.h\\.t${n} \\{ color: (#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, a, grund) => v.map((c, i) => a * c + (1 - a) * grund[i]);

const BG = hex(hol('bg'));
const TEXT = hex(hol('text'));
const DIM = hex(hol('dim'));
const DIMMER = hex(hol('dimmer'));
const TOENE = [0, 1, 2, 3].map((n) => hex(tonWert(n)));

// Die getoenten Gruende fuer Fassung 4 – ausgerechnet und nicht geraten,
// damit die Zahlen darunter stimmen.
//
// 32 % und nicht weniger: Bei 18 % lag der Grund auf gemessenen #1e242a und
// war neben #0a0b0f praktisch nicht zu sehen – die Fassung haette dann etwas
// gezeigt, was sie gar nicht tut. Wer eine Moeglichkeit vorfuehrt, muss sie
// so vorfuehren, dass man sie beurteilen kann.
const ANTEIL = .32;
const GRUENDE = TOENE.map((t) => mix(t, ANTEIL, BG));
const AKZENT_GRUND = mix(hex(hol('accent')), ANTEIL, BG);

const FASSUNGEN = [
  {
    datei: 'jetzt', name: 'Jetzt',
    css: '',
    farben: TOENE, gruende: TOENE.map(() => BG),
    text: 'Vier Töne, aus der Adresse errechnet, fett und in Schreibmaschinenschrift. '
      + 'Ansem bekommt den Akzent und dazu die getönte Zeile. Der Ton ist das Einzige, '
      + 'was zwei Leute mit demselben Kürzel auseinanderhält.',
  },
  {
    datei: 'ohnefarbe', name: 'Ohne Farbe',
    css: `.msg .who .h { color: var(--dim); }
          .msg .who .admin-name { color: var(--accent); }`,
    farben: TOENE.map(() => DIM), gruende: TOENE.map(() => BG),
    text: 'Alle Namen in einem Grau, nur Ansem behält den Akzent. Der Chat wird ruhig – '
      + 'aber die zwei "7xK" unten sind dann nicht mehr zu unterscheiden, und genau dafür '
      + 'gibt es die Töne. Die volle Adresse steht weiterhin im Tooltip der Zeile.',
  },
  {
    datei: 'leiser', name: 'Kleiner und leiser',
    css: `.msg .who .h { font-size: .82rem; font-weight: 500; }`,
    farben: TOENE, gruende: TOENE.map(() => BG),
    text: 'Dieselben Töne, aber kleiner und ohne Fettung. Der Name tritt hinter den Satz '
      + 'zurück, statt vor ihm zu stehen. Ändert nur Größe und Gewicht – die Farbe bleibt, '
      + 'wie sie ist.',
  },
  {
    datei: 'chip', name: 'Als Marke',
    css: `.msg .who .h {
            border: 1px solid currentColor; border-radius: 6px;
            padding: .02rem .32rem; font-size: .78rem;
          }`,
    farben: TOENE, gruende: TOENE.map(() => BG),
    text: 'Die drei Zeichen in einem eigenen Umriss. Sie lesen sich dadurch als Kennung '
      + 'und nicht als abgeschnittenes Wort – bei drei Zeichen ohne Bedeutung ist das der '
      + 'Unterschied zwischen "Name" und "Tippfehler". Kostet Platz und bringt eine '
      + 'weitere Rundung in eine Zeile, die schon eine hat.',
  },
  {
    datei: 'grund', name: 'Farbe als Grund',
    css: TOENE.map((_, i) =>
      `.msg .who .h.t${i} { background: ${hx(GRUENDE[i])}; }`).join('\n')
      + `\n.msg .who .h { color: var(--text); border-radius: 6px; padding: .02rem .34rem; font-size: .8rem; }
         .msg .who .admin-name { color: var(--accent); background: ${hx(AKZENT_GRUND)}; }`,
    farben: TOENE.map(() => TEXT), gruende: GRUENDE,
    text: 'Die Farbe wandert von der Schrift in eine kleine Fläche dahinter, die Zeichen '
      + 'werden fast weiß. Der Ton unterscheidet weiter, ohne dass die Schrift selbst '
      + 'eingefärbt ist – und alle Namen sind gleich hell, egal welchen Ton sie erwischt '
      + 'haben. Dafür ist es die lauteste der Fassungen.',
  },
  {
    datei: 'at', name: 'Mit @ davor',
    css: `.msg .who .h::before { content: '@'; color: var(--dimmer); font-weight: 400; }`,
    farben: TOENE, gruende: TOENE.map(() => BG),
    text: 'Nur ein Zeichen davor, sonst alles wie jetzt. Drei Buchstaben ohne @ sehen aus '
      + 'wie ein Rest; mit @ liest man sie sofort als Namen. Kostet nichts – und wer von X '
      + 'kommt, kennt die Form. Der Haken: @ verspricht dort einen Namen, den man anschreiben '
      + 'kann, und hier ist es ein Adressanfang.',
  },
];

// --- Zahlen ----------------------------------------------------------------
console.log('\n  Kontrast der Namen und ihr Abstand zum Nachrichtentext\n');
console.log('  ' + 'Fassung'.padEnd(22) + 'Name auf Grund'.padEnd(20)
  + 'schwächster'.padEnd(14) + 'Ton-Unterschiede');
for (const f of FASSUNGEN) {
  const werte = f.farben.map((c, i) => kon(c, f.gruende[i]));
  f.min = Math.min(...werte);
  // Wie viele PAARE der vier Toene sich noch unterscheiden. In "Ohne Farbe"
  // sind es null – das ist die eigentliche Aussage dieser Fassung.
  const paare = [];
  for (let i = 0; i < f.farben.length; i++)
    for (let j = i + 1; j < f.farben.length; j++)
      if (hx(f.farben[i]) !== hx(f.farben[j]) || hx(f.gruende[i]) !== hx(f.gruende[j])) paare.push(1);
  f.paare = paare.length;
  console.log('  ' + f.name.padEnd(22)
    + `${werte.map((v) => v.toFixed(1)).join(' / ')}`.padEnd(20)
    + `${f.min.toFixed(1)}:1`.padEnd(14) + `${f.paare} von 6 Paaren`);
}
const textKon = kon(TEXT, BG);
console.log(`\n  Der Nachrichtentext daneben steht bei ${textKon.toFixed(1)}:1.`);
console.log('  Ein Name, der deutlich darueber liegt, liest sich als Ueberschrift.\n');

// --- Daten -----------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  b: '7xK9zYxWvUtSrQpOnMlKjIhGfEdCbA1234567890abc',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
  e: 'Zm2nB4vC6xZ8lK0jH2gF4dS6aP8oI0uY2tR4eW6qA8s',
};
const std = (h) => Date.now() - h * 3600e3, min2 = (m) => Date.now() - m * 60_000;
// Kurz gehalten, damit sechs Bilder nebeneinander passen – aber MIT den
// unbequemen Faellen: zwei gleiche Kuerzel, Ansem, eine lange Nachricht.
const CHAT = [
  { id: 1, wallet: W.c, usd: 1240, body: 'gm', createdAt: std(5) },
  { id: 2, wallet: W.a, usd: 86400, body: 'is the gate still at $10 or did that change', createdAt: std(5) },
  { id: 3, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'still $10. new poll is live, 24h', createdAt: std(4) },
  { id: 4, wallet: W.b, usd: 0.4, body: 'made it in with dust lol', createdAt: std(4) },
  { id: 5, wallet: W.d, usd: 3420, body: 'voted. ship it', createdAt: std(3) },
  { id: 6, wallet: W.e, usd: 214000,
    body: 'anyone else seeing the balance lag by a minute or two after buying', createdAt: std(2) },
  { id: 7, wallet: W.a, usd: 86400, body: 'yeah it catches up', createdAt: min2(52) },
  { id: 8, wallet: W.b, usd: 0.4, body: 'same handle as that guy up there, different wallet', createdAt: min2(31) },
  { id: 9, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'weight follows the balance while the poll is open', createdAt: min2(12) },
  { id: 10, wallet: W.c, usd: 1240, body: 'fair', createdAt: min2(2) },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">${chatGeruest}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const bilder = [];
for (const f of FASSUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 640, height: 620 }, deviceScaleFactor: 2 });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({ content: `
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = {
      cfg: { symbol: 'ANSEM', admin_wallet: ${JSON.stringify(W.ansem)} },
      me: { isAdmin: false, wallet: ${JSON.stringify(W.a)} },
      live: new Map(), quoted: new Map(), filters: { usd: 0 },
    };
    const toast = () => {};
    ${escFn}${zahlen}${kurz}${tage}${namen}${linkify}${chatBau}
    const usdOf = (m) => m.usd;
    const passesFilter = () => true;
    document.querySelector('#chat-list').innerHTML =
      ${JSON.stringify(CHAT)}.map(msgHtml).join('');
    document.querySelector('#chat-list').scrollTop = 1e6;` });
  // Erst NACH dem Blatt der Seite – sonst gewinnt die Regel aus styles.css.
  if (f.css) await seite.addStyleTag({ content: f.css });
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(350);
  const bild = await seite.locator('#chat-list').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, `namen-${f.datei}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .reihe { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 26px; align-items: start; }
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
<h1>Die drei Zeichen im Chat</h1>
<p class="lead">In jedem Bild stehen dieselben zehn Nachrichten. Zwei davon kommen von verschiedenen Wallets mit
demselben Kürzel <b>7xK</b> – der Fall, für den es die vier Töne überhaupt gibt; in Fassung 1 sieht man, was
ohne sie passiert. Ansem ist zweimal dabei, mit Akzentfarbe und getönter Zeile.
Der Nachrichtentext daneben steht bei ${textKon.toFixed(1)}:1 – ein Name, der deutlich darüber liegt, liest sich
als Überschrift statt als Angabe. Nichts hiervon ist eingebaut.</p>
<div class="reihe">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.min < 4.5 ? 'knapp' : ''}">schwächster Name ${f.min.toFixed(1)}:1
      · ${f.paare} von 6 Tonpaaren unterscheidbar</span></h2>
  <p class="t">${f.text}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(600);
await s.screenshot({ path: path.join(ausgabe, 'namen-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'namen-uebersicht.png')}\n`);
