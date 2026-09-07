// ============================================================================
// Ideas for Ansem's inbox.
//
// The trigger is a measurement, not a whim: at forty conversations, the
// preview gets cut off in 22 rows - more than half of them. The column is
// 290 px wide, minus what the handle and amount take up; often only twenty
// characters are left for the text.
//
// Every version here therefore answers a QUESTION and isn't a coat of paint:
//
//   2  What does it cost to show the preview in full?
//   3  Would a wider column already be enough for that?
//   4  Does the amount have to sit on the right - or does the left column
//      turn into a ladder?
//   5  Does the preview even earn its place?
//   6  Does grouping by order of magnitude help with searching?
//
// All six use the same row from the real renderThreads() - only the
// stylesheet changes. That's not a convenience, it's the point: whatever
// works here with just CSS also works later without new markup.
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

// The building blocks verbatim from the preview script next door - the same
// data and the same setup, so the images can really be compared.
const nachbar = fs.readFileSync(
  path.join(root, 'scripts', 'vorschau-posteingang.mjs'), 'utf8');
// From the random address up to right before the browser launches: data,
// amounts and text in one piece. Verbatim and not rebuilt, since only that
// way are the images really comparable with those from
// vorschau-posteingang.mjs - down to the same address in the same row.
const dataSource = nachbar.slice(
  nachbar.indexOf('const B58 ='), nachbar.indexOf('const CHROME'));

const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const parts = [
  cut('const HANDLE_TONES', '\n'),
  cut('const handleOf =', '\n'),
  cut('function toneOf(wallet) {', '\n}') + '\n}',
  cut('const esc =', '\n\n'),
  cut('const TIERS =', '\n'),
  cut('function shortUsd(', '\n}') + '\n}',
  cut('function renderThreads() {', '\n}\n') + '\n}',
].join('\n');

// eslint-disable-next-line no-new-func
const { THREADS } = new Function(`${dataSource}\nreturn { THREADS };`)();

// ---------------------------------------------------------------------------
// The ideas
// ---------------------------------------------------------------------------
const IDEEN = [
  {
    nr: 1, name: 'jetzt', titel: 'Jetzt',
    pollQuestion: 'Der Vergleichspunkt: Kuerzel, Vorschau, Betrag – eine Zeile, 290 px Spalte.',
    css: '',
  },
  {
    nr: 2, name: 'zweizeilig', titel: 'Zweizeilig',
    pollQuestion: 'Kuerzel und Betrag peek, die Vorschau darunter ueber die volle Breite. '
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
    pollQuestion: 'Dieselbe Zeile, aber die Spalte von 290 auf 390 px. Der billigste Eingriff – '
         + 'kostet 100 px vom Gespraech daneben.',
    css: '.dm-admin { grid-template-columns: 390px 1fr; }',
  },
  {
    nr: 4, name: 'betrag-links', titel: 'Betrag left',
    pollQuestion: 'Der Betrag zuerst, in fester Breite. Die Liste ist nach Bestand sortiert – '
         + 'left untereinander wird daraus eine Leiter, die man von peek nach bottom liest. '
         + 'Die Vorschau bekommt den ganzen Rest.',
    css: `
      .thread { display: grid; grid-template-columns: 4.2rem auto 1fr; gap: .5rem; }
      .thread > .w { order: -1; text-align: right; }
      .thread > .h { text-align: left; }`,
  },
  {
    nr: 5, name: 'ohne-vorschau', titel: 'Ohne Vorschau',
    pollQuestion: 'Nur Kuerzel und Betrag. Wenn der Text in ueber der Haelfte der Zeilen ohnehin '
         + 'abgeschnitten wird – verdient er dann seinen Platz? Dafuer stehen doppelt so '
         + 'viele Gespraeche im Bild.',
    css: `
      .thread-prev { display: none; }
      .thread { padding-top: .38rem; padding-bottom: .38rem; }
      .thread > .w { margin-left: auto; }`,
  },
  {
    nr: 6, name: 'gruppiert', titel: 'Nach Groessenordnung',
    pollQuestion: 'Dieselbe Reihenfolge, aber mit Trennlinien zwischen den Groessenordnungen. '
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
    // No stylesheet sets these markers - somebody has to write them into the
    // markup. That's why this is deliberately JavaScript and not CSS: this
    // idea would be the only one that would actually require changing
    // renderThreads().
    nachher: `
      const grenzen = [[1e6, '$1M and up'], [1e5, '$100K – $1M'], [1e4, '$10K – $100K'],
                       [1e3, '$1K – $10K'], [0, 'under $1K']];
      let last = null;
      document.querySelectorAll('.thread').forEach((z, i) => {
        const usd = window.__usd[i];
        const tier = grenzen.find(([ab]) => usd >= ab)[1];
        if (tier !== last) { z.dataset.tier = tier; last = tier; }
      });`,
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
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vorschau */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

console.log('\nIdeen fuer den Posteingang – 40 Gespraeche, 1280×860\n');

for (const idee of IDEEN) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(200);
  await page.addScriptTag({
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
      ${parts}
      window.renderThreads = renderThreads;
    `,
  });
  if (idee.css) await page.addStyleTag({ content: idee.css });

  const m = await page.evaluate((nachher) => {
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
    const lines = [...document.querySelectorAll('.thread')];
    const k = liste.getBoundingClientRect();
    return {
      // How many conversations fit in the frame without scrolling? That's
      // the number every one of these ideas either pays or earns.
      imBild: lines.filter((z) => {
        const r = z.getBoundingClientRect();
        return r.top >= k.top - 1 && r.bottom <= k.bottom + 1;
      }).length,
      gekuerzt: lines.filter((z) => {
        const p = z.querySelector('.thread-prev');
        return p && p.offsetParent !== null && p.scrollWidth > p.clientWidth + 1;
      }).length,
      gespraechBreite: Math.round(
        document.querySelector('.thread-view').getBoundingClientRect().width),
    };
  }, idee.nachher ?? null);

  await page.screenshot({ path: path.join(outDir, `${idee.nr}-${idee.name}.png`) });
  await page.close();

  console.log(`${idee.nr}. ${idee.titel}`);
  console.log(`   ${idee.pollQuestion.replace(/\s+/g, ' ')}`);
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
