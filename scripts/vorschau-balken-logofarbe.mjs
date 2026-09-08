/**
 * What the winning bar looks like in the SIZED logo's own colour.
 *
 * Simulation only; public/styles.css is untouched.
 *
 * The mark is --accent-fill, #24598c - a full-strength blue, chosen because
 * a mark is a shape with nothing on top of it. A bar is not that: the answer
 * lies ON it. Measured on the paper palette:
 *
 *   dark label on #24598c      2.51:1     needs 4.5
 *   paper label on #24598c     6.98:1
 *   paper label BESIDE it      1.00:1     where the fill ends, the card starts
 *
 * That last line is the whole problem, and it is not hypothetical: the label
 * starts at the left edge of the row and runs as far as the text is long,
 * while the fill runs as far as the SHARE is. A winner with 54% of the money
 * covers its own label. A winner with 28% does not - and half a word then
 * falls off the blue onto the paper.
 *
 * So this draws two shapes of poll, not one:
 *
 *   a wide winner    the seeded closed poll, 54% - the flattering case
 *   a narrow winner  the same poll with the money spread out, 28% - the case
 *                    that decides whether this can be shipped
 *
 * and four ways of colouring it. Nothing here is argued; it is drawn.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (once)
 *   node scripts/vorschau-balken-logofarbe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'balken-logofarbe');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const TEXT = '#16150f';
const PAPIER = '#fbfaf7';
const KARTE = '#fbfaf7';
const LOGO = '#24598c';

const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const t = c / 255; return t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hx(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const kon = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const VARIANTEN = [
  {
    key: '1-logo-dunkel', name: 'Genau die Logofarbe, Schrift wie jetzt',
    fuellung: LOGO, schrift: null,
    note: `Antwort auf dem Balken ${kon(TEXT, LOGO).toFixed(2)}:1`,
  },
  {
    key: '2-logo-hell', name: 'Genau die Logofarbe, Gewinnerzeile in Papierweiss',
    fuellung: LOGO, schrift: PAPIER,
    note: `auf dem Balken ${kon(PAPIER, LOGO).toFixed(2)}:1, daneben ${kon(PAPIER, KARTE).toFixed(2)}:1`,
  },
  {
    key: '3-aufgehellt', name: 'Derselbe Ton, so weit aufgehellt, dass die Schrift bleibt',
    fuellung: '#5b83a9', schrift: null,
    note: `Antwort auf dem Balken ${kon(TEXT, '#5b83a9').toFixed(2)}:1`,
  },
  {
    key: '4-jetzt', name: 'Wie es jetzt ist',
    fuellung: '#ccdcef', schrift: null,
    note: `Antwort auf dem Balken ${kon(TEXT, '#ccdcef').toFixed(2)}:1`,
  },
];

console.log('\n── Die Antwort liegt auf dem Balken ──\n');
for (const v of VARIANTEN) {
  const auf = v.schrift ?? TEXT;
  const k = kon(auf, v.fuellung);
  console.log(`  ${k >= 4.5 ? '✓' : '✗'} ${v.key.padEnd(15)} ${v.note}`);
}

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p0 = await ctx0.newPage();
await p0.goto(BASE, { waitUntil: 'networkidle' });
await p0.fill('#wallet-input', ADMIN);
await p0.click('#btn-challenge');
await p0.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
const cid = await p0.evaluate(() =>
  JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);
await p0.evaluate(async (c) => {
  await fetch('/functions/v1/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'mock-pay', challengeId: c }),
  });
}, cid);
await p0.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
const JWT = await p0.evaluate(() => localStorage.getItem('ansem_jwt'));
await ctx0.close();

/**
 * Leaves only the closed poll standing, and optionally squeezes the winner
 * down to a narrow share so the label runs off the end of the fill.
 *
 * The width is set on .opt-fill directly rather than by editing the data,
 * because the point here is the PICTURE, not the arithmetic - and a fake
 * share written into state would also change the amounts printed beside it,
 * which would make the shot say something untrue about the numbers.
 */
