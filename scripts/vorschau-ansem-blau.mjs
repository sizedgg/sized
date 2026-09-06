// ============================================================================
// Vorschau: Ansems Zeilen im Chat auf dem Blau der Poll-Balken
//
// Heute liegen sie auf einem schwachen Petrol – rgba(47, 191, 168, .075). Die
// Begruendung dafuer steht im Blatt und ist genau die, die jetzt zur Debatte
// steht: Petrol war damals der einzige Ton, der in dieser App noch KEINE
// Aufgabe hatte.
//
// Inzwischen hat das Blau drei:
//
//   Poll-Balken     #2b5988   "diese Antwort liegt vorn"
//   DM-Blase        #2b5988   "diese Nachricht ist von mir"
//   Posteingang     #8ab2dc   "dieses Gespraech ist ungelesen" (11,5 %)
//
// Es als vierte Bedeutung auf Ansems Zeilen zu legen, heisst nicht "endlich
// einheitlich", sondern "eine Farbe sagt jetzt vier verschiedene Dinge". Das
// ist kein Ausschlussgrund – Chat, Polls, DMs und Posteingang sind vier
// getrennte Ansichten, man sieht nie zwei davon gleichzeitig. Es ist aber der
// Preis, und er gehoert neben die Bilder.
//
// Gezeigt werden deshalb vier Staerken derselben Farbe und nicht eine: Ein
// Balken ist ein kleiner Streifen, eine Chatzeile ist die ganze Breite. Was
// als Fuellung angenehm ist, kann als Zeilengrund erschlagen.
//
// Gemessen in jeder Fassung: wie weit sich die Zeile vom Chatgrund abhebt
// (sonst faellt sie beim Ueberfliegen nicht auf – das ist ihr einziger Zweck),
// und wie gut Text und Betrag darauf noch stehen.
//
// Nichts hiervon ist eingebaut.
//
// Erzeugt preview/ansemblau-*.png und preview/ansemblau-uebersicht.png
//   node scripts/vorschau-ansem-blau.mjs
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
const mix = (v, a, grund) => v.map((c, i) => a * c + (1 - a) * grund[i]);

// Der Grund, auf dem eine Chatzeile WIRKLICH liegt, ist --bg-1 und nicht --bg:
// Der Chat steckt in einer Flaeche (.chat-panel), und die traegt --bg-1.
//
// Beim ersten Anlauf stand hier --bg. Die BILDER waren trotzdem richtig – sie
// kommen aus dem echten Geruest –, aber die Zahlentabelle daneben war es
// nicht, und die ist der halbe Zweck dieser Vorschau. Eine Vorschau, die
// falsche Zahlen neben richtige Bilder stellt, ist schlimmer als gar keine.
const BG = hex(hol('bg-1'));
const SEITE = hex(hol('bg'));
const TEXT = hex(hol('text'));
const WORTH = hex(hol('worth'));
const BLAU = hex(hol('fuellung-spitze'));   // #2b5988, dieselbe Quelle wie Balken und DM
const BG2 = hex(hol('bg-2'));               // der Grund unter dem Zeiger

// Die beiden vorhandenen Toenungen, woertlich aus dem Blatt gelesen statt
// abgetippt – sonst vergleicht man gegen eine Erinnerung.
const rgbaAus = (muster) => {
  const m = new RegExp(muster).exec(css);
  if (!m) throw new Error(`Nicht gefunden im Blatt: ${muster}`);
  return { farbe: [+m[1], +m[2], +m[3]], anteil: +m[4] };
};
const UNGELESEN = rgbaAus(String.raw`\.thread\.is-unread \{ background: rgba\((\d+), (\d+), (\d+), (\.\d+)\)`);

