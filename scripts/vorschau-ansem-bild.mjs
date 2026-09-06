// ============================================================================
// Vorschau: Ansem mit rundem Profilbild statt der drei Zeichen
//
// Die Frage klingt nach einer Bildfrage und ist in Wahrheit eine Layoutfrage.
// Der Grund steht im Blatt, in einem Kommentar ueber .msg:
//
//   grid-template-columns: 1.75rem minmax(0, 1fr) auto auto;
//
// Die erste Spalte ist 28 px breit und FEST. Sie ist genau so breit, weil ein
// Kuerzel aus drei Schreibmaschinenzeichen 25 px misst – und weil alle echten
// Kuerzel exakt drei Zeichen lang sind, beginnt der Text in jeder Zeile der
// Liste an derselben Stelle. Das ist der Grund, warum der Chat als Liste liest
// und nicht als Sammlung von Absaetzen.
//
// Ein Bild in diese Spalte zu setzen heisst deshalb: entweder es passt in
// 28 px – dann aendert sich am Aufbau der Liste nichts –, oder die Spalte
// waechst, und dann rueckt der Text ALLER Zeilen nach rechts, nicht nur
// Ansems. Genau das wird hier gemessen und nicht geschaetzt.
//
// Die zweite Sache, die man sehen muss: align-items: baseline. Text hat eine
// Schriftlinie, ein Bild nicht – der Browser nimmt dann seine Unterkante. Ein
// Bild sitzt in einer Zeile mit Schriftlinie also anders, als man erwartet.
//
// Nichts hiervon ist eingebaut, und das Bild liegt nur in preview/.
//
// Erzeugt preview/ansembild-*.png und preview/ansembild-uebersicht.png
//   node scripts/vorschau-ansem-bild.mjs
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const bildDatei = path.join(root, 'preview', 'ansem-avatar.jpg');
if (!fs.existsSync(bildDatei)) throw new Error(`Fehlt: ${bildDatei}`);
const AVATAR = 'data:image/jpeg;base64,' + fs.readFileSync(bildDatei).toString('base64');

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const stueck = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};

const zahlen = schneide('const nfCompact =', '/* Ausgeschrieben statt');
const kurz = schneide('const STUFEN =', '\n/**\n * Datumstrenner');
const tage = schneide('const tagBeginn =', 'const handleOf');
const namen = schneide('const handleOf =', '\nconst esc =');
const escFn = schneide('const esc = (s) =>', '\n\n');
const linkify = schneide('const LINK_MUSTER =', '\nfunction toast(');
const chatBau = schneide('const istAdmin =', '\nfunction appendMessage');
const chatGeruest = stueck('<main id="pane-chat"', '</main>');

// Die Spaltenbreite aus dem Blatt lesen statt sie zu kennen – sie ist einmal
// von 3,4rem auf 1,75rem geaendert worden, und beim naechsten Mal soll dieser
// Text nicht luegen.
//
// Und rem ist hier NICHT 16 px: html, body stehen auf 15 px. 1,75rem sind
// damit 26 und nicht 28 – ein Bild in "28 px, passt genau" haette also zwei
// Pixel ueber die Spalte gestanden. Auch die Grundgroesse wird deshalb
// gelesen und nicht angenommen.
const SPALTE = /grid-template-columns: ([\d.]+)rem minmax/.exec(css)?.[1];
if (!SPALTE) throw new Error('Die erste Spalte von .msg sieht anders aus als erwartet');
const GRUNDGROESSE = Number(/font-family: var\(--mono\); font-size: (\d+)px/.exec(css)?.[1]);
if (!GRUNDGROESSE) throw new Error('Die Grundgroesse steht nicht mehr, wo sie stand');
const SPALTE_PX = Math.round(Number(SPALTE) * GRUNDGROESSE);

// Das Bild wird per CSS in die Zeile gesetzt, ohne app.js anzufassen: Die drei
// Zeichen bleiben im Markup stehen und werden nur unsichtbar gemacht. Fuer
// eine Vorschau reicht das – und es zeigt ehrlich, was das Layout tut, weil
// der Rest der Zeile echt bleibt.
const alsBild = (groesse, mitZeichen) => `
  /* align-self: center und nicht die Schriftlinie der Zeile.
     Ein Bild hat keine Schriftlinie – der Browser nimmt dann seine Unterkante,
     und das Bild ragt ueber die Zeile hinaus, statt in ihr zu sitzen. Ohne
     diese eine Zeile wird Ansems Zeile hoeher als noetig. */
  .msg.is-admin .who { align-self: center; }
  .msg.is-admin .who .admin-name {
    ${mitZeichen ? '' : 'font-size: 0;'}
    display: inline-flex; align-items: center; gap: .35rem;
  }
  .msg.is-admin .who .admin-name::before {
    content: ''; flex: none;
    width: ${groesse}px; height: ${groesse}px; border-radius: 50%;
    background: url('${AVATAR}') center/cover no-repeat;
  }`;

const spaltenRegel = (px) => px <= SPALTE_PX ? ''
  : `.msg, .msg.has-quote { grid-template-columns: ${px}px minmax(0, 1fr) auto auto; }`;

