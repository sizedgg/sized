// ============================================================================
// Der untere Rand des DM-Rahmens auf dem Startbildschirm – vier Fassungen
//
// Der Befund vom Gerät: "der Umriss des DM-Tabs geht nicht weit genug nach
// unten, da ist zu viel leerer Platz."
//
// Das ist die Kehrseite des vorigen Fixes. Vorher hing die sichere Zone unten
// an .composer – die sitzt INNERHALB des Rahmens und konnte ihn nicht anheben,
// also verschwanden seine unteren Ecken unter dem Schliess-Balken. Die Zeile
// wanderte deshalb an .pane. Damit hebt sie den ganzen Rahmen – aber sie
// ADDIERT sich zum vorhandenen Innenabstand:
//
//   padding-bottom: calc(.8rem + env(safe-area-inset-bottom))
//                       12,8 px  +  34 px          =  47 px
//
// 47 px leerer Grund unter dem Rahmen. Das ist der Platz, den er meint.
//
// ----------------------------------------------------------------------------
// Warum das hier gezeichnet werden kann, obwohl der Test es nicht messen kann
//
// Chromium kennt env(safe-area-inset-*) ohne echten Geräteausschnitt nicht;
// die Werte sind dort immer 0. Deshalb steht in test-pwa.mjs auch nur eine
// Prüfung am REGELTEXT und keine Messung.
//
// Diese Vorschau ersetzt die env()-Aufrufe in der ausgelieferten styles.css
// durch die echten Werte eines iPhone 14 im Hochformat (oben 47, unten 34) –
// und zwar nur diese, per Textersatz auf dem Weg zum Browser. Alles andere ist
// die Datei, wie sie ist. Damit ist das Bild kein Nachbau, sondern dieselbe
// Seite unter der Bedingung, unter der der Fehler auftritt.
//
//   node scripts/vorschau-dm-unten.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

// iPhone 14, Hochformat, vom Startbildschirm gestartet.
const SICHER = { top: 47, bottom: 34, left: 0, right: 0 };

// ---------------------------------------------------------------------------
// Die vier Fassungen
// ---------------------------------------------------------------------------
//
// Gemeinsam ist allen: Die Eingabezeile muss über dem Schliess-Balken bleiben.
// Unterschiedlich ist, WO der Rahmen endet – und wer den Abstand trägt.

const FASSUNGEN = [
  {
    nr: 1,
    name: 'So wie jetzt',
    was: 'Der Stand, wie er ausgeliefert wird – seit Fassung 3 uebernommen '
       + 'wurde, ist das dieselbe wie unten. Bleibt als Bezugspunkt stehen.',
    css: '',
  },
  {
    nr: 2,
    name: 'Rahmen bis an den Schliess-Balken',
    was: 'Der eigene Abstand fällt weg, die sichere Zone bleibt. Der Rahmen '
       + 'endet genau dort, wo der Balken beginnt – 34 px. Nichts liegt '
       + 'darunter, und nichts steht ungenutzt herum.',
    css: `.pane { padding-bottom: env(safe-area-inset-bottom, 0px); }`,
  },
  {
    nr: 3,
    name: 'Rahmen läuft durch, Eingabe hält Abstand',
    was: 'Der Rahmen reicht bis 12,8 px an die Kante – also unter den '
       + 'Schliess-Balken hindurch – und die Eingabezeile darin weicht ihm '
       + 'aus. So machen es die meisten Apps: Der Balken liegt AUF dem Grund '
       + 'der App, nicht daneben. Die unteren Ecken bleiben sichtbar, weil '
       + '12,8 px Rand übrig sind.',
    css: `.pane { padding-bottom: .8rem; }
          .composer { padding-bottom: env(safe-area-inset-bottom, 0px); }`,
  },
  {
    nr: 4,
    name: 'Rahmen bis an die Kante',
    was: 'Kein Abstand mehr unten. Der Rahmen sitzt an der Gerätekante, seine '
       + 'unteren Ecken werden von ihr angeschnitten. Am meisten Platz für '
       + 'Nachrichten – und das ist der Grund, es überhaupt zu zeigen. Der '
       + 'Preis ist, dass der Rahmen unten nicht mehr als Rahmen zu erkennen '
       + 'ist.',
    css: `.pane { padding-bottom: 0; }
          .dm-user { padding-bottom: 0; border-bottom: 0;
                     border-radius: var(--radius) var(--radius) 0 0; }
          .composer { padding-bottom: calc(.6rem + env(safe-area-inset-bottom, 0px)); }`,
  },
];

// ---------------------------------------------------------------------------
// Der Server – styles.css mit echten Werten für die sichere Zone
// ---------------------------------------------------------------------------

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };

/**
 * Ersetzt env(safe-area-inset-X, …) durch den Wert des Geräts.
 *
 * Nur diese Funktion, nichts sonst: Die Datei geht ansonsten Zeichen für
 * Zeichen so an den Browser, wie sie ausgeliefert wird. Sonst wäre das Bild
 * ein Nachbau und nicht die Seite.
 */
function mitSicherenZonen(css) {
  return css.replace(
    /env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g,
    (_, seite) => `${SICHER[seite]}px`);
}

