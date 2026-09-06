// ============================================================================
// Vorschaubilder: Das Aussehen des Polls-Tabs
//
// Zwei Beschwerden, zwei getrennte Blätter – sie hängen nicht zusammen und
// sollen einzeln entschieden werden.
//
// ----------------------------------------------------------------------------
// 1. "Zu viele verschiedene Grautöne"
//
// Nachgemessen stimmt das, aber anders als es klingt. Es sind nicht zu viele
// UNTERSCHIEDLICHE Töne – es sind zu viele FAST GLEICHE:
//
//   --bg    #0a0b0f
//   --bg-1  #101218   Schritt 1,05:1
//   --bg-2  #161923   Schritt 1,07:1   (im Polls-Tab gar nicht benutzt)
//   --bg-3  #1d212d   Schritt 1,09:1
//   --line  #262b39   Schritt 1,14:1
//
// Fünf Flächen in einer Spanne von rund 1,4:1. Jeder einzelne Schritt liegt
// unter dem, was das Auge als Absicht liest – man sieht, dass sich etwas
// ändert, aber nicht, dass es etwas bedeutet. Das Ergebnis ist genau der
// Eindruck von "irgendwie viele Grautöne": viele Entscheidungen, von denen
// keine etwas aussagt.
//
// Die Richtung ist deshalb nicht "andere Grautöne", sondern WENIGER Flächen
// mit GRÖSSEREN Schritten. Jede Fassung unten sagt, wie viele Flächen sie
// übrig lässt und wie gross ihr kleinster Schritt ist.
//
// ----------------------------------------------------------------------------
// 2. "Für Ansem steht das ganze Anlegefenster immer oben"
//
// Es ist der einzige Tab, dessen Eingabe oben sitzt – in Chat und DMs steht
// sie unten und ist eine Zeile hoch. Hier sind es fünf Zeilen, dauerhaft, über
// allem, was man eigentlich ansehen will. Und zwar auch dann, wenn Ansem gar
// keine Abstimmung anlegen will, was die meiste Zeit der Fall ist.
//
// Erzeugt preview/tab-toene.png und preview/tab-formular.png
//   node scripts/vorschau-polls-tab.mjs
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
const zeit = schneide('function fristText(closesAt)', '\n// Unter einer Stunde');
const zeile = schneide('const BALD_MS =', '\n/**\n * Der Zeiger');
const markup = schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');
const escFn = schneide('const esc = (s) =>', '\n\n');
const symbole = schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen');

const formular = /<div id="poll-admin"[\s\S]*?\n    <\/div>/.exec(html);
if (!formular) throw new Error('Das Anlegeformular sieht anders aus als erwartet');
const formularOffen = formular[0].replace(' hidden', '');

// --- Farbrechnung ----------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const hol = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, a, h) => v.map((c, i) => Math.round(a * c + (1 - a) * h[i]));

const BG = hol('bg'), BG1 = hol('bg-1'), BG3 = hol('bg-3'), LINE = hol('line');
const FUELL = mix(hex(hol('accent')), .24, hex(BG3));

// Wie viele Flächen eine Fassung übrig lässt und wie gross ihr kleinster
// Schritt ist. Gerechnet, nicht behauptet.
const bilanz = (toene) => {
  const eindeutig = [...new Map(toene.map((t) => [t.join(), t])).values()]
    .sort((a, b) => lum(a) - lum(b));
  let kleinster = Infinity;
  for (let i = 1; i < eindeutig.length; i++) kleinster = Math.min(kleinster, kon(eindeutig[i], eindeutig[i - 1]));
  return { anzahl: eindeutig.length, kleinster };
};

