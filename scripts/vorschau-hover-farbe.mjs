// ============================================================================
// Vorschau: die Farbe einer Chatzeile unter dem Zeiger
//
// Das Problem, gemessen: Der Zeigergrund ist --bg-2 (#161923), Ansems Zeilen
// liegen auf #141c28. Zwischen den beiden sind 1,02:1 – das ist kein "etwas
// zu nah", das ist derselbe Ton. Wer mit der Maus durch den Verlauf faehrt,
// erzeugt unter dem Zeiger genau das Bild, das sonst "hier spricht Ansem"
// bedeutet.
//
// Zwei Sachen, die dabei auseinandergehalten gehoeren:
//
//   1. Der Abstand des Zeigergrundes zu ANSEMS RUHEZUSTAND. Das ist die
//      Verwechslung, um die es geht.
//   2. Der Abstand des Zeigergrundes zum normalen Grund. Wird der zu klein,
//      sieht man den Zeiger gar nicht mehr – gewonnen waere nichts.
//
// Und eine dritte, die man leicht uebersieht: Was passiert, wenn man ANSEMS
// Zeile ueberfaehrt? Heute ersetzt der Zeigergrund die Toenung vollstaendig,
// seine Zeile sieht unter dem Zeiger also aus wie jede andere. Fassung 4
// macht daraus eine zusaetzliche Schicht statt eines Austauschs – dann bleibt
// erkennbar, wessen Zeile man gerade ueberfaehrt.
//
// In jedem Bild sind fuenf Zeilen: zwei normale, eine davon unter dem Zeiger,
// und zwei von Ansem, eine davon unter dem Zeiger. Nur so sieht man alle vier
// Zustaende nebeneinander – ein Bildschirmfoto kann immer nur eine Zeile
// wirklich ueberfahren.
//
// Nichts hiervon ist eingebaut.
//
// Erzeugt preview/hover-*.png und preview/hover-uebersicht.png
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
const spreizung = (v) => Math.max(...v) - Math.min(...v);

const GRUND = hex(hol('bg-1'));      // der Chatgrund, auf dem die Zeilen liegen
const BG2 = hex(hol('bg-2'));
const BG3 = hex(hol('bg-3'));
const LINE = hex(hol('line'));
const WEISS = [255, 255, 255];

