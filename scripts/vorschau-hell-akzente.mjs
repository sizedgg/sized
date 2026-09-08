/**
 * The light page with six accents of its own - four blues, ink, one warm.
 *
 * Simulation only; public/styles.css is untouched.
 *
 * What is taken from gage and what is not:
 *
 *   taken      the STRUCTURE - paper ground, near-black ink, hairlines
 *              instead of boxes and shadows, and exactly one accent used
 *              sparingly. That is a way of building a page, not a brand.
 *   not taken  their ochre, their paper value, their bracket wordmark, their
 *              grotesk. Those are what makes a gage page a gage page.
 *
 * The ground here is deliberately NOT their #f5f2ec: it sits a touch cooler
 * and lighter, so the two would not be mistaken for each other side by side.
 * It is the same for all six, because what is being compared is the accent,
 * and two things moving at once compare nothing.
 *
 * The accent has a job in this page that gage does not have: it is Ansem.
 * It also has to stay clear of the four tones that tell PEOPLE apart - so
 * for every draft the closest name tone is swapped out and the distance is
 * measured rather than eyeballed.
 *
 *   node scripts/vorschau-hell-akzente.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'akzente');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

const zahl = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgb = (hex) => zahl(hex).join(', ');
const kanal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const [r, g, b] = zahl(hex); return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b); };
const kontrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const abstand = (a, b) => {
  const [x, y] = [zahl(a), zahl(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

// One ground for all six: beige, papery. Not gage's #f5f2ec - theirs leans
// grey, this one leans sand. Same family, different paper.
//
// It stays fixed across the drafts on purpose. What is being compared here is
// the accent, and a ground that moved with it would make every column differ
// in two ways at once - which is how you end up preferring a colour for a
// reason that was actually the paper.
const GRUND = {
  bg: '#f5f1e8', bg1: '#fbf9f4', bg2: '#eee9de', bg3: '#e6e0d3',
  line: '#ded7c9', text: '#16150e', dim: '#6a6357', dimmer: '#8d8676',
  worth: '#2c2a20', warn: '#a83228',
};

// The four people tones, and a bench of replacements for whichever one the
// accent gets too close to.
const NAMEN = ['#1f5c94', '#5b3fa0', '#a01f4a', '#1f6b3f'];
const ERSATZ = ['#0f6357', '#8a5a12', '#7a3b8c', '#8c4a1f', '#245f8a'];

/**
 * Moves a name tone out of the way of the accent.
 *
 * Not cosmetic: the tone is the only thing that tells two handles apart when
 * they share their first three characters, and the accent is Ansem. A name
 * that sits on Ansem's colour says the wrong thing about who wrote a message.
 * The replacement is picked as the one FURTHEST from both the accent and the
 * remaining three - chosen by measurement, because picking it by eye is how
 * two of them ended up 45 apart in the first place.
 */
function namenFuer(accent) {
  const out = [...NAMEN];
  let schlimmster = -1;
  let engste = Infinity;
  out.forEach((n, i) => {
    const d = abstand(n, accent);
    if (d < engste) { engste = d; schlimmster = i; }
  });
  if (engste >= 90) return { namen: out, getauscht: null, engste };
  const rest = out.filter((_, i) => i !== schlimmster);
  const best = ERSATZ
    .map((k) => ({ k, d: Math.min(abstand(k, accent), ...rest.map((r) => abstand(k, r))) }))
    .sort((a, b) => b.d - a.d)[0];
  out[schlimmster] = best.k;
  return { namen: out, getauscht: `${NAMEN[schlimmster]} → ${best.k}`, engste: best.d };
}

