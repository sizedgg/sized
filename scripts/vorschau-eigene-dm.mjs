// ============================================================================
// Preview image: what should your own messages look like in a DM?
//
// Produces preview/dm-eigene.png.
//
// Starting point: as long as the accent was green, your own bubbles were
// tinted green and thus distinguishable from incoming ones at a glance.
// Since the accent became bone-white, that tint has turned into a light
// gray - and that sits close to the gray of the incoming bubble. The
// difference is still there, but it no longer carries.
//
// "Own" here always means: the viewer's own. For Ansem it's his, for
// everyone else it's theirs - app.js decides that via state.me.isAdmin.
// That's why gold isn't an option, even though it might seem obvious: it's
// Ansem's color, and for a regular user it would simply be wrong.
//
// Built with the real markup from dmHtml() and the real stylesheet.
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// Second pass: variant 3 is settled, all that's left to find is how bright
// the fill is allowed to be. A bubble is bigger than a button and appears
// stacked multiple times - what's still pleasant on a button is glaring
// here.
//
// Run with: node scripts/vorschau-eigene-dm.mjs helligkeit
const BRIGHT = [
  ['#c6ccd8', '60 %', 'Der Ton des Send-Knopfs. Auf einer Blase zu hell, sagt André.'],
  ['#b9c0ce', '52 %', 'Eine Stufe tiefer.'],
  ['#aab2c2', '44 %', 'Eingebaut. Deutlich heller als der Grund, ohne zu leuchten.'],
  ['#9aa3b5', '36 %', 'Noch eine Stufe. Nähert sich einem mittleren Grau.'],
];

const BRIGHTNESS = BRIGHT.map(([ton, prozent, hinweis], i) => ({
  nr: i + 1,
  name: `${ton} · ${prozent}`,
  hinweis,
  css: `@ .msg.dm.mine {
    background: ${ton}; border-color: ${ton}; color: var(--bg);
  }
  @ .msg.dm.mine .time { color: rgba(10, 11, 15, .55); }`,
}));

const VARIANTEN = [
  {
    nr: 1,
    name: 'Jetzt',
    hinweis: 'Der heutige Stand: die Fläche des Akzents bei 14 % Deckkraft, dazu ein Rahmen bei 30 %. Zum Vergleich.',
    css: '',
  },
  {
    nr: 2,
    name: 'Kräftiger gefüllt',
    hinweis: 'Dieselbe Idee, deutlich angehoben. Die minSize mögliche Änderung – nur eine Zahl.',
    css: `@ .msg.dm.mine {
      background: rgba(var(--accent-rgb), .24);
      border-color: rgba(var(--accent-rgb), .42);
    }`,
  },
  {
    nr: 3,
    name: 'Hell mit dunkler Schrift',
    hinweis: 'Wie der Send-Knopf: helle Fläche, dunkle Schrift. Der stärkste Unterschied im Satz und derselbe Ton, in dem die Seite sonst "das machst du" sagt.',
    css: `@ .msg.dm.mine {
      background: var(--accent-fill); border-color: var(--accent-fill);
      color: var(--bg);
    }
    @ .msg.dm.mine .time { color: rgba(10, 11, 15, .55); }`,
  },
  {
    nr: 4,
    name: 'Nur Umriss',
    hinweis: 'Keine Fläche, nur ein Rahmen. Eingehende Nachrichten sind gefüllt, eigene offen – die Unterscheidung liegt in der Bauweise statt in der Helligkeit.',
    css: `@ .msg.dm.mine {
      background: none; border-color: var(--dim);
    }`,
  },
  {
    nr: 5,
    name: 'Dunkler statt heller',
    hinweis: 'Die eigene Blase liegt tiefer als der Grund statt höher. Ungewohnt, aber der Unterschied ist eindeutig und ganz ohne Farbe.',
    css: `@ .msg.dm.mine {
      background: var(--bg); border-color: var(--line);
    }`,
  },
  {
    nr: 6,
    name: 'Andere Ecke',
    hinweis: 'Gleiche Fläche wie eingehend, aber die untere Ecke zur eigenen Seite hin ist eckig – der klassische Zipfel, nur ohne Zipfel. Nichts als Form.',
    css: `@ .msg.dm.mine {
      background: var(--bg-3); border-color: var(--line);
      border-bottom-right-radius: 3px;
    }
    @ .msg.dm:not(.mine) { border-bottom-left-radius: 3px; }`,
  },
];

// A short back-and-forth exchange - that's the only way to see whether the
// two kinds can actually be told apart.
const VERLAUF = [
  { mine: false, text: 'Hey Ansem, quick question about the vesting schedule', zeit: '14:01' },
  { mine: true, text: 'What about it', zeit: '14:03' },
  { mine: false, text: 'Is the unlock linear or cliff based? I have been trying to work this out from the docs and cannot tell', zeit: '14:04' },
  { mine: true, text: 'Cliff, then linear over 18 months.', zeit: '14:06' },
  { mine: true, text: 'ok', zeit: '14:06' },
];

const BRIGHT_SET = process.argv[2] === 'helligkeit';
const SATZ = BRIGHT_SET ? BRIGHTNESS : VARIANTEN;
const ZIEL = BRIGHT_SET ? 'preview/dm-eigene-helligkeit.png' : 'preview/dm-eigene.png';

// Like dmHtml() in app.js: row on the outside, bubble inside, reply arrow
// next to it.
const bubble = (m) => `
  <div class="dm-row ${m.mine ? 'mine' : ''}">
    <div class="msg dm ${m.mine ? 'mine' : ''}">
      <span class="body">${m.text}</span>
      <span class="meta"><span class="time">${m.zeit}</span></span>
    </div>
  </div>`;

const card = (v) => `
  <section class="card">
    <style>${v.css.replaceAll('@', `#v${v.nr}`)}</style>
    <h2><span class="nr">${v.nr}</span>${v.name}</h2>
    <p class="hinweis">${v.hinweis}</p>
    <div class="thread-view" id="v${v.nr}">
      <div class="chat-list">
        <div class="day-sep">Today</div>
        ${VERLAUF.map(bubble).join('')}
      </div>
    </div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px 22px; max-width: 1180px; }
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 3.6em; }
  .thread-view { padding: 0 .9rem .9rem; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 88ch; }
</style>
<h1>${BRIGHT_SET ? 'Wie hell darf die eigene Blase sein?' : 'Eigene Nachrichten in einer DM'}</h1>
<p class="lead">${BRIGHT_SET ? 'Helle Fläche mit dunkler Schrift steht fest – hier vier Abstufungen der Fläche selbst.' : ''}${BRIGHT_SET ? '' : `Solange der Akzent grün war, waren die eigenen Blasen grün getönt. Knochenweiß getönt sind sie nur noch ein helles Grau – nah am Grau der eingehenden. Sechs Wege, den Unterschied wieder tragfähig zu machen.`}</p>
<div class="raster">${SATZ.map(card).join('')}</div>
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-eigene-dm.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`file://${process.cwd()}/public/_vorschau-eigene-dm.html`);
await page.waitForTimeout(300);
await page.screenshot({ path: ZIEL, fullPage: true });
await browser.close();

rmSync('public/_vorschau-eigene-dm.html', { force: true });
console.log(ZIEL);
