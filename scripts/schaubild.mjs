// ============================================================================
// Das Schaubild fuer X
//
// Drei Spalten in Monoschrift auf dem Grund der Seite, im Stil des
// Architekturblocks aus der README. Links der Schritt, in der Mitte was
// passiert, rechts was dabei ausgeschlossen ist.
//
// Der Gewinn der Ordnung ist, dass man SENKRECHT lesen kann: Wer nur die linke
// Spalte ueberfliegt, hat den Ablauf. Wer nur die rechte liest, hat die
// Antwort auf "kann mir das etwas wegnehmen".
//
// ----------------------------------------------------------------------------
// Keine Pfeile
//
// In einer ausgerichteten Tabelle sagt die Spalte schon, dass links zu rechts
// gehoert. Vorher stand dort "──▶", und das sah unruhig aus: Der Strich kommt
// aus dem Kastenzeichensatz, die Spitze aus einem anderen Block, und der
// Browser holt sie sich notfalls aus zwei verschiedenen Schriften.
//
// ----------------------------------------------------------------------------
// Keine ganzen Saetze
//
// Die erste Fassung erklaerte ("SIZED sees it arrive and knows the address
// belongs to you"). Das liest sich wie Werbetext, nicht wie ein Diagramm.
// Beschriftet wird, nicht erzaehlt: keine Verben, die man sich denken kann,
// keine Punkte am Zeilenende.
//
// ----------------------------------------------------------------------------
// Warum die Zeilen kurz sind
//
// In der Zeitleiste wird jedes Bild auf Handybreite geschoben. Eine Zeile mit
// 100 Zeichen ist dort drei Millimeter hoch und niemand liest sie. MAX_SPALTEN
// deckelt bei 64, und das Skript meldet einen Verstoss, bevor das Bild draussen
// ist.
//
// Farben und Schrift kommen aus public/styles.css, nicht aus dem Geschmack:
// Ein Grau eine Spur neben dem Grau der Seite sieht neben den Bildschirmfotos
// falsch aus, und niemand kann sagen warum.
//
//   node scripts/schaubild.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const farbe = (n) => {
  const t = new RegExp(`--${n}:\\s*([^;]+);`).exec(css);
  if (!t) throw new Error(`--${n} fehlt in styles.css`);
  return t[1].trim();
};
const C = { bg: farbe('bg'), text: farbe('text'), dim: farbe('dim'),
  dimmer: farbe('dimmer'), accent: farbe('accent') };

const MAX_SPALTEN = 64;

// ---------------------------------------------------------------------------
// Die zwei Fassungen
// ---------------------------------------------------------------------------
//
// Dieselbe Ordnung, ein anderer Wortschatz. F1 spricht mit jemandem, der
// $ANSEM haelt und kein Entwickler ist – "rules, live in the database, not in
// the website" statt "postgres rls, frontend is not a boundary". F2 behaelt
// zwei Fachwoerter, weil sie fuer den, der sie kennt, genauer sind.
//
// Verloren geht bei F1 nichts, was jemand nachpruefen koennte: Wer es genau
// wissen will, findet es unter der Adresse in der Fusszeile.

const BILDER = [
  {
    nr: 1,
    name: 'F1 – gleiche Ordnung, verstaendliche Woerter',
    frage: 'fuer Halter, nicht fuer Entwickler',
    text: `
sized.gg  ·  token-gated polls and dms  ·  no wallet connect

address    you type it            nothing connected
amount     SIZED names one        the last decimals are yours
payment    you send it            your wallet, nothing signed
match      SIZED sees it          that exact amount, once
access     you are in

balance    read from the chain    never sent by your browser
polls      your vote weighs       what you hold
dms        ansem's inbox          sorted by what you hold
rules      live in the database   not in the website

github.com/sizedgg/sized
`,
  },
  {
    nr: 2,
    name: 'F2 – ein Schritt technischer',
    frage: 'on-chain bleibt drin',
    text: `
sized.gg  ·  token-gated polls and dms  ·  no wallet connect

address    you type it              nothing connected
amount     SIZED names one          the last decimals are yours
payment    you send it              your wallet, nothing signed
match      SIZED sees it on-chain   that exact amount, once
access     you are in

balance    read on-chain            never sent by your browser
polls      vote weight              what you hold
dms        inbox order              what you hold
rules      in the database          the website enforces nothing

github.com/sizedgg/sized
`,
  },
];

// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

console.log('\nSchaubilder fuer X\n');

for (const b of BILDER) {
  const zeilen = b.text.replace(/^\n|\n$/g, '').split('\n');
  const breiteste = Math.max(...zeilen.map((z) => z.length));
  if (breiteste > MAX_SPALTEN) {
    console.log(`  ${b.nr}. ${b.name}  << ZU BREIT: ${breiteste} Spalten`);
  }

  // Erst gross rendern, dann auf den Inhalt zuschneiden – dieselbe Regel wie
  // bei den Beitragsbildern: Ein Bild mit einem Drittel leerer Flaeche wird in
  // der Zeitleiste mitverkleinert, und der Text schrumpft mit.
  const seite = await browser.newPage({
    viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2,
  });
  await seite.setContent(`
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: ${C.bg}; color: ${C.text};
             font-family: "DejaVu Sans Mono", ui-monospace, monospace;
             padding: 46px 52px; width: max-content; }
      pre { font-size: 21px; line-height: 1.55; white-space: pre; }
      /* Kopf- und Fusszeile leiser als die Tabelle: Sie sagen, WOVON das
         Bild handelt, und nicht was darin steht. */
      .leise { color: ${C.dim}; }
    </style>
    <pre id="t"></pre>
    <script>
      const roh = ${JSON.stringify(zeilen.join('\n'))};
      // Erste und letzte Zeile leiser: Kopf und Fuss sind Rahmen, nicht Inhalt.
      // Das \\n ist doppelt entwertet: Die aeussere Zeichenkette hier im
      // Skript wuerde ein einfaches \\n sonst in einen echten Umbruch
      // verwandeln, und im Browser stuende dann eine Zeichenkette ueber zwei
      // Zeilen – ein Syntaxfehler, der die Seite leer laesst. Genau das ist
      // beim ersten Versuch passiert: Bild 208x184 statt 1752x1096.
      const teile = roh.split('\\n');
      document.getElementById('t').innerHTML = teile.map((z, i) =>
        (i === 0 || i === teile.length - 1) && z.trim()
          ? '<span class="leise">' + z + '</span>' : z).join('\\n');
    <\/script>`, { waitUntil: 'load' });

  // Gemessen wird am <pre> und nicht am body: Der body fuellt das Fenster,
  // auch wenn nichts darin steht – gemessen hat er deshalb immer 900 geliefert
  // und der Zuschnitt tat nichts. Aufgefallen ist es, weil alle drei Bilder
  // dieselbe Hoehe hatten.
  const mass = await seite.evaluate(() => {
    const r = document.getElementById('t').getBoundingClientRect();
    const p = parseFloat(getComputedStyle(document.body).paddingLeft);
    const q = parseFloat(getComputedStyle(document.body).paddingTop);
    return { w: Math.ceil(r.width + 2 * p), h: Math.ceil(r.height + 2 * q) };
  });
  await seite.setViewportSize({ width: mass.w, height: mass.h });

  const datei = path.join(root, 'preview', `schaubild-${b.nr}.png`);
  await seite.screenshot({ path: datei });
  await seite.close();

  console.log(`  ${b.nr}. ${b.name}  –  "${b.frage}"`);
  console.log(`     ${breiteste} Spalten, ${zeilen.length} Zeilen`
    + `, Bild ${mass.w * 2}x${mass.h * 2}`);
  console.log(`     ${path.relative(root, datei)}\n`);
}

await browser.close();