const AKZENTE = [
  {
    key: '1-tinte', name: 'Tinte',
    note: 'Kein Farbakzent. Der Akzent IST die Tinte - genau die Regel, die die Seite heute schon hat, nur umgedreht: auf Schwarz war es Knochenweiss, auf Papier ist es Schwarz. Gold bleibt fuer Ansem uebrig. Die Vergleichsfassung.',
    accent: '#1c1b14', fill: '#24231a', knopfText: '#fbf9f4', gold: '#9a6416',
    spitze: '#e3e1d6',
  },
  {
    key: '2-x-blau', name: 'Das Blau, das schon da ist',
    note: 'Kein neuer Wert: #2b5988 steht heute im Blatt als --fuellung-spitze, der fuehrende Balken einer Abstimmung. Wird es zum Akzent, hat die Seite EINE Farbe statt zwei - und die bedeutet dann durchgehend "hier ist das Gewicht".',
    accent: '#2b5988', fill: '#2b5988', knopfText: '#fbf9f4', gold: '#8a5a12',
    spitze: '#d3dfec',
  },
  {
    key: '3-navy', name: 'Navy',
    note: 'Dunkler und satter. Naeher an Tinte als an Farbe - der Akzent traegt, ohne aufzufallen, und der Betrag bleibt das Lauteste auf der Seite.',
    accent: '#1b3f6b', fill: '#204a7d', knopfText: '#fbf9f4', gold: '#8a5a12',
    spitze: '#cfdaea',
  },
  {
    key: '4-schiefer', name: 'Schiefer',
    note: 'Blau mit Grau drin, entsaettigt. Am ruhigsten von den vier Blauen - und am ehesten die Farbe, die man nach einer Woche nicht mehr bemerkt. Das kann gut oder langweilig sein.',
    accent: '#3f5f78', fill: '#496b86', knopfText: '#fbf9f4', gold: '#8a5a12',
    spitze: '#d8e0e7',
  },
  {
    key: '5-petrol', name: 'Petrol',
    note: 'Blau mit Gruen drin. Kuehl, in diesem Umfeld selten - kein Krypto-Gruen, eher Bibliothek. Der Sprung weg vom Blau, ohne warm zu werden.',
    accent: '#0f6357', fill: '#127365', knopfText: '#fbf9f4', gold: '#8a5a12',
    spitze: '#c9e4de',
  },
  {
    key: '6-kupfer', name: 'Kupfer',
    note: 'Die einzige warme hier, zum Vergleich: behaelt das Warme, das dir am hellen Look gefaellt, ist aber deutlich roter als gages Ocker.',
    accent: '#9c5227', fill: '#a4562a', knopfText: '#fbf9f4', gold: '#7d5210',
    spitze: '#f0d9c8',
  },
];

const bau = (a, namen) => `
:root {
  --bg: ${GRUND.bg}; --bg-1: ${GRUND.bg1}; --bg-2: ${GRUND.bg2}; --bg-3: ${GRUND.bg3};
  --line: ${GRUND.line}; --text: ${GRUND.text}; --dim: ${GRUND.dim}; --dimmer: ${GRUND.dimmer};
  --accent: ${a.accent}; --accent-rgb: ${rgb(a.accent)}; --accent-fill: ${a.fill};
  --worth: ${GRUND.worth}; --fokus: ${GRUND.dim};
  --fuellung: ${GRUND.bg3}; --fuellung-spitze: ${a.spitze};
  --ungelesen: ${namen[0]};
  --warn: ${GRUND.warn}; --gold: ${a.gold};
  --accent-2: ${a.accent}; --accent-2-rgb: ${rgb(a.accent)};
}
html, body { background: var(--bg); }
.login-card { background: ${GRUND.bg1} !important; box-shadow: none !important; }
.topbar { background: ${GRUND.bg} !important; }
.pay-row.is-copied { border-color: ${a.accent} !important; }
.reply-btn:hover { background: rgba(${rgb(GRUND.text)}, .07) !important; }
.h.t0 { color: ${namen[0]} !important; }
.h.t1 { color: ${namen[1]} !important; }
.h.t2 { color: ${namen[2]} !important; }
.h.t3 { color: ${namen[3]} !important; }
.thread.is-unread { background: rgba(${rgb(namen[0])}, .09) !important; }
.msg.dm.mine { background: ${a.fill} !important; color: ${a.knopfText} !important; }
.msg.dm.mine .time { color: rgba(${rgb(a.knopfText)}, .78) !important; }
.msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: ${a.knopfText} !important; }
/* No shadows: on paper a shadow is a hole, not a raised edge. */
.toast, .tip, .lz-liste { box-shadow: 0 1px 3px rgba(40, 40, 30, .10) !important; }
.btn-primary { color: ${a.knopfText} !important; }
.btn.laedt::after { border-color: ${a.knopfText} !important; border-top-color: transparent !important; }
`;

// --- measure before rendering ----------------------------------------------
console.log('\n── Kontraste und Namensabstaende ──\n');
let unter = 0;
const VARIANTEN = AKZENTE.map((a) => {
  const { namen, getauscht, engste } = namenFuer(a.accent);
  const paare = [
    ['Text', GRUND.text, GRUND.bg, 4.5],
    ['Zweitschrift', GRUND.dim, GRUND.bg, 4.5],
    ['Leisestes', GRUND.dimmer, GRUND.bg1, 3],
    ['Betrag', GRUND.worth, GRUND.bg1, 4.5],
    ['Knopfschrift', a.knopfText, a.fill, 4.5],
    ['Akzent als Strich', a.accent, GRUND.bg1, 3],
    ['Text auf fuehrendem Balken', GRUND.text, a.spitze, 4.5],
    ['Ansem-Gold', a.gold, GRUND.bg1, 4.5],
    ...namen.map((n, i) => [`Name ${i}`, n, GRUND.bg2, 4.5]),
  ];
  const schlecht = paare.filter(([, x, y, min]) => kontrast(x, y) < min);
  unter += schlecht.length;
  console.log(`  ${schlecht.length ? '✗' : '✓'} ${a.key.padEnd(12)} `
    + `${schlecht.length ? schlecht.map(([n, x, y]) => `${n} ${kontrast(x, y).toFixed(2)}:1`).join(', ')
      : `${paare.length} Paare ok`}`
    + `${getauscht ? `  ·  Name getauscht: ${getauscht}` : ''}`
    + `  ·  engster Abstand ${engste.toFixed(0)}`);
  return { ...a, namen };
});
if (unter) console.log(`\n  ${unter} unter der Schwelle\n`);

