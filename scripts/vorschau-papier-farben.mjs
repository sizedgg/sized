/**
 * Six colour temperatures on the chosen shape (variant 2: right angles).
 *
 * Simulation only - public/styles.css is untouched.
 *
 * What is being varied, and what deliberately is not: the SHAPE stays fixed
 * at right angles everywhere, and the font stays mono. Otherwise two things
 * would move at once and every comparison would be worthless. Only three
 * things change per column: how warm the paper is, which hue the accent has,
 * and how dark the ink is.
 *
 * The palette is generated from a handful of values rather than written out
 * six times. Writing it out would mean six chances to fix a colour in five
 * places and forget the sixth - and the difference would then look like a
 * design decision instead of the slip it is.
 *
 *   node scripts/vorschau-papier-farben.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'farben');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

/** #rrggbb -> "r, g, b", because rgba() cannot take a colour variable. */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

/**
 * The whole page from one config.
 *
 * `p` names only what actually differs between the drafts. Everything else -
 * the right angles, the shadows, the split between the answer bar and your
 * own DM bubble - is the same for all six and lives here once.
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
              box-shadow: 0 1px 3px rgba(60, 52, 36, .07) !important; }
.topbar { background: ${p.bg} !important; }
.pay-row.is-copied { border-color: ${p.text} !important; }
.reply-btn:hover { background: rgba(${rgb(p.text)}, .07) !important; }
.h.t0 { color: ${p.namen[0]} !important; }
.h.t1 { color: ${p.namen[1]} !important; }
.h.t2 { color: ${p.namen[2]} !important; }
.h.t3 { color: ${p.namen[3]} !important; }
.thread.is-unread { background: rgba(${rgb(p.namen[0])}, .10) !important; }
/* Ansem's handle runs on --accent. Where the accent is the ink itself, that
   would make him look like body text - so there he takes the gold instead. */
${p.ansemGold ? '.admin-name, .h.ansem, .me .handle.admin-name { color: var(--gold) !important; }' : ''}
.msg.dm.mine { background: ${p.fill} !important; color: ${p.bg1} !important; }
.msg.dm.mine .time { color: rgba(255, 255, 255, .80) !important; }
.msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: ${p.bg1} !important; }
.toast { box-shadow: 0 6px 24px rgba(60, 52, 36, .16) !important; }
.tip, .lz-liste { box-shadow: 0 10px 24px rgba(60, 52, 36, .14) !important; }
.btn-primary { color: ${p.bg} !important; }
.btn.laedt::after { border-color: ${p.bg} !important; border-top-color: transparent !important; }

