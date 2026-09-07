// ============================================================================
// Preview image: what should the chat look like?
//
// Starting point: polls and Ansem's inbox sit in bordered, rounded panels
// on the page background. Chat is the only area without one - the filter
// bar is a window-wide strip, messages run to the edge, the composer hangs
// at the bottom off a plain line. That's exactly the difference that makes
// it look unfinished.
//
// Produces preview/chat-look.png: the same chat, stacked four times.
//
// The template is the real markup from msgHtml() - class names, order and
// nesting match app.js. Only that way does the image show what the real
// stylesheet actually does with it, instead of being a pretty mockup.
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// --- The shared baseline: chat in a panel -----------------------------------
// The values are taken from .thread-view and .poll, not invented anew.
const PANEL = `
  .chat-panel {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--bg-1); overflow: hidden;
  }
  /* The filter bar becomes the panel's header: its line now ends at the
     panel's edge instead of the window edge. */
  .chat-panel .filters { padding: .7rem .9rem; }
  .chat-panel .chat-list { padding: .9rem; }
  .chat-panel .composer { padding: .7rem .9rem; border-top: 1px solid var(--line); }
  /* Input fields inside a panel sit a shade darker than the panel - the
     same rule .poll-admin input already follows with var(--bg). On
     var(--bg-1) they'd be invisible without a border. */
  .chat-panel .composer input,
  .chat-panel .filter-group { background: var(--bg); }
  /* The hover fill needs to be one step brighter, or it matches the panel
     and the row looks like it isn't reacting at all. */
  .chat-panel .msg:hover { background: var(--bg-2); }
`;

// --- Messages as bubbles, like in the DMs -----------------------------------
const BUBBLES = `
  @ .chat-list { gap: .35rem; }
  @ .msg {
    width: fit-content; max-width: 86%;
    padding: .42rem .7rem;
    border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg-2);
  }
  @ .msg:hover { background: var(--bg-3); }
  @ .msg .meta { align-self: end; }
`;

// --- Second pass: the column in front of the text ---------------------------
// Bubbles wrap around their content, so every line starts in a different
// place - and because the amount is sometimes "$3" and sometimes
// "$781.42K" wide, the text shifts to a different spot with every message.
// Only one thing fixes that: handle and amount sit in a fixed-width
// column, and the text behind them always starts at the same point.
//
// The width isn't a guess. fmtUsd() abbreviates from 10,000 up to
// "$31.5K", so the longest case is eight characters ("$781.42K"). Eight
// monospace characters plus the pill's padding plus three characters for
// the handle plus the gap - that adds up to the 7.1rem below, with a bit
// of slack for a token handle longer than "ANSEM".
const COLUMN = (extra = '') => `
  ${BUBBLES}
  @ .msg .who {
    display: inline-grid; grid-template-columns: 3ch minmax(0, 1fr);
    align-items: center; gap: .35rem; width: 7.1rem;
  }
  /* The amount now sits on the brighter bubble instead of the page
     background. To keep the pill from disappearing there, it gets a
     touch more distinct. */
  @ .worth {
    background: rgba(255, 255, 255, .05);
    border-color: var(--bg-3);
  }
  ${extra}
`;

// --- Third pass: the amount without its own bubble --------------------------
// The pill was a box inside a box - once the message itself is a bubble,
// that's one border too many. The amount now stands as a plain number.
//
// And it's short: shortUsd() abbreviates from a thousand up with K, so
// never more than three digits show ($1.4K instead of $1,412). That makes
// the longest case five characters wide ($781K, $1.2M) - the column can
// stay narrow without ever overflowing.
const NACKT = (extra = '') => `
  ${BUBBLES}
  @ .msg .who {
    display: inline-grid; grid-template-columns: 3ch 5ch;
    align-items: baseline; gap: .55rem; width: auto;
  }
  /* No more bubble around the amount: no border, no background, no
     padding. The fixed width now comes from the grid column, not the
     pill. */
  @ .worth {
    display: block; height: auto; padding: 0;
    background: none; border: 0; border-radius: 0;
    font-size: .82rem; text-align: right;
  }
  ${extra}
`;

