// ============================================================================
// Vorschaubilder: Richtung 1 (flacher Grund) in Schreibmaschinenschrift
//
// Entschieden ist der Grund: kein Farbverlauf mehr, kein Violett. Und die
// Schrift: Mono. Offen ist, WIE WEIT die Mono geht – das ist die eigentliche
// Frage, und es sind mehr Stufen, als man vermutet.
//
// Drei Dinge, die man beim Umstellen auf Mono wissen muss:
//
//   1. Mono baut breiter. Jedes Zeichen bekommt dieselbe Breite, auch das i
//      und das l. Derselbe Punktwert wirkt dadurch größer und die Zeile wird
//      länger. Deshalb steht in den Fassungen hier eine kleinere Zahl als die
//      .86rem der Grotesk – der gemessene Ausgleich liegt bei etwa 0,92.
//
//   2. Mono braucht mehr Luft zwischen den Zeilen. Gleichmäßige Zeichenbreiten
//      erzeugen ein senkrechtes Raster; ohne Abstand wird eine Liste daraus
//      ein Block. Das war die Schwäche der Terminal-Fassung im letzten Bild,
//      und Nummer 4 hier ist der Versuch, sie zu beheben.
//
//   3. Mono ist auf dieser Seite schon besetzt: Kürzel und Beträge stehen seit
//      jeher darin, und zwar mit Absicht – Ziffern stehen so untereinander.
//      Wenn ALLES Mono wird, verliert die Unterscheidung ihre Bedeutung. Das
//      ist kein Fehler, aber eine Entscheidung: Danach trennt nur noch Farbe
//      und Gewicht, was vorher auch die Schrift getrennt hat.
//
// Der Grund ist in allen sechs derselbe – flach, ohne Licht. Verglichen wird
// ausschließlich die Schrift.
//
// Erzeugt preview/mono-0..5.png und preview/mono-uebersicht.png
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
const kopf = schneide('<header class="topbar">', '</header>');
const chat = schneide('<main id="pane-chat" class="pane">', '</main>');

const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, h: '4bo', usd: '$12M', body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '<$1', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'sold half my bag and the vote weight dropped immediately', zeit: '14:05' },
  { admin: true, h: '4bo', usd: '$12M', body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$52', body: 'ser', zeit: '14:07' },
  { h: 'dR1', ton: 1, usd: '$104K', body: 'wen dividends', zeit: '14:08' },
  { h: 'q8P', ton: 3, usd: '$2.9K', body: 'how long does the vote stay open', zeit: '14:09' },
  { admin: true, h: '4bo', usd: '$12M', body: '24h', zeit: '14:09' },
  { h: 'Ux2', ton: 2, usd: '$47K', body: 'just topped up, when does the balance refresh', zeit: '14:10' },
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'hit the arrow next to your balance', zeit: '14:11' },
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

// Gilt für alle sechs: der flache Grund aus Richtung 1.
const FLACH = `body { background-image: none; }`;

// Die Bedienelemente rundherum – Reiter, Knöpfe, Marke, Filterleiste.
const CHROM = `
  .tab, .btn, .chip, .filters-label, .brand, .thread-head,
  .chat-panel .composer input { font-family: var(--mono); }`;

const RICHTUNGEN = [
  {
    datei: 'mono-0', name: 'Nur der Nachrichtentext',
    kurz: 'Der kleinste Schritt',
    text: 'Nur das, was die Leute schreiben, wird Mono. Kürzel und Beträge waren es schon – damit ist die ganze Zeile Mono, alles andere auf der Seite bleibt wie es ist. .8rem statt .86rem, weil Mono breiter baut und sonst größer wirkte als vorher.',
    css: `.chat-panel .msg .body { font-family: var(--mono); font-size: .8rem; }`,
  },
  {
    datei: 'mono-1', name: 'Der ganze Chat',
    kurz: 'Bis zur Filterleiste und Eingabe',
    text: 'Dazu die Beschriftung der Filterleiste, die Voreinstellungsknöpfe und das Eingabefeld. Die Fläche des Chats ist damit vollständig Mono, die Kopfzeile darüber nicht – man sieht die Grenze, und das ist genau die Frage an dieser Fassung.',
    css: `
      .chat-panel .msg .body { font-family: var(--mono); font-size: .8rem; }
      .filters-label, .chip, .chat-panel .composer input { font-family: var(--mono); }`,
  },
  {
    datei: 'mono-2', name: 'Alles',
    kurz: 'Auch Reiter, Knöpfe und Marke',
    text: 'Keine Grenze mehr: Die ganze Seite ist eine Schrift. Am konsequentesten und am ruhigsten, weil nichts mehr aus der Reihe fällt. Der Preis ist, dass Mono nichts Besonderes mehr bedeutet – bisher hieß Mono auf dieser Seite "das ist eine Zahl".',
    css: `.chat-panel .msg .body { font-family: var(--mono); font-size: .8rem; } ${CHROM}`,
  },
  {
    datei: 'mono-3', name: 'Alles, ohne Kasten',
    kurz: 'Keine Umrandung, keine Rundungen',
    text: 'Wie 2, aber der Chat liegt nicht mehr in einer gerundeten Fläche, sondern zwischen Haarlinien. Am nächsten an einem Terminal. Zu bedenken: Die Fläche ist bewusst eingeführt worden, weil der Chat neben Abstimmungen und Posteingang sonst unfertig aussah – die beiden müssten mitziehen.',
    css: `
      .chat-panel .msg .body { font-family: var(--mono); font-size: .8rem; } ${CHROM}
      .chat-panel { border: 0; border-radius: 0; background: transparent; }
      .chat-panel > .filters { border-bottom: 1px solid var(--line); padding-inline: 0; }
      .chat-panel > .composer { padding-inline: 0; }
      .msg { padding-inline: 0; }
      .btn, .tab, .chip { border-radius: 4px; }
      .chat-panel .composer input { border-radius: 4px; }`,
  },
  {
    datei: 'mono-4', name: 'Alles, mit Luft',
    kurz: 'Mehr Zeilenabstand – die Antwort auf den Blockeffekt',
    text: 'Wie 2, aber mit dem, was Mono eigentlich braucht: höhere Zeilen und mehr Abstand zwischen den Buchstaben. Gleichmäßige Zeichenbreiten erzeugen ein Raster, und ohne Luft wird die Liste eine Wand. Kostet Zeilen im Fenster – hier zum ersten Mal wirklich, weil die Zeile über das Kürzel hinauswächst.',
    css: `
      .chat-panel .msg .body { font-family: var(--mono); font-size: .82rem; letter-spacing: .01em; }
      ${CHROM}
      .msg { padding: .72rem .8rem; }
      .chat-panel .msg .body, .msg .worth { line-height: 1.65; }`,
  },
  {
    datei: 'mono-5', name: 'Alles, dicht',
    kurz: 'Kleiner und enger – Handelsbildschirm',
    text: 'Die Gegenrichtung zu 4: kleinere Schrift, engere Zeilen, mehr Nachrichten im Fenster. Liest sich wie ein laufender Feed statt wie ein Gespräch. Passt zu einem Raum, in dem der Betrag neben jedem Namen steht – ist aber die anstrengendste Fassung von allen.',
    css: `
      .chat-panel .msg .body { font-family: var(--mono); font-size: .76rem; letter-spacing: -.01em; }
      ${CHROM}
      .msg { padding: .32rem .8rem; }
      .msg .worth { font-size: .76rem; }
      .chat-panel .msg .body, .msg .worth { line-height: 1.35; }`,
  },
];

