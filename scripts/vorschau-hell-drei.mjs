/**
 * The light look on the three screens that matter, with REAL data.
 *
 * Simulation only; public/styles.css is untouched.
 *
 * Why real data and not ?demo=: demo mode fills the inbox list but leaves the
 * conversations empty - so the one screen where the accent covers a
 * palm-sized area, the own message bubble, came out blank in the last round.
 * A colour behaves differently over a block than in a 1px border, and that
 * block is exactly what has to be judged here. So this signs in against the
 * seeded test database instead: 500 conversations, 1,588 messages, 3 polls
 * with real vote weights.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (once)
 *   node scripts/vorschau-hell-drei.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'hell-drei');
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

// Blue, violet, rose, green. On an ochre accent none of them collides - ochre
// sits between rose and green in hue but far from both in saturation, and the
// measured distance below says so rather than my eye.
const NAMEN = ['#1f5c94', '#5b3fa0', '#a01f4a', '#1f6b3f'];

const VARIANTEN = [
  {
    key: '1-gage-nah', name: 'Nah an gage',
    note: 'Ihre Werte, so genau wie aus den Bildern ablesbar. Grund leicht ins Graue.',
    bg: '#f5f2ec', bg1: '#fbfaf7', bg2: '#efece4', bg3: '#e8e4da', line: '#e0dbd0',
    text: '#16150f', dim: '#6b6558', dimmer: '#8b8474', worth: '#2b2a22',
    accent: '#b8791f', fill: '#c8892a', knopfText: '#16150f',
    balken: '#eae6dc', spitze: '#f0dcb4', gold: '#8a5a12',
  },
  {
    key: '2-beiger', name: 'Beiger',
    note: 'Derselbe Ocker, aber das Papier geht ins Sandige statt ins Graue. Naeher an Papier, weiter weg von Buero - und nicht mehr ihr Grundwert.',
    bg: '#f5f1e8', bg1: '#fbf9f4', bg2: '#eee9de', bg3: '#e6e0d3', line: '#ded7c9',
    text: '#16150e', dim: '#6a6357', dimmer: '#8d8676', worth: '#2c2a20',
    accent: '#b8791f', fill: '#c8892a', knopfText: '#16150e',
    balken: '#e9e3d6', spitze: '#f1dcb2', gold: '#8a5a12',
  },
  {
    key: '3-tiefes-ocker', name: 'Tieferes Ocker',
    note: 'Beiges Papier, Akzent ins Braune. Leiser - der Betrag zieht mehr Blick als der Knopf.',
    bg: '#f5f1e8', bg1: '#fbf9f4', bg2: '#eee9de', bg3: '#e6e0d3', line: '#ded7c9',
    text: '#16150e', dim: '#6a6357', dimmer: '#8d8676', worth: '#2c2a20',
    accent: '#8c5916', fill: '#95601a', knopfText: '#fbf9f4',
    balken: '#e9e3d6', spitze: '#ecd8b0', gold: '#7d5210',
  },
  {
    key: '4-tinte-ocker', name: 'Tinte, Ocker nur fuer Ansem',
    note: 'Knoepfe, Rahmen und Verweise werden schwarz. Ocker bleibt fuer genau eine Sache uebrig: Ansem und die fuehrende Antwort. Die strengste Fassung - und die einzige, in der die Farbe etwas bedeutet.',
    bg: '#f5f1e8', bg1: '#fbf9f4', bg2: '#eee9de', bg3: '#e6e0d3', line: '#ded7c9',
    text: '#16150e', dim: '#6a6357', dimmer: '#8d8676', worth: '#2c2a20',
    accent: '#1c1b14', fill: '#24231a', knopfText: '#fbf9f4',
    balken: '#e9e3d6', spitze: '#f1dcb2', gold: '#96631a',
  },
];

const bau = (p) => `
:root {
  --bg: ${p.bg}; --bg-1: ${p.bg1}; --bg-2: ${p.bg2}; --bg-3: ${p.bg3};
  --line: ${p.line}; --text: ${p.text}; --dim: ${p.dim}; --dimmer: ${p.dimmer};
  --accent: ${p.accent}; --accent-rgb: ${rgb(p.accent)}; --accent-fill: ${p.fill};
  --worth: ${p.worth}; --fokus: ${p.dim};
  --fuellung: ${p.balken}; --fuellung-spitze: ${p.spitze};
  --ungelesen: ${NAMEN[0]};
  --warn: #a83228; --gold: ${p.gold};
  --accent-2: ${p.accent}; --accent-2-rgb: ${rgb(p.accent)};
}
html, body { background: var(--bg); }
.login-card { background: ${p.bg1} !important; box-shadow: none !important; }
.topbar { background: ${p.bg} !important; }
.pay-row.is-copied { border-color: ${p.accent} !important; }
.reply-btn:hover { background: rgba(${rgb(p.text)}, .07) !important; }
.h.t0 { color: ${NAMEN[0]} !important; }
.h.t1 { color: ${NAMEN[1]} !important; }
.h.t2 { color: ${NAMEN[2]} !important; }
.h.t3 { color: ${NAMEN[3]} !important; }
.thread.is-unread { background: rgba(${rgb(NAMEN[0])}, .09) !important; }
.msg.dm.mine { background: ${p.fill} !important; color: ${p.knopfText} !important; }
.msg.dm.mine .time { color: rgba(${rgb(p.knopfText)}, .78) !important; }
.msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: ${p.knopfText} !important; }
/* No shadows: on paper a shadow is a hole, not a raised edge. */
.toast, .tip, .lz-liste { box-shadow: 0 1px 3px rgba(40, 40, 30, .10) !important; }
.btn-primary { color: ${p.knopfText} !important; }
.btn.laedt::after { border-color: ${p.knopfText} !important; border-top-color: transparent !important; }
`;

console.log('\n── Kontraste ──\n');
let unter = 0;
for (const p of VARIANTEN) {
  const paare = [
    ['Text', p.text, p.bg, 4.5], ['Zweitschrift', p.dim, p.bg, 4.5],
    ['Leisestes', p.dimmer, p.bg1, 3], ['Betrag', p.worth, p.bg1, 4.5],
    ['Knopfschrift', p.knopfText, p.fill, 4.5], ['Akzent als Strich', p.accent, p.bg1, 3],
    ['Text auf fuehrendem Balken', p.text, p.spitze, 4.5], ['Ansem-Gold', p.gold, p.bg1, 4.5],
    ...NAMEN.map((n, i) => [`Name ${i}`, n, p.bg2, 4.5]),
  ];
  const schlecht = paare.filter(([, a, b, min]) => kontrast(a, b) < min);
  unter += schlecht.length;
  console.log(`  ${schlecht.length ? '✗' : '✓'} ${p.key.padEnd(16)} `
    + (schlecht.length ? schlecht.map(([n, a, b]) => `${n} ${kontrast(a, b).toFixed(2)}:1`).join(', ')
      : `${paare.length} Paare ok`));
}
if (unter) { console.error(`\n  ${unter} unter der Schwelle - nicht gerendert\n`); process.exit(1); }

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
  const style = `${HIDE} ${bau(v)}`;
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

  // 2 + 3. Ansem's side against the seeded database - no demo mode.
  const b = anziehen(await ctx.newPage());
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  await b.goto(BASE, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.opt', { timeout: 25_000 });
  await b.waitForTimeout(700);
  await b.screenshot({ path: path.join(OUT, `${v.key}-b-polls.png`) });

  await b.click('.tab[data-tab="dms"]');
  await b.waitForSelector('.thread', { timeout: 25_000 });
  await b.waitForTimeout(900);
  // A conversation with a back and forth in it, not the first row - the top of
  // the list is whoever holds most, and that may well be a single "gm".
  const gewaehlt = await b.evaluate(() => {
    const rows = [...document.querySelectorAll('.thread')];
    return rows.length ? rows[Math.min(5, rows.length - 1)].dataset.wallet : null;
  });
  if (gewaehlt) {
    await b.click(`.thread[data-wallet="${gewaehlt}"]`);
    await b.waitForSelector('.dm-row', { timeout: 25_000 });
    await b.waitForTimeout(800);
  }
  await b.screenshot({ path: path.join(OUT, `${v.key}-c-dms.png`) });
  await b.close();

  await ctx.close();
  console.log(`  ${v.key.padEnd(16)} ${v.name}`);
}

const AUSSCHNITT = {
  'a-anmelden': { oben: 250, hoch: 400, links: 320, breit: 560 },
  'b-polls':    { oben: 0,   hoch: 430, links: 0,   breit: 1180 },
  // The LOWER half for the conversation: messages sit at the bottom of a chat
  // pane, and a crop from the top showed a header over an empty area - the
  // own bubble, the whole reason this screen is here, was below the cut.
  'c-dms':      { oben: 390, hoch: 470, links: 0,   breit: 1180 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of Object.entries({
  'a-anmelden': 'Anmeldung', 'b-polls': 'Polls', 'c-dms': 'DMs',
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
