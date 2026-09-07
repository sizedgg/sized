// ============================================================================
// Preview images: what a reply looks like in chat
//
// Today, a reply carries its own box above it with the quote: a tinted
// surface, a line on the left, rounded corners, at .85rem. That gives it
// roughly the same visual weight as the message below it - and that's the
// core of the problem. What's quoted is something that already stood there
// once; the reply is the new thing. A lead-in as loud as the thing itself
// flips the hierarchy.
//
// The box also dates from a time when the page looked different: back then
// the message text was .78rem and dim, so the quote at .85rem was still the
// smaller piece of information. By now the message sits at .86rem and
// brighter - the quote has quietly gone from lead-in to lead actor.
//
// Every version has to do two things, or it isn't a solution:
//
//   * It has to stay clickable and jump to the quoted message. That's the
//     reason the quote carries the text at all.
//   * It has to be able to represent the "original deleted" case. That
//     happens now that Ansem can delete polls and messages.
//
// And one quirk that's easy to throw away while trimming: the quote is fed
// from state.quoted, not from the displayed list. Anyone who filters chat
// down to big holders doesn't see the quoted message itself at all - only
// the reply to it. Without the quoted text, that would be an answer with no
// question. So versions that drop the text lose something real.
//
// Produces preview/antwort.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// A conversation with two replies and one whose original is deleted - the
// case the short versions have to prove themselves against.
const zitat = { h: '9Qm', ton: 0, text: 'when is the next poll going up' };

const NORMAL = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'when is the next poll going up', zeit: '14:02' },
  { admin: true, h: '4bo', usd: '$12M', body: 'tonight, right after the stream', zeit: '14:03', quote: zitat },
  { h: 'Km9', ton: 3, usd: '<$1', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'does the weight update live or only when i refresh', zeit: '14:05' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'live. it follows the balance', zeit: '14:06',
    quote: { h: 'zQ4', ton: 0, text: 'does the weight update live or only when i refresh' } },
  { h: '7xK', ton: 2, usd: '$52', body: 'ser', zeit: '14:07', weg: true },
];

const name = (h, ton, admin) => admin
  ? `<span class="h admin-name">${h}</span>`
  : `<span class="h t${ton}">${h}</span>`;

