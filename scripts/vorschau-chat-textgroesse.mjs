// ============================================================================
// Vorschaubild: Wie groß ist der Nachrichtentext im Chat?
//
// Heute .78rem, also 11,7 px am Rechner. Das ist bewusst klein gesetzt worden,
// und der Grund steht im Blatt: Chat und Posteingang sind dieselbe Sache – eine
// Liste von Zeilen aus Kürzel, Text und Betrag –, und der Text darin ist eine
// Vorschauzeile, kein Fließtext. Vorschauzeilen setzt man kleiner.
//
// Was dabei übersehen wurde: Im Posteingang ist die Zeile wirklich eine
// Vorschau – man öffnet das Gespräch, um zu lesen. Im Chat gibt es kein
// Dahinter. Diese Zeile IST die Nachricht. Sie so zu setzen wie eine Vorschau
// heißt, das Einzige klein zu machen, was man tatsächlich liest.
//
// Zwei Dinge hängen mit dran und werden hier mitgeführt:
//
//   * Der Betrag. Er ist seit der letzten Änderung genau so groß wie der Text.
//     Wächst nur der Text, ist der Betrag wieder die Fußnote, die er nicht sein
//     soll – der Test test-chat-betrag.mjs würde das melden.
//   * Der Posteingang. Wächst nur der Chat, sehen zwei Listen derselben Sache
//     verschieden aus. Auch das steht als Regel im Blatt.
//
// Der vermutete Preis – größerer Text, weniger Nachrichten im Fenster – wurde
// nachgemessen und ist keiner. Die Höhe einer Zeile wird nicht vom Text
// bestimmt, sondern vom Kürzel daneben: Das hat keine eigene Größe und erbt
// deshalb die volle Grundgröße der Seite, 15 px. Der Text darunter bleibt bis
// .92rem (13,8 px) darunter, die Zeile ist in allen Fassungen 37,5 px hoch.
//
// Das ist der eigentliche Befund: Der Nachrichtentext ist heute kleiner als
// der Name des Absenders, und der Platz über ihm steht ohnehin leer. Größer
// setzen kostet hier nichts – es füllt nur, was schon da ist.
//
// Die letzten beiden Fassungen ändern zusätzlich die Helligkeit. Das ist eine
// alte offene Frage: Der Text steht auf --dimmer und damit bei 3,4:1 gegen den
// Grund. Wenn "zu klein" heißt "schlecht zu lesen", ist die Größe womöglich
// nur die Hälfte der Antwort.
//
// Erzeugt preview/chat-textgroesse.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

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

const DIMMER = '#5d657a';
const DIM = '#8b93a7';

const FASSUNGEN = [
  { name: 'Jetzt', gr: '.78rem', farbe: DIMMER,
    hinweis: 'Der Stand von heute: 11,7 px. So groß wie eine Vorschauzeile im Posteingang – nur dass es hier kein Dahinter gibt.' },
  { name: 'Eine Stufe', gr: '.82rem', farbe: DIMMER,
    hinweis: '12,3 px, also genau das, was der Chat auf dem Handy schon hat. Kleinster Schritt, der überhaupt zu sehen ist.' },
  { name: 'Zwei Stufen', gr: '.86rem', farbe: DIMMER,
    hinweis: '12,9 px. Der Text löst sich merklich von der Vorschauzeilen-Anmutung, ohne dass die Liste ihren Rhythmus verliert.' },
  { name: 'Fließtext', gr: '.92rem', farbe: DIMMER,
    hinweis: '13,8 px – fast die Grundgröße der Seite und knapp unter dem Kürzel. Liest sich wie ein Gespräch statt wie eine Liste. Ab hier beginnt die Zeile zu wachsen.' },
  { name: 'Zwei Stufen + heller', gr: '.86rem', farbe: DIM,
    hinweis: 'Wie 2, aber auf --dim statt --dimmer: 6,4:1 statt 3,4:1. Falls "zu klein" eigentlich "schlecht zu lesen" heißt, sitzt hier der größere Teil der Antwort.' },
  { name: 'Eine Stufe + heller', gr: '.82rem', farbe: DIM,
    hinweis: 'Der vorsichtige Weg: kaum größer, aber deutlich besser lesbar. Die Liste bleibt so dicht wie heute.' },
];

