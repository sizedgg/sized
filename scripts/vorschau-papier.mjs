/**
 * Variant 1 ("paper, one font") on every screen - as a simulation.
 *
 * Nothing here changes the page. The palette is laid on top as CSS at
 * render time, exactly like scripts/vorschau-stil-varianten.mjs did for the
 * four drafts. public/styles.css is untouched.
 *
 * What is new compared with that script: this one goes through ALL the
 * screens, not just two - inbox, an open conversation, and the image that
 * gets posted to X. Those are the places where a light ground actually
 * costs something, and a decision made on the login screen alone would be
 * made blind.
 *
 * Why the override is this long: styles.css keeps roughly a dozen colours
 * outside :root, hardcoded in the rule that uses them - the login card, the
 * top bar, the four name tones, the unread row, your own DM bubble, the
 * shadows. They do not follow the palette, so a preview has to name every
 * one of them by hand. If the change is made for real, those become tokens
 * first and this block shrinks to the :root part.
 *
 *   node scripts/vorschau-papier.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'papier');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

const TOKENS = `
  --bg: #f4f0e8; --bg-1: #fbf9f4; --bg-2: #efeae0; --bg-3: #e5dfd1;
  --line: #d9d1c1; --text: #16170f; --dim: #625e50; --dimmer: #8a8574;
  /* Ochre is the ONLY accent. It is Ansem's colour and the button's at the
     same time - on the dark page those were bone white, and bone white on
     paper is nothing at all. */
  --accent: #a1671c; --accent-rgb: 161, 103, 28; --accent-fill: #b3762a;
  --worth: #3a3627; --fokus: #625e50;
  /* The answer bars turn round: on black the fill was brighter than the
     ground, on paper it has to be darker, or the bar disappears. And the
     leading answer is no longer blue but a light ochre - the accent, in the
     one place where text has to sit on top of it. */
  --fuellung: #e7e0d0; --fuellung-spitze: #f0ddb8;
  --ungelesen: #2f6ea8;
  --warn: #b3261e; --gold: #8a5a12;
  /* The glow in the corner of the X image. Violet on paper looks like a
     printing error; it becomes the accent, and much weaker. */
  --accent-2: #b3762a; --accent-2-rgb: 179, 118, 42;
