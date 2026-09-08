/**
 * Five readings of the gage.cash palette, on the real page.
 *
 * Simulation only - public/styles.css is untouched. Palette laid on at render
 * time, shape (right angles) and font (IBM Plex Mono) unchanged, so only the
 * colour moves.
 *
 * What was read off their screenshots, value for value:
 *
 *   ground        a warm off-white, greyer than sand    ~#f5f2ec
 *   card          a shade lighter than the ground       ~#fbfaf7
 *   hairline      warm light grey, no shadows           ~#e4dfd5
 *   ink           near-black, warm                      ~#16150f
 *   muted         warm grey for labels                  ~#8a8377
 *   accent        ochre, ONE tone, everywhere           ~#c8892a
 *
 * And what they do with it, which matters more than the values: the accent
 * carries the number that the page is about, the border of the one card that
 * is being highlighted, the chart fills and the active nav item. Nothing
 * else. Everything else is ink on paper with a hairline between. No shadows,
 * no second accent, no colour used for decoration.
 *
 * Not taken: the bracket wordmark, and their grotesk for headings. SIZED runs
 * on one font by decision, and the brackets are their mark.
 *
 *   node scripts/vorschau-gage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'gage');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

// --- contrast, so none of this is shipped on a guess -----------------------
const kanal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * The page from one config.
 *
 * Same generator as the earlier colour rounds - what changes per draft is a
 * handful of values, and writing the sheet out five times would mean five
 * chances to fix a colour in four places and forget the fifth.
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
              box-shadow: 0 1px 2px rgba(60, 52, 36, .05) !important; }
.topbar { background: ${p.bg} !important; }
.pay-row.is-copied { border-color: ${p.accent} !important; }
.reply-btn:hover { background: rgba(${rgb(p.text)}, .07) !important; }
.h.t0 { color: ${p.namen[0]} !important; }
.h.t1 { color: ${p.namen[1]} !important; }
.h.t2 { color: ${p.namen[2]} !important; }
.h.t3 { color: ${p.namen[3]} !important; }
.thread.is-unread { background: rgba(${rgb(p.namen[0])}, .09) !important; }
/* Own bubble solid, incoming flat - the way gage fills a bar: one filled
   shape, everything else outlined. */