// Every version builds its own quote line. Anything that can only be built
// with a different structure is marked accordingly - that's not a minor
// detail, it's extra work in app.js.
const FASSUNGEN = [
  {
    file: 'jetzt', name: 'Jetzt', short: 'Kasten mit Fläche und Strich',
    text: 'Der Stand von heute. Getönte Fläche, Strich left, .85rem – ungefähr dasselbe Gewicht wie die Nachricht darunter. Der Vorspann ist so laut wie die Sache selbst.',
    aufbau: 'CSS',
    zitat: (q) => `<button class="quote" type="button">${name(q.h, q.ton)}<span class="quote-body">${q.text}</span></button>`,
    weg: () => `<span class="quote is-gone">Original message is gone</span>`,
    css: '',
  },
  {
    file: 'line', name: 'Eine Zeile', short: 'Kein Kasten, nur Text',
    text: 'Dieselbe Zeile ohne Fläche und ohne Rundung: ein Pfeil, das Kürzel, der zitierte Text – klein und leise. Am wenigsten Gewicht bei gleichem Inhalt, und die Klickfläche bleibt die ganze Zeile.',
    aufbau: 'CSS',
    zitat: (q) => `<button class="quote" type="button"><span class="pfeil">↳</span>${name(q.h, q.ton)}<span class="quote-body">${q.text}</span></button>`,
    weg: () => `<span class="quote is-gone"><span class="pfeil">↳</span>Original message is gone</span>`,
    css: `
      .quote { background: none; border: 0; border-radius: 0; padding: 0 0 .1rem;
               font-size: .76rem; color: var(--dimmer); gap: .35rem; }
      .quote:hover { background: none; color: var(--dim); }
      .quote .h { font-size: .76rem; }
      .pfeil { color: var(--dimmer); flex: none; }`,
  },
  {
    file: 'strich', name: 'Nur der Strich', short: 'Fläche weg, Strich bleibt',
    text: 'Der minSize Eingriff: Die Füllung fällt weg, der senkrechte Strich left bleibt und wird der einzige Hinweis. Näher am Heutigen als alle anderen, und der Strich sagt weiterhin "das gehört zusammen".',
    aufbau: 'CSS',
    zitat: (q) => `<button class="quote" type="button">${name(q.h, q.ton)}<span class="quote-body">${q.text}</span></button>`,
    weg: () => `<span class="quote is-gone">Original message is gone</span>`,
    css: `
      .quote { background: none; border-radius: 0; padding: .1rem 0 .1rem .5rem;
               font-size: .78rem; color: var(--dimmer); }
      .quote:hover { background: none; color: var(--dim); border-left-color: var(--dim); }
      .quote .h { font-size: .78rem; }`,
  },
  {
    file: 'namen', name: 'Nur der Name', short: 'Ohne den zitierten Text',
    text: 'Nur "↳ an 9Qm". Die kürzeste Form überhaupt – aber sie verliert etwas Echtes: Wer den Chat auf große Halter filtert, sieht die zitierte Nachricht nicht und hätte dann eine Antwort ohne Frage vor sich.',
    aufbau: 'CSS',
    zitat: (q) => `<button class="quote nur-name" type="button"><span class="pfeil">↳</span>${name(q.h, q.ton)}</button>`,
    weg: () => `<span class="quote is-gone nur-name"><span class="pfeil">↳</span>gone</span>`,
    css: `
      .quote { background: none; border: 0; border-radius: 0; padding: 0 0 .1rem;
               font-size: .76rem; color: var(--dimmer); gap: .3rem; width: auto; }
      .quote:hover { background: none; color: var(--dim); }
      .quote .h { font-size: .76rem; }
      .pfeil { color: var(--dimmer); flex: none; }`,
  },
  {
    file: 'inline', name: 'Im Textfluss', short: 'Kein eigener Umbruch mehr',
    text: 'Das Zitat steht als kurzer Vorspann in derselben Zeile wie die Antwort. Die Liste behält damit ihren Rhythmus – eine Antwort ist nicht mehr doppelt so hoch wie eine normale Nachricht. Der zitierte Text muss dafür sehr short gekürzt werden.',
    aufbau: 'app.js',
    imBody: true,
    zitat: (q) => `<button class="vorspann" type="button"><span class="pfeil">↳</span>${name(q.h, q.ton)}<span class="vorspann-body">${q.text.slice(0, 28)}…</span></button>`,
    weg: () => `<span class="vorspann ist-weg"><span class="pfeil">↳</span>gone</span>`,
    css: `
      .vorspann { background: none; border: 0; padding: 0; margin-right: .4rem;
                  font: inherit; font-size: .78rem; color: var(--dimmer);
                  cursor: pointer; display: inline; }
      .vorspann:hover { color: var(--dim); }
      .vorspann .h { font-size: .78rem; margin: 0 .25rem; }
      .vorspann-body { opacity: .8; }
      .ist-weg { font-style: italic; }`,
  },
  {
    file: 'block', name: 'Eingerückt', short: 'Der Strich umfasst die ganze Antwort',
    text: 'Wie in einem Mailprogramm: Zitat und Antwort stehen gemeinsam hinter einem senkrechten Strich und sind zusammen eingerückt. Der Zusammenhang ist am deutlichsten – aber es kostet Breite, und auf dem Handy ist Breite knapp.',
    aufbau: 'app.js',
    umfasst: true,
    zitat: (q) => `<button class="quote" type="button">${name(q.h, q.ton)}<span class="quote-body">${q.text}</span></button>`,
    weg: () => `<span class="quote is-gone">Original message is gone</span>`,
    css: `
      .msg.has-quote { border-left: 2px solid var(--line); padding-left: .8rem; }
      .quote { background: none; border: 0; border-radius: 0; padding: 0 0 .15rem;
               font-size: .76rem; color: var(--dimmer); }
      .quote:hover { background: none; color: var(--dim); }
      .quote .h { font-size: .76rem; }`,
  },
];

