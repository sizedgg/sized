// ============================================================================
// Preview images: how the polls tab looks
//
// Two complaints, two separate sheets - they're unrelated and should be
// decided separately.
//
// ----------------------------------------------------------------------------
// 1. "Too many different shades of gray"
//
// Measured, that's true, but not in the way it sounds. It's not too many
// DIFFERENT shades - it's too many ALMOST IDENTICAL ones:
//
//   --bg    #0a0b0f
//   --bg-1  #101218   step 1.05:1
//   --bg-2  #161923   step 1.07:1   (not even used in the polls tab)
//   --bg-3  #1d212d   step 1.09:1
//   --line  #262b39   step 1.14:1
//
// Five surfaces in a span of about 1.4:1. Each individual step falls
// below what the eye reads as intentional - you see that something
// changes, but not that it means something. The result is exactly the
// impression of "somehow a lot of grays": many decisions, none of which
// say anything.
//
// So the direction isn't "different grays", but FEWER surfaces with
// BIGGER steps. Each version below states how many surfaces it leaves
// and how big its smallest step ends up being.
//
// ----------------------------------------------------------------------------
// 2. "For Ansem, the whole creation panel always sits at the top"
//
// It's the only tab whose input sits at the top - in chat and DMs it
// sits at the bottom and is one line tall. Here it's five lines,
// permanently, over everything you actually want to look at. And that's
// true even when Ansem doesn't want to create a poll at all, which is
// most of the time.
//
// Produces preview/tab-toene.png and preview/tab-formular.png
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

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeit = cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;');
const line = cut('const BALD_MS =', 'let fristT = null;');
const markup = cut('function pollHtml(p) {', 'async function deletePoll(id) {');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const escFn = cut('const esc = (s) =>', '\n\n');
const symbole = cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;');

const formular = /<div id="poll-admin"[\s\S]*?\n    <\/div>/.exec(html);
if (!formular) throw new Error('Das Anlegeformular sieht anders aus als erwartet');
const formularOffen = formular[0].replace(' hidden', '');

// --- Color math ----------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const get = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, a, h) => v.map((c, i) => Math.round(a * c + (1 - a) * h[i]));

const BG = get('bg'), BG1 = get('bg-1'), BG3 = get('bg-3'), LINE = get('line');
const FILL_COLOR = mix(hex(get('accent')), .24, hex(BG3));

// How many surfaces a version leaves and how big its smallest step is.
// Computed, not asserted.
const bilanz = (tones) => {
  const eindeutig = [...new Map(tones.map((t) => [t.join(), t])).values()]
    .sort((a, b) => lum(a) - lum(b));
  let smallest = Infinity;
  for (let i = 1; i < eindeutig.length; i++) smallest = Math.min(smallest, kon(eindeutig[i], eindeutig[i - 1]));
  return { anzahl: eindeutig.length, smallest };
};