async function nurGeschlossen(page, schmal) {
  const zu = await page.evaluate((eng) => {
    let n = 0;
    for (const k of document.querySelectorAll('.poll')) {
      if (k.querySelector('.closed-tag')) { n += 1; } else { k.hidden = true; }
    }
    if (eng) {
      const karte = document.querySelector('.poll:not([hidden])');
      const zeile = karte?.querySelector('.opt.leads');
      const fuell = zeile?.querySelector('.opt-fill');
      if (fuell) fuell.style.width = '28%';
      // And give the winner the LONGEST answer this poll actually contains.
      //
      // The first attempt left the label as it was, and the shot proved
      // nothing: 'Keep $ANSEM' is short enough to sit inside even a 28% bar,
      // so all four variants looked equally fine and the question the shot
      // was taken to answer never came up. The label has to be long enough
      // to cross the edge, and it is taken from the poll's own options
      // rather than invented, so this stays a real case.
      const lang = [...karte.querySelectorAll('.opt-label')]
        .map((e) => e.textContent.trim())
        .sort((a, b) => b.length - a.length)[0];
      const ziel = zeile?.querySelector('.opt-label');
      if (ziel && lang) ziel.textContent = lang;
    }
    return n;
  }, schmal);
  if (!zu) throw new Error('Keine geschlossene Poll - Datenbank neu befuellen?');
}

for (const v of VARIANTEN) {
  // Three shapes, and the third is the one that decides. On the desktop even
  // a 28% bar is ~310px wide and the poll's longest answer still fits inside
  // it, so the first two rows look fine in every variant - twice now I have
  // taken a shot meant to show the label crossing the fill edge and shown it
  // not crossing. On a phone a 28% bar is about 100px. That is where a light
  // label on a dark fill either survives or does not, and the app is a PWA:
  // the phone is not the edge case, it is the case.
  for (const [form, schmal, breite] of [
    ['breit', false, 1180], ['schmal', true, 1180], ['handy', true, 390],
  ]) {
    const style = `${HIDE}
      .opt.leads .opt-fill { background: ${v.fuellung} !important; }
      ${v.schrift ? `.opt.leads .opt-label { color: ${v.schrift} !important; }` : ''}`;
    const ctx = await browser.newContext({
      viewport: { width: breite, height: 700 }, deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
    page.on('load', () => page.addStyleTag({ content: style }).catch(() => {}));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: style });
    await page.waitForSelector('.poll', { timeout: 25_000 });
    await nurGeschlossen(page, schmal);
    await page.waitForTimeout(400);
    const kasten = await page.locator('.poll:not([hidden]) .opt').first().boundingBox();
    await page.screenshot({
      path: path.join(OUT, `${v.key}-${form}.png`),
      clip: { x: 8, y: kasten.y - 10, width: breite - 16, height: 116 },
    });
    await ctx.close();
  }
  console.log(`  gezeichnet: ${v.key}`);
}

const sheet = await browser.newContext({ deviceScaleFactor: 1 });
const p = await sheet.newPage();
const reihen = VARIANTEN.map((v) => {
  const bild = (form) =>
    fs.readFileSync(path.join(OUT, `${v.key}-${form}.png`)).toString('base64');
  return `<section>
    <h2>${v.key.replace(/^(\d)-/, '$1 — ')} · ${v.name}</h2>
    <p>${v.note}</p>
    <figure><figcaption>breiter Sieger (54 %)</figcaption>
      <img src="data:image/png;base64,${bild('breit')}"></figure>
    <figure><figcaption>schmaler Sieger (28 %)</figcaption>
      <img src="data:image/png;base64,${bild('schmal')}"></figure>
    <figure><figcaption>dasselbe auf dem Handy (390 px)</figcaption>
      <img class="handy" src="data:image/png;base64,${bild('handy')}"></figure>
  </section>`;
}).join('');
await p.setContent(`<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #101218; width: 1180px; padding-bottom: 10px; }
  section { padding: 4px 0 10px; }
  h2 { font: 600 16px ui-monospace, monospace; color: #e7e9ee;
       margin: 0; padding: 14px 16px 2px; letter-spacing: .02em; }
  p  { font: 400 13px ui-monospace, monospace; color: #8b93a7;
       margin: 0; padding: 0 16px 8px; }
  figure { margin: 0 0 4px; }
  figcaption { font: 400 12px ui-monospace, monospace; color: #5d657a;
               padding: 4px 16px 3px; }
  img { width: 1140px; display: block; margin: 0 20px; }
  img.handy { width: 374px; }
</style>${reihen}`);
await p.waitForTimeout(400);
await p.screenshot({ path: path.join(OUT, 'vergleich.png'), fullPage: true });
await p.close();
await sheet.close();

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
