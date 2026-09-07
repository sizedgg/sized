// ============================================================================
// Preview: the duration as days / hours / minutes
//
// Today a single value in hours sits there, with a plus and a minus next
// to it: "- 24h +". That's a row you tap your way through. What's wanted
// is X's shape: three select fields side by side, days, hours, minutes,
// each individually selectable.
//
// The difference is bigger than it looks, for a reason that has nothing
// to do with taste: SPACE.
//
//   today      one box,   ~92 px wide
//   X's shape  three boxes, each with a label and an arrow
//
// And that space has to come from somewhere. Today the duration sits in
// the creation box's HEADER, right next to "+ New poll", visible even
// when collapsed. Three boxes barely fit there on desktop and don't fit
// at all at 390 px.
//
// So this preview shows not just "what do the fields look like", but
// above all: WHERE do they sit. Every version is rendered on desktop and
// on a phone, collapsed and expanded.
//
// All markup and all CSS is cut verbatim out of index.html and
// styles.css. Only what each version CHANGES lives here in the script -
// otherwise the preview would show a rebuilt page instead of the real
// one.
//
// ----------------------------------------------------------------------------
// HEADS UP: this script no longer runs.
//
// It cuts .poll-frist out of index.html - the old hour toggle in the
// header. That's been gone since the decision for version 1, so the cut
// now hits nothing.
//
// It stays here anyway, because it records the question that got decided
// and the two paths that weren't taken. Whoever wants to revive it will
// have to rebuild the three versions against today's box.
//
//   node scripts/vorschau-laufzeit.mjs
//
// Used to produce preview/laufzeit.png
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');
const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

// Verbatim from index.html: the entire creation box, from .poll-admin to
// its closing tag. Not a rebuild - if it were, the preview would show
// what I think the page looks like, not what's actually there.
const cut = (von, bis) => {
  const a = html.indexOf(von);
  if (a < 0) throw new Error(`nicht gefunden: ${von}`);
  const b = html.indexOf(bis, a);
  if (b < 0) throw new Error(`Ende nicht gefunden: ${bis}`);
  return html.slice(a, b + bis.length);
};
const BOX = cut('<div id="poll-admin"', '</div>\n    </div>')
  .replace(' hidden', '');

// ---------------------------------------------------------------------------
// The versions
// ---------------------------------------------------------------------------
//
// ersetzt: what takes the place of .poll-frist.
// wohin:   'header'  - stays in the header next to "+ New poll"
//          'innen' - moves into the expanded box, like on X
//
// With 'innen', the header in the collapsed state is ONLY the button, and
// the duration isn't visible at all before expanding. That's a real loss
// and belongs to the decision: today Ansem sees the configured duration
// without touching anything.

const fieldX = (name, wert, wide) => `
  <label class="lz-feld${wide ? ' lz-breit' : ''}">
    <span class="lz-name">${name}</span>
    <select class="lz-wahl">${
      [...Array(wert.max + 1)].map((_, i) =>
        `<option${i === wert.vor ? ' selected' : ''}>${i}</option>`).join('')
    }</select>
  </label>`;

const DREI = (wide = false) => fieldX('Days', { max: 7, vor: 1 }, wide)
  + fieldX('Hours', { max: 23, vor: 0 }, wide)
  + fieldX('Minutes', { max: 59, vor: 0 }, wide);

