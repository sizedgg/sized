// ============================================================================
// Vorschaubilder: Der helle Knopf – "Send", "Start poll", "Continue"
//
// Er ist die hellste Fläche der ganzen Seite, und das ist kein Versehen: Ein
// gefüllter Knopf sagt "hier geht es weiter", und auf fast schwarzem Grund
// braucht diese Aussage Helligkeit. Der Ton ist auch schon einmal
// heruntergedreht worden – von #eceff5 auf #c6ccd8, mit der Begründung im
// Blatt: "Ein duenner Strich in 86 % Helligkeit ist ein Akzent, ein
// handtellergrosser Block darin ist eine Lampe."
//
// Offenbar nicht weit genug. Und dafür gibt es einen Grund, der seit heute
// dazugekommen ist: Der Grund hat seinen Lichtschein verloren. Vorher lag über
// der Seite ein sehr schwacher Verlauf, der die Umgebung des Knopfes ein wenig
// aufhellte; auf reinem #0a0b0f steht derselbe Knopf jetzt in mehr Dunkelheit
// als vorher – ohne dass an ihm etwas geändert wurde. Er ist nicht heller
// geworden, seine Umgebung ist dunkler geworden.
//
// Drei Wege, und sie führen zu verschiedenen Ergebnissen:
//
//   * Dieselbe Bauart, dunklerer Ton. Der Knopf bleibt eine helle Fläche mit
//     dunkler Schrift, nur leiser.
//   * Umgedreht: dunkle Fläche, helle Schrift. Kein Leuchten mehr, dafür
//     braucht der Knopf einen Rand, um überhaupt als Knopf zu gelten.
//   * Nur ein Umriss. Am ruhigsten – und am schwächsten, wenn im Blick eine
//     Handlung gefunden werden soll.
//
// Der Kontrast der Schrift auf dem Knopf wird bei jeder Fassung mitgerechnet.
// Er darf nicht unter 4,5:1 fallen: Das ist ein Bedienelement, kein Schmuck.
//
// Erzeugt preview/knopf.png
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
// Der echte Aufbau: Eingabezeile des Chats und der Kasten fuer eine neue
// Abstimmung. Beide Knoepfe stehen darin, in ihrer echten Umgebung – ein Knopf
// allein auf einer Flaeche laesst sich nicht beurteilen.
const composer = schneide('<form id="chat-form" class="composer">', '</form>');
const pollKasten = schneide('<div id="poll-admin" class="poll-admin"', '\n    </div>');

const GRUND = '#0a0b0f';
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontrast = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const FASSUNGEN = [
  { name: 'Jetzt', flaeche: '#c6ccd8', schrift: GRUND,
    kurz: 'Helle Fläche, dunkle Schrift',
    text: 'Der Stand von heute. Seit der Grund seinen Lichtschein verloren hat, steht dieselbe Fläche in mehr Dunkelheit als zuvor – der Knopf ist nicht heller geworden, seine Umgebung dunkler.' },

  { name: 'Eine Stufe', flaeche: '#aab2c2', schrift: GRUND,
    kurz: 'Derselbe Ton wie die eigene DM-Blase',
    text: 'Ein Wert, den die Seite schon kennt: --accent-fill-weich, die Farbe der eigenen Sprechblase in den DMs. Kein neuer Ton, und der Knopf bleibt eindeutig der hellste Punkt seiner Umgebung.' },

  { name: 'Zwei Stufen', flaeche: '#8e97a9', schrift: GRUND,
    kurz: 'Deutlich gedämpft',
    text: 'Merklich zurückgenommen. Der Knopf leuchtet nicht mehr, sagt aber noch klar "hier drücken". Die dunkle Schrift darauf wird langsam knapp – der Wert steht unten.' },

  { name: 'Dunkel, heller Rand', flaeche: '#1d212d', schrift: '#e7e9ee', rand: '#b9c0d0',
    kurz: 'Umgedreht: dunkle Fläche, helle Schrift',
    text: 'Kein Leuchten mehr. Damit der Knopf überhaupt als Knopf gilt, braucht er einen Rand – ohne ihn wäre er ein Stück Hintergrund mit Text darauf. Ruhig, aber im Blick schwerer zu finden.' },

  { name: 'Nur Umriss', flaeche: 'transparent', schrift: '#e7e9ee', rand: '#b9c0d0',
    kurz: 'Gar keine Fläche',
    text: 'Die ruhigste Fassung. Der Preis ist die Hierarchie: "Send" sieht dann genauso aus wie "+ Option" daneben, und die Seite hat keinen Punkt mehr, an dem das Auge hängen bleibt.' },

  { name: 'Eine Stufe, matt', flaeche: '#aab2c2', schrift: GRUND, matt: true,
    kurz: 'Wie 1, aber ohne das Aufhellen beim Überfahren',
    text: 'Derselbe Ton wie 1. Zusätzlich fällt das Aufhellen unter dem Zeiger weg – das war ein Drittel des Eindrucks von "grell", denn beim Tippen steht der Zeiger oft genau auf dem Knopf.' },
];

