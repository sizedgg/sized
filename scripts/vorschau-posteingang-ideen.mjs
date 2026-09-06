// ============================================================================
// Ideen fuer Ansems Posteingang.
//
// Ausloeser ist eine Messung und keine Laune: Bei vierzig Gespraechen wird die
// Vorschau in 22 Zeilen abgeschnitten – in mehr als der Haelfte. Die Spalte ist
// 290 px breit, davon gehen Kuerzel und Betrag ab; fuer den Text bleiben oft
// zwanzig Zeichen.
//
// Jede Fassung hier beantwortet deshalb eine FRAGE und ist kein Anstrich:
//
//   2  Was kostet es, die Vorschau vollstaendig zu zeigen?
//   3  Reicht dafuer schon eine breitere Spalte?
//   4  Muss der Betrag rechts stehen – oder wird die Spalte links zur Leiter?
//   5  Verdient die Vorschau ihren Platz ueberhaupt?
//   6  Hilft eine Gliederung nach Groessenordnung beim Suchen?
//
// Alle sechs benutzen dieselbe Zeile aus dem echten renderThreads() – geaendert
// wird nur das Blatt. Das ist keine Bequemlichkeit, sondern der Punkt: Was hier
// nur mit CSS geht, geht spaeter auch ohne neues Markup.
//
//   node scripts/vorschau-posteingang-ideen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'preview', 'posteingang');
fs.mkdirSync(outDir, { recursive: true });

// Die Bausteine woertlich aus dem Vorschauskript nebenan – dieselben Daten und
// derselbe Aufbau, damit sich die Bilder wirklich vergleichen lassen.
const nachbar = fs.readFileSync(
  path.join(root, 'scripts', 'vorschau-posteingang.mjs'), 'utf8');
// Von der Zufallsadresse bis kurz vor den Browserstart: Daten, Betraege und
// Texte in einem Stueck. Woertlich und nicht nachgebaut, denn nur so sind die
// Bilder mit denen aus vorschau-posteingang.mjs wirklich vergleichbar – bis auf
// dieselbe Adresse in derselben Zeile.
const datenQuelle = nachbar.slice(
  nachbar.indexOf('const B58 ='), nachbar.indexOf('const CHROME'));

const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const teile = [
  schneide('const HANDLE_TONES', '\n'),
  schneide('const handleOf =', '\n'),
  schneide('function toneOf(wallet) {', '\n}') + '\n}',
  schneide('const esc =', '\n\n'),
  schneide('const STUFEN =', '\n'),
  schneide('function kurzUsd(', '\n}') + '\n}',
  schneide('function renderThreads() {', '\n}\n') + '\n}',
].join('\n');

// eslint-disable-next-line no-new-func
const { THREADS } = new Function(`${datenQuelle}\nreturn { THREADS };`)();

// ---------------------------------------------------------------------------
// Die Ideen
// ---------------------------------------------------------------------------
const IDEEN = [
  {
    nr: 1, name: 'jetzt', titel: 'Jetzt',
    frage: 'Der Vergleichspunkt: Kuerzel, Vorschau, Betrag – eine Zeile, 290 px Spalte.',
    css: '',
  },
  {
    nr: 2, name: 'zweizeilig', titel: 'Zweizeilig',
    frage: 'Kuerzel und Betrag oben, die Vorschau darunter ueber die volle Breite. '
         + 'Nichts wird mehr abgeschnitten – dafuer passen halb so viele Gespraeche ins Bild.',
    css: `
      .thread {
        display: grid; grid-template-columns: auto 1fr auto;
        grid-template-areas: "wer . geld" "text text text";
        align-items: baseline; row-gap: .2rem;
      }
      .thread > .h { grid-area: wer; }
      .thread > .w { grid-area: geld; }
      .thread-prev { grid-area: text; white-space: normal; }`,
  },
  {
    nr: 3, name: 'breiter', titel: 'Breitere Spalte',
    frage: 'Dieselbe Zeile, aber die Spalte von 290 auf 390 px. Der billigste Eingriff – '
         + 'kostet 100 px vom Gespraech daneben.',
    css: '.dm-admin { grid-template-columns: 390px 1fr; }',
  },
  {
    nr: 4, name: 'betrag-links', titel: 'Betrag links',
    frage: 'Der Betrag zuerst, in fester Breite. Die Liste ist nach Bestand sortiert – '
         + 'links untereinander wird daraus eine Leiter, die man von oben nach unten liest. '
         + 'Die Vorschau bekommt den ganzen Rest.',
    css: `
      .thread { display: grid; grid-template-columns: 4.2rem auto 1fr; gap: .5rem; }
      .thread > .w { order: -1; text-align: right; }
      .thread > .h { text-align: left; }`,
  },
  {
    nr: 5, name: 'ohne-vorschau', titel: 'Ohne Vorschau',
    frage: 'Nur Kuerzel und Betrag. Wenn der Text in ueber der Haelfte der Zeilen ohnehin '
         + 'abgeschnitten wird – verdient er dann seinen Platz? Dafuer stehen doppelt so '
         + 'viele Gespraeche im Bild.',
    css: `
      .thread-prev { display: none; }
      .thread { padding-top: .38rem; padding-bottom: .38rem; }
      .thread > .w { margin-left: auto; }`,
  },
  {
    nr: 6, name: 'gruppiert', titel: 'Nach Groessenordnung',
    frage: 'Dieselbe Reihenfolge, aber mit Trennlinien zwischen den Groessenordnungen. '
         + 'Beim Bauen war "keine Abschnitte" entschieden – bei vier Zeilen war das auch '
         + 'richtig. Bei vierzig ist die Frage neu.',
    css: `
      .thread[data-stufe]::before {
        content: attr(data-stufe); display: block;
        grid-column: 1 / -1;
        margin: .35rem 0 .45rem; padding-top: .5rem;
        border-top: 1px solid var(--line);
        font-size: .68rem; letter-spacing: .09em; text-transform: uppercase;
        color: var(--dimmer);
      }
      .thread[data-stufe] { display: grid; grid-template-columns: auto 1fr auto;
        align-items: baseline; column-gap: .45rem; }`,
    // Die Marken setzt kein Blatt – das muss jemand ins Markup schreiben. Hier
    // steht deshalb ausdruecklich JavaScript und nicht CSS: Diese Idee waere
    // die einzige, die renderThreads() wirklich aendern muesste.
    nachher: `
      const grenzen = [[1e6, '$1M and up'], [1e5, '$100K – $1M'], [1e4, '$10K – $100K'],
                       [1e3, '$1K – $10K'], [0, 'under $1K']];
      let letzte = null;
      document.querySelectorAll('.thread').forEach((z, i) => {
        const usd = window.__usd[i];
        const stufe = grenzen.find(([ab]) => usd >= ab)[1];
        if (stufe !== letzte) { z.dataset.stufe = stufe; letzte = stufe; }
      });`,
  },
];