// Ansems Toenung aus dem Blatt lesen statt sie zu kennen – sie ist erst vor
// Kurzem von Petrol auf dieses Blau gewechselt.
const m = /\.msg\.is-admin \{ background: rgba\((\d+), (\d+), (\d+), (\.\d+)\)/.exec(css);
if (!m) throw new Error('Ansems Toenung sieht im Blatt anders aus als erwartet');
const ANSEM = mix([+m[1], +m[2], +m[3]], +m[4], GRUND);

const fassung = (datei, name, farbe, text, { schicht = null } = {}) => ({
  datei, name, text,
  // Dieselbe Deklaration fuer :hover und fuer die Klasse, mit der das Bild
  // zwei Zeilen gleichzeitig "ueberfahren" zeigt. So ist das, was im Bild
  // steht, wirklich der Vorschlag und keine zweite Fassung davon.
  css: schicht
    ? `.msg:hover, .msg.zeigt-hover { background-image:
         linear-gradient(${schicht}, ${schicht}); }`
    : `.msg:hover, .msg.zeigt-hover { background: ${farbe}; }`,
  // Was man am Ende SIEHT – bei der Schicht liegt sie auf dem jeweiligen
  // Grund, sonst ersetzt die Farbe ihn.
  normalHover: schicht ? mix(WEISS, schicht.anteil, GRUND) : hex(farbe),
  ansemHover: schicht ? mix(WEISS, schicht.anteil, ANSEM) : hex(farbe),
});

// Ein kleines Objekt statt einer Zeichenkette: Die Deckkraft wird zweimal
// gebraucht – einmal als CSS-Text, einmal zum Nachrechnen der Farbe, die dabei
// herauskommt. Zwei getrennte Werte waeren zwei Stellen, die auseinanderlaufen.
const veil = (anteil) => ({ toString: () => `rgba(255, 255, 255, ${anteil})`, anteil });

const FASSUNGEN = [
  // "Vorher" und nicht "Jetzt": Seit dieser Runde steht im Blatt Fassung 2.
  // Ein Vergleichsbild, dessen eine Haelfte stillschweigend mitwandert,
  // vergleicht nichts.
  fassung('vorher', 'Vorher – --bg-2', hx(BG2),
    'Der Stand vor dieser Runde. 1,02:1 von Ansems Tönung entfernt, also praktisch '
    + 'derselbe Ton. Genau darum ging es.'),
  fassung('bg3', '--bg-3', hx(BG3),
    'Eine Palettenstufe höher. Deutlich sichtbarer als Zeiger, aber immer noch '
    + 'blaustichig wie Ansems Tönung – der Abstand kommt allein aus der Helligkeit.'),
  fassung('line', '--line – so ist es jetzt', hx(LINE),
    'Die eingebaute Fassung. Die hellste Fläche der Palette. Der grösste Abstand, den ein vorhandener Ton '
    + 'hergibt. Der Preis: --line ist auch die Farbe der Trennlinien zwischen den '
    + 'Zeilen – unter dem Zeiger verschwindet die Linie also in der Fläche.'),
  fassung('weiss', 'Weisser Schleier, 8 %', hx(mix(WEISS, .08, GRUND)),
    'Kein Palettenton, sondern ein Hauch Weiss auf dem Chatgrund. Das Ergebnis ist '
    + 'NEUTRAL, während Ansems Tönung blau ist – der Unterschied kommt hier also '
    + 'nicht nur aus der Helligkeit, sondern auch aus dem Farbton. Das trennt '
    + 'besser, als die Zahl allein vermuten lässt.'),
  fassung('schicht', 'Schleier als zusätzliche Schicht', null,
    'Wie Fassung 3, aber der Zeiger ERSETZT den Grund nicht mehr, sondern legt sich '
    + 'darüber. Damit behält Ansems Zeile ihre Tönung, während man sie überfährt – '
    + 'heute verliert sie sie, und seine Zeile sieht unter dem Zeiger aus wie jede '
    + 'andere. Die einzige Fassung, in der alle vier Zustände unterscheidbar sind.',
    { schicht: veil(.06) }),
];

// --- Zahlen ----------------------------------------------------------------
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
console.log('\n  Die letzte Spalte ist die, die heute niemand beachtet: Faehrt man ueber'
  + '\n  ANSEMS Zeile, ersetzt der Zeigergrund seine Toenung. 1,00:1 heisst dort:'
  + '\n  Seine Zeile ist unter dem Zeiger von jeder anderen nicht zu unterscheiden.\n');

// --- Daten -----------------------------------------------------------------
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
  const datei = path.join(root, 'public', decodeURIComponent(q.url.split('?')[0]));
  if (q.url !== '/' && datei.startsWith(path.join(root, 'public'))
      && fs.existsSync(datei) && fs.statSync(datei).isFile()) {
    return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(fs.readFileSync(datei));
  }
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">${chatGeruest}</div>`);
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');

const bilder = [];
for (const f of FASSUNGEN) {
  // 900 px: Unter 761 px greift das Handy-Raster, und dann beantwortet das
  // Bild eine andere Frage als die gestellte.
  const seite = await browser.newPage({ viewport: { width: 900, height: 330 }, deviceScaleFactor: 2 });
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
    // Zeile 2 und 4 bekommen den Zeigerzustand als Klasse – ein Bild kann
    // immer nur EINE Zeile wirklich ueberfahren, und gerade der Vergleich der
    // vier Zustaende ist hier der Punkt.
    const zeilen = document.querySelectorAll('#chat-list .msg');
    zeilen[1].classList.add('zeigt-hover');
    zeilen[3].classList.add('zeigt-hover');` });
  if (f.css) await seite.addStyleTag({ content: f.css });
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(400);
  const bild = await seite.locator('#chat-list').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, `hover-${f.datei}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .reihe { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  /* Rot markiert wird nur, wo die Verwechslung WIRKLICH bleibt: wenn der
     Zeigergrund nah an Ansems Toenung liegt UND man die beiden auch im
     ueberfahrenen Zustand nicht auseinanderhaelt. Fassung 4 hat die erste
     Haelfte und nicht die zweite – sie loest das Problem an anderer Stelle. */
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #0a0b0f; padding: 10px; border-radius: 12px; border: 1px solid #1d212d; }
</style>
<h1>Die Farbe einer Chatzeile unter dem Zeiger</h1>
<p class="lead">Heute ist der Zeigergrund <b>#161923</b> und Ansems Tönung <b>${hx(ANSEM)}</b> –
<b>1,02:1</b> auseinander, also derselbe Ton. Wer mit der Maus durch den Verlauf fährt, erzeugt unter dem
Zeiger genau das Bild, das sonst „hier spricht Ansem“ bedeutet. In jedem Bild stehen alle vier Zustände
untereinander: normale Zeile in Ruhe und unter dem Zeiger, Ansems Zeile in Ruhe und unter dem Zeiger.
Achte besonders auf die letzte Spalte der Werte – sie sagt, ob man Ansems Zeile noch erkennt,
<i>während</i> man sie überfährt. Nichts hiervon ist eingebaut.</p>
<div class="reihe">
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
