// ============================================================================
// Vorschaubilder: Die Füllung der Antwortbalken auf der Karte
//
// Der Balken ist der einzige Teil der Karte, der etwas AUSRECHNET. Alles
// andere zeigt Text; er zeigt ein Verhältnis. Und er trägt eine Regel, die
// beim Umbauen leicht kaputtgeht: Seine Breite ist der Anteil am Gesamtbetrag,
// die gefüllten Stücke aller Antworten ergeben zusammengelegt also genau einen
// vollen Balken. test-poll-bild.mjs rechnet das nach.
//
// Zwei Entscheidungen sind bereits gefallen und bleiben in allen Fassungen:
//
//   * Die Kante hört hart auf, ohne Auslauf. Auf der Seite läuft dieselbe
//     Füllung weich aus – dort ist der Balken anklickbar und ändert sich beim
//     Abstimmen, und eine harte Kante, die beim Klick durch ein Wort springt,
//     liest sich als Fehler. Das Bild ist starr; dort sagt die Kante etwas,
//     was der weiche Auslauf verschluckt: genau hier endet der Anteil.
//
//   * Kein Prozentwert. Der Betrag ist die Aussage, der Balken zeigt ihn.
//
// Offen ist, WIE der gefüllte Teil sich vom leeren absetzt. Der Text der
// Antwort liegt darüber und wird von der Kante gekreuzt – jede Fassung muss
// ihn auf beiden Seiten gleich lesbar lassen. Das ist die eigentliche Grenze
// nach oben: Eine kräftigere Füllung sieht auf den ersten Blick besser aus und
// frisst dann das Wort, das über der Kante steht.
//
// Beide Formate wieder nebeneinander, und die Fälle sind absichtlich
// verschieden: einmal drei Antworten mit klarer Führung, einmal zehn eng
// beieinander – dort zeigt sich, ob eine Fassung auch bei kleinen Anteilen
// noch etwas sagt.
//
// Erzeugt preview/balken-*.png und preview/balken-uebersicht.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeichner = schneide('const cssWert =', '\nasync function ladeOgBildHoch');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');

// --- Die Stelle, an der alle Fassungen ansetzen ----------------------------
const FUELLUNG = `      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, .24)\`;
      ctx.fillRect(rand, y, fuellB, optH);`;
if (!zeichner.includes(FUELLUNG)) throw new Error('Die Balkenfuellung sieht in app.js anders aus als erwartet');

// Die Zeile selbst – Grund und Umriss – fuer die Fassungen, die daran ruehren.
const ZEILE = `    ctx.fillStyle = farbe.balken;
    rundesRechteck(ctx, rand, y, inhalt, optH, 13);
    ctx.fill();`;
if (!zeichner.includes(ZEILE)) throw new Error('Der Zeilengrund sieht anders aus als erwartet');

const fuell = (js) => (q) => q.replace(FUELLUNG, js);

