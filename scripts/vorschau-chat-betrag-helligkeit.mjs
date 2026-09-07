// ============================================================================
// Preview image: how bright can the amount in chat be?
//
// Version 2 is decided - the amount gets text size (.78rem) and weight.
// The only thing still open is the brightness.
//
// The reason "just use --text" isn't the answer here: --text is the
// color for body text, read line by line. But the amount isn't body
// text, it's a short, bold block of monospace digits, and the same
// color value reads noticeably louder in bold mono than in a regular
// grotesk. On top of that: twenty of them stack in a column in chat.
// What looks right for one number becomes a glowing streak down the
// right edge for twenty.
//
// So this steps through options instead of guessing. Every version has
// the same size and weight as number 2; only the color value moves
// between --dim (today's, too quiet a value) and --text (the full one).
//
// The contrast values are computed and printed along with it, so the
// decision doesn't rest on screen impression alone.
//
// Produces preview/chat-betrag-helligkeit.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const GRUND = '#0a0b0f';

// WCAG contrast. Not as a pass/fail stamp - 4.5:1 is the threshold for
// body text, and the amount is bold and short, where 3:1 already
// applies. The number is used here as a yardstick to compare the steps
// against each other.
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontrast = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const TIERS = [
  { name: 'Wie heute',   color: '#8b93a7', gewicht: 400, groesse: '.72rem',
    hinweis: 'Nur zum Vergleich mit dabei – der Stand von jetzt, in alter Größe und altem Gewicht.' },
  { name: 'Gedämpft',    color: '#a4acbe', gewicht: 600, groesse: '.78rem',
    hinweis: 'Nur eine Spur heller als heute, aber fett und in Textgröße. Die Größe trägt hier fast die ganze Wirkung.' },
  { name: 'Mittel',      color: '#b9c0d0', gewicht: 600, groesse: '.78rem',
    hinweis: 'Klar heller als der Nachrichtentext, aber merklich under Weiß. Die Spalte fällt auf, ohne zu leuchten.' },
  { name: 'Mittel, leichter', color: '#b9c0d0', gewicht: 500, groesse: '.78rem',
    hinweis: 'Dieselbe Farbe, ein Gewicht weniger. Fette Monoziffern wirken heller als sie sind – das nimmt etwas davon zurück.' },
  { name: 'Hell',        color: '#cfd5e2', gewicht: 600, groesse: '.78rem',
    hinweis: 'Deutlich vorn, aber noch nicht die Farbe von Fließtext. Letzte Stufe vor Weiß.' },
  { name: 'Voll (--text)', color: '#e7e9ee', gewicht: 600, groesse: '.78rem',
    hinweis: 'Fassung 2 unverändert, wie im letzten Bild. Zwanzig davon untereinander ergeben eine Leuchtspur am rechten Rand.' },
];

const MESSAGES = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, h: '4bo', usd: '$12M', body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '<$1', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'sold half my bag and the vote weight dropped immediately', zeit: '14:05' },
  { admin: true, h: '4bo', usd: '$12M', body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$52', body: 'ser', zeit: '14:07' },
  { h: 'dR1', ton: 1, usd: '$104K', body: 'same', zeit: '14:08' },
  { h: 'q8P', ton: 3, usd: '$2.9K', body: 'how long does the vote stay open', zeit: '14:09' },
  { admin: true, h: '4bo', usd: '$12M', body: '24h', zeit: '14:09' },
];

const line = (m) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? `<span class="h admin-name">${m.h}</span>`
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    <span class="worth">${m.usd}</span>
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

const regeln = TIERS.map((s, i) =>
  `#v${i} .msg .worth { font-size: ${s.groesse}; font-weight: ${s.gewicht}; color: ${s.color}; }`
).join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px 26px 40px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px 22px; max-width: 1560px; }
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .werte { font-family: var(--mono); font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 4.8em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 96ch; }
</style>
<style>${regeln}</style>
<h1>Fassung 2 – wie hell?</h1>
<p class="lead">Gleiche Größe, gleiches Gewicht, nur die Helligkeit wandert. Zehn Zeilen statt sieben, weil es genau darum geht: Eine einzelne Zahl darf heller sein als eine ganze Spalte davon.</p>
<div class="raster">
  ${TIERS.map((s, i) => `
  <section class="card">
    <h2><span class="nr">${i}</span>${s.name}
      <span class="werte">${s.color} · ${kontrast(s.color, GRUND).toFixed(1)}:1</span></h2>
    <p class="hinweis">${s.hinweis}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${MESSAGES.map(line).join('')}</div>
    </div>
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-helligkeit.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1620, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`file://${tmp}`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${ausgabe}chat-betrag-helligkeit.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log('');
for (const [i, s] of TIERS.entries()) {
  console.log(`  ${i}  ${s.name.padEnd(18)} ${s.color}  ${kontrast(s.color, GRUND).toFixed(1)}:1`);
}
console.log(`\n  ${ausgabe}chat-betrag-helligkeit.png\n`);
