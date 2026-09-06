// ============================================================================
// Ideen: gelesen gegen ungelesen.
//
// Der Zustand hat heute ZWEI Anzeichen, beide leise: eine schwach blaue Flaeche
// und eine Vorschau, die eine Stufe heller steht. Blau und nicht heller, weil
// Helligkeit schon vergeben ist – die hellere Flaeche bedeutet "gerade
// geoeffnet". Waeren beide Zustaende Helligkeiten, waeren sie verwechselbar.
//
// Genau daran haengt die Pruefung, die hier mitlaeuft und die auf einem Bild
// niemand sieht: In der Liste gibt es DREI Flaechen, die einander im Weg stehen
// koennen – ungelesen, unter dem Zeiger, geoeffnet. Eine Idee, die "ungelesen"
// deutlicher macht, ist wertlos, wenn sie dabei aussieht wie "geoeffnet".
// Deshalb wird zu jeder Fassung gemessen, wie weit die drei auseinanderliegen,
// und im Bild steht eine ungelesene Zeile DIREKT neben der geoeffneten.
//
// Verworfen waren beim Bauen: rote Blase, Punkt, linker Strich – mit der
// Begruendung, alle drei behaupteten Dringlichkeit statt bloss "noch nicht
// gelesen". Zwei davon stehen hier trotzdem wieder drin. Das Argument galt bei
// vier Zeilen; bei vierzig ist die Frage nicht mehr dieselbe, und eine
// Entscheidung, die man nicht nachprueft, ist irgendwann nur noch Gewohnheit.
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
const datenQuelle = nachbar.slice(
  nachbar.indexOf('const B58 ='), nachbar.indexOf('const CHROME'));
// eslint-disable-next-line no-new-func
const { THREADS } = new Function(`${datenQuelle}\nreturn { THREADS };`)();

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

// Die heutigen Regeln muessen abgeschaltet werden, bevor eine andere Idee
// wirken kann – sonst liegt jede Fassung OBEN DRAUF und man vergleicht
// Summen statt Alternativen.
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
    nr: 4, name: 'punkt', titel: 'Punkt links',
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
       + 'treten zurueck. In einem Posteingang sind die meisten Zeilen gelesen – '
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

