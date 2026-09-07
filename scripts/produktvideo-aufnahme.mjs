// ============================================================================
// Records the raw clips for the product video
//
// Three separate recordings instead of one long one: login, poll, inbox. A
// single take would be "more genuine", but every slip - a misclick, a
// reply that takes a second longer - would force the whole thing to be
// redone. Three clips can be re-recorded individually, and the cut needs
// the boundaries anyway.
//
// Recorded against the local stack (scripts/dev-stack.mjs), not against
// sized.gg: the real site has neither polls nor conversations, and an
// on-chain payment takes too long for the video. The inbox comes from demo
// mode - invented conversations, labeled as such in the finished video.
//
// ----------------------------------------------------------------------------
// BEFORE: delete the own vote
//
//   psql "$PGURL_DEV" -c "delete from public.votes where wallet =
//     '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j'"
//
// Otherwise the checkmark is already there before the click. On the first
// take this goes unnoticed, but from the second one on the poll clip
// shows a selection that doesn't change on click - a recording of nothing
// happening.
//
//   node scripts/produktvideo-aufnahme.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUS = path.join(root, 'video-roh');
const BASIS = process.env.BASIS || 'http://localhost:4000';
// Recorded at full resolution, what gets scaled up is the PAGE.
//
// The first attempt recorded at 960x540 and tried to output at 1920x1080.
// Playwright does not scale for that though, it places the small image
// gray-framed in the corner - discovered after the first cut looked odd.
//
// The reason for the detour remains valid: the page has a fixed max width
// and does not grow with the window, at real 1920 pixels it sticks to the
// top third. The lever is just enlarging the PAGE (zoom), not a smaller
// window - that way the image is born at 1920x1080 from the start and
// never needs to be scaled up anywhere.
const WIDTH = 1920;
const HEIGHT = 1080;
const ZOOM_TIGHT = 2;      // login and voting: one column
// The inbox stays at 1. Zooming it in would make the two-column view no
// longer fit the height: the list would run out of frame at the bottom
// and the conversation's input field would disappear. It fills the frame
// anyway, since unlike the other two it uses the full width.
const ZOOM_WIDE = 1;

// Two things that only exist in the local stack and would be a lie in the
// video:
//
//   #btn-mock-pay  "Simulate payment (mock mode)" - on sized.gg there is
//                  no button that fakes a payment.
//   the notice     "Live updates unavailable" - the local stack has no
//                  realtime, the real site does.
//
// Both are hidden rather than worked around: whoever watches the video
// should see the site as it really exists.
const onlyLocalConceal = (zoom) => `
  :root { zoom: ${zoom}; }
  #btn-mock-pay { display: none !important; }
  #toast { display: none !important; }
`;

// The address typed in the video. Looks real but belongs to nobody -
// base58, 44 characters.
const NUTZER = '7xKXtg2CW3xY4mDqRhBnPk9vLcJ5uEaZs6TfWnQhMr2j';
const ANSEM  = 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52';

fs.rmSync(AUS, { recursive: true, force: true });
fs.mkdirSync(AUS, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The inbox needs more width than the other two: it is two-column, list
// on the left, conversation on the right. At 960 pixels the amounts get
// squeezed against the edge.
async function clip(name, fn, zoom = ZOOM_TIGHT) {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: AUS, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await ctx.newPage();
  const stil = onlyLocalConceal(zoom);
  // Fresh on every page load: addStyleTag hangs off the document, and
  // that is a different one after a goto.
  page.on('load', () => page.addStyleTag({ content: stil }).catch(() => {}));
  await page.addStyleTag({ content: stil }).catch(() => {});
  try {
    await fn(page, ctx);
  } finally {
    const video = page.video();
    await ctx.close();                       // only after this is the file finished
    const roh = await video.path();
    const ziel = path.join(AUS, `${name}.webm`);
    fs.renameSync(roh, ziel);
    const kb = Math.round(fs.statSync(ziel).size / 1024);
    console.log(`  ${name}.webm  ${kb} KB`);
  }
}

/** Types character by character, so it looks like typing in the video. */
const type = async (page, sel, text, ms = 45) => {
  await page.click(sel);
  await page.type(sel, text, { delay: ms });
};

/** Gets the JWT from a completed login, for the following clips. */
async function meldeAn(page, wallet) {
  await page.goto(BASIS, { waitUntil: 'networkidle' });
  await page.fill('#wallet-input', wallet);
  await page.click('#btn-challenge');
  await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  const id = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('ansem_challenge') || 'null');
    return c?.challengeId ?? null;
  });
  await page.evaluate(async (challengeId) => {
    await fetch('/functions/v1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId }),
    });
  }, id);
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  return page.evaluate(() => localStorage.getItem('ansem_jwt'));
}

