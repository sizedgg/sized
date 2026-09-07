// ============================================================================
// The first screen on the phone - four arrangements of the same text
//
// The text is fixed:
//
//   "SIZED works best from your home screen."  + three steps
//
// Only the ordering is open. The plain list looks restless for a
// measurable reason: at 375px steps wrap ("Add to Home / Screen"), which
// makes every line a different height and leaves the right edge ragged.
//
// So this script measures HOW MANY lines wrap. An arrangement that looks
// calm in the picture but falls apart again with a longer line isn't a
// solution - it's just a well-chosen sample text.
//
// Drawn with the real index.html and the real styles.css. The login
// screen is normally shown via JavaScript; here that happens by hand,
// otherwise the image would stay black (which is exactly what it was
// until now).
//
//   node scripts/vorschau-login.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The share icon from the real index.html - taken literally, so the
// variants don't advertise a different glyph than the page actually shows
// later.
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const IOS_GLYPH = (() => {
  const a = html.indexOf('<span class="glyph">');
  const b = html.indexOf('</span>', html.indexOf('</svg>', a)) + 7;
  if (a < 0 || b < 7) throw new Error('Teilen-Symbol nicht in index.html gefunden');
  return html.slice(a, b);
})();

const HAUS = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"
  stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">
  <path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5V19h11V9.5"/>
  <path d="M10 19v-4.5h4V19"/></svg>`;

const iosSteps = (last) => `
  <ol id="ios-steps" class="steps">
    <li>Tap ${IOS_GLYPH} in the browser bar</li>
    <li>Scroll down and choose <strong>Add to Home Screen</strong></li>
    <li>${last}</li>
  </ol>`;

// ---------------------------------------------------------------------------
// The four versions
// ---------------------------------------------------------------------------

const LEDE = 'SIZED works best from your home screen.';

// Two versions of the steps: one full, one shortened. "Scroll down and"
// isn't content padding - in iOS's share menu the entry really does sit
// far down. But it's also what causes the wrap. Both are offered rather
// than hiding the decision.
const STEPS_LONG = (g) => [
  `Tap ${g} in the browser bar`,
  'Scroll down and choose <strong>Add to Home Screen</strong>',
  'Open SIZED from there and verify',
];
const STEPS_SHORT = (g) => [
  `Tap ${g} in the browser bar`,
  'Choose <strong>Add to Home Screen</strong>',
  'Open SIZED from there',
];

// Each step's text sits inside ONE span.
//
// Without this detour the line falls apart: if flex or grid sits directly
// on the <li>, every piece of text inside it becomes its own element -
// "Scroll down and choose" and "<strong>Add to Home Screen</strong>" then
// get pulled apart, and with grid every word lands on its own line. That's
// exactly what the first two images looked like.
const liste = (schritte) =>
  `<ol class="steps">${schritte.map((s) => `<li><span class="txt">${s}</span></li>`).join('')}</ol>`;

const FASSUNGEN = [
  {
    nr: 1,
    name: 'Mittig, alles auf einer Achse',
    was: 'Marke, Satz und Schritte stehen auf derselben Mittelachse. Symmetrie '
       + 'ist die billigste Art von Ordnung – und der leere Raum darunter '
       + 'wirkt dann wie Absicht statt wie ein Rest.',
    css: `.login-card .lede { text-align: center; }
          .steps { list-style: none; padding: 0; counter-reset: s;
                   display: flex; flex-direction: column; gap: .5rem; }
          .steps li { counter-increment: s; display: flex; gap: .6rem;
                      align-items: baseline; justify-content: center;
                      text-align: left; }
          .steps li::before { content: counter(s); color: var(--dim);
                      font-family: var(--mono); font-size: .8rem; flex: none; }
          .steps .txt { display: block; }`,
    content: (g) => `<p class="lede">${LEDE}</p>${liste(STEPS_SHORT(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
  {
    nr: 2,
    name: 'Schritte als Zeilen mit Trennlinien',
    was: 'Wie eine Einstellungsliste auf dem Telefon: gleiche Höhe, gleiche '
       + 'Einrückung, eine Haarlinie between. Die Nummern stehen in einer '
       + 'Spalte, dadurch ist der linke Rand ruhig – und ein Umbruch fällt '
       + 'nicht mehr auf, weil jede Zeile ohnehin ihren eigenen Streifen hat.',
    css: `.steps { list-style: none; padding: 0; margin: 0; counter-reset: s;
            border: 1px solid var(--line); border-radius: var(--radius);
            background: var(--bg-1); overflow: hidden; }
          .steps li { counter-increment: s; display: flex; gap: .7rem;
            align-items: flex-start; padding: .7rem .85rem;
            border-bottom: 1px solid var(--line); text-align: left; }
          .steps li:last-child { border-bottom: 0; }
          .steps li::before { content: counter(s); color: var(--dim);
            font-family: var(--mono); font-size: .78rem; line-height: 1.55;
            flex: none; width: .9rem; }
          .steps .txt { display: block; }`,
    content: (g) => `<p class="lede">${LEDE}</p>${liste(STEPS_LONG(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
  {
    nr: 3,
    name: 'Nummern als Kreise, feste Spalte',
    was: 'Die Nummern sitzen in gleich grossen Kreisen, der Text beginnt bei '
       + 'allen dreien an derselben Kante. Auch wenn eine Zeile umbricht, '
       + 'bleibt die Spalte stehen – das ist der Unterschied zur heutigen '
       + 'Liste, bei der die zweite Zeile nach left under die Nummer rutscht.',
    css: `.steps { list-style: none; padding: 0; margin: 0; counter-reset: s;
            display: flex; flex-direction: column; gap: .75rem; }
          .steps li { counter-increment: s; display: grid;
            grid-template-columns: 1.55rem 1fr; gap: .7rem;
            align-items: start; text-align: left; }
          .steps li::before { content: counter(s);
            display: grid; place-items: center;
            width: 1.55rem; height: 1.55rem; border-radius: 50%;
            border: 1px solid var(--line); background: var(--bg-1);
            font-family: var(--mono); font-size: .74rem; color: var(--dim); }
          .steps .txt { display: block; }`,
    content: (g) => `<p class="lede">${LEDE}</p>${liste(STEPS_LONG(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
  {
    nr: 4,
    name: 'Ohne Nummern, nur Zeilen',
    was: 'Die Reihenfolge steht ohnehin in den Sätzen ("Tap … Choose … Open"). '
       + 'Ohne Ziffern fällt eine ganze Spalte weg, und der Text steht am '
       + 'linken Rand wie der Satz darüber. Am wenigsten Bauteile – die Frage '
       + 'ist, ob es dadurch als Anleitung noch erkennbar bleibt.',
    css: `.steps { list-style: none; padding: 0; margin: 0;
            display: flex; flex-direction: column; gap: .55rem; }
          .steps li { text-align: left; padding-left: .9rem; position: relative; }
          .steps li::before { content: ''; position: absolute; left: 0; top: .62em;
            width: 4px; height: 4px; border-radius: 50%; background: var(--dim); }`,
    content: (g) => `<p class="lede">${LEDE}</p>${liste(STEPS_SHORT(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
];

// ---------------------------------------------------------------------------

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(root, 'public', pfad);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    return res.writeHead(404).end('');
  }
  // app.js stays empty: the preview sets the state itself, otherwise the
  // script would immediately start the login flow and hide everything
  // again.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const DEVICE = { width: 375, height: 667, dpr: 2 };   // iPhone SE - the tightest fit

async function shoot(f) {
  const page = await browser.newPage({
    viewport: { width: DEVICE.width, height: DEVICE.height },
    deviceScaleFactor: DEVICE.dpr, isMobile: true, hasTouch: true,
  });
  await page.goto(base);
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.evaluate((content) => {
    document.querySelector('#login').hidden = false;
    document.querySelector('#app').hidden = true;
    const card = document.querySelector('#login .login-card');
    // Keep the brand, replace everything below it with the version.
    const marker = card.querySelector('.brand').outerHTML;
    card.innerHTML = marker + `<div class="step">${content}</div>`;
  }, f.content(IOS_GLYPH));
  await page.waitForTimeout(180);
  const puffer = await page.screenshot();

  // Two numbers you can't see in the image:
  //
  //   height      Does the card run past the bottom of the screen? A
  //              screenshot of the visible part won't tell you.
  //   wraps  How many steps span more than one line? That's exactly
  //              what makes today's list look restless, and exactly what
  //              would come back with a longer translation or line.
  const mass = await page.evaluate(() => {
    const card = document.querySelector('#login .login-card');
    let wraps = 0;
    for (const li of document.querySelectorAll('.steps li')) {
      const line = parseFloat(getComputedStyle(li).lineHeight);
      const innen = li.getBoundingClientRect().height
        - parseFloat(getComputedStyle(li).paddingTop)
        - parseFloat(getComputedStyle(li).paddingBottom);
      if (innen > line * 1.6) wraps++;
    }
    return { height: Math.round(card.getBoundingClientRect().height), wraps };
  });
  await page.close();
  return { bild: `data:image/png;base64,${puffer.toString('base64')}`, ...mass };
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) bilder.push({ ...f, ...(await shoot(f)) });

const PLATZ = DEVICE.height;
const blatt = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 26px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .row { display: flex; gap: 22px; align-items: flex-start; }
  .fall { width: 262px; }
  h2 { font-size: 13.5px; margin: 0 0 3px; line-height: 1.3; }
  p { font-size: 11px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px; }
  .warn { color: #e8b45c; }
  .mass { font-family: ui-monospace, Menlo, monospace; font-size: 10px;
          color: #6f6f7a; margin: 0 0 8px; }
  img { width: 262px; display: block; border-radius: 10px; border: 1px solid #23232a; }
</style>
<div class="row">
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <p class="mass">Karte ${b.height} px · ${b.wraps === 0
       ? 'kein Schritt bricht um'
       : `${b.wraps} von 3 Schritten brechen um`}</p>
    ${b.height > PLATZ ? `<p class="warn">Passt nicht auf einen Bildschirm:
       ${b.height} px auf ${PLATZ} px – man muss scrollen.</p>` : ''}
    <img src="${b.bild}">
  </div>`).join('')}
</div>
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'login-optionen.png'), fullPage: true });

console.log('');
for (const b of bilder) {
  console.log(`  ${b.nr}. ${b.name}`);
  console.log(`     Karte ${b.height} px, ${b.wraps} Umbruch/Umbrueche`
    + (b.height > PLATZ ? `  – mehr als ${PLATZ} px, also Scrollen` : ''));
}
console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/login-optionen.png\n`);
await browser.close();
server.close();
