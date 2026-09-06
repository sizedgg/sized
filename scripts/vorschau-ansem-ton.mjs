// ============================================================================
// Vorschaubild: Ein Farbton für Ansems Zeilen im Chat
//
// Seine Nachrichten sollen beim Überfliegen auffallen, ohne dass man liest.
// Der Name allein reicht dafür nicht – er ist 25 px breit und steht ganz links.
// Eine getönte Zeile findet das Auge dagegen sofort.
//
// Grenzen, die der Ton einhalten muss:
//   * Er darf den Zeigerhinweis (--bg-2) nicht schlucken.
//   * Er darf dem Aufleuchten beim Zitatsprung nicht zu nahe kommen.
//   * Und er sollte nicht wie das Blau der ungelesenen Gespräche aussehen –
//     anderes Bauteil, aber dieselbe App, und dort heißt getönt "ungelesen".
//
// Erzeugt preview/ansem-ton.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const TOENE = [
  ['Ohne Ton',      null,                        'Der jetzige Stand. Nur der Name unterscheidet ihn – und der ist 25 px breit.'],
  ['Neutral heller', 'rgba(255, 255, 255, .045)', 'Gar keine Farbe, nur eine Spur heller. Ruhigste Lösung, aber sie liegt nah am Zeigerhinweis.'],
  ['Bernstein',      'rgba(245, 181, 60, .065)',  'Warm gegen den kalten Grund. Fällt am schnellsten auf – und Gold war ja mal seine Farbe.'],
  ['Stahlblau',      'rgba(138, 178, 220, .075)', 'Ruhig und kühl. Aber genau dieser Ton heißt im Posteingang "ungelesen".'],
  ['Petrol',         'rgba(47, 191, 168, .075)',  'Blau Richtung Grün, in dieser App noch unbesetzt. Kühl, ohne dem Blau zu nahe zu kommen.'],
  ['Violett',        'rgba(168, 107, 255, .08)',  'Deutlich als Farbe erkennbar. Nachbar der Namensfarbe .h.t1, aber als Fläche weit genug weg.'],
  ['Zinnober',       'rgba(255, 106, 61, .06)',   'Der wärmste Ton im Feld. Sehr auffällig – vielleicht zu auffällig für jemanden, der oft schreibt.'],
];

const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '$1.3K', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'sold half my bag and the vote weight dropped immediately', zeit: '14:05' },
  { admin: true, body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$5.2K', body: 'ser', zeit: '14:07' },
];

const zeile = (m) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? '<span class="h admin-name">ANSEM</span>'
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    ${m.admin ? '' : `<span class="worth">${m.usd}</span>`}
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

const karte = ([name, ton, hinweis], i) => `
  <section class="karte">
    ${ton ? `<style>#v${i} .msg.is-admin { background: ${ton}; }</style>` : ''}
    <h2><span class="nr">${i}</span>${name}${ton ? `<code class="ton">${ton}</code>` : ''}</h2>
    <p class="hinweis">${hinweis}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${NACHRICHTEN.map(zeile).join('')}</div>
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
  .ton { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 3.6em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 92ch; }
</style>
<h1>Ansems Zeilen im Chat</h1>
<p class="lead">Sieben Töne für seine Nachrichten. Nummer 0 ist der jetzige Stand.</p>
<div class="raster">${TOENE.map(karte).join('')}</div>
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-ansem-ton.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${process.cwd()}/public/_vorschau-ansem-ton.html`);
await seite.waitForTimeout(300);
await seite.screenshot({ path: 'preview/ansem-ton.png', fullPage: true });
await browser.close();

rmSync('public/_vorschau-ansem-ton.html', { force: true });
console.log('preview/ansem-ton.png');
