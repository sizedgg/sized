/**
 * The finished light palette, rendered from the REAL stylesheet.
 *
 * Every preview before this one injected its palette over the page with
 * addStyleTag, because the point was to decide. That is over: the values now
 * live in public/styles.css, and a preview that still injected them would be
 * showing a simulation of a decision already made - and would keep looking
 * right if the file were wrong.
 *
 * So this one adds nothing. It opens the page and photographs it.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (once)
 *   node scripts/vorschau-papier-echt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'papier-echt');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
const GESPRAECH = 'xKGwnf2uA3U1W5JZQjryzqCM8PcoSFaZpFg5YTpRkTQP';

// The mock-pay button and the preview banner are dev scaffolding, not part of
// the design being looked at. Nothing else is touched.
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

async function tokenFuer(wallet) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
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
  const jwt = await page.evaluate(() => localStorage.getItem('ansem_jwt'));
  await ctx.close();
  return jwt;
}

// --- 1. the login, signed out ----------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '1-anmeldung.png') });
  await ctx.close();
}

const JWT = await tokenFuer(ADMIN);

async function angemeldet(h = 900) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  page.on('load', () => page.addStyleTag({ content: HIDE }).catch(() => {}));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForSelector('.poll', { timeout: 25_000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

// --- 2. the polls, open ------------------------------------------------------
{
  const { ctx, page } = await angemeldet(980);
  await page.screenshot({ path: path.join(OUT, '2-polls.png') });

  // --- 3. and the one that is over -----------------------------------------
  const zu = await page.evaluate(() => {
    let n = 0;
    for (const k of document.querySelectorAll('.poll')) {
      if (k.querySelector('.closed-tag')) { n += 1; } else { k.hidden = true; }
    }
    return n;
  });
  if (!zu) throw new Error('Keine geschlossene Poll in der Liste - Datenbank neu befuellen?');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '3-poll-zu.png'), clip: { x: 0, y: 0, width: 1180, height: 560 } });
  await ctx.close();
}

// --- 4./5. the DMs -----------------------------------------------------------
{
  const { ctx, page } = await angemeldet(900);
  await page.click('.tab[data-tab="dms"]');
  await page.waitForSelector('.thread', { timeout: 25_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '4-posteingang.png') });

  await page.click(`.thread[data-wallet="${GESPRAECH}"]`);
  await page.waitForSelector('.dm-row', { timeout: 25_000 });
  await page.waitForTimeout(900);
  const eigene = await page.evaluate(() => document.querySelectorAll('.dm-row.mine').length);
  if (!eigene) throw new Error('Kein eigener Beitrag im Gespraech - anderes waehlen');
  await page.screenshot({ path: path.join(OUT, '5-gespraech.png') });
  console.log(`  Gespraech mit ${eigene} eigenen Nachrichten`);
  await ctx.close();
}

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