const NUMBER_SET = [
  {
    nr: 1,
    name: 'Rechtsbündig, hell',
    hinweis: 'Die Zahl steht rechtsbündig in ihrer Spalte, in voller Helligkeit. Tausender stehen under Tausendern.',
    css: NACKT(),
  },
  {
    nr: 2,
    name: 'Rechtsbündig, gedämpft',
    hinweis: 'Dieselbe Anordnung, die Zahl aber eine Stufe leiser – sie begleitet den Namen, statt mit ihm um Aufmerksamkeit zu ringen.',
    css: NACKT('@ .worth { color: var(--dim); }'),
  },
  {
    nr: 3,
    name: 'Linksbündig am Kürzel',
    hinweis: 'Die Zahl beginnt direkt hinter dem Kürzel. Zwei linke Kanten – dafür stehen die Ziffern nicht mehr untereinander.',
    css: NACKT('@ .worth { text-align: left; }'),
  },
  {
    nr: 4,
    name: 'Rechtsbündig, hell, kleiner',
    hinweis: 'Wie 1, die Zahl aber deutlich kleiner gesetzt. Der Name führt, der Betrag folgt.',
    css: NACKT('@ .worth { font-size: .72rem; }'),
  },
];

const COLUMN_SET = [
  {
    nr: 1,
    name: 'Pille left',
    hinweis: 'Kürzel und Pille beginnen beide an fester Stelle, der Text ebenfalls. Drei linke Kanten, die untereinander stehen – die Pille selbst ist mal breiter, mal narrower.',
    css: COLUMN('@ .worth { justify-self: start; }'),
  },
  {
    nr: 2,
    name: 'Pille right',
    hinweis: 'Die Pille rückt an den Text heran und schließt bündig an ihn an. Dafür wandert der Zwischenraum hinter das Kürzel und wird bei kleinen Beträgen groß.',
    css: COLUMN('@ .worth { justify-self: end; }'),
  },
  {
    nr: 3,
    name: 'Pille fest, Zahl rechtsbündig',
    hinweis: 'Die Pille hat immer dieselbe Breite, die Zahl steht right darin. Damit stehen auch Tausender under Tausendern – Beträge lassen sich untereinander vergleichen, ohne sie zu lesen.',
    css: COLUMN(`
      @ .worth { justify-self: stretch; justify-content: flex-end; }
    `),
  },
  {
    nr: 4,
    name: 'Pille fest, Zahl mittig',
    hinweis: 'Wie 3, die Zahl steht aber mittig in der Pille – so wie bisher im Chat.',
    css: COLUMN('@ .worth { justify-self: stretch; }'),
  },
];

const AREA_SET = [
  {
    nr: 1,
    name: 'Jetzt',
    hinweis: 'Der Stand von heute, zum Vergleich. Randlos – als einziger Bereich der Seite.',
    css: `
      @ .chat-panel { border: 0; background: none; border-radius: 0; overflow: visible; }
      @ .chat-panel .filters { padding: .7rem 0; }
      @ .chat-panel .chat-list { padding: .9rem 0; }
      @ .chat-panel .composer { padding: .7rem 0 0; }
      @ .chat-panel .composer input, @ .chat-panel .filter-group { background: var(--bg-1); }
      @ .chat-panel .msg:hover { background: var(--bg-1); }
    `,
  },
  {
    nr: 2,
    name: 'Fläche',
    hinweis: 'Der ganze Chat in einer umrandeten Fläche, wie ein Poll und wie Ansems Posteingang. An den Nachrichten selbst ändert sich nichts.',
    css: '',
  },
  {
    nr: 3,
    name: 'Fläche + Blasen',
    hinweis: 'Zusätzlich bekommt jede Nachricht eine Blase, die sich um ihren Inhalt legt – wie in den DMs. Einzeilig bleibt einzeilig.',
    css: BUBBLES,
  },
  {
    nr: 4,
    name: 'Fläche + Blasen, eigene right',
    hinweis: 'Wie 3, dazu stehen die eigenen Nachrichten right und grün – genau wie im DM-Verlauf.',
    css: `
      ${BUBBLES}
      @ .msg.mine {
        margin-left: auto;
        background: rgba(20, 241, 149, .14); border-color: rgba(20, 241, 149, .3);
      }
      @ .msg.mine:hover { background: rgba(20, 241, 149, .19); }
    `,
  },
];

