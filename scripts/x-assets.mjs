/**
 * Profilbild und Kopfleiste fuer X.
 *
 * Nichts hier ist ausgesucht: der Grund, die Marke, die Balkenfarben und die
 * Schrift kommen aus public/. Ein Profilbild, dessen Papier eine Spur neben
 * dem Papier der Seite liegt, sieht falsch aus, sobald jemand vom Profil auf
 * sized.gg klickt - und niemand kann sagen, warum.
 *
 * Der Grund ist EIN Wert fuer beide Bilder. Genau darum ging die Ansage: die
 * Kopfleiste traegt den Hintergrund des Profilbilds, damit das runde Bild
 * nicht als Scheibe auf einer anderen Flaeche klebt, sondern in ihr
 * verschwindet.
 *
 * ---------------------------------------------------------------------------
 * GROESSEN
 *
 *   Profil    800 x 800   (X verlangt mindestens 400; doppelt, damit es auf
 *                          einem Retina-Schirm nicht matscht). X schneidet
 *                          rund zu, also muss alles Wichtige innerhalb des
 *                          eingeschriebenen Kreises liegen.
 *   Kopf     3000 x 1000  (1500 x 500 in doppelter Aufloesung, dasselbe 3:1)
 *
 * ---------------------------------------------------------------------------
 * WO NICHTS STEHEN DARF
 *
 * X legt das Profilbild ueber die linke untere Ecke der Kopfleiste und
 * beschneidet sie auf schmalen Schirmen in der Hoehe. Deshalb bleiben die
 * linken 300 und die unteren 120 Punkte (bei 1500 x 500 gerechnet) frei, und
 * der Inhalt haelt sich vertikal in der Mitte. Diese Zahlen stehen unten als
 * FREI_LINKS / FREI_UNTEN und werden nach dem Zeichnen geprueft, nicht nur
 * behauptet.
 *
 *   node scripts/x-assets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const OUT = path.join(root, 'post', 'x');
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

/** Die Marke, wortwoertlich aus index.html - nicht nachgezeichnet. */
const MARKE = (() => {
  const a = html.indexOf('<svg viewBox="29 16 42 64"');
  const b = html.indexOf('</svg>', a) + 6;
  if (a < 0) throw new Error('Markenzeichen nicht in index.html gefunden');
  return html.slice(a, b);
})();

/** Ein Farbwert aus styles.css, ueber var()-Ketten hinweg aufgeloest. */
const farbe = (name, tiefe = 0) => {
  if (tiefe > 8) throw new Error(`--${name}: Verweis dreht sich im Kreis`);
  const t = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(css);
  if (!t) throw new Error(`--${name} nicht in styles.css gefunden`);
  const wert = t[1].trim();
  const verweis = /^var\(--([\w-]+)\)$/.exec(wert);
  return verweis ? farbe(verweis[1], tiefe + 1) : wert;
};

const C = {
  grund: farbe('bg'),
  text: farbe('text'),
  dim: farbe('dim'),
  dimmer: farbe('dimmer'),
  marke: farbe('marke'),
  fuellung: farbe('fuellung'),
  spitze: farbe('fuellung-spitze'),
};

/** Die echte Schrift, eingebettet - sonst faellt das Bild auf DejaVu zurueck. */
const schnitt = (gewicht) => {
  const datei = path.join(pub, 'fonts', `ibm-plex-mono-${gewicht}.woff2`);
  const b64 = fs.readFileSync(datei).toString('base64');
  return `@font-face { font-family: 'Plex'; font-weight: ${gewicht};
    src: url(data:font/woff2;base64,${b64}) format('woff2'); }`;
};
const SCHRIFT = [400, 500, 600, 700].map(schnitt).join('\n');

const FREI_LINKS = 300;   // bei 1500 breit gerechnet
const FREI_UNTEN = 120;   // bei 500 hoch gerechnet

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

const BASIS = `
  ${SCHRIFT}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${C.grund}; font-family: 'Plex', ui-monospace, monospace;
         color: ${C.text}; -webkit-font-smoothing: antialiased; }
  /* <span> aus index.html, also inline - ohne display:block greift keine
     Hoehe und das Profilbild kam als leeres Papier heraus. */
  .marke { display: block; }
  .marke svg { display: block; height: 100%; width: auto; color: ${C.marke}; fill: currentColor; }
`;

async function bild(inhalt, breite, hoehe, datei, skala) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: hoehe }, deviceScaleFactor: skala,
  });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8">
    <style>${BASIS}${inhalt.stil || ''}</style>${inhalt.html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const ziel = path.join(OUT, datei);
  await page.screenshot({ path: ziel });
  await ctx.close();
  return ziel;
}

