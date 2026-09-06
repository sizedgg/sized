// ============================================================================
// Das Banner fuer den Artikel – drei Entwuerfe, 5:2
//
// 1600 x 640 CSS-Pixel bei doppelter Punktdichte, also 3200 x 1280 im Bild.
// Das ist gross genug fuer jeden Artikelkopf und teilt sich sauber durch zwei.
//
// ----------------------------------------------------------------------------
// Woher die Farben und die Schrift kommen
//
// Nicht ausgesucht, sondern aus public/styles.css gelesen: Grund, Linien,
// Textfarben und das Blau der fuehrenden Antwort stehen dort als Variablen,
// und dieses Skript zieht sie von dort. Ein Banner, dessen Grau eine Spur
// neben dem Grau der Seite liegt, sieht neben den Bildschirmfotos falsch aus,
// und niemand kann sagen warum.
//
// Dasselbe gilt fuer die Schrift: Die Vorschaubilder sind in diesem Container
// entstanden, also mit DejaVu Sans Mono. Das Banner nimmt dieselbe. Auf einem
// iPhone waere es SF Mono – aber ein PNG ist fertig, wenn es hier entsteht,
// und dann soll es zu den Bildern passen, neben denen es steht.
//
// ----------------------------------------------------------------------------
// Das Zeichen
//
// Zwei Balken, woertlich aus index.html geschnitten. Nachgezeichnet waere es
// die vierte Kopie derselben Form – und die erste, die beim naechsten Aendern
// stehen bleibt.
//
//   node scripts/banner.mjs
// ============================================================================

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

/** Das Zeichen aus index.html – nur das SVG. */
const MARKE = (() => {
  const a = html.indexOf('<svg viewBox="29 16 42 64"');
  const b = html.indexOf('</svg>', a) + 6;
  if (a < 0) throw new Error('Zeichen nicht in index.html gefunden');
  return html.slice(a, b);
})();

/** Eine Farbvariable aus styles.css. */
const farbe = (name) => {
  const t = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!t) throw new Error(`--${name} nicht in styles.css gefunden`);
  return t[1].trim();
};
const C = {
  bg: farbe('bg'), bg1: farbe('bg-1'), bg2: farbe('bg-2'), bg3: farbe('bg-3'),
  line: farbe('line'), text: farbe('text'), dim: farbe('dim'),
  dimmer: farbe('dimmer'), accent: farbe('accent'),
  fuellung: farbe('fuellung'), spitze: farbe('fuellung-spitze'),
};

const B = { w: 1600, h: 640 };   // 5:2

/**
 * Wie viele Bildpunkte eines PNG haben ueberhaupt eine Farbe?
 *
 * Ohne Bildbibliothek: Das PNG wird entpackt und Zeile fuer Zeile
 * zurueckgefiltert – so schreibt PNG nun einmal, jede Zeile bezieht sich auf
 * die davor. "Farbig" heisst hier: Die drei Kanaele liegen weiter als 24
 * auseinander. Das Banner ist grau in grau, ein Ochse ist braun.
 */
