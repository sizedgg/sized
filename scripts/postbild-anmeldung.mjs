/**
 * The image of the payment screen, for a post.
 *
 * Why re-rendered and not a cropped screenshot: a crop can only take
 * away. There were 60 pixels of air at the top, 18 at the bottom - the
 * only way to make those equal is to cut off the top and push the card
 * against the edge. Re-rendered, the margin is correct from the start,
 * at double resolution, and the size is freely choosable.
 *
 * The values in the image are the ones from the real screen; they're set
 * here because the local stack rolls its own amounts. The stylesheet,
 * the font, and the measurements are the page's own - none of it is
 * rebuilt.
 *
 *   node scripts/postbild-anmeldung.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUS = path.join(root, 'post');
fs.mkdirSync(AUS, { recursive: true });

const AMOUNT = process.env.AMOUNT || '0.002437 SOL';
const TREASURY = process.env.TREASURY || 'MASi45ub7Qe4ZE36UT5G6cU4ud8Fhhe4deS4F3cw9KTA';
const REST = process.env.REST || '· 21m left';
const MARGIN = Number(process.env.MARGIN || 90);   // equal margin all around

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: Number(process.env.DICHTE || 3) });
const page = await ctx.newPage();

await page.goto('http://localhost:4000', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '#btn-mock-pay,#toast,.foot-note{display:none!important}' });
await page.fill('#wallet-input', '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j');
await page.click('#btn-challenge');
await page.waitForSelector('#step-pay:not([hidden])');
await page.waitForTimeout(400);

await page.evaluate(({ amount, treasury, rest }) => {
  document.querySelector('#pay-amount').textContent = amount;
  document.querySelector('#pay-treasury').textContent = treasury;
  document.querySelector('#pay-timer').textContent = rest;
}, { amount: AMOUNT, treasury: TREASURY, rest: REST });
await page.waitForTimeout(200);

// The visible card - there are three .login-card elements in the markup
// (noscript, "not yet", login), and querySelector would grab the first
// one. That was already the trap once during measuring: an invisible
// card measures 0 by 0.
const box = await page.evaluate(() => {
  const k = [...document.querySelectorAll('.login-card')]
    .filter((e) => e.getBoundingClientRect().height > 0)[0];
  const r = k.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});

const file = path.join(AUS, process.env.DATEI || 'anmeldung.png');
await page.screenshot({
  path: file,
  clip: {
    x: Math.round(box.x - MARGIN),
    y: Math.round(box.y - MARGIN),
    width: Math.round(box.width + 2 * MARGIN),
    height: Math.round(box.height + 2 * MARGIN),
  },
});

await browser.close();
const { width, height } = await (async () => {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
})();
console.log(`\n  ${path.relative(root, file)}  ${width}x${height}  Rand ringsum ${MARGIN} (x2)\n`);
