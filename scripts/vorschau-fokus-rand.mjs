// ============================================================================
// Vorschaubild: Wie weiß ist "etwas weißer"?
//
// Entschieden ist: kein zweiter Umriss um das Feld herum, kein Schein. Nur der
// Rahmen, den das Feld ohnehin hat, wird beim Tippen heller.
//
// Offen ist der Wert. Und das ist bei einem Rahmen weniger beliebig als bei
// Text, weil er nur 1 px breit ist: Ein mittleres Grau, das als Fläche
// deutlich wäre, verschwindet als Haarlinie fast. Zu wenig Unterschied heißt
// hier nicht "dezent", sondern "man sieht nicht, in welchem Feld man tippt" –
// und im "New poll"-Kasten stehen drei bis zehn gleich aussehende Felder
// untereinander.
//
// Unten steht deshalb bei jeder Stufe der Kontrast gegen den Feldgrund. 3:1
// ist die Grenze, ab der ein Rahmen als Zustandsanzeige noch zuverlässig
// erkennbar ist; darunter wird geraten statt gesehen.
//
// Erzeugt preview/fokus-rand.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const FELDGRUND = '#0a0b0f';
const RUHE = '#262b39';          // --line, der Rahmen ohne Fokus

const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontrast = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const STUFEN = [
  { name: 'Jetzt', farbe: '#eceff5', schein: true,
    hinweis: 'Was gerade eingebaut ist: voller Akzent plus Schein. Der Schein ist genau der zweite Umriss, der weg soll.' },
  { name: 'Voller Akzent', farbe: '#eceff5',
    hinweis: 'Nur der Schein fällt weg. Der Rahmen bleibt volles Knochenweiß – das, was Login, Chat und die DM-Felder heute schon tun.' },
  { name: 'Hell', farbe: '#b9c0d0',
    hinweis: 'Eine Stufe zurück, derselbe Ton wie die Beträge im Chat. Deutlich abgesetzt, aber nicht mehr das Hellste im Kasten.' },
  { name: 'Mittel', farbe: '#8b93a7',
    hinweis: 'Der Ton von --dim. Der Rahmen ist sichtbar heller als die anderen Felder, drängt sich aber nicht auf.' },
  { name: 'Gedämpft', farbe: '#6f778f',
    hinweis: 'Zurückhaltend. Man sieht den Unterschied noch, muss aber schon hinschauen – bei zehn Feldern untereinander wird das mühsam.' },
  { name: 'Kaum', farbe: '#4a5266',
    hinweis: 'Zu wenig. Als Haarlinie ist der Unterschied zum Ruhezustand fast weg – hier nur, um die Untergrenze zu zeigen.' },
];

const kasten = (i) => `
  <div class="poll-admin" id="v${i}">
    <h3>New poll</h3>
    <input type="text" value="Which coin next?" class="fokus">
    <div id="poll-options">
      <input type="text" placeholder="Option 1">
      <input type="text" placeholder="Option 2">
    </div>
    <div class="row">
      <span class="poll-anzahl"><button class="btn btn-ghost" type="button">+ Option</button></span>
      <button class="btn btn-primary" type="button">Start poll</button>
    </div>
  </div>`;

// Fokus hat immer nur ein Element. Damit alle Stufen nebeneinander stehen
// koennen, wird der Zustand ueber eine Klasse nachgestellt statt ueber :focus.
const regeln = STUFEN.map((s, i) =>
  `#v${i} input.fokus { border-color: ${s.farbe};`
  + (s.schein ? ` box-shadow: 0 0 0 3px rgba(236, 239, 245, .16);` : '')
  + ' }'
).join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px 26px 40px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px 22px; max-width: 1400px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .werte { font-family: var(--mono); font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 4.8em; }
  .poll-admin { margin: 0; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 96ch; }
</style>
<style>${regeln}</style>
<h1>Der Rahmen des Feldes, in dem getippt wird</h1>
<p class="lead">Jeweils das obere Feld. Kein Schein mehr außer bei Nummer 0 – nur der Rahmen wird heller. Der Wert dahinter ist der Kontrast gegen den Feldgrund; ohne Fokus liegt der Rahmen bei ${kontrast(RUHE, FELDGRUND).toFixed(1)}:1.</p>
<div class="raster">
  ${STUFEN.map((s, i) => `
  <section class="karte">
    <h2><span class="nr">${i}</span>${s.name}
      <span class="werte">${s.farbe} · ${kontrast(s.farbe, FELDGRUND).toFixed(1)}:1</span></h2>
    <p class="hinweis">${s.hinweis}</p>
    ${kasten(i)}
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-rand.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1460, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${tmp}`);
await seite.waitForTimeout(400);
await seite.screenshot({ path: `${ausgabe}fokus-rand.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log('');
console.log(`  ohne Fokus  ${RUHE}  ${kontrast(RUHE, FELDGRUND).toFixed(1)}:1`);
for (const [i, s] of STUFEN.entries()) {
  console.log(`  ${i}  ${s.name.padEnd(15)} ${s.farbe}  ${kontrast(s.farbe, FELDGRUND).toFixed(1)}:1`);
}
console.log(`\n  ${ausgabe}fokus-rand.png\n`);
