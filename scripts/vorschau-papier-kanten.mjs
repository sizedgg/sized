/**
 * The paper palette, five ways of treating the corners.
 *
 * Simulation only - public/styles.css is untouched, the palette and the
 * radii are laid on at render time.
 *
 * The rounding is not one value in the file: --radius carries the poll
 * card, but the login card sits at 18px, the answer bars at 9, buttons and
 * fields at 8 and 10, the toast at 10 - eleven places in all. A preview
 * that only moved --radius would show a page where a third of the corners
 * changed and the rest did not, and that would say nothing about any of the
 * five. So the override goes over everything and then puts the two things
 * that MUST stay circular back: the loading spinner and the unread dot.
 *
 *   node scripts/vorschau-papier-kanten.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'kanten');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

// --- the palette, unchanged from vorschau-papier.mjs ------------------------
const PAPIER = `
:root {
  --bg: #f4f0e8; --bg-1: #fbf9f4; --bg-2: #efeae0; --bg-3: #e5dfd1;
  --line: #d9d1c1; --text: #16170f; --dim: #625e50; --dimmer: #8a8574;
  --accent: #a1671c; --accent-rgb: 161, 103, 28; --accent-fill: #b3762a;
  --worth: #3a3627; --fokus: #625e50;
  --fuellung: #e7e0d0; --fuellung-spitze: #f0ddb8;
  --ungelesen: #2f6ea8;
  --warn: #b3261e; --gold: #8a5a12;
  --accent-2: #b3762a; --accent-2-rgb: 179, 118, 42;
}
html, body { background: var(--bg); }
.login-card { background: rgba(251, 249, 244, .86) !important;
              box-shadow: 0 1px 3px rgba(60, 52, 36, .07) !important; }
.topbar { background: rgba(244, 240, 232, .88) !important; }
.pay-row.is-copied { border-color: rgba(22, 23, 15, .45) !important; }
.reply-btn:hover { background: rgba(22, 23, 15, .06) !important; }
.h.t0 { color: #2f6ea8 !important; }
.h.t1 { color: #6b4fa8 !important; }
.h.t2 { color: #a83f5f !important; }
.h.t3 { color: #3f7a52 !important; }
.thread.is-unread { background: rgba(47, 110, 168, .10) !important; }
.msg.dm.mine { background: #b3762a !important; color: #fbf9f4 !important; }
.msg.dm.mine .time { color: rgba(255, 255, 255, .80) !important; }
.msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: #fbf9f4 !important; }
.toast { box-shadow: 0 6px 24px rgba(60, 52, 36, .16) !important; }
.toast.err { color: #7a1a15 !important; }
.tip, .lz-liste { box-shadow: 0 10px 24px rgba(60, 52, 36, .14) !important; }
.btn-primary { color: var(--bg) !important; }
.btn.laedt::after { border-color: var(--bg) !important; border-top-color: transparent !important; }
`;

/**
 * One radius for everything, minus the two things that are circles by
 * nature: the spinner in a loading button, and the 6px dot that marks an
 * unread conversation. A square dot is not a quieter dot, it is a bug.
 */
const kante = (px) => `
  * { border-radius: ${px} !important; }
  .btn.laedt::after { border-radius: 50% !important; }
  .thread.is-unread .w::before { border-radius: 50% !important; }
  .preview-flag { border-radius: 999px !important; }
`;

const VARIANTEN = [
  {
    key: '1-jetzt',
    name: 'Wie in der Vorschau',
    note: 'Die Rundungen, die die Seite heute hat: Karte 12, Login 18, Balken 9.',
    css: '',
  },
  {
    key: '2-kante',
    name: 'Rechtwinklig',
    note: 'Null ueberall. Am naechsten an einem gedruckten Blatt - und die Balken werden dadurch messbar leichter zu vergleichen, weil ihre Enden auf einer Linie liegen statt in einer Rundung auszulaufen.',
    css: kante('0'),
  },
  {
    key: '3-schnitt',
    name: 'Papierschnitt, 2px',
    note: 'Fast rechtwinklig, aber nicht scharf. Die Ecke ist noch da, sie faellt nur nicht mehr auf. Der Kompromiss, wenn "0" zu hart wirkt.',
    css: kante('2px'),
  },
  {
    key: '4-ohne-kasten',
    name: 'Ohne Kaesten',
    note: 'Rechtwinklig, und die Poll-Karte verliert ihren Rahmen: getrennt wird durch eine Haarlinie und durch Luft, nicht durch eine Umrandung. Das ist der Zug, den gage macht - weniger Striche, mehr Weissraum.',
    css: `${kante('0')}
      .poll-card, .pane, .thread-list, .dm-user, .rahmen, .gefuellt, .login-card {
        border-color: transparent !important; background: transparent !important;
        box-shadow: none !important;
      }
      .poll-card { border-bottom: 1px solid var(--line) !important;
                   padding-bottom: 1.6rem !important; margin-bottom: 1.6rem !important; }
      .opt-bar { border-color: transparent !important; }
      .opt-fill { background: #e9e2d2 !important; }
      .opt.leads .opt-fill { background: #f2ddb4 !important; }
    `,
  },
  {
    key: '5-gemischt',
    name: 'Struktur eckig, Bedienung rund',
    note: 'Karten und Balken rechtwinklig, aber alles, was man anfasst, bleibt rund: Knoepfe, Reiter, Eingabefelder. Die Form sagt dann, was klickbar ist.',
    css: `${kante('0')}
      .btn, .icon-btn, .tab, input, textarea, select, .pay-row {
        border-radius: 8px !important;
      }
      .btn-primary, .btn-outline, .btn-ghost { border-radius: 999px !important; }
    `,
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
  const style = `${HIDE} ${PAPIER} ${v.css}`;
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
  console.log(`  ${v.key.padEnd(16)} ${v.name}`);
}

// --- comparison sheets ------------------------------------------------------
// A DETAIL, not the whole screen. The first sheet showed five full pages side
// by side, each 256 px wide - and a corner radius of 2 px against 0 is
// invisible at that size. So each shot gets cropped to the top bar plus the
// first poll card and shown at native resolution, one under the other.
const AUSSCHNITT = {
  'a-anmelden':   { oben: 250, hoch: 470, links: 320, breit: 560 },
  'b-abstimmung': { oben: 0,   hoch: 620, links: 0,   breit: 1300 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of [['a-anmelden', 'Anmeldung'], ['b-abstimmung', 'Abstimmung']]) {
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
    /* The shots are deviceScaleFactor 2, so the crop is in half pixels. */
    .fenster img { position: absolute; width: 1180px;
                   left: ${-c.links}px; top: ${-c.oben}px; }
  </style>${reihen}`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `vergleich-${teil}.png`), fullPage: true });
  await p.close();
  console.log(`  vergleich-${teil}.png   ${titel}`);
}
await sheet.close();

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
