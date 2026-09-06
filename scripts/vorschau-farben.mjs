// ============================================================================
// Farbvorschlaege: dieselbe Seite, sechs Paletten.
//
// Warum nicht Farbquadrate, sondern die ganze Seite: Eine Palette entscheidet
// sich nicht am einzelnen Ton, sondern daran, wie zwanzig Betraege
// untereinander aussehen und ob der Balken einer fuehrenden Antwort die Zeile
// ueberstrahlt. Genau das war schon zweimal der Grund, eine Farbe zu aendern,
// die fuer sich genommen richtig aussah.
//
// Gebaut wird mit der ECHTEN index.html und dem echten Blatt; ueberschrieben
// werden nur die Variablen in :root. Damit bleibt eine Probe folgenlos – im
// Blatt aendert sich nichts, bis eine Palette gewaehlt ist.
//
// Der Beispielinhalt kommt woertlich aus preview-mobile.mjs. Eine zweite Kopie
// der Aufbauanweisungen waere die uebliche Falle: Sie laeuft irgendwann neben
// der Seite her, und dann vergleicht man Farben an einer Oberflaeche, die es
// so nicht mehr gibt.
//
// Zu jeder Palette werden die Kontraste GERECHNET und ausgegeben – eine Farbe,
// die gut aussieht und die Stimmenzahl auf dem Balken verschwinden laesst, ist
// keine Alternative, sondern ein Rueckschritt. Die Grenzen stehen in
// styles.css bei den jeweiligen Variablen.
//
//   node scripts/vorschau-farben.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'preview', 'farben');
fs.mkdirSync(outDir, { recursive: true });