// --- Fourth pass: other directions ------------------------------------------
// Bubbles failed, and specifically on something that wasn't visible
// before: in chat, something else sits in front of every text - handle
// and amount. A bubble wraps around its contents, so all three things
// start in a different place with every message, and every attempt to
// tidy that up kept squeezing the amount further.
//
// The way out comes from the inbox, the part that works best: there the
// amount does NOT sit next to the name, it's all the way at the end of
// the row. That gives the order name - text - amount, and all three get
// their own column that holds across the whole list.
//
// This requires one small markup change: .worth has to become a sibling
// of .who instead of nesting inside it, otherwise it can't be moved to
// the other end of the row. That's exactly what these four variants do.
const LINE = `
  @ .msg {
    grid-template-columns: 3.2rem minmax(0, 1fr) auto auto;
    grid-template-areas: "who body worth meta";
    gap: .2rem .7rem; padding: .32rem .5rem;
  }
  @ .msg.has-quote { grid-template-areas: "quote quote quote quote" "who body worth meta"; }
  @ .msg .worth { grid-area: worth; }
  /* The amount sits at the end of the row, right before the time - the
     same order as in Ansem's inbox. No border: in a column that already
     holds its width, the number doesn't need its own box. */
  @ .worth {
    display: block; height: auto; padding: 0;
    background: none; border: 0; border-radius: 0;
    font-size: .78rem; text-align: right; min-width: 3.4rem;
  }
`;

const WEGE_SATZ = [
  {
    nr: 1,
    name: 'Betrag ans Zeilenende',
    markup: 'geschwister',
    hinweis: 'Name left, Text daneben, Betrag und Uhrzeit right – die Reihenfolge aus dem Posteingang. Der Text beginnt immer an derselben Stelle, weil vor ihm nur noch das dreistellige Kürzel steht.',
    css: LINE,
  },
  {
    nr: 2,
    name: 'Betrag right, Zeilen getrennt',
    markup: 'geschwister',
    hinweis: 'Wie 1, dazu eine Haarlinie zwischen den Zeilen und mehr Luft – der Verlauf liest sich dann wie die Liste im Posteingang.',
    css: `
      ${LINE}
      @ .chat-list { gap: 0; padding: 0; }
      @ .msg { padding: .5rem .9rem; border-bottom: 1px solid var(--line); border-radius: 0; }
      @ .msg:last-child { border-bottom: 0; }
    `,
  },
  {
    nr: 3,
    name: 'Absenderzeile darüber',
    markup: 'geschwister',
    hinweis: 'Name, Betrag und Uhrzeit stehen in einer eigenen kleinen Zeile, der Text darunter über die volle Breite. Vor dem Text steht dann gar nichts mehr, was ihn verschieben könnte.',
    css: `
      @ .msg {
        grid-template-columns: auto auto minmax(0, 1fr);
        grid-template-areas: "who worth meta" "body body body";
        gap: .1rem .5rem; padding: .35rem .5rem;
      }
      @ .msg.has-quote { grid-template-areas: "who worth meta" "quote quote quote" "body body body"; }
      @ .msg .worth { grid-area: worth; }
      @ .msg .meta { justify-self: start; }
      @ .worth {
        display: block; height: auto; padding: 0;
        background: none; border: 0; border-radius: 0;
        font-size: .76rem; color: var(--dim);
      }
      @ .msg .time { font-size: .7rem; }
      @ .chat-list { gap: .5rem; }
    `,
  },
  {
    nr: 4,
    name: 'Feste Namensspalte',
    markup: 'geschwister',
    hinweis: 'Name und Betrag stehen zusammen in einer schmalen Spalte am linken Rand, durch eine senkrechte Linie vom Text getrennt. Rechts bleibt nur die Uhrzeit.',
    css: `
      @ .msg {
        grid-template-columns: 3.2rem 3.6rem minmax(0, 1fr) auto;
        grid-template-areas: "who worth body meta";
        gap: .2rem .7rem; padding: .32rem .5rem;
      }
      @ .msg.has-quote { grid-template-areas: "quote quote quote quote" "who worth body meta"; }
      @ .msg .worth { grid-area: worth; }
      @ .worth {
        display: block; height: auto; padding: 0 .7rem 0 0;
        background: none; border: 0; border-right: 1px solid var(--line); border-radius: 0;
        font-size: .78rem; text-align: right;
      }
    `,
  },
];

