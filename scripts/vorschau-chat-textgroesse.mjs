// ============================================================================
// Preview image: how big is the message text in chat?
//
// Today it's .78rem, i.e. 11.7 px on desktop. That was set small on
// purpose, and the reasoning is in the stylesheet: chat and inbox are
// the same thing - a list of rows made of handle, text, and amount - and
// the text in it is a preview line, not body text. Preview lines are set
// smaller.
//
// What that overlooked: in the inbox, the row really is a preview - you
// open the conversation to read it. In chat there's nothing behind it.
// This row IS the message. Setting it like a preview means shrinking the
// one thing you're actually reading.
//
// Two things are tied to this and get carried along here:
//
//   * The amount. Since the last change it's exactly as big as the text.
//     If only the text grows, the amount goes back to being the
//     footnote it's not supposed to be - the test-chat-betrag.mjs test
//     would flag that.
//   * The inbox. If only chat grows, two lists of the same thing look
//     different. That's also a rule stated in the stylesheet.
//
// The assumed cost - bigger text, fewer messages in the window - was
// measured and isn't real. A row's height isn't set by the text, but by
// the handle next to it: that has no size of its own and so inherits the
// page's full base size, 15 px. The text below it stays under that up to
// .92rem (13.8 px); the row is 37.5 px tall in every version.
//
// That's the actual finding: the message text is currently smaller than
// the sender's name, and the space above it sits empty anyway. Making it
// bigger costs nothing here - it only fills what's already there.
//
// The last two versions also change the brightness. That's an old open
// question: the text sits on --dimmer, so at 3.4:1 against the
// background. If "too small" actually means "hard to read", size might
// only be half the answer.
//
// Produces preview/chat-textgroesse.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const GRUND = '#0a0b0f';
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontrast = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const DIMMER = '#5d657a';
const DIM = '#8b93a7';

const FASSUNGEN = [
  { name: 'Jetzt', gr: '.78rem', color: DIMMER,
    hinweis: 'Der Stand von heute: 11,7 px. So groß wie eine Vorschauzeile im Posteingang – nur dass es hier kein Dahinter gibt.' },
  { name: 'Eine Stufe', gr: '.82rem', color: DIMMER,
    hinweis: '12,3 px, also genau das, was der Chat auf dem Handy schon hat. Kleinster Schritt, der überhaupt zu sehen ist.' },
  { name: 'Zwei Stufen', gr: '.86rem', color: DIMMER,
    hinweis: '12,9 px. Der Text löst sich merklich von der Vorschauzeilen-Anmutung, ohne dass die Liste ihren Rhythmus verliert.' },
  { name: 'Fließtext', gr: '.92rem', color: DIMMER,
    hinweis: '13,8 px – fast die Grundgröße der Seite und knapp under dem Kürzel. Liest sich wie ein Gespräch statt wie eine Liste. Ab hier beginnt die Zeile zu wachsen.' },
  { name: 'Zwei Stufen + heller', gr: '.86rem', color: DIM,
    hinweis: 'Wie 2, aber auf --dim statt --dimmer: 6,4:1 statt 3,4:1. Falls "zu klein" eigentlich "bad zu lesen" heißt, sitzt hier der größere Teil der Antwort.' },
  { name: 'Eine Stufe + heller', gr: '.82rem', color: DIM,
    hinweis: 'Der vorsichtige Weg: kaum größer, aber deutlich besser lesbar. Die Liste bleibt so dicht wie heute.' },
];

const MESSAGES = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, h: '4bo', usd: '$12M', body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '<$1', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'sold half my bag and the vote weight dropped immediately, thats brutal', zeit: '14:05' },
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

// The amount scales along with the text size - otherwise it would go
// back to being a footnote next to the name in every larger version.
const regeln = FASSUNGEN.map((f, i) => `
  #v${i} .msg .body { font-size: ${f.gr}; color: ${f.color}; }
  #v${i} .msg .worth { font-size: ${f.gr}; }
`).join('\n');

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
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 5.6em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 100ch; }
</style>
<style>${regeln}</style>
<h1>Der Nachrichtentext im Chat</h1>
<p class="lead">Sechs Fassungen. Der Betrag zieht in jeder mit – er ist seit der letzten Änderung genau so groß wie der Text, und das expected er bleiben. Die letzten beiden ändern zusätzlich die Helligkeit.<br>Nachgemessen: Größerer Text kostet hier keine Zeile. Die Höhe wird vom Kürzel bestimmt, das 15 px groß ist – der Nachrichtentext ist heute also kleiner als der Name des Absenders, und der Platz über ihm steht empty.</p>
<div class="raster">
  ${FASSUNGEN.map((f, i) => `
  <section class="card">
    <h2><span class="nr">${i}</span>${f.name}
      <span class="werte" id="w${i}">${f.gr} · ${kontrast(f.color, GRUND).toFixed(1)}:1</span></h2>
    <p class="hinweis">${f.hinweis}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${MESSAGES.map(line).join('')}</div>
    </div>
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-textgroesse.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1620, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`file://${tmp}`);
await page.waitForTimeout(400);

// Measured instead of assumed: does bigger text cost rows? The answer
// isn't in anyone's head, it's in the layout - and it's no, as long as
// the text stays under the size of the handle next to it. That's exactly
// why the row height is read out here rather than estimated.
const numbers = await page.evaluate((n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const lines = [...document.querySelectorAll(`#v${i} .msg`)];
    const px = parseFloat(getComputedStyle(document.querySelector(`#v${i} .msg .body`)).fontSize);
    // Only single-line messages: a wrapped one says something about its
    // length, not about the font size.
    const heights = lines.map((el) => el.getBoundingClientRect().height);
    out.push({ px, height: Math.min(...heights) });
  }
  return out;
}, FASSUNGEN.length);

await page.evaluate((daten) => {
  daten.forEach((d, i) => {
    const el = document.querySelector(`#w${i}`);
    el.textContent = `${el.textContent} · ${d.px}px · Zeile ${d.height}px`;
  });
}, numbers);
await page.waitForTimeout(200);
await page.screenshot({ path: `${ausgabe}chat-textgroesse.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log('');
FASSUNGEN.forEach((f, i) => {
  const d = numbers[i];
  console.log(`  ${i}  ${f.name.padEnd(22)} ${String(d.px).padStart(5)}px  `
    + `${kontrast(f.color, GRUND).toFixed(1)}:1  Zeilenhoehe ${d.height}px`);
});
console.log(`\n  ${ausgabe}chat-textgroesse.png\n`);