// --- Der Beispielinhalt, woertlich aus preview-mobile.mjs -------------------
const vorschau = fs.readFileSync(path.join(root, 'scripts', 'preview-mobile.mjs'), 'utf8');
const schneide = (von, bis) => {
  const a = vorschau.indexOf(von);
  const b = vorschau.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in preview-mobile.mjs: ${von}`);
  return vorschau.slice(a, b);
};
// Beide Bloecke enden auf die schliessende Backtick-Zeile.
const FIXTURE = schneide('const FIXTURE = `', '\n`;\n') + '\n`;\n';
const ADMIN_FIXTURE = schneide('const ADMIN_FIXTURE = `', '\n`;\n') + '\n`;\n';

// ---------------------------------------------------------------------------
// Die Paletten
//
// Jede aendert NUR :root-Variablen. Was eine Farbe bedeutet, bleibt in allen
// gleich: neutral ist Handlung, Gold ist Ansem, Rot ist ein Problem. Wer das
// verschiebt, verschiebt nicht die Farbe, sondern die Sprache der Seite.
// ---------------------------------------------------------------------------
const PALETTEN = [
  {
    nr: 1,
    name: 'jetzt',
    titel: 'Jetzt',
    was: 'Blaustichiges Fast-Schwarz, knochenweisser Akzent. Der Vergleichspunkt.',
    vars: {},
  },
  {
    nr: 2,
    name: 'neutral',
    titel: 'Neutral',
    was: 'Dieselbe Helligkeit, aber der Blaustich raus. Damit ist das Blau des '
       + 'fuehrenden Balkens die einzige Farbe der Seite – es traegt mehr.',
    vars: {
      '--bg': '#0b0b0b', '--bg-1': '#111111', '--bg-2': '#171717',
      '--bg-3': '#1e1e1e', '--line': '#292929',
      '--text': '#e9e9e9', '--dim': '#969696', '--dimmer': '#656565',
      '--accent': '#f0f0f0', '--accent-rgb': '240, 240, 240',
      '--accent-fill': '#b0b0b0', '--worth': '#c0c0c0', '--votes': '#cfcfcf',
      '--fokus': '#969696',
    },
  },
  {
    nr: 3,
    name: 'warm',
    titel: 'Warm',
    was: 'Grautoene ins Warme gedreht, Akzent als Creme. Liest sich weniger '
       + 'nach Handelsplatz, mehr nach Papier. Der Balken bleibt blau und '
       + 'steht damit als Gegenfarbe – der einzige kalte Ton der Seite.',
    vars: {
      '--bg': '#0d0b09', '--bg-1': '#14110e', '--bg-2': '#1b1714',
      '--bg-3': '#231e19', '--line': '#2e2822',
      '--text': '#efeae2', '--dim': '#a79b8b', '--dimmer': '#756a5c',
      '--accent': '#f5efe2', '--accent-rgb': '245, 239, 226',
      '--accent-fill': '#c2b6a2', '--worth': '#d0c6b4', '--votes': '#d9d0c0',
      '--fokus': '#a79b8b', '--fuellung': '#3a3733',
    },
  },
  {
    nr: 4,
    name: 'gruen',
    titel: 'Solana-Gruen',
    was: 'Der Akzent, der beim Bauen verworfen wurde – hier zum Ansehen statt '
       + 'zum Nachlesen. Das Argument dagegen steht im Blatt: Ein gesaettigter '
       + 'Akzent kommt einer der vier Namensfarben immer nahe.',
    vars: {
      '--accent': '#14f195', '--accent-rgb': '20, 241, 149',
      '--accent-fill': '#0e9e63',
    },
  },
  {
    nr: 5,
    name: 'blau',
    titel: 'Ein Blau, konsequent',
    was: 'Statt Blaustich im Grau ein richtiges Blau, und der Akzent zieht mit. '
       + 'Die Seite bekennt sich zu einer Farbe, statt sie nur anzudeuten.',
    vars: {
      '--bg': '#080b14', '--bg-1': '#0d1220', '--bg-2': '#12192b',
      '--bg-3': '#182238', '--line': '#223049',
      '--text': '#e6ecf7', '--dim': '#8e9cb8', '--dimmer': '#5f6b85',
      '--accent': '#cfe0ff', '--accent-rgb': '207, 224, 255',
      '--accent-fill': '#7d9bd0', '--worth': '#b3c6e8', '--votes': '#c9d7ef',
      '--fokus': '#8e9cb8',
      // #3b6fb5 stand hier zuerst – ein helleres, kraeftigeres Blau, das zur
      // Ansage "eine Farbe, konsequent" gepasst haette. Gerechnet fiel die
      // Stimmenzahl darauf auf 3,5:1 und der Text auf 4,3:1, beides unter der
      // Grenze. #3457a2 ist der hellste Wert, der beide noch traegt.
      '--fuellung': '#2a3242', '--fuellung-spitze': '#3457a2',
    },
  },
  {
    nr: 6,
    name: 'weicher',
    titel: 'Weicher Grund',
    was: 'Dieselben Farbtoene, aber der Grund eine Stufe heller. Weniger harter '
       + 'Anschlag, dafuer weniger Tiefe. Nur die Flaechen bewegen sich, '
       + 'kein Text.',
    vars: {
      '--bg': '#14161d', '--bg-1': '#1a1d26', '--bg-2': '#21252f',
      '--bg-3': '#2a2f3b', '--line': '#363c4a',
    },
  },
];

// ---------------------------------------------------------------------------
// Kontrast
// ---------------------------------------------------------------------------
const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => kanal(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kon = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Die Ausgangswerte aus dem echten Blatt lesen, nicht hier noch einmal
// hinschreiben: Sonst rechnet die Probe gegen eine Palette, die es im Blatt
// laengst nicht mehr gibt.
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const wurzel = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const grundwerte = Object.fromEntries(
  [...wurzel.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));

/**
 * Die Stellen, an denen eine Farbentscheidung schiefgehen kann.
 *
 * Nicht alle Paarungen der Palette – nur die, die beim Bauen schon einmal
 * knapp waren oder wo eine Zahl unlesbar wurde. Jede traegt ihre Grenze mit,
 * und die Grenzen stehen so auch in styles.css.
 */
const PRUEFPUNKTE = [
  ['Text auf Grund',            '--text',   '--bg',               7.0],
  ['Nebentext auf Grund',       '--dim',    '--bg',               4.5],
  ['Betrag auf Grund',          '--worth',  '--bg',               4.5],
  ['Stimmenzahl auf Grau',      '--votes',  '--fuellung',         4.5],
  ['Stimmenzahl auf Blau',      '--votes',  '--fuellung-spitze',  4.5],
  ['Text auf Blau',             '--text',   '--fuellung-spitze',  4.5],
  ['Knopfschrift auf Knopf',    '--bg',     '--accent-fill',      4.5],
  ['Rahmen im Fokus',           '--fokus',  '--bg',               3.0],
];

const wert = (p, name) => p.vars[name] ?? grundwerte[name];

// ---------------------------------------------------------------------------
// Die Seite
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const datei = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const abs = path.join(root, 'public', path.normalize(datei).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(path.join(root, 'public')) || !fs.existsSync(abs)) {
    return res.writeHead(404).end('');
  }
  // app.js wird ersetzt: Die echte Anwendung wuerde sich anmelden wollen.
  if (datei === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Probe */');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Zwei Ansichten, und beide werden gebraucht: In den Abstimmungen entscheidet
// sich der Balken, in den DMs die Sprechblase. Eine Palette kann in einer von
// beiden gut aussehen und in der anderen nicht.
const ANSICHTEN = [
  ['polls', `document.querySelector('#pane-polls').hidden = false;`],
  ['dms', `document.querySelectorAll('.tab')[1].classList.add('is-active');
     document.querySelectorAll('.tab')[0].classList.remove('is-active');
     document.querySelector('#pane-polls').hidden = true;
     document.querySelector('#pane-dms').hidden = false;
     document.querySelector('#dm-admin').classList.add('viewing');`],
];

console.log('\nFarbvorschlaege\n');

for (const p of PALETTEN) {
  const regeln = Object.entries(p.vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  for (const [ansicht, aufbau] of ANSICHTEN) {
    const seite = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await seite.goto(base, { waitUntil: 'domcontentloaded' });
    // Erst die beiden Bloecke DEKLARIEREN, dann ihren Inhalt ausfuehren.
    // Ausgeschnitten ist der Quelltext samt "const FIXTURE = `…`;" – wer den
    // nur einfuegt, hat zwei Zeichenketten angelegt und nichts getan. Genau
    // das ist beim ersten Versuch passiert: sechs leere Seiten in sechs
    // Farben. Der Inhalt ist eine Vorlage mit eigenen ${}-Stellen, muss also
    // als solche ausgewertet werden – daher eval und kein Einfuegen.
    await seite.addScriptTag({
      content: `${FIXTURE}${ADMIN_FIXTURE}
        eval(FIXTURE + ADMIN_FIXTURE + ${JSON.stringify(aufbau)});`,
    });
    if (regeln) await seite.addStyleTag({ content: `:root { ${regeln} }` });
    await seite.waitForTimeout(200);
    await seite.screenshot({ path: path.join(outDir, `${p.nr}-${p.name}-${ansicht}.png`) });
    await seite.close();
  }

  // Und die Zahlen dazu. Eine Palette, die eine Grenze reisst, ist keine
  // Geschmacksfrage mehr.
  const zeilen = PRUEFPUNKTE.map(([was, a, b, grenze]) => {
    const v = kon(wert(p, a), wert(p, b));
    return { was, v, grenze, ok: v >= grenze };
  });
  const durch = zeilen.filter((z) => !z.ok);
  console.log(`${p.nr}. ${p.titel}`);
  console.log(`   ${p.was.replace(/\s+/g, ' ')}`);
  console.log('   ' + zeilen.map((z) => `${z.was} ${z.v.toFixed(1)}:1${z.ok ? '' : ' ✗'}`).join('  ·  '));
  if (durch.length) {
    console.log(`   ACHTUNG: ${durch.length} unter der Grenze – `
      + durch.map((z) => `${z.was} braucht ${z.grenze}:1`).join(', '));
  }
  console.log('');
}

await browser.close();
server.close();
console.log(`Bilder in preview/farben/\n`);
