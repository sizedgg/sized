/**
 * Five monospace candidates on the real page.
 *
 * Simulation only - public/styles.css is untouched. The fonts are loaded at
 * render time as @font-face and --mono is overridden.
 *
 * ONE THING TO KNOW BEFORE LOOKING: the "current" column is not honest about
 * the letterforms. The page runs on ui-monospace, which resolves to SF Mono
 * on a Mac and an iPhone - and SF Mono is not licensed for redistribution,
 * so it does not exist in this container. That column therefore shows
 * whatever the container falls back to. The five candidates are exact: those
 * are real font files, the same ones that would ship. To judge the current
 * one, look at the site in your own browser.
 *
 * The fonts do not live in the repo. Fetch them into a directory and point
 * this script at it:
 *
 *   mkdir -p /tmp/fonts && cd /tmp/fonts
 *   npm pack @fontsource/jetbrains-mono @fontsource/ibm-plex-mono \
 *            @fontsource/space-mono @fontsource/geist-mono @fontsource/fira-mono
 *   for f in *.tgz; do tar xzf "$f"; done   # files land in package/files/
 *
 *   SCHRIFTEN=/tmp/fonts/out node scripts/vorschau-schriften.mjs
 *
 * All five are under the SIL Open Font License: they may be shipped with the
 * page. That matters - the page's CSP allows font-src 'self' only, so a
 * font has to be a file in the repo, not a link to Google.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'schriften');
fs.mkdirSync(OUT, { recursive: true });
const SCHRIFTEN = process.env.SCHRIFTEN || '/tmp/fonts/out';
const BASE = 'http://localhost:4000';

const KANDIDATEN = [
  {
    key: '0-jetzt', name: 'Jetzt (ui-monospace)', datei: null,
    note: 'Auf dem Mac SF Mono, auf Android Roboto Mono, auf Windows Consolas - drei verschiedene Schriften. Kostet keine Datei und kein Byte.',
  },
  {
    key: '1-jetbrains', name: 'JetBrains Mono', datei: 'jetbrains-mono',
    note: 'Grosse x-Hoehe, weite Buchstaben. Die lesbarste der fuenf auf kleinen Groessen - und die groesste Datei.',
  },
  {
    key: '2-ibm-plex', name: 'IBM Plex Mono', datei: 'ibm-plex-mono',
    note: 'Etwas serifenbetont, redaktionell. Wirkt weniger nach Terminal und mehr nach gedrucktem Bericht.',
  },
  {
    key: '3-geist', name: 'Geist Mono', datei: 'geist-mono',
    note: 'Neutral und eng. Am naechsten an dem, was du jetzt hast - und mit Abstand die kleinste Datei.',
  },
  {
    key: '4-space', name: 'Space Mono', datei: 'space-mono',
    note: 'Eigenwillig, mit Charakter. Als Ueberschrift stark, in einer Spalte aus zwanzig Betraegen anstrengend.',
  },
  {
    key: '5-fira', name: 'Fira Mono', datei: 'fira-mono',
    note: 'Der Klassiker aus dem Firefox-Umfeld. Warm, rund, ohne Eigenheiten.',
  },
];

// --- the font files, served locally ----------------------------------------
const server = http.createServer((q, res) => {
  const name = path.basename(decodeURIComponent(q.url));
  const file = path.join(SCHRIFTEN, name);
  if (!fs.existsSync(file)) return res.writeHead(404).end('');
  res.writeHead(200, { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const FONTPORT = server.address().port;

/** @font-face for one family plus the --mono override. */
function schriftCss(datei) {
  if (!datei) return '';
  const gewichte = [400, 500, 700].filter((g) =>
    fs.existsSync(path.join(SCHRIFTEN, `${datei}-${g}.woff2`)));
  if (!gewichte.length) throw new Error(`Keine Dateien fuer ${datei} in ${SCHRIFTEN}`);
  const faces = gewichte.map((g) => `
    @font-face {
      font-family: 'Probe';
      src: url('http://127.0.0.1:${FONTPORT}/${datei}-${g}.woff2') format('woff2');
      font-weight: ${g}; font-style: normal; font-display: block;
    }`).join('');
  // The page also asks for 650. With static files that lands on the 700 cut,
  // which is what would happen in production too - so the preview shows the
  // real thing, not a nicer one.
  return `${faces}\n:root { --mono: 'Probe', monospace !important; }`;
}

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