// --- Fifth pass: fine-tuning the list ----------------------------------
// The direction is settled: a list of uniform rows in a panel, amount
// right-aligned in its own column. What's still varying here is only the
// density, the strength of the divider, and the weight of the amount.
const LISTE = `
  ${LINE}
  @ .chat-list { gap: 0; padding: 0; }
  @ .msg { padding: .5rem .9rem; border-bottom: 1px solid var(--line); border-radius: 0; }
  @ .msg:last-child { border-bottom: 0; }
`;

const LISTE_SATZ = [
  {
    nr: 1,
    name: 'Wie gehabt',
    markup: 'geschwister',
    hinweis: 'Variante 2 von eben, unverändert – der Bezugspunkt für die anderen fünf.',
    css: LISTE,
  },
  {
    nr: 2,
    name: 'Linie leiser',
    markup: 'geschwister',
    hinweis: 'Dieselbe Zeile, die Trennlinie aber deutlich schwächer. Sie gliedert noch, tritt aber hinter den Text zurück.',
    css: `${LISTE}
      @ .msg { border-bottom-color: rgba(255, 255, 255, .045); }
    `,
  },
  {
    nr: 3,
    name: 'Betrag ganz außen',
    markup: 'geschwister',
    hinweis: 'Uhrzeit und Betrag tauschen den Platz: Der Betrag steht als lastChar am Rand – genau wie in Ansems Posteingang, wo er die äußfirst Spalte ist.',
    css: `${LISTE}
      @ .msg { grid-template-areas: "who body meta worth"; }
      @ .msg.has-quote { grid-template-areas: "quote quote quote quote" "who body meta worth"; }
    `,
  },
  {
    nr: 4,
    name: 'Enger',
    markup: 'geschwister',
    hinweis: 'Weniger Höhe je Zeile. Man sieht mehr vom Verlauf, ohne zu scrollen – in einem lebhaften Raum zählt das.',
    css: `${LISTE}
      @ .msg { padding: .33rem .9rem; }
    `,
  },
  {
    nr: 5,
    name: 'Luftiger',
    markup: 'geschwister',
    hinweis: 'Mehr Höhe je Zeile. Ruhiger zu lesen, dafür passt weniger ins Fenster.',
    css: `${LISTE}
      @ .msg { padding: .7rem .9rem; }
    `,
  },
  {
    nr: 6,
    name: 'Betrag kräftiger',
    markup: 'geschwister',
    hinweis: 'Wie 1, der Betrag aber in der Größe des Textes statt kleiner. Er ist der Kern der Seite – hier bekommt er das Gewicht dafür.',
    css: `${LISTE}
      @ .worth { font-size: .88rem; font-weight: 650; }
    `,
  },
];

