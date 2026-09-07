// ============================================================================
// Preview images: the border of the field being typed into - second pass
//
// This value has already been decided once today: --fokus #b9c0d0, out of a
// series of six steps. It was right back then. Since then its surroundings
// have changed in three places, each time downward:
//
//   * The background lost its glow and is now plain --bg.
//   * The bright button dropped from 12.2:1 to 9.2:1.
//   * The page is now in mono, and mono is finer than the grotesque - the
//     same amount of color spreads over thinner strokes.
//
// So the border, without anyone touching it, has become the brightest thing
// in the box: 10.8:1 against the 9.2:1 of the button next to it. A field
// you're actively typing into shouldn't be louder than the button that sends
// it.
//
// Hence the same series again - but in today's surroundings, not
// yesterday's. That's the whole point: a color value is never right on its
// own, only next to what sits beside it.
//
// The lower bound isn't taste. A focus border is a state indicator, and
// below a certain point you're guessing instead of seeing - especially with
// four identical-looking fields stacked in the box. The value is listed with
// every step, computed against the field background.
//
// Produces preview/fokus-nochmal.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const cut = (von, bis) => {
  const a = html.indexOf(von);
  const b = html.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in index.html: ${von}`);
  return html.slice(a, b + bis.length);
};
const panel = cut('<div id="poll-admin" class="poll-admin"', '\n    </div>');

const FIELD_GROUND = '#0a0b0f';
const RUHE = '#262b39';
const BUTTON = '#aab2c2';

const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontrast = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const TIERS = [
  { name: 'Jetzt', color: '#b9c0d0',
    hinweis: 'Der Wert von heute Morgen. Damals war er richtig – inzwischen ist er heller als der Knopf daneben, ohne dass an ihm etwas geändert wurde.' },
  { name: 'Eine Stufe', color: '#9aa3b6',
    hinweis: 'Knapp under dem Knopf. Der Rahmen sagt weiterhin deutlich, wo getippt wird, ist aber nicht mehr das Hellste im Kasten.' },
  { name: 'Auf --dim', color: '#8b93a7',
    hinweis: 'Ein Ton, den die Seite schon kennt: die Farbe der Zeitangaben und der Vorschauzeilen. Kein neuer Wert, deutlich ruhiger.' },
  { name: 'Gedämpft', color: '#6f778f',
    hinweis: 'Zurückhaltend. Man sieht den Unterschied noch, muss aber hinschauen. Bei zehn Antwortfeldern untereinander wird das mühsam.' },
  { name: 'Kaum', color: '#4a5266',
    hinweis: 'Unter der Grenze, ab der eine Haarlinie als Zustandsanzeige noch zuverlässig trägt – hier nur, um zu show, wo sie liegt.' },
];

// Focus can only ever be on one element; the state is therefore reconstructed
// via a class so all the steps can sit side by side.
const regeln = TIERS.map((s, i) => `#v${i} input.an { border-color: ${s.color}; }`).join('\n');

const page = `<!doctype html>
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
<p class="lead">Jeweils das obere Feld. Zum Vergleich steht der Knopf "Start poll" in jedem Kasten mit im Bild: Er liegt bei ${kontrast(BUTTON, FIELD_GROUND).toFixed(1)}:1, und der Rahmen sollte nicht darüber liegen. Ohne Fokus liegt er bei ${kontrast(RUHE, FIELD_GROUND).toFixed(1)}:1.</p>
<div class="raster">
  ${TIERS.map((s, i) => `
  <section>
    <h2><span class="nr">${i}</span>${s.name}
      <span class="werte">${s.color} · ${kontrast(s.color, FIELD_GROUND).toFixed(1)}:1</span></h2>
    <p class="hinweis">${s.hinweis}</p>
    <div id="v${i}">${panel.replace(' hidden>', '>').replace('id="poll-question" type="text"', 'id="poll-question" class="an" type="text" value="Which coin next?"')}</div>
  </section>`).join('')}
</div>`;

const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });
const tmp = path.join(root, 'public', '_vorschau-fokus2.html');
fs.writeFileSync(tmp, page);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const blatt = await browser.newPage({ viewport: { width: 1620, height: 900 }, deviceScaleFactor: 2 });
await blatt.goto(`file://${tmp}`);
await blatt.waitForTimeout(400);
await blatt.screenshot({ path: path.join(ausgabe, 'fokus-nochmal.png'), fullPage: true });
await browser.close();
fs.rmSync(tmp);

console.log('');
console.log(`  Knopf daneben      ${BUTTON}  ${kontrast(BUTTON, FIELD_GROUND).toFixed(1)}:1`);
console.log(`  Rahmen ohne Fokus  ${RUHE}  ${kontrast(RUHE, FIELD_GROUND).toFixed(1)}:1\n`);
for (const [i, s] of TIERS.entries()) {
  const k = kontrast(s.color, FIELD_GROUND);
  console.log(`  ${i}  ${s.name.padEnd(14)} ${s.color}  ${k.toFixed(1).padStart(5)}:1`
    + (k > kontrast(BUTTON, FIELD_GROUND) ? '   heller als der Knopf' : ''));
}
console.log(`\n  ${path.join(ausgabe, 'fokus-nochmal.png')}\n`);