const knopfCss = (f, i) => `
  #v${i} .btn-primary {
    background: ${f.flaeche};
    color: ${f.schrift};
    ${f.rand ? `border-color: ${f.rand};` : ''}
  }
  ${f.matt ? `#v${i} .btn-primary:hover { filter: none; }` : ''}`;

const karte = (f, i) => `
  <section class="karte" id="v${i}">
    <h2><span class="nr">${i}</span>${f.name}<span class="kurz">${f.kurz}</span>
      <span class="werte">${f.flaeche}${f.flaeche !== 'transparent'
        ? ` · Fläche ${kontrast(f.flaeche, GRUND).toFixed(1)}:1 · Schrift ${kontrast(f.schrift, f.flaeche).toFixed(1)}:1`
        : ''}</span></h2>
    <p class="hinweis">${f.text}</p>
    <div class="chat-panel buehne">${composer}</div>
    ${pollKasten.replace(' hidden>', '>')}
  </section>`;

const seite = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 26px 26px 40px; }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 30px 24px; max-width: 1500px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .kurz { color: var(--dim); font-weight: 400; font-size: .84rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .hinweis { margin: 0 0 .7rem; font-size: .8rem; color: var(--dimmer); min-height: 5.2em; line-height: 1.5; }
  .buehne { flex: none; margin-bottom: 1rem; }
  .buehne .composer { padding: .7rem .9rem; border-top: 0; }
  .poll-admin { margin: 0; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 100ch; }
</style>
<style>${FASSUNGEN.map(knopfCss).join('\n')}</style>
<h1>Der helle Knopf</h1>
<p class="lead">Jeweils die Eingabezeile des Chats und der Kasten für eine neue Abstimmung – die beiden Stellen, an denen der Knopf wirklich steht. Hinter jedem Titel: der Kontrast der Fläche gegen den Seitengrund und der Kontrast der Schrift auf der Fläche. Der zweite darf nicht unter 4,5:1 fallen.</p>
<div class="raster">${FASSUNGEN.map(karte).join('')}</div>`;

const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });
const tmp = path.join(root, 'public', '_vorschau-knopf.html');
fs.writeFileSync(tmp, seite);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const blatt = await browser.newPage({ viewport: { width: 1560, height: 1100 }, deviceScaleFactor: 2 });
await blatt.goto(`file://${tmp}`);
await blatt.waitForTimeout(400);
await blatt.screenshot({ path: path.join(ausgabe, 'knopf.png'), fullPage: true });
await browser.close();
fs.rmSync(tmp);

console.log('');
for (const [i, f] of FASSUNGEN.entries()) {
  const kf = f.flaeche === 'transparent' ? null : kontrast(f.flaeche, GRUND);
  const ks = f.flaeche === 'transparent' ? kontrast(f.schrift, GRUND) : kontrast(f.schrift, f.flaeche);
  console.log(`  ${i}  ${f.name.padEnd(20)} ${f.flaeche.padEnd(12)}`
    + `Fläche ${kf ? kf.toFixed(1).padStart(5) : '    –'}:1   Schrift ${ks.toFixed(1).padStart(5)}:1`
    + (ks < 4.5 ? '   ZU WENIG' : ''));
}
console.log(`\n  ${path.join(ausgabe, 'knopf.png')}\n`);