.msg.dm.mine { background: ${p.fill} !important; color: ${p.knopfText} !important; }
.msg.dm.mine .time { color: rgba(${rgb(p.knopfText)}, .78) !important; }
.msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: ${p.knopfText} !important; }
/* No shadows anywhere. gage has none, and on paper a shadow is a hole. */
.toast, .tip, .lz-liste { box-shadow: 0 1px 3px rgba(60, 52, 36, .10) !important; }
.btn-primary { color: ${p.knopfText} !important; }
.btn.laedt::after { border-color: ${p.knopfText} !important; border-top-color: transparent !important; }
`;

// Four people tones for a light ground. Not a matter of taste: a handle has
// to stay readable, and the four values tuned for black do not.
const NAMEN = ['#1f5c94', '#5b3fa0', '#a01f4a', '#1f6b3f'];
// Where the accent is ochre, the fourth tone must not be: it would be the
// same colour twice, and the colour is the only thing telling two handles
// with the same three characters apart.
const NAMEN_OHNE_SAND = NAMEN;

const VARIANTEN = [
  {
    key: '1-gage-nah', name: 'Nah an gage',
    note: 'Ihre Werte, so genau ich sie aus den Bildern ablesen kann. Grund leicht grau, nicht sandig.',
    p: {
      bg: '#f5f2ec', bg1: '#fbfaf7', bg2: '#efece4', bg3: '#e8e4da',
      line: '#e0dbd0', text: '#16150f', dim: '#6b6558', dimmer: '#8b8474',
      accent: '#b8791f', fill: '#c8892a', knopfText: '#16150f', worth: '#2b2a22',
      balken: '#eae6dc', spitze: '#f0dcb4',
      gold: '#8a5a12', warn: '#a83228', namen: NAMEN,
    },
  },
  {
    key: '2-waermer', name: 'Waermer',
    note: 'Derselbe Ocker, aber der Grund geht ins Sandige. Naeher an Papier, weiter weg von Buero.',
    p: {
      bg: '#f4efe3', bg1: '#fbf8f1', bg2: '#ede7da', bg3: '#e5ded0',
      line: '#ddd5c6', text: '#17150e', dim: '#6a6254', dimmer: '#8a8271',
      accent: '#b8791f', fill: '#c8892a', knopfText: '#17150e', worth: '#2d2a20',
      balken: '#e8e1d3', spitze: '#f2dcb0',
      gold: '#8a5a12', warn: '#a83228', namen: NAMEN,
    },
  },
  {
    key: '3-kuehler', name: 'Kuehler',
    note: 'Fast neutraler Grund, nur eine Spur warm. Der Ocker steht dadurch alleiner da und wirkt lauter.',
    p: {
      bg: '#f4f3f0', bg1: '#fbfbf9', bg2: '#eeedea', bg3: '#e6e5e1',
      line: '#dedcd7', text: '#141410', dim: '#66635b', dimmer: '#868278',
      accent: '#b8791f', fill: '#c8892a', knopfText: '#141410', worth: '#2a2a25',
      balken: '#e9e8e4', spitze: '#f1dcb6',
      gold: '#8a5a12', warn: '#a83228', namen: NAMEN,
    },
  },
  {
    key: '4-tiefes-ocker', name: 'Tieferes Ocker',
    note: 'Gleicher Grund wie 1, der Akzent geht ins Braune. Leiser, teurer wirkend - und der Knopf zieht weniger Blick als der Betrag daneben.',
    p: {
      bg: '#f5f2ec', bg1: '#fbfaf7', bg2: '#efece4', bg3: '#e8e4da',
      line: '#e0dbd0', text: '#16150f', dim: '#6b6558', dimmer: '#8b8474',
      accent: '#8c5916', fill: '#95601a', knopfText: '#fbfaf7', worth: '#2b2a22',
      balken: '#eae6dc', spitze: '#ecd8b4',
      gold: '#7d5210', warn: '#a83228', namen: NAMEN,
    },
  },
  {
    key: '5-tinte-ocker', name: 'Tinte, Ocker nur fuer Ansem',
    note: 'Der Akzent wird schwarz - Knoepfe, Rahmen, Verweise. Ocker bleibt fuer genau eine Sache uebrig: Ansem und die fuehrende Antwort. Die strengste Fassung, und die einzige, in der die Farbe etwas bedeutet.',
    p: {
      bg: '#f5f2ec', bg1: '#fbfaf7', bg2: '#efece4', bg3: '#e8e4da',
      line: '#e0dbd0', text: '#16150f', dim: '#6b6558', dimmer: '#8b8474',
      accent: '#1c1b14', fill: '#24231a', knopfText: '#fbfaf7', worth: '#2b2a22',
      balken: '#eae6dc', spitze: '#f0dcb4',
      gold: '#9a6416', warn: '#a83228', namen: NAMEN_OHNE_SAND,
    },
  },
];

// --- what has to hold, per draft -------------------------------------------
console.log('\n── Kontraste ──\n');
let unter = 0;
for (const v of VARIANTEN) {
  const p = v.p;
  const paare = [
    ['Text auf Grund', p.text, p.bg, 4.5],
    ['Zweitschrift', p.dim, p.bg, 4.5],
    ['Leisestes', p.dimmer, p.bg1, 3],
    ['Betrag', p.worth, p.bg1, 4.5],
    ['Knopfschrift', p.knopfText, p.fill, 4.5],
    ['Akzent als Strich', p.accent, p.bg1, 3],
    ['Text auf fuehrendem Balken', p.text, p.spitze, 4.5],
    ['Ansem-Gold', p.gold, p.bg1, 4.5],
    ...p.namen.map((n, i) => [`Name ${i}`, n, p.bg2, 4.5]),
  ];
  const schlecht = paare.filter(([, a, b, min]) => kontrast(a, b) < min);
  unter += schlecht.length;
  console.log(`  ${schlecht.length === 0 ? '✓' : '✗'} ${v.key.padEnd(16)} `
    + (schlecht.length
      ? schlecht.map(([n, a, b]) => `${n} ${kontrast(a, b).toFixed(2)}:1`).join(', ')
      : `${paare.length} Paare ueber der Schwelle`));
}
if (unter) console.log(`\n  ${unter} Paare unter der Schwelle - siehe oben\n`);

// --- render -----------------------------------------------------------------
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';
const WALLET = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';
// The admin wallet of the LOCAL test database - not Ansem's real one.
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

/**
 * Signs in as the LOCAL test database's admin wallet.
 *
 * Not ?preview=admin for these shots, and that is worth writing down: in
 * preview mode the inbox fills but the poll list stays empty - loadPolls()
 * is never reached without a session, so the demo branch inside it never
 * runs. Fine for looking at the inbox, useless for a picture of the poll
 * list. With a real admin token plus ?demo=, both fill.
 */
async function anmelden(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#wallet-input', ADMIN);
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
  const anziehen = (p) => { p.on('load', () => p.addStyleTag({ content: style }).catch(() => {})); return p; };

  // 1. login
  const a = anziehen(await ctx.newPage());
  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.addStyleTag({ content: style });
  await a.fill('#wallet-input', WALLET);
  await a.click('#btn-challenge');
  await a.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, `${v.key}-a-anmelden.png`) });
  await a.close();

  // 2 + 3. Ansem's side - polls and inbox.
  // ?preview=admin&demo= is the app's own localhost-only preview: it shows
  // Ansem's interface without a login and invents the data. See PREVIEW_ADMIN
  // in app.js.
  const b = anziehen(await ctx.newPage());
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  await b.goto(`${BASE}/?demo=200`, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.poll', { timeout: 20_000 });
  await b.waitForTimeout(600);
  await b.screenshot({ path: path.join(OUT, `${v.key}-b-abstimmung.png`) });

  await b.click('.tab[data-tab="dms"]');
  await b.waitForSelector('.thread', { timeout: 20_000 });
  await b.waitForTimeout(800);
  await b.screenshot({ path: path.join(OUT, `${v.key}-c-posteingang.png`) });
  await b.close();

  await ctx.close();
  console.log(`  ${v.key.padEnd(16)} ${v.name}`);
}

// --- comparison sheets, cropped to a detail --------------------------------
const AUSSCHNITT = {
  'a-anmelden':     { oben: 250, hoch: 420, links: 320, breit: 560 },
  'b-abstimmung':   { oben: 0,   hoch: 420, links: 0,   breit: 1180 },
  'c-posteingang':  { oben: 0,   hoch: 420, links: 0,   breit: 1180 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of Object.entries({
  'b-abstimmung': 'Abstimmung', 'c-posteingang': 'Posteingang', 'a-anmelden': 'Anmeldung',
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