// ---------------------------------------------------------------------------
// 1. Logging in without a wallet
// ---------------------------------------------------------------------------
console.log('\nAufnahme:');

let jwt = null;

await clip('1-anmelden', async (page) => {
  await page.goto(BASIS, { waitUntil: 'networkidle' });
  await sleep(1200);

  await type(page, '#wallet-input', NUTZER, 38);
  await sleep(700);
  await page.click('#btn-challenge');

  // The amount appears. Hold here - this is the shot it's all about: a
  // number and an address, no wallet popup, no signature.
  await page.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
  await sleep(2600);

  const id = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);

  // Let the clock run - this part gets sped up in the cut.
  await sleep(3000);

  await page.evaluate(async (challengeId) => {
    await fetch('/functions/v1/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mock-pay', challengeId }),
    });
  }, id);

  // You're in once #app becomes visible - not once #step-pay disappears.
  // That was the first attempt, and it ran into a timing bug: on login the
  // whole login screen gets hidden, #step-pay stays underneath exactly as
  // it was. So the condition never became true, even though login had
  // long since gone through (the challenge sat in the database as "used").
  await page.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
  await sleep(2200);
  jwt = await page.evaluate(() => localStorage.getItem('ansem_jwt'));
});

// ---------------------------------------------------------------------------
// 2. Voting
// ---------------------------------------------------------------------------
await clip('2-abstimmen', async (page, ctx) => {
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ }
  }, jwt);
  await page.goto(BASIS, { waitUntil: 'networkidle' });
  await page.waitForSelector('.opt', { timeout: 20_000 });
  await sleep(1800);

  // Point at the option, wait briefly, then select. The cursor makes it
  // visible that someone is acting here and the page isn't just running by itself.
  const ziel = page.locator('.opt').nth(2);
  await ziel.hover();
  await sleep(800);
  await ziel.click();
  await sleep(3000);

  // Hover over the bars once: two numbers per option, votes and $.
  await page.locator('.opt').nth(0).hover();
  await sleep(900);
  await page.locator('.opt').nth(3).hover();
  await sleep(1400);
});

// ---------------------------------------------------------------------------
// 3. Ansem's inbox (demo data)
// ---------------------------------------------------------------------------
await clip('3-posteingang', async (page) => {
  await meldeAn(page, ANSEM);
  await page.goto(`${BASIS}/?demo=60`, { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="dms"]');
  await sleep(2000);

  // The inbox is sorted by holdings, largest first. Scroll slowly so the
  // order can be seen.
  await page.mouse.move(WIDTH * 0.25, HEIGHT * 0.6);
  for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, 120); await sleep(260); }
  await sleep(700);
  for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, -120); await sleep(200); }
  await sleep(600);

  const thread = page.locator('.thread').first();
  if (await thread.count()) {
    await thread.hover();
    await sleep(600);
    await thread.click();
    await sleep(2600);
  }
}, ZOOM_WIDE);

await browser.close();
console.log(`\nRohclips in ${path.relative(root, AUS)}/\n`);