const FASSUNGEN = [
  {
    datei: 'jetzt', name: 'Jetzt – drei Zeichen', css: '',
    text: 'Der Stand. Die erste Spalte ist ' + SPALTE_PX + ' px breit und fest; alle Kürzel '
      + 'sind exakt drei Zeichen lang, deshalb beginnt der Text in jeder Zeile an derselben '
      + 'Stelle.',
  },
  {
    datei: 'zeilenhoch', name: 'Bild in 20 px – so hoch wie die Zeile',
    css: alsBild(20, false),
    text: 'Klein genug, dass es in die Zeile passt, die ohnehin da ist. Als einzige Fassung '
      + 'lässt sie den Aufbau der Liste in Ruhe: gleiche Spalte, gleicher Textanfang, und '
      + 'Ansems Zeilen werden nicht höher (sie sind sogar 3 px flacher, weil die drei '
      + 'Zeichen wegfallen). Dafür ist ein Gesicht in 20 px kaum mehr als ein Fleck.',
  },
  {
    datei: 'klein', name: `Bild in ${SPALTE_PX} px – so breit wie die Spalte`,
    css: alsBild(SPALTE_PX, false),
    text: 'So breit, wie die Spalte ohnehin ist – die Spalte hält also, und der Text aller '
      + 'Zeilen beginnt weiter an derselben Stelle. Aber: Ansems Zeilen werden 3 px höher '
      + 'als die anderen, weil das Bild höher ist als eine Textzeile. Bei drei Nachrichten '
      + 'in einer langen Liste ist das ein leicht unruhiger Rhythmus, kein Bruch.',
  },
  {
    datei: 'gross', name: 'Bild in 34 px – die Spalte wächst',
    css: alsBild(34, false) + spaltenRegel(34),
    text: 'Deutlich erkennbar, aber die erste Spalte muss dafür wachsen – und die gilt für '
      + 'ALLE Zeilen. Der Text jeder Nachricht rückt 8 px nach rechts, auch der von Leuten '
      + 'ohne Bild, und hinter deren drei Zeichen steht dann eine Lücke. Genau dieser '
      + 'Zustand war schon einmal da (3,4rem Spalte für Ansems Tokenkürzel) und wurde '
      + 'abgeschafft.',
  },
  {
    datei: 'beides', name: 'Bild und Zeichen',
    css: alsBild(22, true) + spaltenRegel(60),
    text: 'Bild plus Kürzel. Ansems Zeilen bleiben genauso hoch wie die anderen – aber die '
      + 'Spalte wächst auf 60 px, und der Text jeder Nachricht rückt 34 px nach rechts. '
      + 'Das ist die teuerste Fassung, und die drei Zeichen sagen neben einem Gesicht kaum '
      + 'noch etwas, das man nicht schon sieht.',
  },
];