for (const k of KANDIDATEN) {
  const style = `${HIDE} ${schriftCss(k.datei)}`;
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2,
  });

  // --- the poll list: the font doing its actual job ---
  const b = await ctx.newPage();
  await b.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  b.on('load', () => b.addStyleTag({ content: style }).catch(() => {}));
  await b.goto(`${BASE}/?demo=14`, { waitUntil: 'networkidle' });
  await b.addStyleTag({ content: style });
  await b.waitForSelector('.opt', { timeout: 20_000 });
  await b.evaluate(() => document.fonts.ready);
  await b.waitForTimeout(500);
  await b.screenshot({ path: path.join(OUT, `${k.key}-liste.png`) });
  await b.close();

  // --- the specimen: what this page is actually made of ---
  // Not "the quick brown fox". Everything here is a real string from the
  // page: an amount, the exact SOL figure from the payment screen, a wallet
  // address, a question. Those are the four shapes that have to work, and
  // the digits matter more than the letters.
  const s = await ctx.newPage();
  await s.goto(`${BASE}/?demo=1`, { waitUntil: 'networkidle' });
  await s.addStyleTag({ content: style });
  await s.setContent(`<!doctype html><meta charset="utf-8">
    <style>${schriftCss(k.datei)}
      body { margin: 0; background: #0a0b0f; color: #e7e9ee;
             font-family: var(--mono, monospace); padding: 26px 30px; }
      .z { margin: 0 0 14px; }
      .frage { font-size: 15px; font-weight: 500; }
      .betrag { font-size: 15px; font-weight: 650; letter-spacing: 0; }
      .gross { font-size: 1.35rem; font-weight: 700; color: #b9c0d0; }
      .adresse { font-size: 13px; color: #8b93a7; }
      .klein { font-size: .72rem; letter-spacing: .08em; color: #5d657a; }
      .spalte { display: grid; grid-template-columns: max-content; gap: 2px;
                font-size: 15px; font-weight: 650; text-align: right; }
    </style>
    <p class="z klein">AMOUNT</p>
    <p class="z gross">0.001096869 SOL</p>
    <p class="z frage">What should the next stream focus on?</p>
    <p class="z adresse">ChrLeUkqhY149aRNK6FS5P6539GSwp3r6sRtx3Ye5Qp9</p>
    <div class="spalte">
      <span>$1,640,000</span><span>$823,909</span><span>$1,110,512</span>
      <span>$63,000</span><span>$912</span><span>&lt;$1</span>
    </div>
    <p class="z betrag" style="margin-top:14px">0 O o 1 l I 5 S 8 B , . : ; — -</p>`);
  await s.evaluate(() => document.fonts.ready);
  await s.waitForTimeout(400);
  await s.screenshot({ path: path.join(OUT, `${k.key}-muster.png`) });
  await s.close();

  await ctx.close();
  const bytes = k.datei
    ? [400, 500, 700]
      .map((g) => path.join(SCHRIFTEN, `${k.datei}-${g}.woff2`))
      .filter((f) => fs.existsSync(f))
      .reduce((n, f) => n + fs.statSync(f).size, 0)
    : 0;
  console.log(`  ${k.key.padEnd(13)} ${k.name.padEnd(22)} ${bytes ? `${Math.round(bytes / 1024)} KB` : 'keine Datei'}`);
}

// --- comparison sheets ------------------------------------------------------
const AUSSCHNITT = {
  muster: { oben: 0, hoch: 430, links: 0, breit: 700 },
  liste:  { oben: 0, hoch: 360, links: 0, breit: 1180 },
};
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
for (const [teil, titel] of [['muster', 'Schriftmuster'], ['liste', 'Abstimmungsliste']]) {
  const c = AUSSCHNITT[teil];
  const p = await sheet.newPage();
  const reihen = KANDIDATEN.map((k) => {
    const b64 = fs.readFileSync(path.join(OUT, `${k.key}-${teil}.png`)).toString('base64');
    return `<figure>
      <figcaption>${k.key.replace(/^(\d)-/, '$1 — ')}  ·  ${k.name}</figcaption>
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
server.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