// Das Petrol steht hier als fester Wert und wird NICHT mehr aus dem Blatt
// gelesen – es steht dort nicht mehr, seit die Entscheidung gefallen ist.
// Wuerde man es weiter aus .msg.is-admin holen, zeigte die Fassung "Vorher"
// den aktuellen Stand und behauptete, das sei der alte. Ein Vergleich, dessen
// eine Haelfte stillschweigend mitwandert, vergleicht nichts.
const PETROL = { farbe: [47, 191, 168], anteil: .075 };

const JETZT = mix(PETROL.farbe, PETROL.anteil, BG);
const UNGELESEN_GRUND = mix(UNGELESEN.farbe, UNGELESEN.anteil, BG);

const stufe = (anteil, name, text) => ({
  datei: `b${String(Math.round(anteil * 100)).padStart(3, '0')}`,
  name, text,
  css: `.msg.is-admin { background: rgba(${BLAU.join(', ')}, ${anteil}); }`,
  grund: mix(BLAU, anteil, BG),
});

const FASSUNGEN = [
  {
    datei: 'vorher', name: 'Vorher – Petrol',
    css: `.msg.is-admin { background: rgba(${PETROL.farbe.join(', ')}, ${PETROL.anteil}); }`,
    grund: JETZT,
    text: `rgba(${PETROL.farbe.join(', ')}, ${PETROL.anteil}) über dem Chatgrund, also `
      + `${hx(JETZT)}. Der Stand VOR dieser Runde – gewählt wurde Petrol, weil es damals `
      + 'der einzige Ton ohne Aufgabe in der App war. Genau das stimmte für Blau nicht mehr. '
      + 'Steht hier nur noch als Vergleich; eingebaut ist inzwischen Fassung 2.',
  },
  stufe(.075, 'Blau, gleiche Stärke',
    'Dieselbe Deckkraft wie das Petrol jetzt – nur der Farbton getauscht. Der ehrlichste '
    + 'Vergleich: Alles andere bleibt gleich, man sieht nur den Ton.'),
  stufe(.14, 'Blau, kräftiger – so ist es jetzt',
    'Knapp doppelt so stark, und damit genau dort, wo das Petrol vorher lag (1,09:1). '
    + 'Das ist die eingebaute Fassung. Die Zeile meldet sich deutlicher, ohne dass die Fläche '
    + 'die Nachricht übernimmt.'),
  stufe(.22, 'Blau, deutlich',
    'Ab hier ist es keine Tönung mehr, sondern eine Fläche. Ansems Zeilen werden zu '
    + 'eigenen Blöcken im Verlauf statt zu hervorgehobenen Zeilen.'),
  stufe(1, 'Volles Blau wie die Balken',
    'Der Ton eins zu eins, wie in Poll und DM. Über die ganze Chatbreite ist das etwas '
    + 'anderes als in einem schmalen Balken oder einer kleinen Blase – gezeigt, damit du '
    + 'die Grenze siehst und nicht raten musst.'),
];

// --- Zahlen ----------------------------------------------------------------
console.log('\n  Alle Werte gerechnet.\n');
console.log('  ' + 'Fassung'.padEnd(28) + 'Zeile'.padEnd(10) + 'gegen'.padEnd(9)
  + 'Text'.padEnd(9) + 'Betrag'.padEnd(9) + 'gegen Zeiger-');
console.log('  ' + ' '.repeat(28) + ''.padEnd(10) + 'Chatgrund'.padEnd(9)
  + 'darauf'.padEnd(9) + 'darauf'.padEnd(9) + 'grund (--bg-2)');
for (const f of FASSUNGEN) {
  f.abheben = kon(f.grund, BG);
  f.text_ = kon(TEXT, f.grund);
  f.betrag = kon(WORTH, f.grund);
  f.gegenHover = kon(f.grund, BG2);
  console.log('  ' + f.name.padEnd(28) + hx(f.grund).padEnd(10)
    + `${f.abheben.toFixed(2)}:1`.padEnd(9)
    + `${f.text_.toFixed(1)}:1`.padEnd(9) + `${f.betrag.toFixed(1)}:1`.padEnd(9)
    + `${f.gegenHover.toFixed(2)}:1`);
}
console.log(`\n  Zum Vergleich: "ungelesen" im Posteingang steht auf ${hx(UNGELESEN_GRUND)}`
  + ` (${kon(UNGELESEN_GRUND, BG).toFixed(2)}:1 gegen seinen Grund).`);