// ---------------------------------------------------------------------------
// Blatt 1: die Töne
// ---------------------------------------------------------------------------
const TOENE = [
  { datei: 'jetzt', name: 'Jetzt', css: '',
    toene: [hex(BG), hex(BG1), hex(BG3), hex(LINE), FUELL],
    hinweis: 'Vier Flächen plus die Füllung. Zwischen Seitengrund, Karte, Antwortzeile und Rand liegen Schritte von 1,05 bis 1,14:1 – jeder einzelne zu klein, um als Absicht gelesen zu werden.' },

  { datei: 'karte-flach', name: 'Karte ohne eigene Fläche',
    css: '.poll, .poll-admin { background: transparent; }',
    toene: [hex(BG), hex(BG3), hex(LINE), FUELL],
    hinweis: 'Die Karte hat keinen eigenen Grund mehr, nur noch ihren Rand. Der Unterschied zwischen Seite und Karte war ohnehin der kleinste im ganzen Tab (1,05:1) – ihn wegzunehmen kostet fast nichts und spart eine Fläche.' },

  { datei: 'zeile-flach', name: 'Antwortzeile ohne eigene Fläche',
    css: '.opt-bar { background: transparent; }',
    toene: [hex(BG), hex(BG1), hex(LINE), FUELL],
    hinweis: 'Umgekehrt: Die Karte behält ihren Grund, die Antwortzeilen verlieren ihren. Der gefüllte Teil steht dann direkt auf der Karte – die Füllung erzählt den Anteil allein, ohne dass eine zweite Fläche daneben mitredet. Eine Fläche weniger, aber der kleinste Schritt bleibt: Seite gegen Karte ist weiterhin 1,05:1.' },

  { datei: 'beides-flach', name: 'Beides flach – nur Ränder',
    css: '.poll, .poll-admin { background: transparent; } .opt-bar { background: transparent; }',
    toene: [hex(BG), hex(LINE), FUELL],
    hinweis: 'Eine einzige Fläche im ganzen Tab. Struktur kommt nur noch von Rändern und von der Füllung – dieselbe Sprache, die die heruntergeladene Karte schon spricht, seit der Verlauf dort weg ist.' },

  // Die drei Werte sind gerechnet, nicht gegriffen: Ausgehend von --bg jeweils
  // ein Schritt von 1,28:1, im Farbstich der Palette (das Verhaeltnis aus
  // --bg-3). So sind die Abstaende gleich gross – und zwar gross genug, um
  // gelesen zu werden.
  { datei: 'grosse-schritte', name: 'Weiter auseinander',
    css: ':root { --bg-1: #202532; --bg-3: #2f364a; --line: #3d465f; }',
    toene: [hex(BG), hex('#202532'), hex('#2f364a'), hex('#3d465f'), mix(hex(hol('accent')), .24, hex('#2f364a'))],
    hinweis: 'Alle vier Flächen bleiben, aber jeder Schritt wird auf 1,28:1 gebracht – gerechnet, nicht gegriffen. Wenn schon vier Ebenen, dann sollen sie sich auch unterscheiden. Der Preis steht im Bild: Der Tab wird deutlich heller und verliert das Fast-Schwarz, das der Rest der Seite hat.' },
];

// ---------------------------------------------------------------------------
// Blatt 2: das Anlegeformular
// ---------------------------------------------------------------------------
const FORMULARE = [
  { datei: 'jetzt', name: 'Jetzt: immer offen, oben',
    hinweis: 'Fünf Zeilen dauerhaft über allem – auch dann, wenn Ansem gerade keine Abstimmung anlegen will, was die meiste Zeit der Fall ist. Auf dem Handy ist der halbe Bildschirm weg, bevor die erste Abstimmung anfängt.' },

  { datei: 'geklappt', name: 'Zusammengeklappt',
    hinweis: 'Eine Zeile statt fünf. Ein Tipp klappt das Formular auf, nach dem Anlegen geht es wieder zu. Der kleinste Eingriff: Es ändert sich nichts an dem, was das Formular tut oder wo es steht – nur daran, ob es dasteht, wenn niemand es braucht.' },

  { datei: 'unten', name: 'Unten wie im Chat',
    hinweis: 'Die Eingabe wandert dorthin, wo sie in den anderen beiden Tabs schon steht. Der Polls-Tab ist der einzige, dessen Eingabe oben sitzt – das ist eine Inkonsequenz, die man erst merkt, wenn man sie behebt. Sie bleibt aber fünf Zeilen hoch und nimmt der Liste den unteren Rand.' },

  { datei: 'geklappt-unten', name: 'Zusammengeklappt, unten',
    hinweis: 'Beides zusammen: eine Zeile am unteren Rand, die sich nach oben öffnet – genau wie das Schreibfeld im Chat, nur höher, wenn es offen ist. Die Liste beginnt oben, dort wo man zu lesen anfängt.' },
];