// ---------------------------------------------------------------------------
// Sheet 1: the shades
// ---------------------------------------------------------------------------
const TONES = [
  { file: 'jetzt', name: 'Jetzt', css: '',
    tones: [hex(BG), hex(BG1), hex(BG3), hex(LINE), FILL_COLOR],
    hinweis: 'Vier Flächen plus die Füllung. Zwischen Seitengrund, Karte, Antwortzeile und Rand liegen Schritte von 1,05 bis 1,14:1 – jeder einzelne zu klein, um als Absicht gelesen zu werden.' },

  { file: 'karte-flach', name: 'Karte ohne eigene Fläche',
    css: '.poll, .poll-admin { background: transparent; }',
    tones: [hex(BG), hex(BG3), hex(LINE), FILL_COLOR],
    hinweis: 'Die Karte hat keinen eigenen Grund mehr, nur noch ihren Rand. Der Unterschied zwischen Seite und Karte war ohnehin der minSize im ganzen Tab (1,05:1) – ihn wegzunehmen kostet fast nichts und spart eine Fläche.' },

  { file: 'zeile-flach', name: 'Antwortzeile ohne eigene Fläche',
    css: '.opt-bar { background: transparent; }',
    tones: [hex(BG), hex(BG1), hex(LINE), FILL_COLOR],
    hinweis: 'Umgekehrt: Die Karte behält ihren Grund, die Antwortzeilen verlieren ihren. Der gefüllte Teil steht dann direkt auf der Karte – die Füllung erzählt den Anteil allein, ohne dass eine zweite Fläche daneben mitredet. Eine Fläche weniger, aber der minSize Schritt bleibt: Seite gegen Karte ist weiterhin 1,05:1.' },

  { file: 'beides-flach', name: 'Beides flach – nur Ränder',
    css: '.poll, .poll-admin { background: transparent; } .opt-bar { background: transparent; }',
    tones: [hex(BG), hex(LINE), FILL_COLOR],
    hinweis: 'Eine einzige Fläche im ganzen Tab. Struktur kommt nur noch von Rändern und von der Füllung – dieselbe Sprache, die die heruntergeladene Karte schon spricht, seit der Verlauf dort weg ist.' },

  // The three values are computed, not picked by feel: starting from
  // --bg, each a 1.28:1 step, in the palette's color cast (the ratio
  // taken from --bg-3). That way the gaps are all the same size - and
  // big enough to be read as intentional.
  { file: 'grosse-schritte', name: 'Weiter auseinander',
    css: ':root { --bg-1: #202532; --bg-3: #2f364a; --line: #3d465f; }',
    tones: [hex(BG), hex('#202532'), hex('#2f364a'), hex('#3d465f'), mix(hex(get('accent')), .24, hex('#2f364a'))],
    hinweis: 'Alle vier Flächen bleiben, aber jeder Schritt wird auf 1,28:1 gebracht – gerechnet, nicht gegriffen. Wenn schon vier Ebenen, dann sollen sie sich auch unterscheiden. Der Preis steht im Bild: Der Tab wird deutlich heller und verliert das Fast-Schwarz, das der Rest der Seite hat.' },
];

