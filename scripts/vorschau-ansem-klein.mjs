// ============================================================================
// Preview image: "ANSEM" small enough to be exactly as wide as three characters
//
// The column is 26 px wide - that's three monospace characters at 15 px.
// "ANSEM" is five letters. To fit into the same width, it has to be set
// noticeably smaller, and the only question is: how do you do that without
// it becoming unreadable?
//
// Three approaches:
//   * set it smaller (honest, but tiny)
//   * use a narrower typeface (the sans is narrower than the mono)
//   * compress it horizontally (height stays readable, width shrinks)
//
// The script measures every variant in the browser and writes the actual
// width next to it. Nothing here is guessed.
//
// Generates preview/ansem-klein2.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// Second pass. The first one measured: only the mono at 8.5 px and the
// compressed mono fit into the 25.4 px at all. The compressed one was even
// too narrow at 20.5 px - height going to waste there.
//
// So here's the same idea at three sizes, each compressed just enough to
// land EXACTLY on the handle width. The math: natural width at 11 px is
// 33.1 px, so 25.4 / 33.1 = 0.768. At a larger size, correspondingly more
// compression - and at some point you can see it. That's exactly the
// limit this image is meant to show.
const VARIANTEN = [
  {
    nr: 1,
    name: 'Mono 8.5px, ungestaucht',
    hinweis: 'Die ehrliche Variante aus dem ersten Durchgang: einfach klein genug gesetzt, nichts verzerrt. 12,8 px hoch.',
    css: `font-family: var(--mono); font-size: 8.5px; letter-spacing: 0; font-weight: 700;`,
  },
  {
    nr: 2,
    name: 'Mono 11px, gestaucht auf 0.77',
    hinweis: 'Normal gesetzt und leicht zusammengedrueckt. 16,5 px hoch – knapp ein Drittel mehr als bei 1, bei gleicher Breite.',
    css: `font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0;
          display: inline-block; transform: scaleX(.77); transform-origin: left center;`,
  },
  {
    nr: 3,
    name: 'Mono 12px, gestaucht auf 0.70',
    hinweis: 'Noch groesser, dafuer staerker gestaucht. 18 px hoch.',
    css: `font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: 0;
          display: inline-block; transform: scaleX(.70); transform-origin: left center;`,
  },
  {
    nr: 4,
    name: 'Mono 13px, gestaucht auf 0.65',
    hinweis: 'Die Grenze. So hoch wie die Kuerzel daneben, aber die Buchstaben sind sichtbar schmalgezogen.',
    css: `font-family: var(--mono); font-size: 13px; font-weight: 700; letter-spacing: 0;
          display: inline-block; transform: scaleX(.65); transform-origin: left center;`,
  },
  {
    nr: 5,
    name: 'Mono 12px, gestaucht, normal fett',
    hinweis: 'Wie 3, aber ohne Fettung. Beim Stauchen werden fette Buchstaben fast klobig – duennere vertragen es besser.',
    css: `font-family: var(--mono); font-size: 12px; font-weight: 500; letter-spacing: 0;
          display: inline-block; transform: scaleX(.70); transform-origin: left center;`,
  },
  {
    nr: 6,
    name: 'Drei Zeichen (Vergleich)',
    hinweis: 'Ein normales Kuerzel – die Breite, die zur Verfuegung steht, und die Hoehe, die daneben steht.',
    css: `font-family: var(--mono); font-size: .9375rem; font-weight: 700;`,
    text: '4bo',
  },
];

const MESSAGES = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { admin: true, body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '$1.3K', body: 'lfg', zeit: '14:04' },
  { admin: true, body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$5.2K', body: 'ser', zeit: '14:07' },
];

const line = (m, v) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? `<span class="h ansem">${v.text ?? 'ANSEM'}</span>`
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    ${m.admin ? '' : `<span class="worth">${m.usd}</span>`}
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

const card = (v) => `
  <section class="card">
    <style>#v${v.nr} .ansem { color: var(--accent); ${v.css} }</style>
    <h2><span class="nr">${v.nr}</span>${v.name}<span class="mass" id="m${v.nr}"></span></h2>
    <p class="hinweis">${v.hinweis}</p>
    <div class="chat-panel" id="v${v.nr}">
      <div class="chat-list">${MESSAGES.map((m) => line(m, v)).join('')}</div>
    </div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 26px 22px; max-width: 1240px; }
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .mass { font-family: var(--mono); font-size: .72rem; font-weight: 400; color: var(--dimmer); }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 3.6em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 92ch; }
</style>
<h1>„ANSEM" – wie groß geht es?</h1>
<p class="lead">Die Spalte ist 26 px wide. Hinter jeder Überschrift steht, wie wide der Schriftzug tatsächlich geworden ist – measured im Browser, nicht geschätzt.</p>
<div class="raster">${VARIANTEN.map(card).join('')}</div>
<script>
  for (const v of [1,2,3,4,5,6]) {
    const el = document.querySelector('#v' + v + ' .ansem');
    if (!el) continue;
    const b = el.getBoundingClientRect();
    document.querySelector('#m' + v).textContent =
      b.width.toFixed(1) + ' px wide, ' + b.height.toFixed(1) + ' px hoch';
    // The decisive value: does Ansem's text start at the same spot as the
    // others'? transform only changes the rendering, not the layout
    // width - if that overflows, the text shifts after all.
    const lines = document.querySelectorAll('#v' + v + ' .msg');
    const left = [...lines].map((z) => Math.round(z.querySelector('.body').getBoundingClientRect().left));
    const gleich = left.every((x) => x === left[0]);
    document.querySelector('#m' + v).textContent +=
      gleich ? '  ·  Text flush' : '  ·  TEXT VERSCHOBEN (' + [...new Set(left)].join('/') + ')';
  }
</script>
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-ansem-klein2.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`file://${process.cwd()}/public/_vorschau-ansem-klein2.html`);
await page.waitForTimeout(300);
await page.screenshot({ path: 'preview/ansem-klein2.png', fullPage: true });
await browser.close();

rmSync('public/_vorschau-ansem-klein2.html', { force: true });
console.log('preview/ansem-klein2.png');
