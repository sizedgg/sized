/**
 * Ansem's side, full: 500 conversations and 3 polls, in one file.
 *
 * The result is a single .html that opens with a double click - no server,
 * no Node, no network. Stylesheet, fonts and profile picture are inlined.
 *
 * What it is: a SNAPSHOT, not the app. The real application renders against
 * the local stack, and the finished DOM is lifted out of the browser in three
 * states - poll list, inbox, one open conversation. So the markup is the real
 * one, down to the last class; what is missing is everything that needs a
 * server: sending, voting, marking as read, live updates.
 *
 * Why not the app itself: it needs Supabase, a login and a service worker.
 * Anyone who wants to click through it for real runs the local stack. Anyone
 * who wants to SEE what an inbox with 500 conversations does gets this file.
 *
 * Fill the database first:
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql
 *   node scripts/vorschau-ansem-voll.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');
const OUT = path.join(root, 'preview', 'ansem-voll.html');
const BASE = 'http://localhost:4000';

// The admin wallet of the LOCAL test database - not Ansem's real one. The
// local stack decides who is admin from app_config, and this is the value
// that sits there.
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// --- sign in ----------------------------------------------------------------
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
await page.waitForSelector('.opt', { timeout: 20_000 });
await page.waitForTimeout(800);

/** The whole application, as it stands right now. */
const abzug = () => page.evaluate(() => {
  // The local stack has no Realtime, so the app puts up "Live updates
  // unavailable" - true here, false on the live site. Baked into the snapshot
  // it would be a message about the preview's plumbing sitting in a picture of
  // the product.
  const toast = document.querySelector('#toast');
  if (toast) toast.hidden = true;

  // What is typed into a field is a PROPERTY, not an attribute - and
  // outerHTML only writes attributes. Without this the threshold field came
  // out of the snapshot showing its placeholder "0", while the list beside it
  // was filtered at $1,000: a picture that contradicted itself, and the kind
  // of thing somebody would have reported as a bug in the page.
  for (const el of document.querySelectorAll('input, textarea')) {
    el.setAttribute('value', el.value);
    if (el.tagName === 'TEXTAREA') el.textContent = el.value;
  }
  for (const el of document.querySelectorAll('input[type=checkbox], input[type=radio]')) {
    el.toggleAttribute('checked', el.checked);
  }

  const app = document.querySelector('.app');
  // The topbar sits inside .app, so one subtree is enough. Buttons stay in
  // the markup: they do nothing here, but removing them would change the
  // layout, and the layout is the thing being looked at.
  return app.outerHTML;
});

const zustaende = [];

// --- 1. the poll list -------------------------------------------------------
zustaende.push({ key: 'polls', name: 'Polls', html: await abzug() });

// --- 2. the inbox -----------------------------------------------------------
await page.click('.tab[data-tab="dms"]');
await page.waitForSelector('.thread', { timeout: 20_000 });
await page.waitForTimeout(1200);
const anzahl = await page.evaluate(() => document.querySelectorAll('.thread').length);
zustaende.push({ key: 'inbox', name: `Posteingang (${anzahl})`, html: await abzug() });

// --- 3. one open conversation ----------------------------------------------
// Not the first row: the first is whatever sorted to the top, and a
// conversation with a single "gm" in it shows nothing. This picks the first
// one that has at least three messages, so the picture has a back and forth
// in it.
const gewaehlt = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.thread')];
  return rows.length ? rows[Math.min(6, rows.length - 1)].dataset.wallet : null;
});
if (gewaehlt) {
  await page.click(`.thread[data-wallet="${gewaehlt}"]`);
  await page.waitForSelector('.dm-row', { timeout: 20_000 });
  await page.waitForTimeout(900);
  zustaende.push({ key: 'thread', name: 'Ein Gespräch', html: await abzug() });
}

await browser.close();

// --- build the file ---------------------------------------------------------
let css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

/** Everything the page fetches becomes a data: URI - the file has no network. */
const daten = (rel, typ) =>
  `data:${typ};base64,${fs.readFileSync(path.join(publicDir, rel)).toString('base64')}`;

css = css.replace(/url\('(fonts\/[^']+\.woff2)'\)/g,
  (_, rel) => `url('${daten(rel, 'font/woff2')}')`);

// The profile picture is not an <img>, it is a background-image in the
// stylesheet - url('ansem.jpg'), relative to the sheet. In a file:// document
// that resolves next to the .html, where the picture is not. It gets inlined
// here rather than patched afterwards by script: a fix that runs at the end
// of the document happens after the browser has already tried and failed.
css = css.replace(/url\('(ansem\.jpg)'\)/g, (_, rel) => `url('${daten(rel, 'image/jpeg')}')`);

const koerper = zustaende.map((z, i) => `
  <div class="abzug" data-key="${z.key}"${i ? ' hidden' : ''}>${z.html}</div>`).join('');

const schalter = zustaende.map((z, i) =>
  `<button data-ziel="${z.key}"${i ? '' : ' class="an"'}>${z.name}</button>`).join('');

const html = `<!doctype html>
<html lang="de">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIZED — Ansems Seite, ${anzahl} Gespräche</title>
<style>
${css}

/* --- everything below belongs to the preview, not to the page ------------ */
.vorschau-leiste {
  position: fixed; top: 0; left: 0; right: 0; z-index: 999;
  display: flex; gap: .4rem; align-items: center;
  padding: .5rem .8rem; background: var(--bg-2);
  border-bottom: 1px solid var(--line); font-size: .8rem;
}
.vorschau-leiste button {
  font: inherit; font-family: var(--mono); cursor: pointer;
  background: transparent; color: var(--dim);
  border: 1px solid var(--line); padding: .3rem .6rem;
}
.vorschau-leiste button.an { color: var(--bg); background: var(--accent-fill); border-color: transparent; }
.vorschau-leiste .hinweis { margin-left: auto; color: var(--dimmer); }
body { padding-top: 42px; }
/* The snapshot brings the page's own full height with it; inside the file it
   has to sit under the bar rather than over it. */
.abzug > .app { height: calc(100dvh - 42px); }
</style>

<div class="vorschau-leiste">
  ${schalter}
  <span class="hinweis">Standbild aus der echten Seite · Demo-Daten · nichts davon ist anklickbar</span>
</div>
${koerper}

<script>
  const zeige = (key) => {
    for (const el of document.querySelectorAll('.abzug')) el.hidden = el.dataset.key !== key;
    for (const b of document.querySelectorAll('.vorschau-leiste button')) {
      b.classList.toggle('an', b.dataset.ziel === key);
    }
  };
  for (const b of document.querySelectorAll('.vorschau-leiste button')) {
    b.addEventListener('click', () => zeige(b.dataset.ziel));
  }
  // Every button in the snapshot is dead. Saying so once beats letting
  // somebody click around wondering why nothing happens.
  for (const el of document.querySelectorAll('.abzug button, .abzug a')) {
    el.addEventListener('click', (e) => { e.preventDefault(); }, true);
  }
</script>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`\n  ${path.relative(root, OUT)}  –  ${(html.length / 1024 / 1024).toFixed(1)} MB, `
  + `${zustaende.length} Zustaende, ${anzahl} Gespraeche\n`);
