// ============================================================================
// Vorschaubild: Der Betrag im Chat soll deutlicher zu sehen sein
//
// Der Ausgangspunkt ist ein Widerspruch, der schon eine Weile im Blatt steht.
// Über der Regel für .msg .worth steht als Begründung:
//
//     "Textgröße statt kleiner: Der Betrag ist der Kern der Seite, nicht die
//      Fußnote am Namen. Kleiner gesetzt war er das Leiseste in der Zeile."
//
// Darunter steht dann .72rem, Gewicht 400, Farbe --dim – also genau das, was
// der Text ausschließt. Der Betrag ist damit das Leiseste in der Zeile: Der
// Name ist fett, der Text größer, und die Zahl, um die es auf dieser Seite
// eigentlich geht, ist kleiner und blasser als beides.
//
// Die Mittel, die zur Verfügung stehen, und was sie kosten:
//
//   * Helligkeit  – wirkt sofort, kostet nichts an Platz. --dim liegt bei 4,2:1
//                   gegen den Grund, --text bei 12,6:1.
//   * Gewicht     – zweitstärkstes Mittel, verbreitert die Spalte minimal.
//   * Größe       – stärkstes Mittel, verschiebt aber das Kräfteverhältnis zum
//                   Nachrichtentext. Ab einem gewissen Punkt liest man die
//                   Zahlen und überfliegt die Nachrichten, nicht umgekehrt.
//   * Fläche      – Pille oder getönte Spalte. Am auffälligsten, aber bei
//                   zwanzig Zeilen untereinander wird daraus ein Muster, das
//                   mehr Aufmerksamkeit zieht als der Inhalt.
//
// Erzeugt preview/chat-betrag.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// Die Beträge decken absichtlich die ganze Spanne ab: von <$1 bis $781K. Nur
// so sieht man, ob eine Fassung die Spalte hält und ob große und kleine
// Beträge noch unterscheidbar bleiben.
const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: '$3.4K', stufe: 'mittel', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', stufe: 'mittel', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, h: '4bo', usd: '$12M', stufe: 'hoch', body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '<$1', stufe: 'klein', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', stufe: 'hoch', body: 'sold half my bag and the vote weight dropped immediately', zeit: '14:05' },
  { admin: true, h: '4bo', usd: '$12M', stufe: 'hoch', body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$52', stufe: 'klein', body: 'ser', zeit: '14:07' },
];