console.log('  Die beiden treffen nie im selben Bild aufeinander – Chat und Posteingang'
  + '\n  sind getrennte Ansichten. Es bleibt trotzdem dieselbe Farbe fuer zwei Dinge.\n');

// --- Daten -----------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  b: '7xK9zYxWvUtSrQpOnMlKjIhGfEdCbA1234567890abc',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
};
const std = (h) => Date.now() - h * 3600e3, min2 = (m) => Date.now() - m * 60_000;
// Drei Zeilen von Ansem, verteilt – eine allein sagt nichts darueber, ob der
// Verlauf dadurch unruhig wird. Eine davon lang, eine sehr kurz.
const CHAT = [
  { id: 1, wallet: W.c, usd: 1240, body: 'gm', createdAt: std(5) },
  { id: 2, wallet: W.a, usd: 86400, body: 'is the gate still at $10 or did that change', createdAt: std(5) },
  { id: 3, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'still $10. read the pinned poll before asking again https://sized.gg/p/12', createdAt: std(4) },
  { id: 4, wallet: W.b, usd: 0.4, body: 'made it in with dust lol', createdAt: std(4) },
  { id: 5, wallet: W.d, usd: 3420, body: 'voted. ship it', createdAt: std(3) },
  { id: 6, wallet: W.ansem, usd: 12400000, isAdmin: true, body: 'new poll is live. 24h. go', createdAt: std(3) },
  { id: 7, wallet: W.a, usd: 86400, body: 'anyone else seeing the balance lag after buying', createdAt: min2(52) },
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
            background:var(--bg);padding:14px;box-sizing:border-box">${chatGeruest}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const bilder = [];
for (const f of FASSUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 660, height: 600 }, deviceScaleFactor: 2 });
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
  // Nach dem Blatt der Seite, sonst gewinnt die Regel aus styles.css.
  if (f.css) await seite.addStyleTag({ content: f.css });
  // Der Zeiger weg: Eine Zeile unter dem Zeiger zeigt --bg-2 statt ihres
  // eigenen Grundes, und genau die haette man dann verglichen.
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(350);
  const bild = await seite.locator('#chat-list').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, `ansemblau-${f.datei}.png`), bild);
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
<h1>Ansems Zeilen im Blau der Poll-Balken</h1>
<p class="lead">Dieselben zehn Nachrichten, drei davon von Ansem. Das Blau ist <b>#2b5988</b> – dieselbe Quelle
wie die führende Antwort in einer Umfrage und die eigene Sprechblase in den DMs. Vier Stärken, weil ein Balken
ein schmaler Streifen ist und eine Chatzeile die ganze Breite: Was als Füllung angenehm ist, kann als
Zeilengrund erschlagen. Der Einwand, den man kennen sollte, steht im Blatt und ist älter als diese Frage –
Petrol wurde damals gewählt, <i>weil es der einzige Ton ohne Aufgabe war</i>. Blau hat inzwischen drei:
führende Antwort, eigene DM, ungelesenes Gespräch. Nichts hiervon ist eingebaut.</p>
<div class="reihe">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.text_ < 4.5 ? 'knapp' : ''}">${hx(f.grund)}
      · hebt sich ${f.abheben.toFixed(2)}:1 ab · Text darauf ${f.text_.toFixed(1)}:1</span></h2>
  <p class="t">${f.text}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(600);
await s.screenshot({ path: path.join(ausgabe, 'ansemblau-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'ansemblau-uebersicht.png')}\n`);