// --- Daten -----------------------------------------------------------------
const W = {
  ansem: '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo',
  a: '7xKm4pQrsTuVwXyZ1a2b3c4d5e6f7g8h9i0jKlMnOpQ',
  b: '7xK9zYxWvUtSrQpOnMlKjIhGfEdCbA1234567890abc',
  c: 'Bnk3vN8pQr2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN',
  d: 'Qw9eR7tY5uI3oP1aS2dF4gH6jK8lZ0xC1vB3nM5qW7e',
};
const std = (h) => Date.now() - h * 3600e3, min2 = (m) => Date.now() - m * 60_000;
const CHAT = [
  { id: 1, wallet: W.c, usd: 1240, body: 'gm', createdAt: std(5) },
  { id: 2, wallet: W.a, usd: 86400, body: 'is the gate still at $10 or did that change', createdAt: std(5) },
  { id: 3, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'still $10. read the pinned poll before asking again', createdAt: std(4) },
  { id: 4, wallet: W.b, usd: 0.4, body: 'made it in with dust lol', createdAt: std(4) },
  { id: 5, wallet: W.d, usd: 3420, body: 'voted. ship it', createdAt: std(3) },
  { id: 6, wallet: W.ansem, usd: 12400000, isAdmin: true, body: 'new poll is live. 24h. go', createdAt: std(3) },
  { id: 7, wallet: W.a, usd: 86400, replyTo: 6, body: 'done', createdAt: min2(52) },
  { id: 8, wallet: W.b, usd: 0.4, body: 'yeah it catches up', createdAt: min2(31) },
  { id: 9, wallet: W.ansem, usd: 12400000, isAdmin: true,
    body: 'counts for less. weight follows the balance while the poll is open', createdAt: min2(12) },
  { id: 10, wallet: W.c, usd: 1240, body: 'fair', createdAt: min2(2) },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0">
       <div id="app" style="display:flex;flex-direction:column;height:100vh;
            background:var(--bg);padding:14px;box-sizing:border-box">${chatGeruest}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');

const bilder = [];
for (const f of FASSUNGEN) {
  // 900 px und nicht weniger. Unter 761 px greift @media (max-width: 760px),
  // und dort hat .msg ein ANDERES Raster – Kuerzel und Betrag in einer Zeile,
  // der Text darunter. Wer hier schmaler misst, misst das Handy-Layout und
  // beantwortet die Spaltenfrage gar nicht. (Diese Falle ist in diesem Projekt
  // schon einmal zugeschnappt, damals bei genau 760 px.)
  const seite = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({ content: `
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = {
      cfg: { symbol: 'ANSEM', admin_wallet: ${JSON.stringify(W.ansem)} },
      me: { isAdmin: false, wallet: ${JSON.stringify(W.a)} },
      live: new Map(), quoted: new Map(), filters: { usd: 0 },
    };
    const toast = () => {};
    ${escFn}${zahlen}${kurz}${tage}${namen}${linkify}${chatBau}
    const usdOf = (m) => m.usd;
    const passesFilter = () => true;
    const daten = ${JSON.stringify(CHAT)};
    for (const m of daten) state.quoted.set(m.id, m);
    document.querySelector('#chat-list').innerHTML = daten.map(msgHtml).join('');
    document.querySelector('#chat-list').scrollTop = 1e6;` });
  if (f.css) await seite.addStyleTag({ content: f.css });
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(400);

  // Gemessen statt behauptet: Wo faengt der Text an, wie hoch ist eine Zeile
  // mit Bild gegen eine ohne, und steht die Geldspalte noch untereinander?
  f.mass = await seite.evaluate(() => {
    const zeilen = [...document.querySelectorAll('.msg')];
    const ansem = zeilen.find((z) => z.classList.contains('is-admin'));
    const andere = zeilen.find((z) => !z.classList.contains('is-admin'));
    const links = (z) => Math.round(z.querySelector('.body').getBoundingClientRect().left);
    const hoch = (z) => Math.round(z.getBoundingClientRect().height);
    // Die Geldspalte wird hier bewusst NICHT gemessen. Jede Nachricht ist ein
    // eigenes Grid; die rechte Kante haengt an der Breite der Uhrzeit daneben,
    // und die schwankt in den Testdaten. Ein Messwert, der schon im
    // Ist-Zustand "gebrochen" meldet, misst die Testdaten und nicht die Frage.
    return {
      textAb: links(andere), textAbAnsem: links(ansem),
      hochAnsem: hoch(ansem), hochAndere: hoch(andere),
      spalte: Math.round(parseFloat(getComputedStyle(zeilen[0]).gridTemplateColumns.split(' ')[0])),
    };
  });

  const bild = await seite.locator('#chat-list').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, `ansembild-${f.datei}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

console.log('\n  Was das Layout dazu sagt\n');
console.log('  ' + 'Fassung'.padEnd(34) + 'Spalte'.padEnd(9) + 'Text ab'.padEnd(10)
  + 'Zeilenhöhe');
console.log('  ' + ' '.repeat(34) + ''.padEnd(9) + 'andere/Ansem'.padEnd(10)
  + 'Ansem/andere'.padEnd(13) + '');
for (const f of FASSUNGEN) {
  const m = f.mass;
  console.log('  ' + f.name.padEnd(34) + `${m.spalte} px`.padEnd(9)
    + `${m.textAb}/${m.textAbAnsem}`.padEnd(10)
    + `${m.hochAnsem}/${m.hochAndere} px`
    + (m.hochAnsem > m.hochAndere ? '   Ansems Zeilen sind höher' : ''));
}
const grund = FASSUNGEN[0].mass;
console.log(`\n  "Text ab" ist der linke Rand des Nachrichtentextes. Steht dort in einer`
  + `\n  Fassung eine groessere Zahl als ${grund.textAb}, ist die ganze Liste nach rechts`
  + `\n  gerueckt – auch fuer alle, die gar kein Bild haben.\n`);

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .reihe { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #0a0b0f; padding: 10px; border-radius: 12px; border: 1px solid #1d212d; }
</style>
<h1>Ansem mit rundem Profilbild</h1>
<p class="lead">Dieselben zehn Nachrichten, drei davon von Ansem. Die Frage sieht nach einer Bildfrage aus und
ist eine Layoutfrage: Die erste Spalte im Chat ist <b>${SPALTE_PX} px breit und fest</b>, weil alle Kürzel
exakt drei Zeichen lang sind – deshalb beginnt der Text in jeder Zeile an derselben Stelle. Ein Bild passt
entweder hinein, oder die Spalte wächst, und dann rückt der Text <i>aller</i> Zeilen nach rechts, auch der von
Leuten ohne Bild. Unter jeder Fassung stehen die gemessenen Werte. Nichts hiervon ist eingebaut.</p>
<div class="reihe">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.mass.textAb > grund.textAb ? 'knapp' : ''}">Spalte ${f.mass.spalte} px
      · Text ab ${f.mass.textAb} px${f.mass.textAb > grund.textAb ? ` (statt ${grund.textAb})` : ''}
      · Zeile ${f.mass.hochAnsem} px gegen ${f.mass.hochAndere} px</span></h2>
  <p class="t">${f.text}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(700);
await s.screenshot({ path: path.join(ausgabe, 'ansembild-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'ansembild-uebersicht.png')}\n`);