const line = (m, f) => {
  const q = m.quote ? f.zitat(m.quote) : (m.weg ? f.weg() : '');
  const imFluss = f.imBody && q;
  return `
  <div class="msg ${m.admin ? 'is-admin' : ''}${q && !imFluss ? ' has-quote' : ''}">
    <span class="who">${name(m.h, m.ton, m.admin)}</span>
    <span class="worth">${m.usd}</span>
    ${imFluss ? '' : q}
    <span class="body">${imFluss ? q : ''}${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;
};

const regeln = FASSUNGEN
  .map((f, i) => f.css ? f.css.replace(/(^|\})\s*\./g, (m0, p1) => `${p1}\n#v${i} .`) : '')
  .join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 26px 26px 40px; }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 30px 24px; max-width: 1500px; }
  h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .short { color: var(--dim); font-weight: 400; font-size: .84rem; }
  .marker { font-size: .66rem; color: var(--dimmer); border: 1px solid var(--line);
           border-radius: 4px; padding: 0 .3rem; font-weight: 400; }
  .hinweis { margin: 0 0 .7rem; font-size: .8rem; color: var(--dimmer); min-height: 5.4em; line-height: 1.5; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 104ch; }
</style>
<style>${regeln}</style>
<h1>Eine Antwort im Chat</h1>
<p class="lead">Derselbe Verlauf in allen Fassungen: zwei Antworten und eine Nachricht, deren Original gelöscht wurde – der Fall, an dem die kurzen Fassungen sich beweisen müssen. "CSS" heißt, die Fassung ist eine reine Stilblatt-Änderung; "app.js" heißt, der Aufbau der Zeile ändert sich mit.</p>
<div class="raster">
  ${FASSUNGEN.map((f, i) => `
  <section>
    <h2><span class="nr">${i}</span>${f.name}<span class="short">${f.short}</span>
      <span class="marker">${f.aufbau}</span></h2>
    <p class="hinweis">${f.text}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${NORMAL.map((m) => line(m, f)).join('')}</div>
    </div>
  </section>`).join('')}
</div>`;

const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });
const tmp = path.join(root, 'public', '_vorschau-antwort.html');
fs.writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const blatt = await browser.newPage({ viewport: { width: 1560, height: 1100 }, deviceScaleFactor: 2 });
await blatt.goto(`file://${tmp}`);
await blatt.waitForTimeout(400);

// Measured: how tall is a reply compared to a normal row? That's the price
// the box costs, and it can't be estimated.
const heights = await blatt.evaluate((n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const alle = [...document.querySelectorAll(`#v${i} .msg`)];
    const mitZitat = alle.find((el) => el.querySelector('.quote, .vorspann'));
    const ohne = alle.find((el) => !el.querySelector('.quote, .vorspann'));
    out.push({
      mit: Math.round(mitZitat.getBoundingClientRect().height * 10) / 10,
      ohne: Math.round(ohne.getBoundingClientRect().height * 10) / 10,
    });
  }
  return out;
}, FASSUNGEN.length);

await blatt.evaluate((d) => {
  d.forEach((h, i) => {
    const el = document.querySelectorAll('.marker')[i];
    el.textContent = `${el.textContent} · Antwort ${h.mit}px, normal ${h.ohne}px`;
  });
}, heights);
await blatt.waitForTimeout(200);
await blatt.screenshot({ path: path.join(ausgabe, 'antwort.png'), fullPage: true });
await browser.close();
fs.rmSync(tmp);

console.log('');
FASSUNGEN.forEach((f, i) => {
  const h = heights[i];
  console.log(`  ${i}  ${f.name.padEnd(14)} ${f.aufbau.padEnd(7)} `
    + `Antwort ${String(h.mit).padStart(5)}px   normal ${String(h.ohne).padStart(5)}px   `
    + `+${Math.round((h.mit / h.ohne - 1) * 100)} %`);
});
console.log(`\n  ${path.join(ausgabe, 'antwort.png')}\n`);
