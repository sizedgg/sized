/**
 * Eight colour worlds - not eight shades of sand.
 *
 * Simulation only; public/styles.css is untouched.
 *
 * The previous round varied the temperature of one idea and the six columns
 * came out nearly identical on the voting screen, for a reason worth keeping
 * in mind here: the accent barely appears on that screen. So what is being
 * varied this time is the GROUND as much as the accent - four dark worlds,
 * four light ones, hues from amber through green, blue, coral, red, orange,
 * teal to wine.
 *
 * Fixed across all eight, so that only one thing moves: right angles
 * everywhere, mono everywhere, same layout, same data.
 *
 *   node scripts/vorschau-farbwelten.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'welten');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

/**
 * The whole page from one config.
 *
 * Two things had to change against the sand version to survive a dark
 * ground: what sits ON the filled accent is now --bg in every case (on light
 * grounds that is the paper, on dark ones the near-black - either way the
 * quiet colour against the loud one), and the shadow follows `dunkel`. A
 * warm brown shadow under a black card is invisible; a 50%-black shadow on
 * paper is a hole.
 */
const bau = (p) => `
:root {
  --bg: ${p.bg}; --bg-1: ${p.bg1}; --bg-2: ${p.bg2}; --bg-3: ${p.bg3};
  --line: ${p.line}; --text: ${p.text}; --dim: ${p.dim}; --dimmer: ${p.dimmer};
  --accent: ${p.accent}; --accent-rgb: ${rgb(p.accent)}; --accent-fill: ${p.fill};
  --worth: ${p.worth}; --fokus: ${p.dim};
  --fuellung: ${p.balken}; --fuellung-spitze: ${p.spitze};
  --ungelesen: ${p.namen[0]};
  --warn: ${p.warn}; --gold: ${p.gold};
  --accent-2: ${p.accent}; --accent-2-rgb: ${rgb(p.accent)};
}
html, body { background: var(--bg); }
.login-card { background: ${p.bg1} !important;
              box-shadow: 0 1px 3px ${p.dunkel ? 'rgba(0,0,0,.5)' : 'rgba(60,52,36,.07)'} !important; }
.topbar { background: ${p.bg} !important; }
.pay-row.is-copied { border-color: ${p.accent} !important; }
.reply-btn:hover { background: rgba(${rgb(p.text)}, .09) !important; }
.h.t0 { color: ${p.namen[0]} !important; }
.h.t1 { color: ${p.namen[1]} !important; }
.h.t2 { color: ${p.namen[2]} !important; }
.h.t3 { color: ${p.namen[3]} !important; }
.thread.is-unread { background: rgba(${rgb(p.namen[0])}, .12) !important; }
.msg.dm.mine { background: ${p.fill} !important; color: ${p.bg} !important; }
.msg.dm.mine .time { color: rgba(${rgb(p.bg)}, .78) !important; }
.msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: ${p.bg} !important; }
.toast, .tip, .lz-liste {
  box-shadow: 0 8px 26px ${p.dunkel ? 'rgba(0,0,0,.55)' : 'rgba(60,52,36,.15)'} !important; }
.btn-primary { color: ${p.bg} !important; }
.btn.laedt::after { border-color: ${p.bg} !important; border-top-color: transparent !important; }

/* Shape and font stay fixed - see the note at the top. */
* { border-radius: 0 !important; }
.btn.laedt::after { border-radius: 50% !important; }
.thread.is-unread .w::before { border-radius: 50% !important; }
.preview-flag { border-radius: 999px !important; }
`;

// The four people tones come in two sets: one for dark grounds, one for
// light. They are not a matter of taste - a handle has to stay readable, and
// the same four values cannot do that on both.
const HELL_AUF_DUNKEL = ['#8ab2dc', '#b79ae0', '#e59ba8', '#cfc07f'];
const DUNKEL_AUF_HELL = ['#14568c', '#5b3fa0', '#a01f4a', '#1f6b3f'];