/* Shape - fixed for all six, see the note at the top. */
* { border-radius: 0 !important; }
.btn.laedt::after { border-radius: 50% !important; }
.thread.is-unread .w::before { border-radius: 50% !important; }
.preview-flag { border-radius: 999px !important; }
`;

// The four people tones, per ground. Blue, violet and rose carry over; the
// fourth has to dodge whatever the accent is doing, which is why it is not
// the same colour in every column.
const NAMEN_WARM  = ['#2f6ea8', '#6b4fa8', '#a83f5f', '#3f7a52'];
const NAMEN_OLIVE = ['#2f6ea8', '#6b4fa8', '#a83f5f', '#8a5a12'];

const VARIANTEN = [
  {
    key: '1-ocker',
    name: 'Ocker auf Sand',
    note: 'Die Fassung, die du schon gesehen hast.',
    p: {
      bg: '#f4f0e8', bg1: '#fbf9f4', bg2: '#efeae0', bg3: '#e5dfd1',
      line: '#d9d1c1', text: '#16170f', dim: '#625e50', dimmer: '#8a8574',
      accent: '#a1671c', fill: '#b3762a', worth: '#3a3627',
      balken: '#e7e0d0', spitze: '#f0ddb8',
      gold: '#8a5a12', warn: '#b3261e', namen: NAMEN_WARM,
    },
  },
  {
    key: '2-terrakotta',
    name: 'Terrakotta',
    note: 'Derselbe Grund, der Akzent geht ins Rote. Waermer und lauter - der Knopf zieht deutlich mehr Blick als beim Ocker.',
    p: {
      bg: '#f3ece2', bg1: '#fbf7f1', bg2: '#ede5d9', bg3: '#e3d9c9',
      line: '#d6cab6', text: '#1a1611', dim: '#665c4e', dimmer: '#8d8271',
      accent: '#a2502a', fill: '#b45a2e', worth: '#3d3327',
      balken: '#e6dccb', spitze: '#f2d9c2',
      gold: '#8a5a12', warn: '#a1241c', namen: NAMEN_WARM,
    },
  },
  {
    key: '3-tinte',
    name: 'Tinte, Ocker nur fuer Ansem',
    note: 'Der Akzent wird schwarz: Knoepfe, Rahmen, Verweise. Ocker bleibt uebrig fuer genau eine Sache - Ansem. Das ist die strengste Fassung und die einzige, in der die Akzentfarbe wirklich etwas bedeutet.',
    p: {
      bg: '#f4f0e8', bg1: '#fbf9f4', bg2: '#efeae0', bg3: '#e5dfd1',
      line: '#d9d1c1', text: '#16170f', dim: '#625e50', dimmer: '#8a8574',
      accent: '#1c1d16', fill: '#24261c', worth: '#3a3627',
      balken: '#e7e0d0', spitze: '#e0d9c6',
      gold: '#a1671c', warn: '#b3261e', namen: NAMEN_WARM, ansemGold: true,
    },
  },
  {
    key: '4-olive',
    name: 'Olive',
    note: 'Kuehlerer Grund, gruener Akzent. Kein Krypto-Gruen - eher Leinen. Die vierte Namensfarbe wird hier wieder Sand, weil Gruen jetzt der Akzent ist.',
    p: {
      bg: '#f2f0e6', bg1: '#faf9f2', bg2: '#ebe9dd', bg3: '#e1dfd0',
      line: '#d4d2c0', text: '#15170f', dim: '#5f6250', dimmer: '#888b76',
      accent: '#5f6b28', fill: '#6b7a2e', worth: '#383a27',
      balken: '#e4e2d2', spitze: '#e4e8c4',
      gold: '#8a6a12', warn: '#a8291f', namen: NAMEN_OLIVE,
    },
  },
  {
    key: '5-kraft',
    name: 'Kraftpapier',
    note: 'Dunkleres, satteres Papier, die Karten heller als der Grund. Am weitesten weg von Weiss - und die Variante, die auf einem hellen Bildschirm am wenigsten blendet.',
    p: {
      bg: '#e9e0cd', bg1: '#f5efe2', bg2: '#e2d8c2', bg3: '#d8cdb4',
      line: '#c9bda3', text: '#1b1810', dim: '#5f5747', dimmer: '#8b8371',
      accent: '#9a5f18', fill: '#ab6d22', worth: '#3a3323',
      balken: '#dcd2bb', spitze: '#efd6a8',
      gold: '#8a5a12', warn: '#a1241c', namen: NAMEN_WARM,
    },
  },
  {
    key: '6-kalk',
    name: 'Kalk',
    note: 'Fast weiss, nur eine Spur warm. Naeher an einem normalen hellen Design als an Papier - hier zum Vergleich, damit sichtbar wird, wie viel die Waerme der anderen fuenf ueberhaupt ausmacht.',
    p: {
      bg: '#f3f2ee', bg1: '#fbfaf8', bg2: '#ecebe5', bg3: '#e3e1d9',
      line: '#d7d4ca', text: '#14150f', dim: '#5f5f55', dimmer: '#8a897d',
      accent: '#a1671c', fill: '#b3762a', worth: '#36362d',
      balken: '#e6e5dd', spitze: '#f0e2c6',
      gold: '#8a5a12', warn: '#b3261e', namen: NAMEN_WARM,
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

for (const v of VARIANTEN) {
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
  console.log(`  ${v.key.padEnd(15)} ${v.name}`);
}

// --- comparison sheets, cropped to a detail --------------------------------
const AUSSCHNITT = {
  'a-anmelden':   { oben: 250, hoch: 430, links: 320, breit: 560 },
  'b-abstimmung': { oben: 0,   hoch: 480, links: 0,   breit: 1180 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of [['b-abstimmung', 'Abstimmung'], ['a-anmelden', 'Anmeldung']]) {
  const c = AUSSCHNITT[teil];
  const p = await sheet.newPage();
  const reihen = VARIANTEN.map((v) => {
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
