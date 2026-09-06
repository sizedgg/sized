// ============================================================================
// Vorschau: Die Laufzeit als Tage / Stunden / Minuten
//
// Heute steht dort ein einziger Wert in Stunden, mit einem Plus und einem
// Minus daneben: "− 24h +". Das ist eine Reihe, durch die man sich tippt.
// Gewuenscht ist die Form von X: drei Auswahlfelder nebeneinander, Tage,
// Stunden, Minuten, jedes einzeln waehlbar.
//
// Der Unterschied ist groesser als er aussieht, und zwar aus einem Grund, der
// nichts mit Geschmack zu tun hat: PLATZ.
//
//   heute      ein Kasten,  ~92 px breit
//   X-Form     drei Kaesten, jeder mit Beschriftung und Pfeil
//
// Und dieser Platz muss irgendwo herkommen. Heute steht die Laufzeit in der
// KOPFZEILE des Anlegekastens, rechts neben "+ New poll", und zwar sichtbar
// auch im zugeklappten Zustand. Drei Kaesten passen dort am Rechner knapp und
// auf 390 px gar nicht.
//
// Deshalb zeigt diese Vorschau nicht nur "wie sehen die Felder aus", sondern
// vor allem: WO stehen sie. Jede Fassung wird am Rechner und auf dem Handy
// gerendert, zugeklappt und aufgeklappt.
//
// Alles Markup und alles CSS wird woertlich aus index.html und styles.css
// geschnitten. Nur was die jeweilige Fassung AENDERT, steht hier im Skript –
// sonst wuerde die Vorschau eine nachgebaute Seite zeigen statt der echten.
//
// ----------------------------------------------------------------------------
// ACHTUNG: Dieses Skript laeuft nicht mehr.
//
// Es schneidet .poll-frist aus index.html – den alten Stundenschalter in der
// Kopfzeile. Den gibt es seit der Entscheidung fuer Fassung 1 nicht mehr, und
// damit faellt der Schnitt ins Leere.
//
// Es bleibt trotzdem liegen, weil es die Frage festhaelt, die entschieden
// wurde, und die beiden Wege, die nicht genommen wurden. Wer es wiederbeleben
// will, muss die drei Fassungen gegen den heutigen Kasten neu aufbauen.
//
//   node scripts/vorschau-laufzeit.mjs
//
// Erzeugte preview/laufzeit.png
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oeffentlich = path.join(root, 'public');
const css = fs.readFileSync(path.join(oeffentlich, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(oeffentlich, 'index.html'), 'utf8');

// Woertlich aus index.html: der ganze Anlegekasten, von .poll-admin bis zu
// seinem schliessenden Tag. Kein Nachbau – waere es einer, zeigte die
// Vorschau, was ich fuer die Seite halte, und nicht, was dort steht.
const schneide = (von, bis) => {
  const a = html.indexOf(von);
  if (a < 0) throw new Error(`nicht gefunden: ${von}`);
  const b = html.indexOf(bis, a);
  if (b < 0) throw new Error(`Ende nicht gefunden: ${bis}`);
  return html.slice(a, b + bis.length);
};
const KASTEN = schneide('<div id="poll-admin"', '</div>\n    </div>')
  .replace(' hidden', '');

// ---------------------------------------------------------------------------
// Die Fassungen
// ---------------------------------------------------------------------------
//
// ersetzt: Was an die Stelle von .poll-frist tritt.
// wohin:   'kopf'  – bleibt in der Kopfzeile neben "+ New poll"
//          'innen' – wandert in den aufgeklappten Kasten, wie bei X
//
// Bei 'innen' ist die Kopfzeile im zugeklappten Zustand NUR noch der Knopf,
// und die Laufzeit ist gar nicht zu sehen, bevor man aufklappt. Das ist ein
// echter Verlust und gehoert zur Entscheidung dazu: Heute sieht Ansem die
// eingestellte Laufzeit, ohne etwas anzufassen.

const feldX = (name, wert, breit) => `
  <label class="lz-feld${breit ? ' lz-breit' : ''}">
    <span class="lz-name">${name}</span>
    <select class="lz-wahl">${
      [...Array(wert.max + 1)].map((_, i) =>
        `<option${i === wert.vor ? ' selected' : ''}>${i}</option>`).join('')
    }</select>
  </label>`;

const DREI = (breit = false) => feldX('Days', { max: 7, vor: 1 }, breit)
  + feldX('Hours', { max: 23, vor: 0 }, breit)
  + feldX('Minutes', { max: 59, vor: 0 }, breit);

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
      /* Der Pfeil ist gezeichnet, kein Zeichen: Ein "v" aus der Schrift steht
         zu hoch und ist in der Mono zu breit. */
      .lz-feld::after {
        content: ''; position: absolute; right: .6rem; top: 50%;
        width: 8px; height: 8px; margin-top: -5px;
        border-right: 1.6px solid var(--dimmer); border-bottom: 1.6px solid var(--dimmer);
        transform: rotate(45deg); pointer-events: none;
      }
      .lz-wahl option { background: var(--bg-1); color: var(--text); }
      :root[data-tastatur] .lz-feld:focus-within { border-color: var(--fokus); }`,
    text: 'Genau der Aufbau vom Screenshot: Überschrift, darunter drei gleich breite '
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
      /* Derselbe Rahmen wie .filter-group und .frist-feld: eng am Inhalt, ein
         randloses Feld und die Einheit dahinter. */
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
    wohin: 'kopf',
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
    text: 'Wie 2, aber am alten Platz: rechts neben "+ New poll", auch im zugeklappten '
      + 'Zustand sichtbar. Am Rechner geht das auf. Auf dem Handy bricht die Zeile um – '
      + 'genau das ist hier die Frage.',
  },
];

// ---------------------------------------------------------------------------
// Rendern
// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, res) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(oeffentlich, p);
  if (!f.startsWith(oeffentlich) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(f)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const basis = `http://127.0.0.1:${server.address().port}`;

/** Ein Bild einer Fassung, in einer Breite, auf- oder zugeklappt. */
async function bild(f, breite, offen) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 400 } });
  await seite.goto(basis);
  await seite.waitForTimeout(150);

  let markup = KASTEN;
  if (f.wohin === 'innen') {
    // Aus der Kopfzeile raus, in den Kasten rein – vor die Zeile mit den
    // Knoepfen, wie bei X unter der letzten Antwort.
    markup = markup.replace(/<div class="poll-frist">[\s\S]*?<\/div>\s*<\/div>/, '</div>')
                   .replace('<div class="row">', `${f.ersetzt}\n        <div class="row">`);
  } else {
    markup = markup.replace(/<div class="poll-frist">[\s\S]*?<\/div>\s*<\/div>/, `${f.ersetzt}\n      </div>`);
  }

  await seite.addStyleTag({ content: f.css });
  await seite.evaluate(([m, auf]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    const pane = document.querySelector('#pane-polls');
    pane.hidden = false;
    pane.querySelector('#poll-admin').outerHTML = m;
    const kasten = document.querySelector('#poll-admin');
    kasten.hidden = false;
    kasten.classList.toggle('offen', auf);
    document.querySelector('#poll-admin-felder').hidden = !auf;
    document.querySelector('#poll-list').innerHTML = '';
    // Die Kopfzeile und die Liste stoeren im Ausschnitt nur.
    document.querySelector('.topbar').style.display = 'none';
  }, [markup, offen]);
  await seite.waitForTimeout(120);

  const ziel = seite.locator('#poll-admin');
  const kasten = await ziel.boundingBox();
  const png = await seite.screenshot({
    clip: { x: 0, y: kasten.y - 10, width: breite, height: kasten.height + 20 },
  });
  const kopf = await seite.locator('.poll-admin-kopf').boundingBox();
  await seite.close();
  return { png: png.toString('base64'), hoehe: Math.round(kasten.height), kopfHoehe: Math.round(kopf.height) };
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
    + `${zu.hoehe} px`.padEnd(14) + `${auf.hoehe} px`.padEnd(15)
    + `${handyZu.kopfHoehe} px`);
}