`;

// Everything styles.css keeps outside :root. See the note at the top.
const AUSSERHALB = `
  html, body { background: var(--bg); }
  .login-card { background: rgba(251, 249, 244, .86) !important;
                box-shadow: 0 1px 3px rgba(60, 52, 36, .07) !important; }
  .topbar { background: rgba(244, 240, 232, .88) !important; }
  .pay-row.is-copied { border-color: rgba(22, 23, 15, .45) !important; }
  .reply-btn:hover { background: rgba(22, 23, 15, .06) !important; }
  /* The four people tones, re-tuned. Blue, violet and rose only go darker;
     the fourth was sand, and sand next to an ochre accent is the same
     colour twice. It becomes green - the only free direction left. */
  .h.t0 { color: #2f6ea8 !important; }
  .h.t1 { color: #6b4fa8 !important; }
  .h.t2 { color: #a83f5f !important; }
  .h.t3 { color: #3f7a52 !important; }
  .thread.is-unread { background: rgba(47, 110, 168, .10) !important; }
  /* Your own bubble parts ways with the leading answer bar here. On black
     both wanted the same blue; on paper the bar has to stay light because
     text sits on it, while the bubble should read as a solid block. One
     value cannot do both anymore. */
  .msg.dm.mine { background: #b3762a !important; color: #fbf9f4 !important; }
  .msg.dm.mine .time { color: rgba(255, 255, 255, .80) !important; }
  .msg.dm.mine .body a, .msg.dm.mine .body a:hover { color: #fbf9f4 !important; }
  .toast { box-shadow: 0 6px 24px rgba(60, 52, 36, .16) !important; }
  .toast.err { color: #7a1a15 !important; }
  .tip, .lz-liste { box-shadow: 0 10px 24px rgba(60, 52, 36, .14) !important; }
  .btn-primary { color: var(--bg) !important; }
  .btn.laedt::after { border-color: var(--bg) !important; border-top-color: transparent !important; }
`;

const PAPIER = `:root { ${TOKENS} }\n${AUSSERHALB}`;
const HIDE = '#btn-mock-pay,#toast{display:none!important}';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

const WALLET = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';

/**
 * Signs in through the mock chain and hands back the token.
 *
 * Needed even for demo mode: ?demo= fills the LISTS client-side, it does not
 * replace the login. Without a token the app stays on the payment screen and
 * the poll list never appears - which is exactly how the first run of this
 * script failed.
 */
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

// One sign-in for both passes - the token is reused.
const vorlauf = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const vp = await vorlauf.newPage();
const JWT = await anmelden(vp);
await vorlauf.close();

/** One pass over the app: login, polls, inbox, an open conversation. */
async function screens(key, css) {
  const style = `${HIDE} ${css}`;
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2,
  });
  const anziehen = (p) => {
    p.on('load', () => p.addStyleTag({ content: style }).catch(() => {}));
    return p;
  };
  const schuss = (p, name) => p.screenshot({ path: path.join(OUT, `${key}-${name}.png`) });

  // --- 1. Login, waiting for the payment ---
  const a = anziehen(await ctx.newPage());
  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.addStyleTag({ content: style });
  await a.fill('#wallet-input', WALLET);
  await a.click('#btn-challenge');
  await a.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await a.waitForTimeout(500);
  await schuss(a, '1-anmelden');
  await a.close();

  // --- 2, 3, 4. Demo mode: polls, inbox, one conversation ---
  // ?demo= fills the app client-side without a login and only on localhost -
  // see DEMO_DMS in app.js. That is exactly what is wanted here: real markup,
  // real rules, made-up content.
  const b = anziehen(await ctx.newPage());
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  await b.goto(`${BASE}/?demo=14`, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.opt', { timeout: 20_000 });
  await b.waitForTimeout(600);
  await schuss(b, '2-abstimmung');

  await b.close();

  await ctx.close();
}

// --- 5. The image that goes to X ------------------------------------------
// Drawn by drawPoll() from app.js, cut out literally. It reads its colours
// out of the stylesheet at draw time, so the palette carries into the image
// on its own - which is the point of checking it here.
async function karte(key, css) {
  const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const cut = (von, bis) => {
    const i = appJs.indexOf(von);
    const j = appJs.indexOf(bis, i);
    if (i < 0 || j < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
    return appJs.slice(i, j);
  };
  const zeichner = cut('const cssWert =', 'async function ladePollBild');

  const server = http.createServer((_q, res) =>
    res.writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><meta charset="utf-8"><style>${styles}</style>`
        + `<style>${css}</style><body>`));
  await new Promise((r) => server.listen(0, r));

  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' } };
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const fullUsd = fmtUsd;
      ${zeichner}
      window.zeichne = drawPoll;
    `,
  });
  const daten = {
    id: 1,
    question: 'What should the next stream focus on?',
    options: [
      { id: 1, label: 'Majors only — BTC, SOL, ETH', votes: 812, usd: 1110512 },
      { id: 2, label: 'Alt rotations and new listings', votes: 604, usd: 823909 },
      { id: 3, label: 'On-chain flows and whale tracking', votes: 1190, usd: 1637715 },
      { id: 4, label: 'Open Q&A with holders', votes: 431, usd: 638591 },
    ],
    totalUsd: 1110512 + 823909 + 1637715 + 638591,
    closed: false,
  };
  const dataUrl = await page.evaluate(async (p) => {
    const c = await window.zeichne(p, { fuerKarte: true });
    return c.toDataURL('image/png');
  }, daten);
  fs.writeFileSync(path.join(OUT, `${key}-5-x-karte.png`),
    Buffer.from(dataUrl.split(',')[1], 'base64'));
  await ctx.close();
  server.close();
}

for (const [key, css] of [['jetzt', ''], ['papier', PAPIER]]) {
  await screens(key, css);
  await karte(key, css);
  console.log(`  ${key}`);
}

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