const FASSUNGEN = [
  { datei: 'jetzt', name: 'Jetzt', kurz: 'Fläche bei 24 %',
    text: 'Der Stand von heute. Die gefüllte Fläche liegt bei 24 % Deckkraft über dem Zeilengrund. Bei kleinen Anteilen ist das Stück schmal und leise – siehe die letzten Antworten im Zehnerfall.',
    patch: (q) => q },

  { datei: 'kraeftig', name: 'Kräftiger', kurz: '36 % statt 24 %',
    text: 'Dieselbe Fläche, deutlich sichtbarer. Der Anteil springt schon beim Überfliegen ins Auge. Zu prüfen ist der Text: Wo die Kante durch ein Wort läuft, wird der Unterschied zwischen den beiden Hälften des Wortes größer.',
    patch: fuell(`      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, .36)\`;
      ctx.fillRect(rand, y, fuellB, optH);`) },

  { datei: 'leise', name: 'Leiser', kurz: '16 % statt 24 %',
    text: 'Die Gegenrichtung: Die Zeile wird ruhiger, der Betrag rechts übernimmt mehr Gewicht. Passt zur Haltung "der Balken ist die Nebenauskunft, die Zahl die Hauptsache" – kostet aber genau das, wofür der Balken da ist.',
    patch: fuell(`      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, .16)\`;
      ctx.fillRect(rand, y, fuellB, optH);`) },

  { datei: 'kante', name: 'Fläche + Kantenstrich', kurz: 'Das Ende bekommt eine Linie',
    text: 'Die Füllung bleibt zurückhaltend, aber ihr Ende wird als heller Strich markiert. Damit ist der Anteil auf den Millimeter ablesbar, ohne dass die Fläche lauter wird – die Kante trägt die Aussage, nicht die Helligkeit.',
    patch: fuell(`      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, .20)\`;
      ctx.fillRect(rand, y, fuellB, optH);
      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, .75)\`;
      ctx.fillRect(rand + fuellB - 3, y, 3, optH);`) },

  { datei: 'streifen', name: 'Streifen unten', kurz: 'Kein Feld, sondern eine Leiste',
    text: 'Statt die ganze Zeile zu füllen, läuft ein kräftiger Streifen am unteren Rand. Der Text steht damit nie auf der Füllung und wird nie von einer Kante gekreuzt – das Lesbarkeitsproblem verschwindet ganz. Dafür wirkt der Anteil kleiner, als er ist.',
    patch: fuell(`      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, .85)\`;
      ctx.fillRect(rand, y + optH - 7, fuellB, 7);`) },

  { datei: 'spitze', name: 'Führende hervorgehoben', kurz: 'Eine Antwort lauter als die anderen',
    text: 'Die führende Antwort wird bei 38 % gefüllt, alle übrigen bei 18 %. Die Karte sagt damit auf einen Blick, was gewinnt, und ordnet den Rest unter. Zu bedenken: Bei einem knappen Rennen behauptet die Karte einen Abstand, den es so nicht gibt.',
    patch: fuell(`      ctx.fillStyle = \`rgba(\${farbe.akzentRgb}, \${spitze ? '.38' : '.18'})\`;
      ctx.fillRect(rand, y, fuellB, optH);`) },
];

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });
const FAELLE = {
  drei: {
    id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
    question: 'Should we open the token gate to smaller holders?',
    options: [
      opt('Ship it this week', 128, 482900, 4829 / 7814.2),
      opt('Wait for the audit', 44, 210400, 2104 / 7814.2),
      opt('Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
    ],
  },
  zehn: (() => {
    const usd = Array.from({ length: 10 }, (_, i) => 400000 - i * 30000);
    const gesamt = usd.reduce((a, b) => a + b, 0);
    return {
      id: 4, closed: false, totalVotes: 235, totalUsd: gesamt,
      question: 'Pick the next AMA guest',
      options: usd.map((u, i) => opt(`Guest number ${i + 1}`, 55 - i * 4, u, u / gesamt)),
    };
  })(),
};

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const ergebnisse = [];
for (const f of FASSUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, polls: [] };
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const toast = () => {};
      ${formate}
      ${f.patch(zeichner)}
      window.zeichnePoll = zeichnePoll;
    `,
  });

  const daten = await seite.evaluate(async (faelle) => {
    const drei = await window.zeichnePoll(faelle.drei);
    const karte = await window.zeichnePoll(faelle.drei, { fuerKarte: true });
    const zehn = await window.zeichnePoll(faelle.zehn);
    return {
      drei: drei.toDataURL('image/png'),
      karte: karte.toDataURL('image/png'),
      zehn: zehn.toDataURL('image/png'),
      // Die Regel, die nicht kaputtgehen darf: Die Fuellbreiten aller
      // Antworten ergeben zusammen genau einen vollen Balken.
      summe: drei.geometrie.fuellungen.reduce((a, b) => a + b, 0) / drei.geometrie.inhalt,
    };
  }, FAELLE);
  await seite.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  for (const [was, d] of Object.entries({ download: daten.drei, karte: daten.karte, zehn: daten.zehn })) {
    fs.writeFileSync(path.join(ausgabe, `balken-${f.datei}-${was}.png`), roh(d));
  }
  ergebnisse.push({ ...daten, kb: roh(daten.karte).length / 1024 });
  console.log(`  ${f.name.padEnd(26)} Karte ${(roh(daten.karte).length / 1024).toFixed(0).padStart(4)} KB`
    + `   Summe der Fuellungen ${daten.summe.toFixed(4)}`);
}

// Wenn eine Fassung diese Summe verschiebt, zeigt sie ein falsches Verhaeltnis.
// Lieber hier laut werden als es im Bild uebersehen.
const schief = ergebnisse.filter((e) => Math.abs(e.summe - 1) > 0.002);
if (schief.length) {
  console.log(`\n  ACHTUNG: ${schief.length} Fassung(en) fuellen nicht mehr auf genau einen Balken.\n`);
}

const blattHtml = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 110ch; }
  section { margin-bottom: 42px; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .8rem; }
  .kurz { color: var(--dim); font-weight: 400; font-size: .86rem; }
  p.t { margin: .35rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 120ch; }
  .reihe { display: grid; grid-template-columns: 1.1fr 1.1fr .8fr; gap: 18px; align-items: start; }
  .beschriftung { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Die Füllung der Antwortbalken</h1>
<p class="lead">Links das Bild zum Herunterladen, in der Mitte die Vorschaukarte für X, rechts derselbe Entwurf mit zehn eng beieinanderliegenden Antworten – dort zeigt sich, ob eine Fassung auch bei kleinen Anteilen noch etwas sagt. Der Rahmen ist wieder das Grau einer Zeitleiste. Fassung 3 vom letzten Mal ist überall schon drin: flach, kräftiger Rand.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>${f.name}<span class="kurz">${f.kurz}</span></h2>
  <p class="t">${f.text}</p>
  <div class="reihe">
    <div><p class="beschriftung">Herunterladen · 16:9</p><div class="buehne"><img src="${ergebnisse[i].drei}"></div></div>
    <div><p class="beschriftung">Vorschau bei X · 1,91:1</p><div class="buehne"><img src="${ergebnisse[i].karte}"></div></div>
    <div><p class="beschriftung">Zehn Antworten</p><div class="buehne"><img src="${ergebnisse[i].zehn}"></div></div>
  </div>
</section>`).join('')}`;

const blatt = await browser.newPage({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 1.4 });
await blatt.setContent(blattHtml);
await blatt.waitForTimeout(700);
await blatt.screenshot({ path: path.join(ausgabe, 'balken-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'balken-uebersicht.png')}\n`);