// ---------------------------------------------------------------------------
// Sheet 2: the creation form
// ---------------------------------------------------------------------------
const FORMULARE = [
  { file: 'jetzt', name: 'Jetzt: immer offen, peek',
    hinweis: 'Fünf Zeilen dauerhaft über allem – auch dann, wenn Ansem gerade keine Abstimmung anlegen will, was die meiste Zeit der Fall ist. Auf dem Handy ist der halbe Bildschirm weg, bevor die first Abstimmung anfängt.' },

  { file: 'geklappt', name: 'Zusammengeklappt',
    hinweis: 'Eine Zeile statt fünf. Ein Tipp klappt das Formular auf, nach dem Anlegen geht es wieder zu. Der minSize Eingriff: Es ändert sich nichts an dem, was das Formular tut oder wo es steht – nur daran, ob es dasteht, wenn niemand es braucht.' },

  { file: 'bottom', name: 'Unten wie im Chat',
    hinweis: 'Die Eingabe wandert dorthin, wo sie in den anderen beiden Tabs schon steht. Der Polls-Tab ist der einzige, dessen Eingabe peek sitzt – das ist eine Inkonsequenz, die man erst merkt, wenn man sie behebt. Sie bleibt aber fünf Zeilen hoch und nimmt der Liste den unteren Rand.' },

  { file: 'geklappt-unten', name: 'Zusammengeklappt, bottom',
    hinweis: 'Beides zusammen: eine Zeile am unteren Rand, die sich nach peek öffnet – genau wie das Schreibfeld im Chat, nur höher, wenn es offen ist. Die Liste beginnt peek, dort wo man zu lesen anfängt.' },
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
         <div id="peek"></div>
         <div id="ziel" class="poll-list" style="overflow:hidden"></div>
         <div id="bottom"></div>
       </main>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const GEKLAPPT = `<button class="btn btn-ghost" type="button"
  style="width:100%;justify-content:flex-start;text-align:left">+ New poll</button>`;

async function shoot(zusatzCss, wo, content, file, width = 720) {
  const page = await browser.newPage({ viewport: { width: width, height: 860 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if (zusatzCss) await page.addStyleTag({ content: zusatzCss });
  await page.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: true }, polls: [] };
      const toast = () => {};
      ${escFn}
      ${formate}
      ${symbole}
      ${zeit}
      ${line}
      ${markup}
      window.pollHtml = pollHtml;`,
  });
  if (wo) await page.evaluate(([w, i]) => { document.querySelector(w).innerHTML = i; }, [wo, content]);
  await page.evaluate((ps) => {
    document.querySelector('#ziel').innerHTML = ps.map((p) => window.pollHtml({
      ...p,
      closesAt: p.stunden === null ? null : new Date(Date.now() + p.stunden * 3600e3 + 2000).toISOString(),
    })).join('');
  }, POLLS);
  if (wo === '#peek' || wo === '#bottom') {
    await page.fill('#poll-question', '').catch(() => {});
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  const bild = await page.locator('#pane').screenshot();
  await page.close();
  fs.writeFileSync(path.join(ausgabe, file), bild);
  return 'data:image/png;base64,' + bild.toString('base64');
}

console.log('\nFlaechen je Fassung\n');
const toneImages = [];
for (const t of TONES) {
  const b = bilanz(t.tones);
  t.anzahl = b.anzahl; t.smallest = b.smallest;
  console.log('  ' + t.name.padEnd(32) + `${b.anzahl} Flächen`.padEnd(14)
    + `smallest Schritt ${b.smallest.toFixed(2)}:1`);
  toneImages.push(await shoot(t.css, '#peek', formularOffen, `tab-toene-${t.file}.png`));
}

const formBilder = [];
formBilder.push(await shoot('', '#peek', formularOffen, 'tab-formular-jetzt.png'));
formBilder.push(await shoot('', '#peek', GEKLAPPT, 'tab-formular-geklappt.png'));
formBilder.push(await shoot('#ziel { flex: 1; }', '#bottom', formularOffen, 'tab-formular-unten.png'));
formBilder.push(await shoot('#ziel { flex: 1; }', '#bottom', GEKLAPPT, 'tab-formular-geklappt-unten.png'));

// ---------------------------------------------------------------------------
const headerCss = `
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 110ch; line-height: 1.6; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #16181c; padding: 10px; border-radius: 12px; }`;

const sheetTones = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>${headerCss}</style>
<h1>Die Flächen im Polls-Tab</h1>
<p class="lead">Gemessen sind es nicht zu viele <b>verschiedene</b> Töne, sondern zu viele <b>fast gleiche</b>:
Seitengrund, Karte, Antwortzeile und Rand liegen in einer Spanne von rund 1,4:1, jeder Schritt zwischen 1,05
und 1,14:1. Das ist under dem, was als Absicht gelesen wird – man sieht, dass sich etwas ändert, aber nicht,
dass es etwas heisst. Deshalb geht es hier nicht um andere Grautöne, sondern um weniger Flächen mit grösseren
Schritten. An jeder Überschrift steht, wie viele bleiben und wie big der minSize Schritt dann ist.</p>
<div class="row">
${TONES.map((t, i) => `
<div>
  <h2><span class="nr">${i}</span>${t.name}
    <span class="werte">${t.anzahl} Flächen · smallest Schritt ${t.smallest.toFixed(2)}:1</span></h2>
  <p class="t">${t.hinweis}</p>
  <div class="buehne"><img src="${toneImages[i]}"></div>
</div>`).join('')}
</div>`;

const blattForm = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>${headerCss}</style>
<h1>Wo das Anlegeformular steht</h1>
<p class="lead">Nur Ansem sieht diesen Kasten, und er sieht ihn immer – fünf Zeilen über allem, was er
eigentlich ansehen will. Alle vier Bilder show dieselbe Ansicht mit denselben drei Abstimmungen; nur der
Kasten steht woanders oder ist zu. Der Unterschied ist, wie viel von der Liste übrig bleibt.</p>
<div class="row">
${FORMULARE.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}</h2>
  <p class="t">${f.hinweis}</p>
  <div class="buehne"><img src="${formBilder[i]}"></div>
</div>`).join('')}
</div>`;

for (const [file, blatt, width] of [
  ['tab-toene.png', sheetTones, 1760], ['tab-formular.png', blattForm, 1500],
]) {
  const s = await browser.newPage({ viewport: { width: width, height: 1200 }, deviceScaleFactor: 1.4 });
  await s.setContent(blatt);
  await s.waitForTimeout(600);
  await s.screenshot({ path: path.join(ausgabe, file), fullPage: true });
  await s.close();
  console.log(`\n  ${path.join(ausgabe, file)}`);
}

await browser.close();
server.close();
console.log();
