// ============================================================================
// Ansems Posteingang, voll.
//
// Die Liste ist bisher immer mit vier Zeilen abgebildet worden – in
// preview-mobile.mjs, in den Tests, in jeder Vorschau. Vier Zeilen sagen aber
// nichts ueber die Fragen, die eine Liste stellt: Wie liest sich eine Spalte
// aus vierzig Betraegen? Faellt ein ungelesenes Gespraech noch auf, wenn zehn
// davon dastehen? Reicht der Platz fuer die Vorschau, wenn der Betrag
// siebenstellig ist?
//
// renderThreads() wird WOERTLICH aus app.js geschnitten. Eine nachgebaute
// Zeile wuerde hier gut aussehen, waehrend die echte etwas anderes tut.
//
//   node scripts/vorschau-posteingang.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Alles, was die Liste baut – aus der echten Datei.
const teile = [
  schneide('const HANDLE_TONES', '\n'),
  schneide('const handleOf =', '\n'),
  schneide('function toneOf(wallet) {', '\n}') + '\n}',
  schneide('const esc =', '\n\n'),
  // STUFEN gehoert dazu: kurzUsd() liest sie, und ohne sie faellt die Funktion
  // beim ersten Betrag um.
  schneide('const STUFEN =', '\n'),
  schneide('function kurzUsd(', '\n}') + '\n}',
  // Bis zur schliessenden Klammer am Zeilenanfang – vorher endete der Schnitt
  // mitten in der Funktion, und dann ist sie zwar da, aber nie definiert.
  schneide('function renderThreads() {', '\n}\n') + '\n}',
].join('\n');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  // app.js wird ersetzt: Die echte Anwendung wuerde sich anmelden wollen. Die
  // Teile, um die es hier geht, kommen weiter unten woertlich hinein.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vorschau */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

