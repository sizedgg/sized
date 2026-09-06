// ============================================================================
// Vorschaubild: "ANSEM" so klein, dass es genau so breit ist wie drei Zeichen
//
// Die Spalte ist 26 px breit – das sind drei Schreibmaschinenzeichen bei 15 px.
// "ANSEM" sind fünf Buchstaben. Damit es in dieselbe Breite passt, muss es
// deutlich kleiner gesetzt werden, und die Frage ist nur: wie kriegt man das
// hin, ohne dass es unleserlich wird?
//
// Drei Wege:
//   * kleiner setzen (ehrlich, aber winzig)
//   * schmalere Schrift nehmen (die Sans ist schmaler als die Mono)
//   * waagerecht stauchen (Höhe bleibt lesbar, Breite schrumpft)
//
// Das Skript misst jede Variante im Browser nach und schreibt die tatsächliche
// Breite daneben. Geraten wird hier nichts.
//
// Erzeugt preview/ansem-klein2.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// Zweiter Durchgang. Der erste hat gemessen: Nur die Mono bei 8,5 px und die
// gestauchte Mono passen ueberhaupt in die 25,4 px. Die gestauchte war mit
// 20,5 px sogar zu schmal – da ist Hoehe verschenkt.
//
// Also hier dieselbe Idee in drei Groessen, jede so gestaucht, dass sie GENAU
// auf die Kuerzelbreite kommt. Die Rechnung: natuerliche Breite bei 11 px sind
// 33,1 px, also 25,4 / 33,1 = 0,768. Bei groesserer Schrift entsprechend mehr
// Stauchung – und irgendwann sieht man ihr das an. Genau die Grenze soll das
// Bild zeigen.
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
    hinweis: 'Wie 3, aber ohne Fettung. Beim Stauchen werden fette Buchstaben schnell klobig – duennere vertragen es besser.',
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

const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { admin: true, body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '$1.3K', body: 'lfg', zeit: '14:04' },
  { admin: true, body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$5.2K', body: 'ser', zeit: '14:07' },
];

const zeile = (m, v) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? `<span class="h ansem">${v.text ?? 'ANSEM'}</span>`
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    ${m.admin ? '' : `<span class="worth">${m.usd}</span>`}
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

const karte = (v) => `
  <section class="karte">
    <style>#v${v.nr} .ansem { color: var(--accent); ${v.css} }</style>
    <h2><span class="nr">${v.nr}</span>${v.name}<span class="mass" id="m${v.nr}"></span></h2>
    <p class="hinweis">${v.hinweis}</p>
    <div class="chat-panel" id="v${v.nr}">
      <div class="chat-list">${NACHRICHTEN.map((m) => zeile(m, v)).join('')}</div>
    </div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 26px 22px; max-width: 1240px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
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
<p class="lead">Die Spalte ist 26 px breit. Hinter jeder Überschrift steht, wie breit der Schriftzug tatsächlich geworden ist – gemessen im Browser, nicht geschätzt.</p>
<div class="raster">${VARIANTEN.map(karte).join('')}</div>
<script>
  for (const v of [1,2,3,4,5,6]) {
    const el = document.querySelector('#v' + v + ' .ansem');
    if (!el) continue;
    const b = el.getBoundingClientRect();
    document.querySelector('#m' + v).textContent =
      b.width.toFixed(1) + ' px breit, ' + b.height.toFixed(1) + ' px hoch';
    // Der entscheidende Wert: Beginnt der Text bei Ansem an derselben Stelle
    // wie bei den anderen? transform aendert nur die Darstellung, nicht die
    // Layout-Breite – wenn die ueberlaeuft, verschiebt sich der Text doch.
    const zeilen = document.querySelectorAll('#v' + v + ' .msg');
    const links = [...zeilen].map((z) => Math.round(z.querySelector('.body').getBoundingClientRect().left));
    const gleich = links.every((x) => x === links[0]);
    document.querySelector('#m' + v).textContent +=
      gleich ? '  ·  Text buendig' : '  ·  TEXT VERSCHOBEN (' + [...new Set(links)].join('/') + ')';
  }
</script>
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-ansem-klein2.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${process.cwd()}/public/_vorschau-ansem-klein2.html`);
await seite.waitForTimeout(300);
await seite.screenshot({ path: 'preview/ansem-klein2.png', fullPage: true });
await browser.close();

rmSync('public/_vorschau-ansem-klein2.html', { force: true });
console.log('preview/ansem-klein2.png');
