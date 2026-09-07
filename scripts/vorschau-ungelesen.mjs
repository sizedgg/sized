// ============================================================================
// Ideas: read versus unread.
//
// Today the state has TWO signals, both quiet: a faintly blue area and a
// preview line that sits one shade lighter. Blue, and not lighter, because
// lightness is already spoken for - the lighter area means "just opened".
// If both states were shades of lightness, they'd be mistakable for each
// other.
//
// That's exactly what the check running alongside this hinges on, the one
// nobody sees in a screenshot: the list has THREE areas that can get in
// each other's way - unread, under the pointer, opened. An idea that makes
// "unread" clearer is worthless if it ends up looking like "opened" while
// doing it. So for every version, how far the three sit apart from each
// other is measured, and in the picture an unread row sits DIRECTLY next
// to the opened one.
//
// Discarded while building this: red badge, dot, left-hand stripe - on the
// grounds that all three asserted urgency instead of just "not read yet".
// Two of them are back in here anyway. That argument held at four rows; at
// forty the question isn't the same anymore, and a decision nobody
// re-checks eventually becomes just a habit.
//
//   node scripts/vorschau-ungelesen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'preview', 'ungelesen');
fs.mkdirSync(outDir, { recursive: true });

const nachbar = fs.readFileSync(
  path.join(root, 'scripts', 'vorschau-posteingang.mjs'), 'utf8');
const dataSource = nachbar.slice(
  nachbar.indexOf('const B58 ='), nachbar.indexOf('const CHROME'));
// eslint-disable-next-line no-new-func
const { THREADS } = new Function(`${dataSource}\nreturn { THREADS };`)();

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

// Today's rules have to be switched off before another idea can take
// effect - otherwise every version sits ON TOP and you end up comparing
// sums instead of alternatives.
const AUS = `
  .thread.is-unread { background: transparent; }
  .thread.is-unread .thread-prev { color: var(--dim); }`;

const IDEEN = [
  {
    nr: 1, name: 'jetzt', titel: 'Jetzt',
    was: 'Schwach blaue Flaeche und eine Vorschau, die eine Stufe heller steht. '
       + 'Zwei Anzeichen, beide leise.',
    css: '',
  },
  {
    nr: 2, name: 'nur-schrift', titel: 'Nur die Schrift',
    was: 'Keine Flaeche. Ungelesene stehen in voller Textfarbe, gelesene bleiben '
       + 'gedaempft. Das Leiseste, was moeglich ist – und die Frage ist, ob man '
       + 'es zwischen vierzig Zeilen noch findet.',
    css: `${AUS}
      .thread.is-unread .thread-prev { color: var(--text); }
      .thread.is-unread .w { color: var(--text); }`,
  },
  {
    nr: 3, name: 'fett', titel: 'Fette Schrift',
    was: 'Ungelesene in schwererem Schnitt, sonst nichts. So macht es jedes '
       + 'Mailprogramm, und zwar seit dreissig Jahren – das ist ein Argument, '
       + 'kein Vorwurf.',
    css: `${AUS}
      .thread.is-unread .thread-prev { color: var(--text); font-weight: 650; }`,
  },
  {
    nr: 4, name: 'dot', titel: 'Punkt left',
    was: 'Ein kleiner Punkt vor dem Kuerzel. Beim Bauen verworfen, weil er '
       + 'Dringlichkeit behaupte – hier bewusst in --dim statt in Rot oder im '
       + 'Akzent, also als Marke und nicht als Alarm.',
    css: `${AUS}
      .thread { position: relative; padding-left: 1.5rem; }
      .thread.is-unread::before {
        content: ''; position: absolute; left: .7rem; top: 50%;
        width: 6px; height: 6px; margin-top: -3px; border-radius: 50%;
        background: var(--dim);
      }
      .thread.is-unread .thread-prev { color: var(--text); }`,
  },
  {
    nr: 5, name: 'strich', titel: 'Strich am Rand',
    was: 'Ein Strich an der linken Kante. Bei vier Zeilen war das ein Zeichen, '
       + 'das schrie; bei vierzig ergeben die Striche untereinander eine Karte '
       + 'davon, wo im Stapel noch etwas offen ist.',
    css: `${AUS}
      .thread { box-shadow: inset 2px 0 0 transparent; }
      .thread.is-unread { box-shadow: inset 2px 0 0 var(--dim); }
      .thread.is-unread .thread-prev { color: var(--text); }`,
  },
  {
    nr: 6, name: 'gelesene-zurueck', titel: 'Gelesene zurückgenommen',
    was: 'Andersherum gedacht: Ungelesen ist der NORMALFALL, und gelesene Zeilen '
       + 'treten back. In einem Posteingang sind die meisten Zeilen gelesen – '
       + 'die wenigen offenen fallen dann auf, ohne dass ihnen etwas '
       + 'hinzugefuegt wird.',
    css: `${AUS}
      .thread:not(.is-unread):not(.is-active) { opacity: .58; }
      .thread.is-unread .thread-prev { color: var(--text); }`,
  },
];

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