// ---------------------------------------------------------------------------
// Die Daten – die unangenehmen Faelle absichtlich dabei
// ---------------------------------------------------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let saat = 20260831;
const zufall = () => (saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648;
const adresse = () => Array.from({ length: 44 }, () => B58[Math.floor(zufall() * 58)]).join('');

const TEXTE = [
  'gm', 'checking', 'wen poll', 'thanks for the reply',
  'I sold half my bag last week and now I am not sure that was right',
  'Is the unlock linear or cliff based? I have been trying to work this out from the docs and cannot tell',
  'can you look at this', 'will cover it in the next stream',
  'any chance you do an AMA this month', 'appreciate the answer earlier',
  'sent you the details', 'quick one about the vesting schedule',
];

// Betraege ueber die ganze Spanne: von siebenstellig bis unter die Schwelle.
const BETRAEGE = [
  4_820_000, 1_204_880, 892_400, 512_000, 388_120, 251_400, 180_900, 142_300,
  98_400, 76_200, 61_050, 48_900, 39_400, 31_500, 26_800, 21_400, 18_200,
  15_600, 12_400, 9_820, 8_820, 7_400, 6_100, 5_050, 4_200, 3_600, 2_900,
  2_400, 1_980, 1_620, 1_302, 1_050, 860, 640, 480, 320, 210, 120, 45, 3,
];

const THREADS = BETRAEGE.map((usd, i) => ({
  wallet: adresse(),
  usd,
  preview: TEXTE[Math.floor(zufall() * TEXTE.length)],
  // Ungelesene bewusst verstreut und nicht oben gebuendelt: Die Frage ist, ob
  // eine schwach blaue Flaeche zwischen vierzig Zeilen ueberhaupt auffaellt.
  unread: [2, 3, 7, 8, 15, 22, 23, 31].includes(i) ? 1 : 0,
}));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

const bauen = async (breite, hoehe, name, schwelle) => {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(250);
  await seite.addScriptTag({
    content: `
      const $ = (s, r = document) => r.querySelector(s);
      const $$ = (s, r = document) => [...r.querySelectorAll(s)];
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const openThread = () => {};
      const state = {
        cfg: { symbol: 'ANSEM', min_dm_usd: ${schwelle} },
        dmMinEntwurf: null,
        dmThreads: ${JSON.stringify(THREADS)},
        activeThread: ${JSON.stringify(THREADS[4].wallet)},
      };
      ${teile}
      window.renderThreads = renderThreads;
    `,
  });
  const messwerte = await seite.evaluate(() => {
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

    // Ein paar Zahlen mitnehmen, die man auf einem Bild nicht sieht.
    const d = document.documentElement;
    // Gerollt wird .thread-list und NICHT #thread-items – der innere Kasten
    // waechst einfach mit und meldet deshalb immer "rollt nicht". Hier stand
    // erst der innere, und die Messung sagte bei vierzig Zeilen "Liste rollt:
    // nein", waehrend sie in Wirklichkeit ueber 900 px Inhalt verbarg.
    const liste = document.querySelector('.thread-list');
    const zeilen = [...document.querySelectorAll('.thread')];
    const breiten = zeilen.map((z) => {
      const prev = z.querySelector('.thread-prev');
      return prev.scrollWidth > prev.clientWidth + 1;
    });
    return {
      zeilen: zeilen.length,
      hoehe: zeilen.length ? Math.round(zeilen[0].getBoundingClientRect().height) : 0,
      abgeschnitten: breiten.filter(Boolean).length,
      seiteScrollt: d.scrollHeight > d.clientHeight,
      listeScrollt: liste.scrollHeight > liste.clientHeight + 1,
      sichtbar: liste.clientHeight,
      gesamt: liste.scrollHeight,
      // Erreicht man die letzte Zeile ueberhaupt? Ganz nach unten rollen und
      // nachsehen, ob die unterste Zeile dann im Kasten steht.
      letzteErreichbar: (() => {
        liste.scrollTop = 1e6;
        const zeilen = document.querySelectorAll('.thread');
        if (!zeilen.length) return true;
        const u = zeilen[zeilen.length - 1].getBoundingClientRect();
        const k = liste.getBoundingClientRect();
        const ok = u.bottom <= k.bottom + 1 && u.top >= k.top - 1;
        liste.scrollTop = 0;
        return ok;
      })(),
      // Der Schwellenzaehler ist raus – was gefiltert wird, steht im Regler
      // darueber. Gemeldet wird stattdessen, wie viel die Schwelle wirklich
      // wegnimmt: die Zahl, die man auf dem Bild nicht sieht.
      wegGefiltert: 40 - zeilen.length,
    };
  });
  await seite.screenshot({ path: path.join(root, 'preview', `posteingang-${name}.png`) });
  await seite.close();
  return messwerte;
};

console.log('\nAnsems Posteingang, voll\n');
for (const [name, b, h, schwelle] of [
  ['rechner', 1280, 860, 0],
  ['rechner-schwelle', 1280, 860, 1000],
  ['handy', 390, 780, 0],
]) {
  const m = await bauen(b, h, name, schwelle);
  console.log(`  ${name} (${b}×${h}, Schwelle ${schwelle ? '$' + schwelle : 'keine'})`);
  console.log(`    ${m.zeilen} Zeilen à ${m.hoehe} px`
    + `  ·  Vorschau gekürzt in ${m.abgeschnitten}`
    + `  ·  sichtbar ${m.sichtbar} von ${m.gesamt} px`
    + `  ·  letzte Zeile erreichbar: ${m.letzteErreichbar ? 'ja' : 'NEIN – Fehler'}`
    + `  ·  Seite rollt: ${m.seiteScrollt ? 'JA – Fehler' : 'nein'}`);
  if (m.wegGefiltert) console.log(`    Die Schwelle nimmt ${m.wegGefiltert} Gespräche weg`);
}

await browser.close();
server.close();
console.log('\nBilder in preview/posteingang-*.png\n');