function farbanteil(png) {
  const stuecke = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    const art = png.toString('ascii', i + 4, i + 8);
    if (art === 'IHDR') {
      var breite = png.readUInt32BE(i + 8);
      var tiefe = png[i + 16];
      var typ = png[i + 17];
    }
    if (art === 'IDAT') stuecke.push(png.subarray(i + 8, i + 8 + len));
    i += len + 12;
  }
  // Chromium schreibt je nach Inhalt mit oder ohne Alphakanal. Beide Faelle
  // muessen durch: Erst stand hier nur RGBA, und die Pruefung gab bei jedem
  // Bild -1 zurueck – eine Pruefung, die immer dasselbe sagt, prueft nichts.
  const bpp = typ === 6 ? 4 : typ === 2 ? 3 : 0;
  if (!bpp || tiefe !== 8) return -1;
  const roh = zlib.inflateSync(Buffer.concat(stuecke));
  const zeile = breite * bpp;
  const vor = Buffer.alloc(zeile);
  let jetzt = Buffer.alloc(zeile);
  let bunt = 0;
  for (let y = 0, p = 0; p < roh.length; y++) {
    const f = roh[p++];
    roh.copy(jetzt, 0, p, p + zeile); p += zeile;
    for (let x = 0; x < zeile; x++) {
      const a = x >= bpp ? jetzt[x - bpp] : 0;
      const b = vor[x];
      const c = x >= bpp ? vor[x - bpp] : 0;
      if (f === 1) jetzt[x] = (jetzt[x] + a) & 255;
      else if (f === 2) jetzt[x] = (jetzt[x] + b) & 255;
      else if (f === 3) jetzt[x] = (jetzt[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const q = a + b - c;
        const da = Math.abs(q - a); const db = Math.abs(q - b); const dc = Math.abs(q - c);
        jetzt[x] = (jetzt[x] + (da <= db && da <= dc ? a : db <= dc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < zeile; x += bpp) {
      const r = jetzt[x]; const g = jetzt[x + 1]; const bl = jetzt[x + 2];
      if (Math.max(r, g, bl) - Math.min(r, g, bl) > 24) bunt++;
    }
    jetzt.copy(vor);
  }
  return bunt;
}

const GRUND = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${B.w}px; height: ${B.h}px; overflow: hidden;
    background: ${C.bg}; color: ${C.text};
    font-family: "DejaVu Sans Mono", ui-monospace, monospace;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .marke { display: flex; align-items: center; gap: .42em;
    font-weight: 700; letter-spacing: .18em; }
  .marke svg { width: .82em; height: 1.18em; fill: ${C.accent}; }
  .satz { color: ${C.dim}; }
  /* Die Zeichen von Ansem.
     -------------------------------------------------------------------------
     Zwei Wege, und der Unterschied ist sichtbar – siehe SATZ weiter unten.

     Als Schrift: eigene Schriftfamilie, sonst greift der Browser auf die
     Monoschrift zu und setzt zwei leere Kaesten. DejaVu Sans Mono hat kein
     U+1F402 und kein U+1F004, Noto Color Emoji hat beide.

     Ein Sperrsatz zwischen den beiden, weil sie sonst aneinanderkleben. Der
     Ausgleich mit text-indent haelt die Gruppe trotzdem mittig: Sperrsatz
     haengt auch hinter dem letzten Zeichen und schiebt sie sonst nach links. */
  .zeichen {
    font-family: "Noto Color Emoji", "Apple Color Emoji", sans-serif;
    letter-spacing: .16em; text-indent: .16em; line-height: 1;
  }
  /* Als Bild: dann bestimmt nicht die Schrift des Rechners, wie der Ochse
     aussieht, sondern die Datei. Gleiche Hoehe wie die Schriftgroesse, damit
     beide Wege dasselbe Mass haben und der Vergleich einer ist. */
  .zeichen.bilder { display: flex; align-items: center; gap: .16em; }
  .zeichen.bilder img { height: 1em; width: 1em; }
`;

// ---------------------------------------------------------------------------
// Das Banner
// ---------------------------------------------------------------------------
//
// Der Grund von SIZED und das Zeichen klein in der Mitte, sonst nichts.
//
// Der Grund ist wirklich nur eine Farbe: In styles.css lagen einmal zwei
// weiche Lichter darin, violett oben rechts und knochenweiss unten links; die
// sind laengst raus. Was hier steht, ist deshalb kein vereinfachter Nachbau,
// sondern derselbe Grund, den die Seite hat.
//
// Drei Groessen, damit die Entscheidung am Bild faellt und nicht an einer
// Zahl. "Klein" ist relativ zur Flaeche, und 1600 px sind breiter, als man
// sie sich beim Tippen vorstellt.
// Die Groesse steht fest: Nr. 3 aus dem ersten Durchgang, nachgemessen an
// dem gewaehlten Bild (23.3 % Markenbreite, auf die Nachkommastelle dieselbe).
const GROESSEN = [{ nr: 0, name: 'gewaehlt', px: 76 }];

// Darunter die Zeichen, mit denen Ansem auf X steht.
//
// "Etwas kleiner" ist hier 0.62 der Marke und keine feste Pixelzahl: Die
// Marke gibt es in drei Groessen, und eine feste Zahl waere beim kleinsten
// Banner zu gross und beim groessten verloren.
//
// 0.62 und nicht 0.8: Emoji-Zeichen wirken bei gleicher Schriftgroesse
// schwerer als Buchstaben, weil sie die Zeile ganz ausfuellen – ein "kleiner"
// gesetztes Paar sieht sonst gleich gross aus wie das Wort darueber. Und
// nicht 0.4, denn dann liest man es als Fussnote statt als Teil des Zeichens.
const ZEICHEN = '🐂🀄️';
const ZEICHEN_ANTEIL = 0.62;
const ABSTAND_ANTEIL = 0.34;   // Luft zwischen Marke und Zeichen, an der Marke

// ---------------------------------------------------------------------------
// Welcher Ochse?
// ---------------------------------------------------------------------------
//
// Ein Emoji ist ein Codepunkt, kein Bild. Wie er aussieht, entscheidet der
// Rechner, der ihn anzeigt – und die Saetze unterscheiden sich deutlich. Ein
// Banner ist aber ein fertiges PNG: Was hier hineingerendert wird, sehen alle,
// egal auf welchem Geraet.
//
//   noto     – die Schrift in diesem Container. Kam heraus, weil sie da war,
//              nicht weil sie gewaehlt wurde.
//   twemoji  – der Satz, den X selbst benutzt. Auf X steht das Banner also
//              neben denselben Zeichen, die daneben in Ansems Namen stehen.
//
// Apple faellt aus: Apple Color Emoji liegt auf dem Mac davor, nicht hier, und
// laesst sich nicht mitliefern. Wer den Ochsen so will, wie er ihn beim Tippen
// sieht, muesste das Bild auf dem Mac erzeugen.
//
// Die Twemoji-Dateien liegen unter scripts/zeichen/ – Twitter/X, CC-BY 4.0.
// Woertlich uebernommen und nicht nachgezeichnet, aus demselben Grund wie
// beim Zeichen der Marke.
const alsBild = (datei) => 'data:image/svg+xml;base64,'
  + fs.readFileSync(path.join(root, 'scripts', 'zeichen', datei)).toString('base64');

const SAETZE = [
  { nr: 1, name: 'Noto (die Schrift hier)', klasse: '', inhalt: ZEICHEN },
  { nr: 2, name: 'Twemoji (der Satz von X)', klasse: ' bilder',
    inhalt: `<img src="${alsBild('1f402.svg')}" alt="">`
          + `<img src="${alsBild('1f004.svg')}" alt="">` },
];

const ENTWUERFE = SAETZE.flatMap((s) => GROESSEN.map((g) => ({
  nr: s.nr,
  name: s.name,
  was: `Die Marke nimmt ${Math.round(g.px * 5.4 / B.w * 100)} % der Breite ein, `
     + `die Zeichen darunter ${Math.round(g.px * ZEICHEN_ANTEIL)} px.`,
  css: `body { gap: ${Math.round(g.px * ABSTAND_ANTEIL)}px; }
        .marke { font-size: ${g.px}px; }
        .zeichen { font-size: ${Math.round(g.px * ZEICHEN_ANTEIL)}px; }`,
  body: `<div class="marke">${MARKE}SIZED</div>
         <div class="zeichen${s.klasse}">${s.inhalt}</div>`,
})));

// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

console.log(`\nBanner ${B.w}x${B.h} (5:2), doppelte Punktdichte\n`);

for (const e of ENTWUERFE) {
  const seite = await browser.newPage({
    viewport: { width: B.w, height: B.h }, deviceScaleFactor: 2,
  });
  await seite.setContent(
    `<style>${GRUND}${e.css}</style>${e.body}`, { waitUntil: 'load' });

  // Nachmessen statt vertrauen: Ein Banner, dessen Inhalt an den Rand stoesst,
  // sieht auf einem schmalen Bildschirm abgeschnitten aus – und ob das
  // passiert, haengt an der Schrift, nicht an der Absicht.
  const luft = await seite.evaluate(() => {
    const teile = [...document.body.children];
    const r = teile.map((t) => t.getBoundingClientRect());
    return {
      links: Math.round(Math.min(...r.map((x) => x.left))),
      rechts: Math.round(innerWidth - Math.max(...r.map((x) => x.right))),
      oben: Math.round(Math.min(...r.map((x) => x.top))),
      unten: Math.round(innerHeight - Math.max(...r.map((x) => x.bottom))),
    };
  });

  // Sind die Zeichen wirklich Zeichen – oder zwei leere Kaesten?
  // -------------------------------------------------------------------------
  // Fehlt die Schrift, setzt der Browser Ersatzkaesten. Die haben eine Breite,
  // stehen an der richtigen Stelle und bestehen jede Messung, die nur die
  // Geometrie anschaut. Der Unterschied liegt in der Farbe: Ochse und
  // Mahjong-Stein sind bunt, ein Ersatzkasten ist es nie. Also wird gezaehlt,
  // wie viele Bildpunkte in dem Feld ueberhaupt eine Farbe haben.
  const zeichen = await seite.evaluate(() => {
    const el = document.querySelector('.zeichen');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.left), y: Math.floor(r.top),
      width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });

  const datei = path.join(root, 'preview', `banner-${e.nr}.png`);
  await seite.screenshot({ path: datei });
  const ausschnitt = zeichen && zeichen.width > 0
    ? await seite.screenshot({ clip: zeichen }) : null;
  await seite.close();

  const bunt = ausschnitt ? farbanteil(ausschnitt) : 0;

  const eng = Math.min(luft.links, luft.rechts, luft.oben, luft.unten);
  console.log(`  ${e.nr}. ${e.name}`);
  console.log(`     Rand: ${luft.oben} oben, ${luft.rechts} rechts, `
    + `${luft.unten} unten, ${luft.links} links`
    + `${eng < 40 ? `   << eng (${eng} px)` : ''}`);
  console.log(`     ${e.was}`);
  console.log(`     Zeichen: ${bunt} farbige Bildpunkte`
    + `${bunt < 200 ? '   << ERSATZKASTEN? Schrift pruefen' : ''}`);
  console.log(`     ${path.relative(root, datei)}\n`);
}

await browser.close();