const WELTEN = [
  {
    key: '1-bernstein', name: 'Bernstein',
    note: 'Der alte Bernstein-Monitor. Dunkelbraun statt schwarz, alles in warmem Gelb. Die Schrift ist Mono - hier sieht sie zum ersten Mal danach aus, als waere das Absicht.',
    p: {
      dunkel: true,
      bg: '#14100a', bg1: '#1c1710', bg2: '#241e15', bg3: '#2e261a',
      line: '#3b3122', text: '#f0dcb4', dim: '#a8926a', dimmer: '#746850',
      accent: '#ffb340', fill: '#e39a2c', worth: '#ffd08a',
      balken: '#2e261a', spitze: '#6b4a12',
      gold: '#ffb340', warn: '#ff6b5a', namen: HELL_AUF_DUNKEL,
    },
  },
  {
    key: '2-phosphor', name: 'Phosphor',
    note: 'Gruenes Terminal. Am weitesten weg von allem, was sonst im Krypto-Umfeld herumsteht - und riskant: gruen auf schwarz ist entweder eine Haltung oder ein Kostuem, dazwischen gibt es wenig.',
    p: {
      dunkel: true,
      bg: '#050d08', bg1: '#0b160f', bg2: '#101d15', bg3: '#17281c',
      line: '#1f3527', text: '#d6f2dd', dim: '#7fae90', dimmer: '#55755f',
      accent: '#4ade80', fill: '#3fbf6d', worth: '#a7e8bd',
      balken: '#17281c', spitze: '#16512f',
      gold: '#ffd35c', warn: '#ff6b6b', namen: HELL_AUF_DUNKEL,
    },
  },
  {
    key: '3-blaupause', name: 'Blaupause',
    note: 'Technische Zeichnung: tiefes Blau, helle Linien, Cyan als Akzent. Die Zahlen wirken hier am meisten nach Messwert und am wenigsten nach Werbung.',
    p: {
      dunkel: true,
      bg: '#0d2137', bg1: '#12293f', bg2: '#17324a', bg3: '#1e3d58',
      line: '#2a4f6d', text: '#dbe9f5', dim: '#91b3cf', dimmer: '#6486a3',
      accent: '#7fd4ff', fill: '#4fbde8', worth: '#bfe4f7',
      balken: '#1e3d58', spitze: '#2c6a91',
      gold: '#ffcf70', warn: '#ff8080', namen: HELL_AUF_DUNKEL,
    },
  },
  {
    key: '4-marine', note: 'Nachtblau mit Creme und einem Korallenakzent. Die einzige dunkle Fassung hier, die warm UND farbig ist - der Akzent ist keine Leuchtfarbe, sondern ein Ton.',
    name: 'Marine & Koralle',
    p: {
      dunkel: true,
      bg: '#0f1b2d', bg1: '#152238', bg2: '#1b2a43', bg3: '#22344f',
      line: '#2e4462', text: '#f2ece0', dim: '#a9a596', dimmer: '#77776b',
      accent: '#ff8a65', fill: '#f4744a', worth: '#ffd9c2',
      balken: '#22344f', spitze: '#7a3d2a',
      gold: '#ffcf70', warn: '#ff5f56', namen: HELL_AUF_DUNKEL,
    },
  },
  {
    key: '5-zeitung', name: 'Zeitung',
    note: 'Weiss, Schwarz, ein Rot. Keine Waerme, keine Toene - nur Kontrast. Von allen hier die Fassung, die am ehesten wie ein Dokument aussieht und am wenigsten wie eine App.',
    p: {
      bg: '#ffffff', bg1: '#ffffff', bg2: '#f4f4f2', bg3: '#eaeae7',
      line: '#d6d6d1', text: '#111111', dim: '#575757', dimmer: '#8a8a8a',
      accent: '#c8102e', fill: '#c8102e', worth: '#111111',
      balken: '#ececea', spitze: '#f7d7dc',
      gold: '#8a6a00', warn: '#c8102e', namen: DUNKEL_AUF_HELL,
    },
  },
  {
    key: '6-beton', name: 'Beton',
    note: 'Kuehles Grau statt warmem Papier, dazu ein hartes Orange. Nuechtern, fast industriell - und der Akzent hat auf dem grauen Grund mehr Druck als das Ocker auf Sand.',
    p: {
      bg: '#e8e8e6', bg1: '#f3f3f1', bg2: '#dededb', bg3: '#d3d3cf',
      line: '#c3c3bd', text: '#17181a', dim: '#5c5e60', dimmer: '#86888a',
      accent: '#d4501e', fill: '#e2571f', worth: '#2f3134',
      balken: '#dcdcd8', spitze: '#f6cdb4',
      gold: '#a06a00', warn: '#b3261e', namen: DUNKEL_AUF_HELL,
    },
  },
  {
    key: '7-mint', name: 'Mint & Petrol',
    note: 'Blasses Kaltgruen mit tiefem Petrol. Ruhig bis zur Unauffaelligkeit - das kann Vertrauen heissen oder Langeweile, je nachdem, wen man fragt.',
    p: {
      bg: '#eaf2ee', bg1: '#f5faf7', bg2: '#dfeae4', bg3: '#d3e2da',
      line: '#c2d5cb', text: '#0f1a15', dim: '#4f6259', dimmer: '#7d9187',
      accent: '#0d6b5f', fill: '#10796b', worth: '#223a32',
      balken: '#dbe8e1', spitze: '#b8ddd2',
      gold: '#8a6a12', warn: '#b3261e', namen: DUNKEL_AUF_HELL,
    },
  },
  {
    key: '8-burgund', name: 'Burgund',
    note: 'Staubiges Rosa als Grund, Wein als Akzent. Der Gegenentwurf zu allem, was ein Token-Projekt normalerweise macht - und der einzige Vorschlag hier, bei dem die Farbe selbst schon eine Behauptung ist.',
    p: {
      bg: '#f2e8e6', bg1: '#faf3f1', bg2: '#ecdfdc', bg3: '#e2d1cd',
      line: '#d3bfbb', text: '#1a1211', dim: '#6b5652', dimmer: '#927c78',
      accent: '#7d2130', fill: '#8e2839', worth: '#3a2523',
      balken: '#e6d7d3', spitze: '#ecc9c4',
      gold: '#96601a', warn: '#b3261e', namen: DUNKEL_AUF_HELL,
    },
  },
];

