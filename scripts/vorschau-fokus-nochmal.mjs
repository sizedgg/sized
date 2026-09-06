// ============================================================================
// Vorschaubilder: Der Rahmen des Feldes, in dem getippt wird – zweiter Anlauf
//
// Dieser Wert ist heute schon einmal entschieden worden: --fokus #b9c0d0, aus
// einer Reihe von sechs Stufen. Damals war er richtig. Seitdem hat sich seine
// Umgebung an drei Stellen geändert, und zwar jedes Mal nach unten:
//
//   * Der Grund hat seinen Lichtschein verloren und ist reines --bg.
//   * Der helle Knopf ist von 12,2:1 auf 9,2:1 heruntergegangen.
//   * Die Seite steht in Mono, und Mono ist feiner als die Grotesk – dieselbe
//     Fläche Farbe verteilt sich auf dünnere Striche.
//
// Der Rahmen ist damit ohne eigenes Zutun zum hellsten Ding im Kasten geworden:
// 10,8:1 gegen 9,2:1 des Knopfes daneben. Ein Feld, in dem man gerade tippt,
// sollte nicht lauter sein als der Knopf, der die Sache abschickt.
//
// Deshalb dieselbe Reihe noch einmal – aber in der Umgebung von heute, nicht
// in der von damals. Das ist der ganze Punkt: Ein Farbwert ist nie für sich
// richtig, sondern nur neben dem, was daneben steht.
//
// Die Untergrenze ist nicht Geschmack. Ein Fokusrahmen ist eine
// Zustandsanzeige, und darunter wird geraten statt gesehen – erst recht, wenn
// im Kasten vier gleich aussehende Felder untereinander stehen. Der Wert steht
// bei jeder Stufe dabei, gegen den Feldgrund gerechnet.
//
// Erzeugt preview/fokus-nochmal.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const schneide = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};
const kasten = schneide('<div id="poll-admin" class="poll-admin"', '\n    </div>');

const FELDGRUND = '#0a0b0f';
const RUHE = '#262b39';
const KNOPF = '#aab2c2';

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
  { name: 'Jetzt', farbe: '#b9c0d0',
    hinweis: 'Der Wert von heute Morgen. Damals war er richtig – inzwischen ist er heller als der Knopf daneben, ohne dass an ihm etwas geändert wurde.' },
  { name: 'Eine Stufe', farbe: '#9aa3b6',
    hinweis: 'Knapp unter dem Knopf. Der Rahmen sagt weiterhin deutlich, wo getippt wird, ist aber nicht mehr das Hellste im Kasten.' },
  { name: 'Auf --dim', farbe: '#8b93a7',
    hinweis: 'Ein Ton, den die Seite schon kennt: die Farbe der Zeitangaben und der Vorschauzeilen. Kein neuer Wert, deutlich ruhiger.' },
  { name: 'Gedämpft', farbe: '#6f778f',
    hinweis: 'Zurückhaltend. Man sieht den Unterschied noch, muss aber hinschauen. Bei zehn Antwortfeldern untereinander wird das mühsam.' },
  { name: 'Kaum', farbe: '#4a5266',
    hinweis: 'Unter der Grenze, ab der eine Haarlinie als Zustandsanzeige noch zuverlässig trägt – hier nur, um zu zeigen, wo sie liegt.' },
];

// Fokus hat immer nur ein Element; der Zustand wird deshalb ueber eine Klasse
// nachgestellt, damit alle Stufen nebeneinander stehen koennen.
const regeln = STUFEN.map((s, i) => `#v${i} input.an { border-color: ${s.farbe}; }`).join('\n');

const seite = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 26px 26px 40px; }
  .raster { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px 22px; max-width: 1560px; }
  h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .hinweis { margin: 0 0 .7rem; font-size: .8rem; color: var(--dimmer); min-height: 5em; line-height: 1.5; }
  .poll-admin { margin: 0; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 104ch; }
</style>
<style>${regeln}</style>
<h1>Der Rahmen beim Tippen – noch einmal, in der Umgebung von heute</h1>
<p class="lead">Jeweils das obere Feld. Zum Vergleich steht der Knopf "Start poll" in jedem Kasten mit im Bild: Er liegt bei ${kontrast(KNOPF, FELDGRUND).toFixed(1)}:1, und der Rahmen sollte nicht darüber liegen. Ohne Fokus liegt er bei ${kontrast(RUHE, FELDGRUND).toFixed(1)}:1.</p>
<div class="raster">
  ${STUFEN.map((s, i) => `
  <section>
    <h2><span class="nr">${i}</span>${s.name}
      <span class="werte">${s.farbe} · ${kontrast(s.farbe, FELDGRUND).toFixed(1)}:1</span></h2>
    <p class="hinweis">${s.hinweis}</p>
    <div id="v${i}">${kasten.replace(' hidden>', '>').replace('id="poll-question" type="text"', 'id="poll-question" class="an" type="text" value="Which coin next?"')}</div>
  </section>`).join('')}
</div>`;

const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });
const tmp = path.join(root, 'public', '_vorschau-fokus2.html');
fs.writeFileSync(tmp, seite);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const blatt = await browser.newPage({ viewport: { width: 1620, height: 900 }, deviceScaleFactor: 2 });
await blatt.goto(`file://${tmp}`);
await blatt.waitForTimeout(400);
await blatt.screenshot({ path: path.join(ausgabe, 'fokus-nochmal.png'), fullPage: true });
await browser.close();
fs.rmSync(tmp);

console.log('');
console.log(`  Knopf daneben      ${KNOPF}  ${kontrast(KNOPF, FELDGRUND).toFixed(1)}:1`);
console.log(`  Rahmen ohne Fokus  ${RUHE}  ${kontrast(RUHE, FELDGRUND).toFixed(1)}:1\n`);
for (const [i, s] of STUFEN.entries()) {
  const k = kontrast(s.farbe, FELDGRUND);
  console.log(`  ${i}  ${s.name.padEnd(14)} ${s.farbe}  ${k.toFixed(1).padStart(5)}:1`
    + (k > kontrast(KNOPF, FELDGRUND) ? '   heller als der Knopf' : ''));
}
console.log(`\n  ${path.join(ausgabe, 'fokus-nochmal.png')}\n`);