const seiteHtml = (extra) => `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>${FLACH}${extra}</style>
<div class="app">
  ${kopf}
  ${chat}
</div>
<script>
  document.querySelector('#me-handle').textContent = '4bo';
  document.querySelector('#me-handle').className = 'handle h admin-name';
  document.querySelector('#me-holdings').textContent = '$12M';
  document.querySelector('#filter-unit').textContent = 'of $ANSEM';
  document.querySelector('#chat-list').innerHTML = ${JSON.stringify(NACHRICHTEN.map(zeile).join(''))};
  document.querySelector('.chip[data-usd="0"]').classList.add('is-active');
<\/script>`;

const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const bilder = [];
const gemessen = [];
for (const r of RICHTUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  await seite.setContent(seiteHtml(r.css));
  await seite.waitForTimeout(350);

  // Gemessen statt behauptet: Wie hoch ist eine Zeile, und passen dadurch
  // mehr oder weniger Nachrichten ins Fenster als heute?
  gemessen.push(await seite.evaluate(() => {
    const zeilen = [...document.querySelectorAll('.chat-panel .msg')];
    const hoehe = Math.min(...zeilen.map((el) => el.getBoundingClientRect().height));
    const liste = document.querySelector('#chat-list').getBoundingClientRect().height;
    return { hoehe: Math.round(hoehe * 10) / 10, passen: Math.floor(liste / hoehe) };
  }));

  const ziel = path.join(ausgabe, `${r.datei}.png`);
  await seite.screenshot({ path: ziel });
  bilder.push(fs.readFileSync(ziel).toString('base64'));
  await seite.close();
  console.log(`  ${ziel}`);
}

const uebersicht = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; background-image: none; padding: 30px; }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 34px 26px; max-width: 1720px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 105ch; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-family: var(--mono); font-size: .8rem; }
  .kurz { color: var(--dim); font-weight: 400; font-size: .86rem; }
  .werte { font-family: var(--mono); font-size: .7rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .35rem 0 .7rem; font-size: .84rem; color: #8b93a7; min-height: 7em; line-height: 1.55; }
  img { width: 100%; display: block; border-radius: 12px; border: 1px solid #232734; }
</style>
<h1>Flacher Grund, Schreibmaschinenschrift – sechs Fassungen</h1>
<p class="lead">Der Grund ist überall derselbe: flach, kein Licht, kein Violett. Unterschiedlich ist nur, wie weit die Mono geht. Hinter jedem Titel steht die gemessene Zeilenhöhe und wie viele Nachrichten damit ins Fenster passen – heute sind es 37,5 px.</p>
<div class="raster">
${RICHTUNGEN.map((r, i) => `
  <section>
    <h2><span class="nr">${i}</span>${r.name}<span class="kurz">${r.kurz}</span>
      <span class="werte">Zeile ${gemessen[i].hoehe}px · ${gemessen[i].passen} sichtbar</span></h2>
    <p class="t">${r.text}</p>
    <img src="data:image/png;base64,${bilder[i]}" alt="${r.name}">
  </section>`).join('')}
</div>`;

const blatt = await browser.newPage({ viewport: { width: 1780, height: 1200 }, deviceScaleFactor: 1.5 });
await blatt.setContent(uebersicht);
await blatt.waitForTimeout(500);
await blatt.screenshot({ path: path.join(ausgabe, 'mono-uebersicht.png'), fullPage: true });
await browser.close();

console.log('');
RICHTUNGEN.forEach((r, i) =>
  console.log(`  ${i}  ${r.name.padEnd(26)} Zeile ${String(gemessen[i].hoehe).padStart(5)}px  ${gemessen[i].passen} sichtbar`));
console.log(`\n  ${path.join(ausgabe, 'mono-uebersicht.png')}\n`);