// --- Das Profilbild ---------------------------------------------------------
//
// Nur die Marke, kein Schriftzug. In der Zeitleiste ist das Bild 48 Punkte
// gross - ein Wort darin waere ein grauer Fleck. Die Marke ist hochkant
// (42 zu 64), also entscheidet ihre HOEHE, und sie bleibt bei 34 % der Kante
// weit innerhalb des Kreises, den X ausschneidet.
const PROFIL = {
  html: `<div class="mitte"><span class="marke">${MARKE}</span></div>`,
  stil: `
    html, body { height: 100%; }
    .mitte { width: 100%; height: 100%; display: grid; place-items: center; }
    /* 136 von 400 - in Punkten, nicht in Prozent: eine Prozenthoehe braucht
       eine feste Elternhoehe, und die hatte body nicht. Bei 42 zu 64 ist die
       Marke damit 89 breit und bleibt weit im Kreis, den X ausschneidet
       (Radius 200, die Ecke der Marke liegt bei 81 vom Mittelpunkt). */
    .marke { height: 136px; }
  `,
};

// --- Die Kopfleiste, drei Fassungen ----------------------------------------
//
// Alle drei auf demselben Papier wie das Profilbild, alle drei mit freier
// linker unterer Ecke.
const balken = (werte) => werte.map((b, i) => `
  <div class="zeile">
    <div class="fuell" style="width:${b}%;background:${i === 0 ? C.spitze : C.fuellung}"></div>
  </div>`).join('');

const KOPF_STIL = `
  /* Die Hoehe muss hier stehen, sonst ist body nur so hoch wie sein
     Inhalt und align-items:center zentriert in nichts - der Inhalt klebte
     oben an der Kante, obwohl die Regel richtig aussah. */
  html, body { height: 100%; }
  body { display: flex; align-items: center; }
  .platz { width: ${FREI_LINKS}px; flex: none; }
  /* Kein padding-bottom. Die erste Fassung hatte eines in der Hoehe des
     freien Streifens, und das hat den ganzen Inhalt nach oben geschoben -
     die Leiste sah unten leer aus. Freizuhalten ist nur die linke untere
     ECKE, und dort steht ohnehin nichts, weil der Inhalt erst hinter
     .platz beginnt. Die Pruefung unten misst genau diese Ecke.
     120 rechts statt 90: bei 90 lief der laengste Balken so dicht an die
     Kante, dass es nach einem Beschnitt aussah statt nach Absicht. */
  .inhalt { flex: 1; display: flex; align-items: center; gap: 64px;
            padding-right: 120px; }
  .wort { display: flex; align-items: center; gap: 18px; }
  .wort .marke { height: 58px; }
  .wort b { font-weight: 700; font-size: 62px; letter-spacing: .16em; }
  .zeile2 { font-size: 24px; color: ${C.dim}; letter-spacing: .02em; margin-top: 14px; }
  .stapel { flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .zeile { height: 42px; background: transparent; }
  .fuell { height: 100%; }
`;

// Eine Fassung, nicht drei.
//
// Ohne Markenzeichen: es steht bereits im Profilbild, und X legt das
// unmittelbar links daneben. Zweimal dieselben zwei Balken in einem Blickfeld
// sind keine Wiederholung, die etwas betont - sie lassen die Leiste aussehen,
// als sei das Bild versehentlich zweimal eingesetzt worden.
const KOEPFE = [
  {
    key: 'wort',
    name: 'Schriftzug und Zeile, ohne Zeichen',
    html: `<div class="platz"></div><div class="inhalt">
      <div>
        <div class="wort"><b>SIZED</b></div>
        <div class="zeile2">Community votes and DMs for $ANSEM</div>
      </div>
    </div>`,
  },
];

console.log('\n── Aus public/ gelesen ──\n');
for (const [k, v] of Object.entries(C)) console.log(`  --${k.padEnd(10)} ${v}`);

const profilDatei = await bild(PROFIL, 400, 400, 'sized-x-profil.png', 2);
console.log(`\n  Profilbild  ${path.relative(root, profilDatei)}`);

const koepfe = [];
for (const k of KOEPFE) {
  const d = await bild({ html: k.html, stil: KOPF_STIL }, 1500, 500, 'sized-x-kopf.png', 2);
  koepfe.push({ ...k, datei: d });
  console.log(`  Kopfleiste  ${path.relative(root, d)}`);
}

// --- Nachmessen, statt es zu behaupten --------------------------------------
//
// Zwei Dinge koennen hier still schiefgehen: der Grund der beiden Bilder
// laeuft auseinander (dann klebt das runde Bild als Scheibe auf der Leiste),
// und in die Ecke, die X mit dem Profilbild ueberdeckt, rutscht doch etwas
// hinein. Beides wird an den PIXELN geprueft.
const pruef = await browser.newContext({ deviceScaleFactor: 1 });
const pp = await pruef.newPage();

/**
 * Grundfarbe und der Kasten, in dem ueberhaupt etwas steht.
 *
 * Die erste Fassung hat ein Rechteck unten links abgesucht und gezaehlt, ob
 * dort Fremdfarbe liegt. Die Gegenprobe hat sie entlarvt: nimmt man den
 * Platzhalter heraus, der die linke Spalte freihaelt, bleibt die Pruefung
 * gruen - der Inhalt steht senkrecht mittig und kommt dem unteren Streifen
 * gar nicht nahe. Sie hat also eine Flaeche geprueft, die nichts erreichen
 * KANN, und das ist keine Pruefung.
 *
 * Jetzt wird der tatsaechliche Kasten gemessen: die aeusserste Spalte und
 * Zeile, in der etwas anderes steht als der Grund. Daran laesst sich beides
 * pruefen - der Abstand nach links und der nach unten - und beides faellt
 * durch, sobald der Inhalt hineinwaechst.
 */