// Damit die drei Zustaende im Bild NEBENEINANDER liegen und nicht zufaellig
// verstreut: Zeile 3 ungelesen, Zeile 4 geoeffnet, Zeile 5 ungelesen.
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
        cfg: { symbol: 'ANSEM', min_dm_usd: 0 }, dmMinEntwurf: null,
        dmThreads: ${JSON.stringify(DATEN)},
        activeThread: ${JSON.stringify(DATEN[3].wallet)},
      };
      ${teile}
      window.renderThreads = renderThreads;
    `,
  });
  if (idee.css) await seite.addStyleTag({ content: idee.css });

  const m = await seite.evaluate(() => {
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

    const zeilen = [...document.querySelectorAll('.thread')];

    // Die WIRKLICH sichtbare Flaeche einer Zeile.
    //
    // getComputedStyle().backgroundColor liefert bei einer durchsichtigen
    // Flaeche rgba(0, 0, 0, 0) – die Null im Alphakanal, aber eben auch drei
    // Nullen davor. Wer nur die ersten drei Zahlen nimmt, rechnet gegen
    // Schwarz statt gegen den Grund darunter und bekommt Werte wie 9,5:1 fuer
    // zwei Zeilen, die nebeneinander fast gleich aussehen. Genau das ist beim
    // ersten Durchlauf passiert.
    //
    // Also von der Zeile nach oben laufen und uebereinanderlegen, bis eine
    // deckende Flaeche kommt. Die Deckkraft geht mit ein – Idee 6 arbeitet
    // allein damit.
    const echteFarbe = (el) => {
      const schichten = [];
      let deckung = 1;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        deckung *= Number(s.opacity);
        const m = s.backgroundColor.match(/[\d.]+/g);
        if (!m) continue;
        const [r, g, b, a = 1] = m.map(Number);
        if (a > 0) schichten.push([r, g, b, a]);
        if (a === 1) break;
      }
      // Von unten nach oben mischen.
      let f = schichten.pop() ?? [0, 0, 0, 1];
      while (schichten.length) {
        const [r, g, b, a] = schichten.pop();
        f = [0, 1, 2].map((i) => f[i] * (1 - a) + [r, g, b][i] * a);
      }
      // Die Deckkraft mischt die ganze Zeile gegen ihren eigenen Grund; fuer
      // die Flaeche heisst das: gegen die Flaeche der Liste.
      if (deckung < 1) {
        const g = getComputedStyle(document.querySelector('.thread-list'))
          .backgroundColor.match(/[\d.]+/g).map(Number);
        f = [0, 1, 2].map((i) => g[i] * (1 - deckung) + f[i] * deckung);
      }
      return f.map((x) => Math.round(x));
    };

    return {
      gelesen: echteFarbe(zeilen[1]),
      ungelesen: echteFarbe(zeilen[2]),
      geoeffnet: echteFarbe(zeilen[3]),
      // Und die Schrift, denn drei der Ideen arbeiten gar nicht mit der
      // Flaeche. Ohne das saehen sie hier alle gleich aus.
      textGelesen: getComputedStyle(zeilen[1].querySelector('.thread-prev')).color,
      textUngelesen: getComputedStyle(zeilen[2].querySelector('.thread-prev')).color,
      fettGelesen: getComputedStyle(zeilen[1].querySelector('.thread-prev')).fontWeight,
      fettUngelesen: getComputedStyle(zeilen[2].querySelector('.thread-prev')).fontWeight,
      deckungGelesen: Number(getComputedStyle(zeilen[1]).opacity),
      marke: getComputedStyle(zeilen[2], '::before').content !== 'none'
        || getComputedStyle(zeilen[2]).boxShadow !== 'none',
    };
  });

  await seite.screenshot({ path: path.join(outDir, `${idee.nr}-${idee.name}.png`) });
  await seite.close();

  const gegenGelesen = kon(m.ungelesen, m.gelesen);
  const gegenOffen = kon(m.ungelesen, m.geoeffnet);
  // Woran haengt der Zustand ueberhaupt? Eine Idee, die nur die Schrift
  // aendert, hat eine Flaechenzahl von 1,000:1 – und das ist kein Mangel,
  // sondern ihre Ansage.
  const traeger = [
    gegenGelesen > 1.01 ? 'Flaeche' : null,
    m.textGelesen !== m.textUngelesen ? 'Textfarbe' : null,
    m.fettGelesen !== m.fettUngelesen ? 'Schnitt' : null,
    m.deckungGelesen < 1 ? 'Deckkraft' : null,
    m.marke ? 'Marke' : null,
  ].filter(Boolean);
  console.log(`${idee.nr}. ${idee.titel}`);
  console.log(`   ${idee.was.replace(/\s+/g, ' ')}`);
  console.log(`   getragen von: ${traeger.join(' + ')}`);
  console.log(`   Flaeche ungelesen gegen gelesen ${gegenGelesen.toFixed(3)}:1`
    + `  ·  gegen geoeffnet ${gegenOffen.toFixed(3)}:1`);
  // Der Fehler, vor dem der Kommentar im Blatt warnt: Eine ungelesene Zeile,
  // die aussieht wie die geoeffnete. Nur relevant, wenn die Flaeche der
  // Traeger ist.
  if (gegenGelesen > 1.01 && gegenOffen < 1.03) {
    console.log('   ACHTUNG: ungelesen und geoeffnet liegen zu nah beieinander.');
  }
  console.log('');
}

await browser.close();
server.close();
console.log('Bilder in preview/ungelesen/\n');