// node scripts/vorschau-chat-look.mjs           -> the four stages
// node scripts/vorschau-chat-look.mjs spalten   -> the column before the text
const SENTENCES = {
  liste: {
    file: 'preview/chat-liste.png',
    titel: 'Der Chat – die Liste feinjustiert',
    lead: 'Alle sechs sind Variante 2: Liste in der Fläche, Betrag rechtsbündig in eigener Spalte. Unterschiedlich sind Dichte, Trennlinie und das Gewicht des Betrags.',
    varianten: LISTE_SATZ,
    nurListe: true,
    height: 'auto',
  },
  wege: {
    file: 'preview/chat-wege.png',
    titel: 'Der Chat – vier andere Wege',
    lead: 'Ohne Blasen. Alle vier liegen in der Fläche und kürzen den Betrag auf höchstens drei Ziffernstellen; unterschiedlich ist, wo Name, Betrag und Uhrzeit stehen.',
    varianten: WEGE_SATZ,
  },
  areas: {
    file: 'preview/chat-look.png',
    titel: 'Der Chat',
    lead: 'Polls und Ansems Posteingang liegen in umrandeten Flächen. Der Chat ist der einzige Bereich ohne – hier vier Stufen, ihn anzugleichen.',
    varianten: AREA_SET,
  },
  number: {
    file: 'preview/chat-zahl.png',
    titel: 'Der Chat – der Betrag ohne eigene Blase',
    lead: 'Alle vier haben Fläche und Blasen. Der Betrag hat keine Umrandung mehr und ist gekürzt: ab tausend mit K, nie mehr als drei Ziffernstellen. Der Text beginnt überall an derselben Stelle.',
    varianten: NUMBER_SET,
  },
  spalten: {
    file: 'preview/chat-spalten.png',
    titel: 'Der Chat – wo der Text anfängt',
    lead: 'Alle vier haben die Fläche und die Blasen aus Variante 3. Unterschiedlich ist nur, wie Kürzel und Betrag in der festen Spalte davor sitzen. Der Text beginnt überall an derselben Stelle.',
    varianten: COLUMN_SET,
  },
};

const SATZ = SENTENCES[process.argv[2] || 'areas'];
if (!SATZ) throw new Error(`Unbekannter Satz: ${process.argv[2]}`);
const VARIANTEN = SATZ.varianten;

// --- The short amount --------------------------------------------------
// Mirrors shortUsd() from app.js. The authoritative version lives there and
// is checked by scripts/test-realtime-switching.mjs; it's duplicated here
// only so the preview image doesn't depend on app.js.
//
// Rule: never more than three digits. The full number under 1000, above
// that abbreviated with K/M/B - one decimal place only while the leading
// digit stays single.
const TIERS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function shortUsd(n) {
  if (!n || n <= 0) return '$0';
  if (n < 1) return '<$1';
  const gerundet = Number(n.toPrecision(3));
  for (const [ab, short] of TIERS) {
    if (gerundet < ab) continue;
    const wert = gerundet / ab;
    return '$' + (wert < 9.95 ? wert.toFixed(1) : String(Math.round(wert))) + short;
  }
  return '$' + Math.round(gerundet);
}

// --- Messages, built like msgHtml() in app.js -------------------------------
const MESSAGES = [
  { h: '9Qm', ton: 0, usd: 3444, body: 'gm', zeit: '14:02' },
  { h: '4tP', ton: 4, usd: 50, body: 'wen moon', zeit: '14:02',
    zitat: { h: 'Km9', ton: 3, text: 'is this thing on' } },
  { admin: true, body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'bH2', ton: 1, usd: 8820, zeit: '14:04',
    body: 'this is the longest single word i can think of right now: Donaudampfschifffahrtsgesellschaftskapitaenswitwe' },
  { h: 'Km9', ton: 3, usd: 1302, body: 'lfg', zeit: '14:05' },
  // From 10,000 up fmtUsd() abbreviates to "$31.5K" - so the longest case
  // the fixed column has to carry is in here, not tucked away in a
  // footnote.
  { h: 'zQ4', ton: 0, usd: 781420, zeit: '14:06',
    body: 'I sold half my bag last week and my vote weight dropped immediately, thats actually a nice touch' },
  { h: '7xK', ton: 2, usd: 5208, body: 'same, and the poll weight updated within the minute', zeit: '14:07', mine: true },
  { h: 'Km9', ton: 1, usd: 3, body: 'different person, same three characters', zeit: '14:07' },
  { h: '3vR', ton: 2, usd: 201, body: 'ser', zeit: '14:08',
    zitat: { h: '9Qm', ton: 0, text: 'how much are we raising for the next round' } },
];

const zitatHtml = (z) => !z ? '' : `
  <button class="quote" type="button">
    <span class="h t${z.ton}">${z.h}</span>
    <span class="quote-body">${z.text}</span>
  </button>`;