const HIDE = '#btn-mock-pay,#toast{display:none!important}';
const WALLET = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

async function anmelden(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#wallet-input', WALLET);
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
const JWT = await anmelden(vp);
await vorlauf.close();

for (const v of WELTEN) {
  const style = `${HIDE} ${bau(v.p)}`;
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2,
  });

  const a = await ctx.newPage();
  a.on('load', () => a.addStyleTag({ content: style }).catch(() => {}));
  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.addStyleTag({ content: style });
  await a.fill('#wallet-input', WALLET);
  await a.click('#btn-challenge');
  await a.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, `${v.key}-a-anmelden.png`) });
  await a.close();

  const b = await ctx.newPage();
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  b.on('load', () => b.addStyleTag({ content: style }).catch(() => {}));
  await b.goto(`${BASE}/?demo=14`, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.opt', { timeout: 20_000 });
  await b.waitForTimeout(500);
  await b.screenshot({ path: path.join(OUT, `${v.key}-b-abstimmung.png`) });
  await b.close();

  await ctx.close();
  console.log(`  ${v.key.padEnd(14)} ${v.name}`);
}

// --- comparison sheets ------------------------------------------------------
const AUSSCHNITT = {
  'a-anmelden':   { oben: 250, hoch: 400, links: 320, breit: 560 },
  'b-abstimmung': { oben: 0,   hoch: 400, links: 0,   breit: 1180 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of [['a-anmelden', 'Anmeldung'], ['b-abstimmung', 'Abstimmung']]) {
  const c = AUSSCHNITT[teil];
  const p = await sheet.newPage();
  const reihen = WELTEN.map((v) => {
    const b64 = fs.readFileSync(path.join(OUT, `${v.key}-${teil}.png`)).toString('base64');
    return `<figure>
      <figcaption>${v.key.replace(/^(\d)-/, '$1 — ')}</figcaption>
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