const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(pub, pfad);
  if (!datei.startsWith(pub) || !fs.existsSync(datei)) return res.writeHead(404).end('');
  // app.js bleibt leer – die Vorschau setzt den Zustand selbst. Sonst würde
  // das Skript sofort den Anmeldeablauf starten und alles wieder verstecken.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  if (pfad === '/styles.css') {
    return res.writeHead(200, { 'content-type': 'text/css' })
      .end(mitSicherenZonen(fs.readFileSync(datei, 'utf8')));
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Die Nachrichten – aus dmHtml in app.js, wörtlich
// ---------------------------------------------------------------------------
// Nicht nachgebaut: Der Bauplan wird aus app.js geschnitten und hier
// ausgeführt. Ändert sich die Blase dort, ändert sich auch dieses Bild – und
// eine Vorschau, die etwas anderes zeigt als die Seite, ist schlimmer als
// keine.

const appQuelle = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const dmHtmlQuelle = (() => {
  const a = appQuelle.indexOf('function dmHtml(row) {');
  if (a < 0) throw new Error('dmHtml nicht in app.js gefunden');
  const b = appQuelle.indexOf('\n}', a) + 2;
  return appQuelle.slice(a, b);
})();

const NACHRICHTEN = [
  { id: 1, from_admin: false, body: 'yo ansem, when is the next call?', created_at: '2026-09-04T18:12:00Z' },
  { id: 2, from_admin: true, body: 'thursday, same link as last time', created_at: '2026-09-04T18:20:00Z' },
  { id: 3, from_admin: false, body: 'perfect, see you there', created_at: '2026-09-04T18:21:00Z' },
  { id: 4, from_admin: true, body: 'bring questions, we have an hour', created_at: '2026-09-04T18:44:00Z' },
];

const GERAET = { width: 390, height: 844, dpr: 2 };   // iPhone 14

async function schuss(f) {
  const seite = await browser.newPage({
    viewport: { width: GERAET.width, height: GERAET.height },
    deviceScaleFactor: GERAET.dpr, isMobile: true, hasTouch: true,
  });
  await seite.goto(base);
  // Auch die Variante MUSS durch den Ersatz laufen. Beim ersten Versuch tat sie
  // es nicht – env() blieb dort 0, und die Messung zeigte für alle drei
  // Vorschläge einen Rahmen bis an die Gerätekante. Also drei Bilder, die
  // etwas anderes zeigten als die Regel, die sie darstellen sollten.
  if (f.css) await seite.addStyleTag({ content: mitSicherenZonen(f.css) });

  const mass = await seite.evaluate(({ bauplan, rows }) => {
    // Die echte Funktion, aus app.js geschnitten – samt der Handvoll Helfer,
    // die sie braucht. Die Helfer sind hier vereinfacht; sie liefern Text,
    // nicht Aufbau, und der Aufbau ist das, was gemessen wird.
    const state = { me: { isAdmin: false } };
    const esc = (s) => String(s);
    const mitLinks = (s) => String(s);
    const fmtTime = (t) => new Date(t).toISOString().slice(11, 16);
    const dmQuoteHtml = () => '';
    void esc;
    // eslint-disable-next-line no-eval
    const dmHtml = eval(`(${bauplan.replace(/^function dmHtml/, 'function')})`);

    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
    document.querySelector('#pane-polls').hidden = true;
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-thread').innerHTML = rows.map(dmHtml).join('');

    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const rahmen = r('#dm-user');
    const eingabe = r('#dm-input');
    return {
      // Wie viel leerer Grund liegt unter dem Rahmen?
      unterRahmen: Math.round(innerHeight - rahmen.bottom),
      // Und wie weit ist die Eingabe von der Kante weg? Sie muss über dem
      // Schliess-Balken bleiben – der ist 34 px hoch.
      eingabeUeberKante: Math.round(innerHeight - eingabe.bottom),
      rahmenHoehe: Math.round(rahmen.height),
    };
  }, { bauplan: dmHtmlQuelle, rows: NACHRICHTEN });

  // Der Schliess-Balken wird eingezeichnet – sonst sieht man auf dem Bild
  // nicht, worauf sich "zu viel Platz" bezieht.
  await seite.addStyleTag({ content: `
    body::after { content: ''; position: fixed; left: 50%; bottom: 8px;
      transform: translateX(-50%); width: 140px; height: 5px; border-radius: 3px;
      background: rgba(255,255,255,.55); z-index: 99; pointer-events: none; }
    body::before { content: ''; position: fixed; left: 0; right: 0; bottom: 0;
      height: ${SICHER.bottom}px; z-index: 98; pointer-events: none;
      background: rgba(255,80,80,.10);
      border-top: 1px dashed rgba(255,80,80,.5); }` });

  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  const bild = path.join(root, 'preview', `dm-unten-${f.nr}.png`);
  await seite.screenshot({ path: bild });
  await seite.close();
  return { ...mass, bild };
}

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

console.log('\nUnterer Rand des DM-Rahmens – iPhone 14 vom Startbildschirm');
console.log(`Sichere Zone unten: ${SICHER.bottom} px (rot gestrichelt im Bild)\n`);

for (const f of FASSUNGEN) {
  const m = await schuss(f);
  console.log(`  ${f.nr}. ${f.name}`);
  console.log(`     leer unter dem Rahmen: ${m.unterRahmen} px`
    + `   Rahmenhoehe: ${m.rahmenHoehe} px`
    + `   Eingabe ueber der Kante: ${m.eingabeUeberKante} px`
    + `${m.eingabeUeberKante < SICHER.bottom ? '   << unter dem Balken!' : ''}`);
  console.log(`     ${f.was}`);
  console.log(`     ${path.relative(root, m.bild)}\n`);
}

await browser.close();
server.close();
