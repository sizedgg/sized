/**
 * Style variants for SIZED, held against the gage.cash look.
 *
 * Renders the real login screen and the real poll list under different
 * palettes - as CSS laid on top, not as changes to styles.css. Nothing here
 * touches the page; it produces images to choose from.
 *
 * What is being taken from gage, and what is deliberately not:
 *
 *   taken     the warm paper ground, one single accent used sparingly, mono
 *             micro-labels in caps, hairline rules instead of boxes, numbers
 *             set large and given room
 *   not taken the bracket wordmark, the licensed grotesk, the exact ochre.
 *             That is their brand. A page that copies it does not look
 *             confident, it looks derivative.
 *
 * On the second typeface: gage sets headlines in a licensed grotesk. SIZED
 * ships no font files at all, and its CSP allows font-src 'self' only - so a
 * bought face would mean a file, a CSP line and an extra download on the
 * first visit. system-ui costs none of that and resolves to SF Pro on Mac and
 * iPhone, which is a near relative of what gage uses. In this container it
 * falls back to something else, so the preview shows the structure, not the
 * final letterforms.
 *
 *   node scripts/vorschau-stil-varianten.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'stil');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';

// Stand-in for system-ui in this container. FreeSans is a Helvetica clone and
// therefore the closest thing here to what a Mac would actually show.
const GROTESK = '"FreeSans", "Helvetica", system-ui, sans-serif';

const VARIANTS = [
  {
    key: '1-papier-mono',
    name: 'Papier, eine Schrift',
    note: 'Heller Grund, Ocker als einziger Akzent. Alles bleibt Mono - kein zweiter Schriftschnitt, kein zusaetzlicher Aufwand bei den Abstimmungsbildern.',
    css: `
      :root {
        --bg: #f4f0e8; --bg-1: #fbf9f4; --bg-2: #efeae0; --bg-3: #e7e1d5;
        --line: #ddd6c8; --text: #14150f; --dim: #6b6759; --dimmer: #97927f;
        --accent: #b3762a; --accent-rgb: 179, 118, 42; --accent-fill: #b3762a;
        --worth: #2e2b22;
      }
      body { background: var(--bg); }
      .btn-primary { color: #fbf9f4 !important; }
      /* Not only :root: several colours sit hardcoded in styles.css and do
         not follow a token. Found while measuring - the first attempt only
         swapped the ground and the login card stayed dark. */
      .login-card { background: #fbf9f4 !important; box-shadow: 0 1px 3px rgba(20,21,15,.06) !important; }
      .pane, .poll-card, .thread-list, .dm-user { box-shadow: none !important; }
      /* The four name tones are tuned for a dark ground. On paper they need
         to go darker and more saturated, or the handles turn to mush. */
      .h.t0 { color: #2f6ea8 !important; }
      .h.t1 { color: #6b52a8 !important; }
      .h.t2 { color: #a83f5f !important; }
      .h.t3 { color: #8a6413 !important; }
      .thread.is-unread { background: rgba(47, 110, 168, .10) !important; }
      .msg.dm.mine { background: #2f6ea8 !important; color: #fbf9f4 !important; }
      .msg.dm.mine .time { color: rgba(255,255,255,.75) !important; }
      .toast { box-shadow: 0 8px 30px rgba(20,21,15,.18) !important; }
      /* Two more surfaces that do not follow a token: the top bar carries its
         own rgba, and the filled part of an answer bar comes from --fuellung.
         Both were still dark after the ground had turned to paper. */
      .topbar { background: rgba(251, 249, 244, .92) !important; }
      :root { --fuellung: rgba(179, 118, 42, .18) !important; }
      .opt-bar { background: #efeae0 !important; }

    `,
  },
  {
    key: '2-papier-grotesk',
    name: 'Papier, zwei Schriften',
    note: 'Wie 1, aber Ueberschriften und Betraege in system-ui (auf dem Mac SF Pro). Mono bleibt fuer Kleinschrift, Adressen und Zahlenspalten - genau die Aufteilung, die bei gage traegt.',
    css: `
      :root {
        --bg: #f4f0e8; --bg-1: #fbf9f4; --bg-2: #efeae0; --bg-3: #e7e1d5;
        --line: #ddd6c8; --text: #14150f; --dim: #6b6759; --dimmer: #97927f;
        --accent: #b3762a; --accent-rgb: 179, 118, 42; --accent-fill: #b3762a;
        --worth: #2e2b22;
      }
      body { background: var(--bg); }
      .brand, .lede, .btn, h1, h2, h3, h4, .poll-card h4, .opt-label,
      .thread-title, .pay-value.big {
        font-family: ${GROTESK};
        letter-spacing: -.015em;
      }
      .pay-value.big { font-weight: 700; font-size: 2.1rem; }
      .poll-card h4 { font-weight: 700; letter-spacing: -.02em; }
      .pay-label, .copy-hint, .dim, .tab, code, .mono-sm { font-family: var(--mono); }
      .btn-primary { color: #fbf9f4 !important; }
      /* Not only :root: several colours sit hardcoded in styles.css and do
         not follow a token. Found while measuring - the first attempt only
         swapped the ground and the login card stayed dark. */
      .login-card { background: #fbf9f4 !important; box-shadow: 0 1px 3px rgba(20,21,15,.06) !important; }
      .pane, .poll-card, .thread-list, .dm-user { box-shadow: none !important; }
      /* The four name tones are tuned for a dark ground. On paper they need
         to go darker and more saturated, or the handles turn to mush. */
      .h.t0 { color: #2f6ea8 !important; }
      .h.t1 { color: #6b52a8 !important; }
      .h.t2 { color: #a83f5f !important; }
      .h.t3 { color: #8a6413 !important; }
      .thread.is-unread { background: rgba(47, 110, 168, .10) !important; }
      .msg.dm.mine { background: #2f6ea8 !important; color: #fbf9f4 !important; }
      .msg.dm.mine .time { color: rgba(255,255,255,.75) !important; }
      .toast { box-shadow: 0 8px 30px rgba(20,21,15,.18) !important; }
      /* Two more surfaces that do not follow a token: the top bar carries its
         own rgba, and the filled part of an answer bar comes from --fuellung.
         Both were still dark after the ground had turned to paper. */
      .topbar { background: rgba(251, 249, 244, .92) !important; }
      :root { --fuellung: rgba(179, 118, 42, .18) !important; }
      .opt-bar { background: #efeae0 !important; }

    `,
  },
  {
    key: '3-dunkel-warm',
    name: 'Dunkel, aber warm',
    note: 'Bleibt dunkel - nur nicht mehr blaustichig. Ocker als Akzent statt Knochenweiss. Der kleinste Eingriff: Abstimmungsbilder, DM-Blasen und die vier Namensfarben bleiben, wie sie sind.',
    css: `
      :root {
        --bg: #100e0b; --bg-1: #17150f; --bg-2: #1f1c15; --bg-3: #2a251b;
        --line: #332d22; --text: #efe9dc; --dim: #a09781; --dimmer: #6f6857;
        --accent: #d2913c; --accent-rgb: 210, 145, 60; --accent-fill: #c98a37;
        --worth: #cfc4ab;
      }
      body { background: var(--bg); }
      .btn-primary { color: #100e0b !important; }
      .login-card { background: rgba(23, 21, 15, .86) !important; }
      .h.t3 { color: #d9b872 !important; }
    `,
  },
];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

/** Signs in via the mock chain and hands back the token. */
async function signIn(page, wallet) {
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

const USER = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';
const HIDE = '#btn-mock-pay,#toast{display:none!important}';

// One sign-in for all variants - the token is reused, so the poll screen does
// not have to be reached three times over.
const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p0 = await ctx0.newPage();
const jwt = await signIn(p0, USER);
await ctx0.close();

for (const v of [{ key: '0-jetzt', name: 'Wie es jetzt ist', css: '' }, ...VARIANTS]) {
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2,
  });
  const style = `${HIDE} ${v.css}`;

  // --- Login screen ---
  const a = await ctx.newPage();
  a.on('load', () => a.addStyleTag({ content: style }).catch(() => {}));
  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.addStyleTag({ content: style });
  await a.fill('#wallet-input', USER);
  await a.click('#btn-challenge');
  await a.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await a.waitForTimeout(500);
  await a.screenshot({ path: path.join(OUT, `${v.key}-a-anmelden.png`) });
  await a.close();

  // --- Poll list ---
  const b = await ctx.newPage();
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, jwt);
  b.on('load', () => b.addStyleTag({ content: style }).catch(() => {}));
  await b.goto(BASE, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.opt', { timeout: 20_000 });
  await b.waitForTimeout(600);
  await b.screenshot({ path: path.join(OUT, `${v.key}-b-abstimmung.png`) });
  await b.close();

  await ctx.close();
  console.log(`  ${v.key.padEnd(18)} ${v.name}`);
}

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