// Jede Fassung ist nur CSS auf .msg .worth – nichts am Aufbau der Zeile.
// Was sich nicht als ein paar Regeln schreiben lässt, wäre auch im Blatt
// keine gute Idee.
const FASSUNGEN = [
  {
    name: 'Jetzt',
    css: '',
    hinweis: 'Der Stand von heute: .72rem, Gewicht 400, Farbe --dim. Kleiner und blasser als der Nachrichtentext daneben – das Leiseste in der Zeile.',
  },
  {
    name: 'Nur heller',
    css: '.msg .worth { color: var(--text); font-weight: 600; }',
    hinweis: 'Größe bleibt, nur Farbe und Gewicht ändern sich. Kontrast von 4,2:1 auf 12,6:1. Kein Platz kommt dazu, die Spalte bleibt exakt gleich breit.',
  },
  {
    name: 'Textgröße',
    css: '.msg .worth { font-size: .78rem; color: var(--text); font-weight: 600; }',
    hinweis: 'Zusätzlich so groß wie der Nachrichtentext. Damit ist der Betrag gleichberechtigt statt untergeordnet – das, was der Kommentar im Blatt ohnehin behauptet.',
  },
  {
    name: 'Größer als der Text',
    css: '.msg .worth { font-size: .88rem; color: var(--text); font-weight: 650; }',
    hinweis: 'Der Betrag wird zum Hauptelement der Zeile. Beim Überfliegen liest man dann die Zahlen und nicht die Nachrichten – die Frage ist, ob genau das gewollt ist.',
  },
  {
    name: 'Größer, Text zurück',
    css: `.msg .worth { font-size: .88rem; color: var(--text); font-weight: 650; }
          .chat-panel .msg .body { color: #4c5468; }
          .msg .who { opacity: .72; }`,
    hinweis: 'Wie 3, aber Name und Text treten zurück statt der Betrag nach vorn. Ruhigere Zeile bei gleichem Abstand – kostet allerdings Lesbarkeit beim Text.',
  },
  {
    name: 'Nach Größe abgestuft',
    css: `.msg .worth { font-size: .78rem; font-weight: 600; }
          .msg .worth.w-klein  { color: var(--dim); font-weight: 400; }
          .msg .worth.w-mittel { color: var(--text); }
          .msg .worth.w-hoch   { color: var(--accent); font-weight: 700; }`,
    hinweis: 'Die Zahl bestimmt ihre eigene Lautstärke: große Bestände hell, kleine bleiben leise. Passt zur Sache – Stimmgewicht ist hier nicht gleich verteilt.',
  },
  {
    name: 'Getönte Spalte',
    css: `.msg { align-items: stretch; }
          .msg .who, .msg .body, .msg .meta { align-self: baseline; }
          .msg .worth {
            display: flex; align-items: baseline; justify-content: flex-end;
            font-size: .78rem; color: var(--text); font-weight: 600;
            background: rgba(255, 255, 255, .04);
            margin: -.5rem 0; padding: .5rem .55rem;
            border-left: 1px solid var(--line);
          }`,
    hinweis: 'Die Spalte wird als Spalte sichtbar, durchgehend über die ganze Liste. Am stärksten – aber es ist eine Fläche, und zwanzig davon untereinander sind ein Muster.',
  },
  {
    name: 'Pille',
    css: `.msg .worth {
            display: inline-flex; align-items: center; justify-content: center;
            box-sizing: border-box; height: 1.28em; line-height: 1;
            font-size: .74rem; color: var(--text); font-weight: 600;
            background: rgba(255, 255, 255, .03);
            border: 1px solid var(--line); border-radius: 999px;
            padding: .07em .5em 0; justify-self: end;
          }`,
    hinweis: 'Derselbe Umriss wie der eigene Bestand oben in der Kopfzeile. Du hattest das im Chat schon einmal abgelehnt – steht hier nur zum Vergleich, nicht als Vorschlag.',
  },
];

const zeile = (m, f) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? `<span class="h admin-name">${m.h}</span>`
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    <span class="worth w-${m.stufe}">${m.usd}</span>
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

// Jede Fassung liegt in derselben Datei neben den anderen, also muss jede Regel
// auf ihre eigene Karte begrenzt werden. Statt CSS-Verschachtelung mit & wird
// vorher flach umgeschrieben: Aus ".msg .worth { … }" wird "#v3 .msg .worth
// { … }". Das hängt an keiner Browserversion und ist im Fehlerfall lesbar.
const flach = (css, i) => css
  .split('}')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [sel, ...rest] = s.split('{');
    const gesetzt = sel.split(',')
      .map((t) => t.trim())
      .map((t) => t.startsWith('.chat-panel ') ? `#v${i} ${t.slice(12)}` : `#v${i} ${t}`)
      .join(', ');
    return `${gesetzt} { ${rest.join('{')} }`;
  })
  .join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px 26px 40px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 26px 22px; max-width: 1300px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 4.8em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 96ch; }
</style>
${FASSUNGEN.map((f, i) => f.css ? `<style>${flach(f.css, i)}</style>` : '').join('\n')}
<h1>Der Betrag im Chat</h1>
<p class="lead">Acht Fassungen derselben Liste. Nummer 0 ist der heutige Stand. Die Beträge reichen absichtlich von &lt;$1 bis $12M – so sieht man, ob die Spalte hält und ob groß und klein noch auseinanderzuhalten sind.</p>
<div class="raster">
  ${FASSUNGEN.map((f, i) => `
  <section class="karte">
    <h2><span class="nr">${i}</span>${f.name}</h2>
    <p class="hinweis">${f.hinweis}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${NACHRICHTEN.map((m) => zeile(m, f)).join('')}</div>
    </div>
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-betrag.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1360, height: 1400 }, deviceScaleFactor: 2 });
await seite.goto(`file://${tmp}`);
await seite.waitForTimeout(400);
await seite.screenshot({ path: `${ausgabe}chat-betrag.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log(`  ${ausgabe}chat-betrag.png`);