// Two build styles. "verschachtelt" (nested) is today's state from
// app.js: the amount sits inside .who and can therefore never leave the
// row. "geschwister" (sibling) pulls it up one level - only that lets it
// be placed at the end of the row or in its own column. Shipping this
// would mean one changed line in msgHtml().
const msgHtml = (m, bauweise) => {
  const klassen = `msg ${m.admin ? 'is-admin' : ''}${m.mine ? ' mine' : ''}${m.zitat ? ' has-quote' : ''}`;
  const name = m.admin
    ? '<span class="h admin-name">ANSEM</span>'
    : `<span class="h t${m.ton}">${m.h}</span>`;
  const amount = m.admin ? '' : `<span class="worth">${shortUsd(m.usd)}</span>`;

  const header = bauweise === 'geschwister'
    ? `<span class="who">${name}</span>${amount}`
    : `<span class="who">${name}${amount}</span>`;

  return `
  <div class="${klassen}">
    ${header}
    ${zitatHtml(m.zitat)}
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;
};

// The chat area's scaffold, as it is in index.html - just with the panel
// as an extra wrapper. It's present in every variant; variant 1 just
// strips its border and background again, so all four show the same
// markup.
const chatHtml = (bauweise, nurListe = false) => `
  <div class="chat-panel">
    ${nurListe ? '' : `<div class="filters">
      <span class="filters-label">Only show wallets holding at least</span>
      <div class="filter-group">
        <span class="unit">$</span>
        <input type="text" value="" placeholder="0">
        <span class="unit unit-token">in $ANSEM</span>
      </div>
      <div class="presets">
        <button class="chip">All</button>
        <button class="chip">$100+</button>
        <button class="chip">$1k+</button>
        <button class="chip">$10k+</button>
        <button class="chip">$100k+</button>
      </div>
    </div>`}
    <div class="chat-list">${MESSAGES.map((m) => msgHtml(m, bauweise)).join('')}</div>
    ${nurListe ? '' : `<form class="composer">
      <input type="text" placeholder="Message the room…">
      <button class="btn btn-primary" type="button">Send</button>
    </form>`}
  </div>`;

// Each variant only restyles its own slice. That's why the rules carry an
// @ in front of every selector; here it gets turned into that slice's id.
// A find-and-replace instead of parsing the selector - short, and it
// can't trip over a comma or a bracket.
const card = (v) => `
  <section class="card">
    <style>${v.css.replaceAll('@', `#v${v.nr}`)}</style>
    <h2><span class="nr">${v.nr}</span>${v.name}</h2>
    <p class="hinweis">${v.hinweis}</p>
    <div class="chat-rahmen" id="v${v.nr}">${chatHtml(v.markup, SATZ.nurListe)}</div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  ${PANEL}
  body { padding: 26px; background: var(--bg); }
  .card { max-width: 1180px; margin: 0 0 34px; }
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .hinweis { margin: 0 0 .7rem; font-size: .8rem; color: var(--dimmer); max-width: 70ch; }
  /* This frame stands in for the area below the header. Fixed height, so
     all four get the same amount of space and only the styling is really
     being compared. */
  .chat-rahmen { display: flex; flex-direction: column; height: ${SATZ.height ?? '560px'}; }
  /* This frame is missing the .scroll class that hangs on the real chat's
     history. Without it the list grows past the fixed height and pushes
     the composer out of the panel. */
  .chat-rahmen .chat-list { overflow-y: auto; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 80ch; }
</style>
<h1>${SATZ.titel}</h1>
<p class="lead">${SATZ.lead}</p>
${VARIANTEN.map(card).join('')}
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-chat.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`file://${process.cwd()}/public/_vorschau-chat.html`);
await page.waitForTimeout(300);
await page.screenshot({ path: SATZ.file, fullPage: true });
await browser.close();

// public/ gets uploaded as a whole - the scratch sheet must not be left behind.
rmSync('public/_vorschau-chat.html', { force: true });
console.log(SATZ.file);