const seiteHtml = `
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
  .schuss { border: 1px solid #262b39; border-radius: 10px; overflow: hidden; }
  .schuss img { display: block; }
  .cap { font-size: .7rem; color: #5d657a; margin: 0 0 .3rem; text-transform: uppercase; letter-spacing: .08em; }
</style>
<h1>Die Laufzeit als Tage / Stunden / Minuten</h1>
<p class="lead">Links jeweils zugeklappt, rechts aufgeklappt – oben am Rechner (1000 px),
darunter auf dem Handy (390 px). Der Unterschied zwischen den Fassungen ist nicht die Form
der Felder, sondern <b>wo sie stehen</b>: in der Kopfzeile neben „+ New poll" (dort steht die
Laufzeit heute, auch zugeklappt sichtbar) oder im aufgeklappten Kasten wie bei X.</p>
${bilder.map(({ f, zu, auf, handyZu, handyAuf }) => `
<div class="fass">
  <h2><span class="nr">${f.nr}.</span>${f.name}</h2>
  <p class="hinweis">${f.text}</p>
  <div class="paar">
    <div><p class="cap">Rechner · zu</p><div class="schuss"><img src="data:image/png;base64,${zu.png}"></div></div>
    <div><p class="cap">Rechner · auf</p><div class="schuss"><img src="data:image/png;base64,${auf.png}"></div></div>
  </div>
  <div class="paar" style="margin-top:1rem">
    <div><p class="cap">390 px · zu</p><div class="schuss"><img src="data:image/png;base64,${handyZu.png}"></div></div>
    <div><p class="cap">390 px · auf</p><div class="schuss"><img src="data:image/png;base64,${handyAuf.png}"></div></div>
  </div>
</div>`).join('')}
`;

const seite = await browser.newPage({ viewport: { width: 1180, height: 900 } });
await seite.setContent(seiteHtml);
await seite.waitForTimeout(200);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await seite.screenshot({ path: path.join(root, 'preview', 'laufzeit.png'), fullPage: true });

await browser.close();
server.close();
console.log('\n  preview/laufzeit.png\n');