// ---------------------------------------------------------------------------
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vorschau */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

console.log('\nIdeen fuer den Posteingang – 40 Gespraeche, 1280×860\n');

for (const idee of IDEEN) {
  const seite = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(200);
  await seite.addScriptTag({
    content: `
      const $ = (s, r = document) => r.querySelector(s);
      const $$ = (s, r = document) => [...r.querySelectorAll(s)];
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const openThread = () => {};
      const state = {
        cfg: { symbol: 'ANSEM', min_dm_usd: 0 },
        dmMinEntwurf: null,
        dmThreads: ${JSON.stringify(THREADS)},
        activeThread: ${JSON.stringify(THREADS[4].wallet)},
      };
      window.__usd = ${JSON.stringify(THREADS.map((t) => t.usd))};
      ${teile}
      window.renderThreads = renderThreads;
    `,
  });
  if (idee.css) await seite.addStyleTag({ content: idee.css });

  const m = await seite.evaluate((nachher) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelectorAll('.tab')[0].classList.remove('is-active');
    document.querySelectorAll('.tab')[1].classList.add('is-active');
    document.querySelector('[data-tab="dms"]').classList.add('zeigt-s');
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-user').hidden = true;
    document.querySelector('#dm-admin').hidden = false;
    document.querySelector('#dm-min-box').hidden = false;
    document.querySelector('#dm-min-input').value = '10';
    document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
      + '<span class="kuerzel">4bo</span></span>';
    document.querySelector('#me-holdings').textContent = '$14,204,880';
    window.renderThreads();
    // eslint-disable-next-line no-eval
    if (nachher) eval(nachher);

    const liste = document.querySelector('.thread-list');
    const zeilen = [...document.querySelectorAll('.thread')];
    const k = liste.getBoundingClientRect();
    return {
      // Wie viele Gespraeche stehen ohne Rollen im Bild? Das ist die Zahl, die
      // jede dieser Ideen bezahlt oder verdient.
      imBild: zeilen.filter((z) => {
        const r = z.getBoundingClientRect();
        return r.top >= k.top - 1 && r.bottom <= k.bottom + 1;
      }).length,
      gekuerzt: zeilen.filter((z) => {
        const p = z.querySelector('.thread-prev');
        return p && p.offsetParent !== null && p.scrollWidth > p.clientWidth + 1;
      }).length,
      gespraechBreite: Math.round(
        document.querySelector('.thread-view').getBoundingClientRect().width),
    };
  }, idee.nachher ?? null);

  await seite.screenshot({ path: path.join(outDir, `${idee.nr}-${idee.name}.png`) });
  await seite.close();

  console.log(`${idee.nr}. ${idee.titel}`);
  console.log(`   ${idee.frage.replace(/\s+/g, ' ')}`);
  console.log(`   ${m.imBild} von 40 Gespraechen ohne Rollen im Bild`
    + `  ·  Vorschau gekuerzt in ${m.gekuerzt}`
    + `  ·  Gespraech daneben ${m.gespraechBreite} px`);
  if (idee.nachher) {
    console.log('   ACHTUNG: Als einzige braucht diese Idee eine Aenderung an '
      + 'renderThreads() – die Marken kommen nicht aus dem Blatt.');
  }
  console.log('');
}

await browser.close();
server.close();
console.log('Bilder in preview/posteingang/\n');
