// ============================================================================
// Preview: how the three characters look in the chat
//
// What they have to accomplish before anyone talks about how they look:
//
//   1. Say who is speaking - for a name made of THREE characters that's not
//      much material. That's why they carry a color at all.
//   2. Tell two people with the same handle apart. With 58^3 = 195,112
//      possible handles that's rare, but it happens - the data below
//      deliberately has TWO with "7xK", and every version shows whether
//      they can still be told apart.
//   3. Make Ansem recognizable without anyone being able to fake him.
//   4. And not outshine the message while doing it. The name is the label,
//      the sentence is the content.
//
// So each version changes ONE thing, not three at once: the color, the
// size, the shape, or whether anything sits in front of it at all.
//
// What's measured in all of them: the contrast of the name against its
// background, and the gap to the message text next to it. A name louder
// than the sentence is no longer a label, it's a headline.
//
// None of this is wired in - these are just pictures.
//
// Produces preview/namen-*.png and preview/namen-uebersicht.png
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

// --- Color math --------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hx = (v) => '#' + v.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (x, y) => { const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + .05) / (q + .05); };
const get = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const toneValue = (n) => new RegExp(`\\.h\\.t${n} \\{ color: (#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, a, grund) => v.map((c, i) => a * c + (1 - a) * grund[i]);

const BG = hex(get('bg'));
const TEXT = hex(get('text'));
const DIM = hex(get('dim'));
const DIMMER = hex(get('dimmer'));
const TONES = [0, 1, 2, 3].map((n) => hex(toneValue(n)));

// The tinted backgrounds for version 4 - computed, not guessed, so the
// numbers below hold up.
//
// 32% and not less: at 18% the background measured #1e242a and was
// practically invisible next to #0a0b0f - the version would then have shown
// something it doesn't actually do. Whoever demonstrates an option has to
// demonstrate it in a way that can be judged.
const ANTEIL = .32;
const GROUNDS = TONES.map((t) => mix(t, ANTEIL, BG));
const AKZENT_GRUND = mix(hex(get('accent')), ANTEIL, BG);

const FASSUNGEN = [
  {
    file: 'jetzt', name: 'Jetzt',
    css: '',
    farben: TONES, reasons: TONES.map(() => BG),
    text: 'Vier Töne, aus der Adresse errechnet, fett und in Schreibmaschinenschrift. '
      + 'Ansem bekommt den Akzent und dazu die getönte Zeile. Der Ton ist das Einzige, '
      + 'was zwei Leute mit demselben Kürzel auseinanderhält.',
  },
  {
    file: 'ohnefarbe', name: 'Ohne Farbe',
    css: `.msg .who .h { color: var(--dim); }
          .msg .who .admin-name { color: var(--accent); }`,
    farben: TONES.map(() => DIM), reasons: TONES.map(() => BG),
    text: 'Alle Namen in einem Grau, nur Ansem behält den Akzent. Der Chat wird ruhig – '
      + 'aber die zwei "7xK" bottom sind dann nicht mehr zu unterscheiden, und genau dafür '
      + 'gibt es die Töne. Die volle Adresse steht weiterhin im Tooltip der Zeile.',
  },
  {
    file: 'leiser', name: 'Kleiner und leiser',
    css: `.msg .who .h { font-size: .82rem; font-weight: 500; }`,
    farben: TONES, reasons: TONES.map(() => BG),
    text: 'Dieselben Töne, aber kleiner und ohne Fettung. Der Name tritt hinter den Satz '
      + 'zurück, statt vor ihm zu stehen. Ändert nur Größe und Gewicht – die Farbe bleibt, '
      + 'wie sie ist.',
  },
  {
    file: 'chip', name: 'Als Marke',
    css: `.msg .who .h {
            border: 1px solid currentColor; border-radius: 6px;
            padding: .02rem .32rem; font-size: .78rem;
          }`,
    farben: TONES, reasons: TONES.map(() => BG),
    text: 'Die drei Zeichen in einem eigenen Umriss. Sie lesen sich dadurch als Kennung '
      + 'und nicht als abgeschnittenes Wort – bei drei Zeichen ohne Bedeutung ist das der '
      + 'Unterschied zwischen "Name" und "Tippfehler". Kostet Platz und bringt eine '
      + 'weitere Rundung in eine Zeile, die schon eine hat.',
  },
  {
    file: 'grund', name: 'Farbe als Grund',
    css: TONES.map((_, i) =>
      `.msg .who .h.t${i} { background: ${hx(GROUNDS[i])}; }`).join('\n')
      + `\n.msg .who .h { color: var(--text); border-radius: 6px; padding: .02rem .34rem; font-size: .8rem; }
         .msg .who .admin-name { color: var(--accent); background: ${hx(AKZENT_GRUND)}; }`,
    farben: TONES.map(() => TEXT), reasons: GROUNDS,
    text: 'Die Farbe wandert von der Schrift in eine kleine Fläche dahinter, die Zeichen '
      + 'werden fast weiß. Der Ton unterscheidet next, ohne dass die Schrift selbst '
      + 'eingefärbt ist – und alle Namen sind gleich hell, egal welchen Ton sie erwischt '
      + 'haben. Dafür ist es die lauteste der Fassungen.',
  },
  {
    file: 'at', name: 'Mit @ davor',
    css: `.msg .who .h::before { content: '@'; color: var(--dimmer); font-weight: 400; }`,
    farben: TONES, reasons: TONES.map(() => BG),
    text: 'Nur ein Zeichen davor, sonst alles wie jetzt. Drei Buchstaben ohne @ sehen aus '
      + 'wie ein Rest; mit @ liest man sie sofort als Namen. Kostet nichts – und wer von X '
      + 'kommt, kennt die Form. Der Haken: @ verspricht dort einen Namen, den man anschreiben '
      + 'kann, und hier ist es ein Adressanfang.',
  },
];

// --- Numbers -------------------------------------------------------------
console.log('\n  Kontrast der Namen und ihr Abstand zum Nachrichtentext\n');
console.log('  ' + 'Fassung'.padEnd(22) + 'Name auf Grund'.padEnd(20)
  + 'schwächster'.padEnd(14) + 'Ton-Unterschiede');
for (const f of FASSUNGEN) {
  const werte = f.farben.map((c, i) => kon(c, f.reasons[i]));
  f.min = Math.min(...werte);
  // How many PAIRS of the four tones can still be told apart. In "Ohne
  // Farbe" it's zero - that's the actual point of that version.
  const paare = [];
  for (let i = 0; i < f.farben.length; i++)
    for (let j = i + 1; j < f.farben.length; j++)
      if (hx(f.farben[i]) !== hx(f.farben[j]) || hx(f.reasons[i]) !== hx(f.reasons[j])) paare.push(1);
  f.paare = paare.length;
  console.log('  ' + f.name.padEnd(22)
    + `${werte.map((v) => v.toFixed(1)).join(' / ')}`.padEnd(20)
    + `${f.min.toFixed(1)}:1`.padEnd(14) + `${f.paare} von 6 Paaren`);
}
const textKon = kon(TEXT, BG);
console.log(`\n  Der Nachrichtentext daneben steht bei ${textKon.toFixed(1)}:1.`);
console.log('  Ein Name, der deutlich darueber liegt, liest sich als Ueberschrift.\n');

// --- Data ------------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  b: '7xK9zYxWvUtSrQpOnMlKjIhGfEdCbA1234567890abc',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
  e: 'Zm2nB4vC6xZ8lK0jH2gF4dS6aP8oI0uY2tR4eW6qA8s',
};
const std = (h) => Date.now() - h * 3600e3, min2 = (m) => Date.now() - m * 60_000;
// Kept short so six pictures fit side by side - but WITH the awkward cases:
// two matching handles, Ansem, a long message.
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
            background:var(--bg);padding:14px;box-sizing:border-box">${chatScaffold}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const bilder = [];
for (const f of FASSUNGEN) {
  const page = await browser.newPage({ viewport: { width: 640, height: 620 }, deviceScaleFactor: 2 });
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
    document.querySelector('#chat-list').scrollTop = 1e6;` });
  // Only AFTER the page's own stylesheet - otherwise the rule from
  // styles.css wins.
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  const bild = await page.locator('#chat-list').screenshot();
  await page.close();
  fs.writeFileSync(path.join(ausgabe, `namen-${f.file}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

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
<h1>Die drei Zeichen im Chat</h1>
<p class="lead">In jedem Bild stehen dieselben zehn Nachrichten. Zwei davon kommen von verschiedenen Wallets mit
demselben Kürzel <b>7xK</b> – der Fall, für den es die vier Töne überhaupt gibt; in Fassung 1 sieht man, was
ohne sie passiert. Ansem ist zweimal dabei, mit Akzentfarbe und getönter Zeile.
Der Nachrichtentext daneben steht bei ${textKon.toFixed(1)}:1 – ein Name, der deutlich darüber liegt, liest sich
als Überschrift statt als Angabe. Nichts hiervon ist eingebaut.</p>
<div class="row">
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
