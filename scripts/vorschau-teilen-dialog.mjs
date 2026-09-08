/**
 * Der Teilen-Dialog, fotografiert - nicht simuliert.
 *
 * Die Vorfassung dieses Skripts hat den Dialog nachgebaut, weil es ihn noch
 * nicht gab. Jetzt gibt es ihn, und ein Nachbau daneben waere ab sofort die
 * Sorte Bild, die richtig aussieht, waehrend die Seite falsch ist.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (einmal)
 *   node scripts/vorschau-teilen-dialog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'teilen-dialog');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#wallet-input', ADMIN);
await page.click('#btn-challenge');
await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
const cid = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);
await page.evaluate(async (c) => {
  await fetch('/functions/v1/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'mock-pay', challengeId: c }),
  });
}, cid);
await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
await page.addStyleTag({ content: HIDE });
await page.waitForSelector('.poll', { timeout: 25_000 });
await page.waitForTimeout(600);

const zuId = await page.evaluate(() => {
  const k = [...document.querySelectorAll('.poll')].find((x) => x.querySelector('.closed-tag'));
  return k ? k.id : null;
});
if (!zuId) throw new Error('Keine geschlossene Poll - Datenbank neu befuellen?');

await page.click(`#${zuId} .icon-btn.poll-image`);
await page.waitForSelector('#bild-dialog:not([hidden])', { timeout: 25_000 });
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, '1-dialog.png') });
await page.locator('.dialog-karte').screenshot({ path: path.join(OUT, '2-karte.png') });
console.log('  Stempel:', (await page.textContent('#bild-dialog-stempel')).trim());

await ctx.close();
await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