const lies = async (datei) => {
  const b64 = fs.readFileSync(datei).toString('base64');
  return pp.evaluate(async (q) => {
    const img = new Image();
    await new Promise((ok) => { img.onload = ok; img.src = 'data:image/png;base64,' + q; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const eck = [d[0], d[1], d[2]];
    let minX = c.width, maxX = -1, minY = c.height, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(d[i] - eck[0]) > 6 || Math.abs(d[i + 1] - eck[1]) > 6
          || Math.abs(d[i + 2] - eck[2]) > 6) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { grund: eck, breite: c.width, hoehe: c.height, minX, maxX, minY, maxY };
  }, b64);
};

console.log('\n── Nachgemessen ──\n');
const profil = await lies(profilDatei);
console.log(`  Profil ${profil.breite}x${profil.hoehe}, Grund rgb(${profil.grund.join(', ')})`);
// Die Marke muss im eingeschriebenen Kreis liegen, sonst schneidet X sie an.
const r = profil.breite / 2;
const ecken = [[profil.minX, profil.minY], [profil.maxX, profil.minY],
  [profil.minX, profil.maxY], [profil.maxX, profil.maxY]];
const weiteste = Math.max(...ecken.map(([x, y]) => Math.hypot(x - r, y - r)));
console.log(`  ${weiteste < r * 0.92 ? '✓' : '✗'} Marke im runden Ausschnitt`
  + ` — weiteste Ecke ${Math.round(weiteste)} von ${Math.round(r)}`);

let schlecht = weiteste < r * 0.92 ? 0 : 1;
for (const k of koepfe) {
  const m = await lies(k.datei);
  const s2 = m.breite / 1500;           // die Datei ist doppelt so gross
  const gleich = m.grund.every((v, i) => v === profil.grund[i]);
  const linksFrei = m.minX >= FREI_LINKS * s2;
  const untenFrei = m.maxY <= m.hoehe - FREI_UNTEN * s2;
  if (!gleich || !linksFrei || !untenFrei) schlecht++;
  console.log(`  ${gleich && linksFrei && untenFrei ? '✓' : '✗'} ${k.key.padEnd(20)} `
    + `${m.breite}x${m.hoehe}, Grund ${gleich ? 'identisch' : `WEICHT AB rgb(${m.grund.join(', ')})`}, `
    + `Inhalt ab ${Math.round(m.minX / s2)} links (noetig ${FREI_LINKS}), `
    + `bis ${Math.round(m.maxY / s2)} unten (erlaubt ${500 - FREI_UNTEN})`);
}

// --- Ein Blatt zum Vergleichen ----------------------------------------------
const b64 = (f) => fs.readFileSync(f).toString('base64');
await pp.setContent(`<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #101218; width: 1180px; font-family: ui-monospace, monospace; }
  h2 { color: #e7e9ee; font-size: 15px; margin: 0; padding: 16px 16px 6px; letter-spacing: .02em; }
  p { color: #8b93a7; font-size: 12px; margin: 0; padding: 0 16px 8px; }
  .kopf { width: 1148px; display: block; margin: 0 16px 4px; }
  .zusammen { position: relative; width: 1148px; margin: 0 16px 10px; }
  .zusammen img.k { width: 100%; display: block; }
  .zusammen img.p { position: absolute; left: 3.4%; bottom: -6%; width: 15%;
                    border-radius: 50%; border: 5px solid #101218; }
</style>
  <h2>Profilbild — 800 x 800, rund beschnitten</h2>
  <p>In der Zeitleiste 48 Punkte gross. Deshalb kein Schriftzug darin.</p>
  <div style="padding:0 16px 12px">
    <img src="data:image/png;base64,${b64(profilDatei)}"
         style="width:180px;border-radius:50%;display:block">
  </div>
  ${koepfe.map((k) => `
    <h2>${k.key.replace(/^([a-z])-/, '$1) ')} · ${k.name}</h2>
    <div class="zusammen">
      <img class="k" src="data:image/png;base64,${b64(k.datei)}">
      <img class="p" src="data:image/png;base64,${b64(profilDatei)}">
    </div>`).join('')}
`);
await pp.waitForTimeout(400);
await pp.screenshot({ path: path.join(OUT, 'vergleich.png'), fullPage: true });
await pp.close();
await pruef.close();

await browser.close();
console.log(`\n  Dateien in ${path.relative(root, OUT)}/\n`);
if (schlecht) {
  console.error(`  ${schlecht} Kopfleiste(n) haben die Pruefung nicht bestanden\n`);
  process.exit(1);
}
