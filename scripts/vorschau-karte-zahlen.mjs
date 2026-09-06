// ============================================================================
// Vorschaubilder: Der Abstand zwischen Betrag und Stimmenzahl auf der Karte
//
// Nachgerechnet stimmt an der jetzigen Lage etwas nicht mit dem Eindruck
// überein. Die beiden Zeilen sitzen in der Antwortzeile sauber mittig:
//
//   Zeilenhöhe 82, Betrag mit Versalhöhe ~26 auf Grundlinie mitte-8,
//   Stimmenzahl mit Unterlänge ~4 auf mitte+30
//   → oben 7 px frei, unten 7 px frei.
//
// Der Betrag steht also NICHT zu weit oben – er sieht nur so aus. Der Grund
// ist die Lücke dazwischen: 26 px zwischen der Grundlinie des Betrags und der
// Oberkante der Stimmenzahl. Bei so viel Abstand liest das Auge die beiden
// nicht mehr als ein Paar, sondern als zwei Dinge, und dann wirkt das obere
// nach oben gerutscht.
//
// Die Lücke zu schließen zieht deshalb beide aufeinander zu – der Betrag
// wandert nach unten, die Stimmenzahl nach oben, und die Mitte bleibt die
// Mitte. Das ist die Rechnung dahinter:
//
//   Betrag auf mitte+a, Stimmenzahl auf mitte+b.
//   Mittig bleibt es, solange a + b = 22.
//   Die sichtbare Lücke ist dann g = 10 - 2a.
//
// Deshalb ist hier nur EIN Wert einstellbar. Zwei Werte von Hand zu setzen
// hiesse, die Mittigkeit bei jeder Änderung neu von Hand herzustellen – und
// beim dritten Mal vergisst man es.
//
// Eine Warnung, weil es schon einmal andersherum ging: Der Abstand ist
// ausdrücklich vergrössert worden, weil die Stimmenzahl "zu nah an der
// $ zahl" stand und sich wie eine Nachkommastelle des Betrags las. Zu eng ist
// also ein echter Fehler, kein theoretischer. Die letzte Fassung hier zeigt,
// wo das anfängt.
//
// Erzeugt preview/zahlen-*.png und preview/zahlen-uebersicht.png
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

const BETRAG = `ctx.fillText(vollUsd(o.usd), B - rand - 26, mitte - 8);`;
const STIMMEN = "ctx.fillText(`${ganzeZahl(o.votes)} vote${o.votes === 1 ? '' : 's'}`, B - rand - 26, mitte + 30);";
if (!zeichner.includes(BETRAG)) throw new Error('Die Betragszeile sieht anders aus als erwartet');
if (!zeichner.includes(STIMMEN)) throw new Error('Die Stimmenzeile sieht anders aus als erwartet');

// a ist der einzige Regler. b folgt daraus, damit das Paar mittig bleibt.
const setze = (a) => (q) => q
  .replace(BETRAG, `ctx.fillText(vollUsd(o.usd), B - rand - 26, mitte + ${a});`)
  .replace(STIMMEN, "ctx.fillText(`${ganzeZahl(o.votes)} vote${o.votes === 1 ? '' : 's'}`, B - rand - 26, mitte + " + (22 - a) + ');');

const FASSUNGEN = [
  { datei: 'jetzt', a: -8, name: 'Jetzt', hinweis: 'Lücke 26 px. Mittig gerechnet – wirkt trotzdem, als säße der Betrag zu hoch, weil das Paar zu weit auseinandersteht, um als Paar gelesen zu werden.' },
  { datei: 'a20', a: -5, name: 'Etwas enger', hinweis: 'Lücke 20 px. Der kleinste Schritt, den man überhaupt sieht.' },
  { datei: 'a16', a: -3, name: 'Enger', hinweis: 'Lücke 16 px. Die beiden fangen an, als ein Block zu wirken; der Betrag rutscht sichtbar nach unten in die Zeile.' },
  { datei: 'a12', a: -1, name: 'Deutlich enger', hinweis: 'Lücke 12 px. Betrag und Stimmenzahl gehören klar zusammen, stehen aber noch als zwei Zeilen da.' },
  { datei: 'a8', a: 1, name: 'Eng', hinweis: 'Lücke 8 px. Hier fängt das alte Problem wieder an: Die Stimmenzahl beginnt, sich wie eine Nachkommastelle des Betrags zu lesen.' },
];

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });
const POLL = {
  id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  options: [
    opt('Ship it this week', 128, 482900, 4829 / 7814.2),
    opt('Wait for the audit', 44, 210400, 2104 / 7814.2),
    opt('Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
  ],
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
      ${setze(f.a)(zeichner)}
      window.zeichnePoll = zeichnePoll;`,
  });
  const daten = await seite.evaluate(async (p) => ({
    gross: (await window.zeichnePoll(p)).toDataURL('image/png'),
    karte: (await window.zeichnePoll(p, { fuerKarte: true })).toDataURL('image/png'),
  }), POLL);
  await seite.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ausgabe, `zahlen-${f.datei}-download.png`), roh(daten.gross));
  fs.writeFileSync(path.join(ausgabe, `zahlen-${f.datei}-karte.png`), roh(daten.karte));
  ergebnisse.push(daten);
  console.log(`  ${f.name.padEnd(16)} Betrag mitte${f.a >= 0 ? '+' : ''}${f.a}`
    + `   Stimmen mitte+${22 - f.a}   Lücke ${10 - 2 * f.a} px`);
}

const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 108ch; }
  section { margin-bottom: 38px; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .8rem; }
  .werte { font-size: .7rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .3rem 0 .7rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .beschriftung { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Betrag und Stimmenzahl auf der Karte</h1>
<p class="lead">Nur der Abstand zwischen den beiden ändert sich. Das Paar bleibt in jeder Fassung mittig in der Antwortzeile – der Betrag wandert nach unten, die Stimmenzahl im selben Maß nach oben. Links das Bild zum Herunterladen, rechts die Vorschaukarte für X.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte">Lücke ${10 - 2 * f.a} px</span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="paar">
    <div><p class="beschriftung">Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].gross}"></div></div>
    <div><p class="beschriftung">Vorschau bei X</p><div class="buehne"><img src="${ergebnisse[i].karte}"></div></div>
  </div>
</section>`).join('')}`;

const seite = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await seite.setContent(blatt);
await seite.waitForTimeout(600);
await seite.screenshot({ path: path.join(ausgabe, 'zahlen-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'zahlen-uebersicht.png')}\n`);