const FASSUNGEN = [
  {
    nr: 1,
    name: 'X eins zu eins, im Kasten',
    wohin: 'innen',
    ersetzt: `<div class="lz-block">
        <span class="lz-titel">Poll length</span>
        <div class="lz-reihe">${DREI(true)}</div>
      </div>`,
    css: `
      .lz-block { display: flex; flex-direction: column; gap: .35rem; }
      .lz-titel { font-size: .82rem; color: var(--dimmer); }
      .lz-reihe { display: flex; gap: .5rem; }
      .lz-feld {
        flex: 1; min-width: 0; position: relative;
        display: flex; flex-direction: column; gap: .1rem;
        background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
        padding: .4rem .6rem;
        transition: border-color .15s;
      }
      .lz-name { font-size: .72rem; color: var(--dimmer); }
      .lz-wahl {
        appearance: none; background: none; border: 0; padding: 0;
        font: inherit; font-family: var(--mono); font-size: .95rem; color: var(--text);
        cursor: pointer; outline: none;
      }
      /* The arrow is drawn, not a character: a "v" from the font sits
         too high and is too wide in the mono face. */
      .lz-feld::after {
        content: ''; position: absolute; right: .6rem; top: 50%;
        width: 8px; height: 8px; margin-top: -5px;
        border-right: 1.6px solid var(--dimmer); border-bottom: 1.6px solid var(--dimmer);
        transform: rotate(45deg); pointer-events: none;
      }
      .lz-wahl option { background: var(--bg-1); color: var(--text); }
      :root[data-tastatur] .lz-feld:focus-within { border-color: var(--fokus); }`,
    text: 'Genau der Aufbau vom Screenshot: Überschrift, darunter drei gleich width '
      + 'Kästen mit Beschriftung, Wert und Pfeil. Er steht im aufgeklappten Kasten, '
      + 'nicht mehr in der Kopfzeile – am Rechner passte er dort knapp, auf dem Handy '
      + 'gar nicht. Der Preis: Zugeklappt ist die eingestellte Laufzeit nicht mehr zu sehen.',
  },
  {
    nr: 2,
    name: 'Drei Felder, unsere Form',
    wohin: 'innen',
    ersetzt: `<div class="lz-block">
        <span class="lz-titel">Runs for</span>
        <div class="lz-reihe">
          <label class="lz-feld"><select class="lz-wahl">${
            [...Array(8)].map((_, i) => `<option${i === 1 ? ' selected' : ''}>${i}</option>`).join('')
          }</select><span class="lz-einheit">d</span></label>
          <label class="lz-feld"><select class="lz-wahl">${
            [...Array(24)].map((_, i) => `<option${i === 0 ? ' selected' : ''}>${i}</option>`).join('')
          }</select><span class="lz-einheit">h</span></label>
          <label class="lz-feld"><select class="lz-wahl">${
            [...Array(60)].map((_, i) => `<option${i === 0 ? ' selected' : ''}>${i}</option>`).join('')
          }</select><span class="lz-einheit">m</span></label>
        </div>
      </div>`,
    css: `
      .lz-block { display: flex; align-items: center; gap: .6rem; }
      .lz-titel { font-size: .82rem; color: var(--dimmer); }
      .lz-reihe { display: flex; gap: .4rem; }
      /* The same border as .filter-group and .frist-feld: tight around
         the content, a borderless field and the unit right after it. */
      .lz-feld {
        display: inline-flex; align-items: center; gap: .15rem;
        background: var(--bg); border: 1px solid var(--line); border-radius: 7px;
        padding: .18rem .45rem;
        transition: border-color .15s;
      }
      .lz-wahl {
        appearance: none; background: none; border: 0; padding: 0;
        font: inherit; font-family: var(--mono); font-size: .78rem; color: var(--dim);
        cursor: pointer; outline: none; text-align: right;
      }
      .lz-einheit { font-family: var(--mono); font-size: .78rem; color: var(--dimmer); }
      .lz-wahl option { background: var(--bg-1); color: var(--text); }
      :root[data-tastatur] .lz-feld:focus-within { border-color: var(--fokus); }`,
    text: 'Dieselben drei Werte, aber in der Form, die die Seite schon hat: der Rahmen '
      + 'von Ansems Schwellenfeld, die Einheit als Buchstabe dahinter, alles in einer '
      + 'Zeile. Kein Pfeil – anklickbar ist es trotzdem. Deutlich flacher als 1.',
  },
  {
    nr: 3,
    name: 'Drei Felder, unsere Form – in der Kopfzeile',
    wohin: 'header',
    ersetzt: `<div class="poll-frist lz-block">
        <span class="frist-label">Runs for</span>
        <div class="lz-reihe">
          <label class="lz-feld"><select class="lz-wahl">${
            [...Array(8)].map((_, i) => `<option${i === 1 ? ' selected' : ''}>${i}</option>`).join('')
          }</select><span class="lz-einheit">d</span></label>
          <label class="lz-feld"><select class="lz-wahl">${
            [...Array(24)].map((_, i) => `<option${i === 0 ? ' selected' : ''}>${i}</option>`).join('')
          }</select><span class="lz-einheit">h</span></label>
          <label class="lz-feld"><select class="lz-wahl">${
            [...Array(60)].map((_, i) => `<option${i === 0 ? ' selected' : ''}>${i}</option>`).join('')
          }</select><span class="lz-einheit">m</span></label>
        </div>
      </div>`,
    css: `
      .lz-block { display: flex; align-items: center; gap: .5rem; }
      .lz-reihe { display: flex; gap: .3rem; }
      .lz-feld {
        display: inline-flex; align-items: center; gap: .15rem;
        background: var(--bg); border: 1px solid var(--line); border-radius: 7px;
        padding: .18rem .4rem;
        transition: border-color .15s;
      }
      .lz-wahl {
        appearance: none; background: none; border: 0; padding: 0;
        font: inherit; font-family: var(--mono); font-size: .78rem; color: var(--dim);
        cursor: pointer; outline: none; text-align: right;
      }
      .lz-einheit { font-family: var(--mono); font-size: .78rem; color: var(--dimmer); }
      .lz-wahl option { background: var(--bg-1); color: var(--text); }
      :root[data-tastatur] .lz-feld:focus-within { border-color: var(--fokus); }`,
    text: 'Wie 2, aber am alten Platz: right neben "+ New poll", auch im zugeklappten '
      + 'Zustand sichtbar. Am Rechner geht das auf. Auf dem Handy bricht die Zeile um – '
      + 'genau das ist hier die Frage.',
  },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, res) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(publicDir, p);
  if (!f.startsWith(publicDir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(f)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const basis = `http://127.0.0.1:${server.address().port}`;

/** An image of one version, at one width, expanded or collapsed. */
async function bild(f, width, offen) {
  const page = await browser.newPage({ viewport: { width: width, height: 400 } });
  await page.goto(basis);
  await page.waitForTimeout(150);

  let markup = BOX;
  if (f.wohin === 'innen') {
    // Out of the header, into the box - right before the row with the
    // buttons, like on X below the last answer.
    markup = markup.replace(/<div class="poll-frist">[\s\S]*?<\/div>\s*<\/div>/, '</div>')
                   .replace('<div class="row">', `${f.ersetzt}\n        <div class="row">`);
  } else {
    markup = markup.replace(/<div class="poll-frist">[\s\S]*?<\/div>\s*<\/div>/, `${f.ersetzt}\n      </div>`);
  }

  await page.addStyleTag({ content: f.css });
  await page.evaluate(([m, auf]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    const pane = document.querySelector('#pane-polls');
    pane.hidden = false;
    pane.querySelector('#poll-admin').outerHTML = m;
    const panel = document.querySelector('#poll-admin');
    panel.hidden = false;
    panel.classList.toggle('offen', auf);
    document.querySelector('#poll-admin-felder').hidden = !auf;
    document.querySelector('#poll-list').innerHTML = '';
    // The topbar and the list would only get in the way of the crop.
    document.querySelector('.topbar').style.display = 'none';
  }, [markup, offen]);
  await page.waitForTimeout(120);

  const ziel = page.locator('#poll-admin');
  const panel = await ziel.boundingBox();
  const png = await page.screenshot({
    clip: { x: 0, y: panel.y - 10, width: width, height: panel.height + 20 },
  });
  const header = await page.locator('.poll-admin-kopf').boundingBox();
  await page.close();
  return { png: png.toString('base64'), height: Math.round(panel.height), kopfHoehe: Math.round(header.height) };
}

console.log('\n  Gemessen: Hoehe des Kastens\n');
console.log('  ' + 'Fassung'.padEnd(40) + 'zu (1000px)'.padEnd(14)
  + 'auf (1000px)'.padEnd(15) + 'Kopfzeile auf 390px');

const bilder = [];
for (const f of FASSUNGEN) {
  const zu = await bild(f, 1000, false);
  const auf = await bild(f, 1000, true);
  const handyZu = await bild(f, 390, false);
  const handyAuf = await bild(f, 390, true);
  bilder.push({ f, zu, auf, handyZu, handyAuf });
  console.log('  ' + `${f.nr}. ${f.name}`.padEnd(40)
    + `${zu.height} px`.padEnd(14) + `${auf.height} px`.padEnd(15)
    + `${handyZu.kopfHoehe} px`);
}

const pageHtml = `
<style>
  body { margin: 0; padding: 2rem; background: #06070a; color: #e7e9ee;
         font-family: ui-monospace, monospace; font-size: 15px; }
  h1 { font-size: 1.2rem; margin: 0 0 .3rem; }
  .lead { color: #8b93a7; font-size: .85rem; max-width: 62rem; line-height: 1.6; margin: 0 0 2rem; }
  .fass { margin-bottom: 2.6rem; border-top: 1px solid #262b39; padding-top: 1.1rem; }
  h2 { font-size: .95rem; margin: 0 0 .35rem; }
  h2 .nr { display: inline-block; min-width: 1.6rem; color: #eceff5; }
  .hinweis { color: #8b93a7; font-size: .8rem; line-height: 1.6; max-width: 62rem; margin: 0 0 1rem; }
  .paar { display: flex; gap: 1.2rem; align-items: flex-start; flex-wrap: wrap; }
  .shoot { border: 1px solid #262b39; border-radius: 10px; overflow: hidden; }
  .shoot img { display: block; }
  .cap { font-size: .7rem; color: #5d657a; margin: 0 0 .3rem; text-transform: uppercase; letter-spacing: .08em; }
</style>
<h1>Die Laufzeit als Tage / Stunden / Minuten</h1>
<p class="lead">Links jeweils zugeklappt, right aufgeklappt – peek am Rechner (1000 px),
darunter auf dem Handy (390 px). Der Unterschied zwischen den Fassungen ist nicht die Form
der Felder, sondern <b>wo sie stehen</b>: in der Kopfzeile neben „+ New poll" (dort steht die
Laufzeit heute, auch zugeklappt sichtbar) oder im aufgeklappten Kasten wie bei X.</p>
${bilder.map(({ f, zu, auf, handyZu, handyAuf }) => `
<div class="fass">
  <h2><span class="nr">${f.nr}.</span>${f.name}</h2>
  <p class="hinweis">${f.text}</p>
  <div class="paar">
    <div><p class="cap">Rechner · zu</p><div class="shoot"><img src="data:image/png;base64,${zu.png}"></div></div>
    <div><p class="cap">Rechner · auf</p><div class="shoot"><img src="data:image/png;base64,${auf.png}"></div></div>
  </div>
  <div class="paar" style="margin-top:1rem">
    <div><p class="cap">390 px · zu</p><div class="shoot"><img src="data:image/png;base64,${handyZu.png}"></div></div>
    <div><p class="cap">390 px · auf</p><div class="shoot"><img src="data:image/png;base64,${handyAuf.png}"></div></div>
  </div>
</div>`).join('')}
`;

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
await page.setContent(pageHtml);
await page.waitForTimeout(200);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await page.screenshot({ path: path.join(root, 'preview', 'laufzeit.png'), fullPage: true });

await browser.close();
server.close();
console.log('\n  preview/laufzeit.png\n');