// So the three states sit NEXT TO EACH OTHER in the picture instead of
// being scattered at random: row 3 unread, row 4 opened, row 5 unread.
const DATEN = THREADS.map((t, i) => ({
  ...t, unread: [2, 4, 8, 9, 14, 21, 22, 30].includes(i) ? 1 : 0,
}));

const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const leucht = ([r, g, b]) => 0.2126 * kanal(r / 255) + 0.7152 * kanal(g / 255) + 0.0722 * kanal(b / 255);
const kon = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

console.log('\nGelesen gegen ungelesen – 40 Gespraeche\n');

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
        cfg: { symbol: 'ANSEM', min_dm_usd: 0 }, dmMinEntwurf: null,
        dmThreads: ${JSON.stringify(DATEN)},
        activeThread: ${JSON.stringify(DATEN[3].wallet)},
      };
      ${parts}
      window.renderThreads = renderThreads;
    `,
  });
  if (idee.css) await page.addStyleTag({ content: idee.css });

  const m = await page.evaluate(() => {
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

    const lines = [...document.querySelectorAll('.thread')];

    // The ACTUALLY visible color of a row.
    //
    // getComputedStyle().backgroundColor returns rgba(0, 0, 0, 0) for a
    // transparent area - the zero in the alpha channel, but also three
    // zeros before it. Anyone who takes just the first three numbers is
    // computing against black instead of the ground underneath, and gets
    // values like 9.5:1 for two rows that look almost identical side by
    // side. That's exactly what happened on the first pass.
    //
    // So walk up from the row and layer things on top of each other until
    // an opaque area shows up. Opacity factors in too - idea 6 works with
    // nothing else.
    const realColor = (el) => {
      const layers = [];
      let deckung = 1;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        deckung *= Number(s.opacity);
        const m = s.backgroundColor.match(/[\d.]+/g);
        if (!m) continue;
        const [r, g, b, a = 1] = m.map(Number);
        if (a > 0) layers.push([r, g, b, a]);
        if (a === 1) break;
      }
      // Blend from bottom to top.
      let f = layers.pop() ?? [0, 0, 0, 1];
      while (layers.length) {
        const [r, g, b, a] = layers.pop();
        f = [0, 1, 2].map((i) => f[i] * (1 - a) + [r, g, b][i] * a);
      }
      // Opacity blends the whole row against its own ground; for the area
      // that means: against the color of the list.
      if (deckung < 1) {
        const g = getComputedStyle(document.querySelector('.thread-list'))
          .backgroundColor.match(/[\d.]+/g).map(Number);
        f = [0, 1, 2].map((i) => g[i] * (1 - deckung) + f[i] * deckung);
      }
      return f.map((x) => Math.round(x));
    };

    return {
      gelesen: realColor(lines[1]),
      ungelesen: realColor(lines[2]),
      geoeffnet: realColor(lines[3]),
      // And the type, because three of the ideas don't work with the area
      // at all. Without this they'd all look the same here.
      textGelesen: getComputedStyle(lines[1].querySelector('.thread-prev')).color,
      textUngelesen: getComputedStyle(lines[2].querySelector('.thread-prev')).color,
      fettGelesen: getComputedStyle(lines[1].querySelector('.thread-prev')).fontWeight,
      fettUngelesen: getComputedStyle(lines[2].querySelector('.thread-prev')).fontWeight,
      deckungGelesen: Number(getComputedStyle(lines[1]).opacity),
      marker: getComputedStyle(lines[2], '::before').content !== 'none'
        || getComputedStyle(lines[2]).boxShadow !== 'none',
    };
  });

  await page.screenshot({ path: path.join(outDir, `${idee.nr}-${idee.name}.png`) });
  await page.close();

  const versusRead = kon(m.ungelesen, m.gelesen);
  const gegenOffen = kon(m.ungelesen, m.geoeffnet);
  // What does the state actually hinge on? An idea that only changes the
  // type has an area ratio of 1.000:1 - and that's not a shortcoming,
  // that's its whole point.
  const carrier = [
    versusRead > 1.01 ? 'Flaeche' : null,
    m.textGelesen !== m.textUngelesen ? 'Textfarbe' : null,
    m.fettGelesen !== m.fettUngelesen ? 'Schnitt' : null,
    m.deckungGelesen < 1 ? 'Deckkraft' : null,
    m.marker ? 'Marke' : null,
  ].filter(Boolean);
  console.log(`${idee.nr}. ${idee.titel}`);
  console.log(`   ${idee.was.replace(/\s+/g, ' ')}`);
  console.log(`   getragen von: ${carrier.join(' + ')}`);
  console.log(`   Flaeche ungelesen gegen gelesen ${versusRead.toFixed(3)}:1`
    + `  ·  gegen geoeffnet ${gegenOffen.toFixed(3)}:1`);
  // The mistake the comment in the sheet warns about: an unread row that
  // looks like the opened one. Only relevant when the area is what
  // carries the signal.
  if (versusRead > 1.01 && gegenOffen < 1.03) {
    console.log('   ACHTUNG: ungelesen und geoeffnet liegen zu nah beieinander.');
  }
  console.log('');
}

await browser.close();
server.close();
console.log('Bilder in preview/ungelesen/\n');