// --- render -----------------------------------------------------------------
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';
const WALLET = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

async function anmelden(page, wallet) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#wallet-input', wallet);
  await page.click('#btn-challenge');
  await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  const id = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);
  await page.evaluate(async (cid) => {
    await fetch('/functions/v1/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId: cid }),
    });
  }, id);
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  return page.evaluate(() => localStorage.getItem('ansem_jwt'));
}

const vorlauf = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const vp = await vorlauf.newPage();
const JWT = await anmelden(vp, ADMIN);
await vorlauf.close();

for (const v of VARIANTEN) {
  const style = `${HIDE} ${bau(v, v.namen)}`;
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2,
  });
  const anziehen = (p) => { p.on('load', () => p.addStyleTag({ content: style }).catch(() => {})); return p; };

  const a = anziehen(await ctx.newPage());
  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.addStyleTag({ content: style });
  await a.fill('#wallet-input', WALLET);
  await a.click('#btn-challenge');
  await a.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, `${v.key}-a-anmelden.png`) });
  await a.close();

  const b = anziehen(await ctx.newPage());
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  await b.goto(`${BASE}/?demo=200`, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.poll', { timeout: 20_000 });
  await b.waitForTimeout(500);
  await b.screenshot({ path: path.join(OUT, `${v.key}-b-abstimmung.png`) });

  await b.click('.tab[data-tab="dms"]');
  await b.waitForSelector('.thread', { timeout: 20_000 });
  await b.waitForTimeout(600);
  // An open conversation: the own bubble is the largest filled area the
  // accent ever covers, and a colour behaves differently over a palm-sized
  // block than in a 1px border.
  const rows = await b.evaluate(() => [...document.querySelectorAll('.thread')].map((r) => r.dataset.wallet));
  if (rows.length) {
    await b.click(`.thread[data-wallet="${rows[Math.min(3, rows.length - 1)]}"]`);
    await b.waitForSelector('.dm-row', { timeout: 20_000 });
    await b.waitForTimeout(600);
  }
  await b.screenshot({ path: path.join(OUT, `${v.key}-c-gespraech.png`) });
  await b.close();

  await ctx.close();
  console.log(`  ${v.key.padEnd(12)} ${v.name}`);
}

// --- comparison sheets ------------------------------------------------------
const AUSSCHNITT = {
  'a-anmelden':   { oben: 250, hoch: 400, links: 320, breit: 560 },
  'c-gespraech':  { oben: 0,   hoch: 430, links: 0,   breit: 1180 },
  'b-abstimmung': { oben: 0,   hoch: 400, links: 0,   breit: 1180 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of Object.entries({
  'a-anmelden': 'Anmeldung', 'c-gespraech': 'Gespraech', 'b-abstimmung': 'Abstimmung',
})) {
  const c = AUSSCHNITT[teil];
  const p = await sheet.newPage();
  const reihen = VARIANTEN.map((v) => {
    const b64 = fs.readFileSync(path.join(OUT, `${v.key}-${teil}.png`)).toString('base64');
    return `<figure>
      <figcaption>${v.key.replace(/^(\d)-/, '$1 — ')}  ·  ${v.name}</figcaption>
      <div class="fenster"><img src="data:image/png;base64,${b64}"></div>
    </figure>`;
  }).join('');
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #101218; width: ${c.breit}px; }
    figure { margin: 0 0 6px; }
    figcaption { font: 600 15px ui-monospace, monospace; color: #e7e9ee;
                 padding: 9px 14px; letter-spacing: .02em; }
    .fenster { width: ${c.breit}px; height: ${c.hoch}px; overflow: hidden; position: relative; }
    .fenster img { position: absolute; width: 1180px; left: ${-c.links}px; top: ${-c.oben}px; }
  </style>${reihen}`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `vergleich-${teil}.png`), fullPage: true });
  await p.close();
  console.log(`  vergleich-${teil}.png   ${titel}`);
}
await sheet.close();

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
