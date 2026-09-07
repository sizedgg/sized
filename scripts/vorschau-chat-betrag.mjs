// ============================================================================
// Preview image: the amount in the chat should stand out more
//
// The starting point is a contradiction that's been sitting in the stylesheet
// for a while. Above the rule for .msg .worth stands this justification:
//
//     "Text size instead of smaller: the amount is the core of the page, not
//      a footnote next to the name. Set smaller, it was the quietest thing
//      in the row."
//
// And right below that: .72rem, weight 400, color --dim - exactly what the
// text rules out. The amount ends up the quietest thing in the row: the name
// is bold, the message text is larger, and the number this whole page is
// actually about is smaller and dimmer than both.
//
// The tools available, and what each one costs:
//
//   * Brightness - works instantly, costs no space. --dim sits at 4.2:1
//                  against the background, --text at 12.6:1.
//   * Weight     - second-strongest tool, widens the column slightly.
//   * Size       - strongest tool, but shifts the balance of power with the
//                  message text. Past a certain point you read the numbers
//                  and skim the messages, not the other way around.
//   * Area       - pill or tinted column. Most eye-catching, but across
//                  twenty rows in a row it becomes a pattern that draws more
//                  attention than the content.
//
// Produces preview/chat-betrag.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// The amounts deliberately span the whole range: from <$1 to $781K. Only
// that way can you tell whether a version keeps the column stable and
// whether large and small amounts stay distinguishable.
const MESSAGES = [
  { h: '9Qm', ton: 0, usd: '$3.4K', tier: 'mittel', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', tier: 'mittel', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, h: '4bo', usd: '$12M', tier: 'hoch', body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '<$1', tier: 'klein', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', tier: 'hoch', body: 'sold half my bag and the vote weight dropped immediately', zeit: '14:05' },
  { admin: true, h: '4bo', usd: '$12M', tier: 'hoch', body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$52', tier: 'klein', body: 'ser', zeit: '14:07' },
];

// Each version is just CSS on .msg .worth - nothing about the row's
// structure. Whatever can't be written as a few rules wouldn't be a good
// idea in the real page either.
const FASSUNGEN = [
  {
    name: 'Jetzt',
    css: '',
    hinweis: 'Der Stand von heute: .72rem, Gewicht 400, Farbe --dim. Kleiner und blasser als der Nachrichtentext daneben – das Leiseste in der Zeile.',
  },
  {
    name: 'Nur heller',
    css: '.msg .worth { color: var(--text); font-weight: 600; }',
    hinweis: 'Größe bleibt, nur Farbe und Gewicht ändern sich. Kontrast von 4,2:1 auf 12,6:1. Kein Platz kommt dazu, die Spalte bleibt exakt gleich wide.',
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
    hinweis: 'Derselbe Umriss wie der eigene Bestand peek in der Kopfzeile. Du hattest das im Chat schon einmal abgelehnt – steht hier nur zum Vergleich, nicht als Vorschlag.',
  },
];

const line = (m, f) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? `<span class="h admin-name">${m.h}</span>`
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    <span class="worth w-${m.tier}">${m.usd}</span>
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

// Each version sits in the same file next to the others, so every rule has
// to be scoped to its own card. Instead of CSS nesting with &, it's flattened
// beforehand: ".msg .worth { … }" becomes "#v3 .msg .worth { … }". That
// doesn't depend on any browser version and stays readable when something
// goes wrong.
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
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
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
  <section class="card">
    <h2><span class="nr">${i}</span>${f.name}</h2>
    <p class="hinweis">${f.hinweis}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${MESSAGES.map((m) => line(m, f)).join('')}</div>
    </div>
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-betrag.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 1400 }, deviceScaleFactor: 2 });
await page.goto(`file://${tmp}`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${ausgabe}chat-betrag.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log(`  ${ausgabe}chat-betrag.png`);