// ---------------------------------------------------------------------------
const opt = (id, label, votes, usd, share) => ({ id, label, votes, usd, share });
const POLLS = [
  { id: 1, closed: false, myOptionId: null, totalVotes: 191, totalUsd: 781420,
    stunden: 29,
    question: 'Should we open the token gate to smaller holders?',
    options: [opt(1, 'Ship it this week', 128, 482900, .618),
              opt(2, 'Wait for the audit', 63, 298520, .382)] },
  { id: 2, closed: false, myOptionId: 2, totalVotes: 88, totalUsd: 214300,
    stunden: 0.6,
    question: 'Next AMA: Thursday or Sunday?',
    options: [opt(3, 'Thursday', 51, 142100, .663),
              opt(4, 'Sunday', 37, 72200, .337)] },
  { id: 3, closed: true, myOptionId: 3, totalVotes: 240, totalUsd: 998400,
    stunden: null,
    question: 'Should the chat minimum go up?',
    options: [opt(5, 'Yes, to $50', 96, 612000, .613),
              opt(6, 'No, leave it', 144, 386400, .387)] },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body><main class="pane" id="pane" style="display:flex;flex-direction:column;
         height:820px;background:var(--bg);padding:14px;overflow:hidden">
         <div id="oben"></div>
         <div id="ziel" class="poll-list" style="overflow:hidden"></div>
         <div id="unten"></div>
       </main>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const GEKLAPPT = `<button class="btn btn-ghost" type="button"
  style="width:100%;justify-content:flex-start;text-align:left">+ New poll</button>`;

async function schuss(zusatzCss, wo, inhalt, datei, breite = 720) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 860 }, deviceScaleFactor: 2 });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  if (zusatzCss) await seite.addStyleTag({ content: zusatzCss });
  await seite.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: true }, polls: [] };
      const toast = () => {};
      ${escFn}
      ${formate}
      ${symbole}
      ${zeit}
      ${zeile}
      ${markup}
      window.pollHtml = pollHtml;`,
  });
  if (wo) await seite.evaluate(([w, i]) => { document.querySelector(w).innerHTML = i; }, [wo, inhalt]);
  await seite.evaluate((ps) => {
    document.querySelector('#ziel').innerHTML = ps.map((p) => window.pollHtml({
      ...p,
      closesAt: p.stunden === null ? null : new Date(Date.now() + p.stunden * 3600e3 + 2000).toISOString(),
    })).join('');
  }, POLLS);
  if (wo === '#oben' || wo === '#unten') {
    await seite.fill('#poll-question', '').catch(() => {});
  }
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(350);
  const bild = await seite.locator('#pane').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, datei), bild);
  return 'data:image/png;base64,' + bild.toString('base64');
}

console.log('\nFlaechen je Fassung\n');
const toenBilder = [];
for (const t of TOENE) {
  const b = bilanz(t.toene);
  t.anzahl = b.anzahl; t.kleinster = b.kleinster;
  console.log('  ' + t.name.padEnd(32) + `${b.anzahl} Flächen`.padEnd(14)
    + `kleinster Schritt ${b.kleinster.toFixed(2)}:1`);
  toenBilder.push(await schuss(t.css, '#oben', formularOffen, `tab-toene-${t.datei}.png`));
}

const formBilder = [];
formBilder.push(await schuss('', '#oben', formularOffen, 'tab-formular-jetzt.png'));
formBilder.push(await schuss('', '#oben', GEKLAPPT, 'tab-formular-geklappt.png'));
formBilder.push(await schuss('#ziel { flex: 1; }', '#unten', formularOffen, 'tab-formular-unten.png'));
formBilder.push(await schuss('#ziel { flex: 1; }', '#unten', GEKLAPPT, 'tab-formular-geklappt-unten.png'));

// ---------------------------------------------------------------------------
const kopfCss = `
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 110ch; line-height: 1.6; }
  .reihe { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #16181c; padding: 10px; border-radius: 12px; }`;

const blattToene = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>${kopfCss}</style>
<h1>Die Flächen im Polls-Tab</h1>
<p class="lead">Gemessen sind es nicht zu viele <b>verschiedene</b> Töne, sondern zu viele <b>fast gleiche</b>:
Seitengrund, Karte, Antwortzeile und Rand liegen in einer Spanne von rund 1,4:1, jeder Schritt zwischen 1,05
und 1,14:1. Das ist unter dem, was als Absicht gelesen wird – man sieht, dass sich etwas ändert, aber nicht,
dass es etwas heisst. Deshalb geht es hier nicht um andere Grautöne, sondern um weniger Flächen mit grösseren
Schritten. An jeder Überschrift steht, wie viele bleiben und wie gross der kleinste Schritt dann ist.</p>
<div class="reihe">
${TOENE.map((t, i) => `
<div>
  <h2><span class="nr">${i}</span>${t.name}
    <span class="werte">${t.anzahl} Flächen · kleinster Schritt ${t.kleinster.toFixed(2)}:1</span></h2>
  <p class="t">${t.hinweis}</p>
  <div class="buehne"><img src="${toenBilder[i]}"></div>
</div>`).join('')}
</div>`;

const blattForm = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>${kopfCss}</style>
<h1>Wo das Anlegeformular steht</h1>
<p class="lead">Nur Ansem sieht diesen Kasten, und er sieht ihn immer – fünf Zeilen über allem, was er
eigentlich ansehen will. Alle vier Bilder zeigen dieselbe Ansicht mit denselben drei Abstimmungen; nur der
Kasten steht woanders oder ist zu. Der Unterschied ist, wie viel von der Liste übrig bleibt.</p>
<div class="reihe">
${FORMULARE.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}</h2>
  <p class="t">${f.hinweis}</p>
  <div class="buehne"><img src="${formBilder[i]}"></div>
</div>`).join('')}
</div>`;

for (const [datei, blatt, breite] of [
  ['tab-toene.png', blattToene, 1760], ['tab-formular.png', blattForm, 1500],
]) {
  const s = await browser.newPage({ viewport: { width: breite, height: 1200 }, deviceScaleFactor: 1.4 });
  await s.setContent(blatt);
  await s.waitForTimeout(600);
  await s.screenshot({ path: path.join(ausgabe, datei), fullPage: true });
  await s.close();
  console.log(`\n  ${path.join(ausgabe, datei)}`);
}

await browser.close();
server.close();
console.log();