const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, h: '4bo', usd: '$12M', body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '<$1', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'sold half my bag and the vote weight dropped immediately, thats brutal', zeit: '14:05' },
  { admin: true, h: '4bo', usd: '$12M', body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$52', body: 'ser', zeit: '14:07' },
  { h: 'dR1', ton: 1, usd: '$104K', body: 'same', zeit: '14:08' },
  { h: 'q8P', ton: 3, usd: '$2.9K', body: 'how long does the vote stay open', zeit: '14:09' },
  { admin: true, h: '4bo', usd: '$12M', body: '24h', zeit: '14:09' },
];

const zeile = (m) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? `<span class="h admin-name">${m.h}</span>`
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    <span class="worth">${m.usd}</span>
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

// Der Betrag zieht mit der Textgroesse mit – sonst waere er in jeder groesseren
// Fassung wieder die Fussnote am Namen.
const regeln = FASSUNGEN.map((f, i) => `
  #v${i} .msg .body { font-size: ${f.gr}; color: ${f.farbe}; }
  #v${i} .msg .worth { font-size: ${f.gr}; }
`).join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px 26px 40px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px 22px; max-width: 1560px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .werte { font-family: var(--mono); font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 5.6em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 100ch; }
</style>
<style>${regeln}</style>
<h1>Der Nachrichtentext im Chat</h1>
<p class="lead">Sechs Fassungen. Der Betrag zieht in jeder mit – er ist seit der letzten Änderung genau so groß wie der Text, und das soll er bleiben. Die letzten beiden ändern zusätzlich die Helligkeit.<br>Nachgemessen: Größerer Text kostet hier keine Zeile. Die Höhe wird vom Kürzel bestimmt, das 15 px groß ist – der Nachrichtentext ist heute also kleiner als der Name des Absenders, und der Platz über ihm steht leer.</p>
<div class="raster">
  ${FASSUNGEN.map((f, i) => `
  <section class="karte">
    <h2><span class="nr">${i}</span>${f.name}
      <span class="werte" id="w${i}">${f.gr} · ${kontrast(f.farbe, GRUND).toFixed(1)}:1</span></h2>
    <p class="hinweis">${f.hinweis}</p>
    <div class="chat-panel" id="v${i}">
      <div class="chat-list">${NACHRICHTEN.map(zeile).join('')}</div>
    </div>
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-textgroesse.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1620, height: 1200 }, deviceScaleFactor: 2 });
await seite.goto(`file://${tmp}`);
await seite.waitForTimeout(400);

// Gemessen statt vermutet: Kostet groesserer Text Zeilen? Die Antwort steht
// nicht im Kopf, sondern im Layout – und sie lautet nein, solange der Text
// unter der Groesse des Kuerzels daneben bleibt. Genau deshalb wird die
// Zeilenhoehe hier ausgelesen und nicht ueberschlagen.
const zahlen = await seite.evaluate((n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const zeilen = [...document.querySelectorAll(`#v${i} .msg`)];
    const px = parseFloat(getComputedStyle(document.querySelector(`#v${i} .msg .body`)).fontSize);
    // Nur einzeilige Nachrichten: Eine umgebrochene sagt etwas ueber ihre
    // Laenge, nicht ueber die Schriftgroesse.
    const hoehen = zeilen.map((el) => el.getBoundingClientRect().height);
    out.push({ px, hoehe: Math.min(...hoehen) });
  }
  return out;
}, FASSUNGEN.length);

await seite.evaluate((daten) => {
  daten.forEach((d, i) => {
    const el = document.querySelector(`#w${i}`);
    el.textContent = `${el.textContent} · ${d.px}px · Zeile ${d.hoehe}px`;
  });
}, zahlen);
await seite.waitForTimeout(200);
await seite.screenshot({ path: `${ausgabe}chat-textgroesse.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log('');
FASSUNGEN.forEach((f, i) => {
  const d = zahlen[i];
  console.log(`  ${i}  ${f.name.padEnd(22)} ${String(d.px).padStart(5)}px  `
    + `${kontrast(f.farbe, GRUND).toFixed(1)}:1  Zeilenhoehe ${d.hoehe}px`);
});
console.log(`\n  ${ausgabe}chat-textgroesse.png\n`);
