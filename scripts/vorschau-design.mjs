// ============================================================================
// Vorschaubilder: Andere Richtungen für die Startseite (Chat + Hintergrund)
//
// Anders als die bisherigen Vorschauen ist das hier keine Reihe von Stufen
// eines Wertes, sondern sechs verschiedene Haltungen. Deshalb bekommt jede ein
// eigenes, vollständiges Bild – Kopfzeile, Filterleiste, Nachrichten, Eingabe,
// Hintergrund – und nicht einen Ausschnitt neben fünf anderen. Eine
// Gestaltung beurteilt man nicht an einer Zeile.
//
// Der Aufbau wird aus index.html geschnitten, nicht nachgebaut. Eine Kopie im
// Skript würde beim nächsten Umbau der Seite auseinanderlaufen, und man
// beurteilte dann eine Seite, die es nicht gibt. Genau dieser Fehler ist beim
// Handy-Vorschauskript schon zweimal passiert.
//
// Jede Richtung ist ausschließlich CSS auf dem bestehenden Aufbau. Das ist
// keine Bequemlichkeit, sondern die Bedingung: Was sich nicht als Stilblatt
// schreiben lässt, wäre ein Umbau der Seite und keine Gestaltungsvariante –
// und es ließe sich nicht in einer Sitzung wieder zurücknehmen.
//
// Erzeugt preview/design-0..5.png und preview/design-uebersicht.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

// --- Aufbau aus dem echten Blatt schneiden ---------------------------------
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

// --- Die sechs Richtungen --------------------------------------------------
const RICHTUNGEN = [
  {
    datei: 'design-0', name: 'Jetzt',
    kurz: 'Der Stand von heute',
    text: 'Fast schwarzer Grund mit zwei weichen Lichtern – violett oben rechts, knochenweiß unten links. Der Chat liegt in einer umrandeten, gerundeten Fläche.',
    css: '',
  },
  {
    datei: 'design-1', name: 'Ohne Licht',
    kurz: 'Derselbe Aufbau, aber der Schimmer fällt weg',
    text: 'Nur der flache Grund, kein Farbverlauf. Das Violett ist der letzte Rest Solana-Lila auf der Seite – aus den Abstimmungskarten hast du es schon entfernen lassen. Ruhiger, härter, und die Namensfarben stehen zum ersten Mal auf neutralem Grund.',
    css: `body { background-image: none; }`,
  },
  {
    datei: 'design-2', name: 'Blatt auf Tisch',
    kurz: 'Schmaler, heller, und der Hintergrund wird sichtbar',
    text: 'Zwei Änderungen, die zusammengehören. Erstens ist die Fläche heller als das Fenster dahinter statt dunkler – der Inhalt liegt auf dem Grund statt darin, mit einem Schatten statt einer Linie. Zweitens ist sie schmaler: Heute füllt der Chat die ganze Breite, und der Hintergrund, um den es hier geht, ist am Rechner praktisch nie zu sehen. Ein schmaler Kanal gibt ihm überhaupt erst eine Fläche.',
    css: `
      .app { max-width: 900px; }
      body { background-image:
        radial-gradient(1000px 520px at 78% -12%, rgba(var(--accent-2-rgb), .16), transparent 62%),
        radial-gradient(820px 420px at 8% 108%, rgba(var(--accent-rgb), .12), transparent 62%); }
      .chat-panel { background: #14161d; border-color: #262b39; box-shadow: 0 20px 50px rgba(0,0,0,.6); }
      .chat-panel .composer input, .chat-panel .filter-group,
      .chat-panel .reply-bar, .chat-panel .gate { background: #0b0d12; }
      .msg { border-bottom-color: #232734; }
      .msg:hover { background: #191c25; }
      .topbar { background: transparent; border-bottom-color: transparent; backdrop-filter: none; }`,
  },
  {
    datei: 'design-3', name: 'Terminal',
    kurz: 'Alles in der Schreibmaschinenschrift',
    text: 'Kein Kasten, keine Rundungen – nur Haarlinien und eine Spalte. Der Betrag ist hier ohnehin schon Mono; wenn der ganze Chat es ist, liest sich die Liste wie ein Orderbuch. Passt zu einem Token-Raum, verlangt aber Disziplin: Mono braucht mehr Zeilenabstand, sonst wird es ein Block.',
    css: `
      body { background-image: none; background-color: #07080b; }
      .chat-panel { border: 0; border-radius: 0; background: transparent; }
      .chat-panel > .filters { border-bottom: 1px solid var(--line); padding-left: 0; padding-right: 0; }
      .chat-panel > .composer { padding-left: 0; padding-right: 0; }
      .chat-panel .msg .body, .msg .who, .msg .time, .filters-label,
      .chat-panel .composer input, .tab, .chip { font-family: var(--mono); }
      .chat-panel .msg .body { font-size: .8rem; letter-spacing: -.01em; }
      .msg { padding-left: 0; padding-right: 0; border-bottom-color: #171b25; }
      .msg:hover { background: rgba(255,255,255,.025); }
      .chat-panel .composer input { background: #0c0e13; border-radius: 4px; }
      .btn { border-radius: 4px; }
      .tab { border-radius: 4px; text-transform: lowercase; letter-spacing: .02em; }
      .topbar { background: #07080b; }`,
  },
  {
    datei: 'design-4', name: 'Luft',
    kurz: 'Weniger Zeilen, mehr Raum',
    text: 'Derselbe Aufbau, nur großzügiger: höhere Zeilen, größerer Text, keine Trennlinien mehr. Die Liste hört auf, eine Tabelle zu sein, und wird ein Gespräch. Der Preis steht im Bild – es passen sichtbar weniger Nachrichten ins Fenster.',
    css: `
      .msg { padding: .95rem .9rem; border-bottom: 0; gap: .35rem .6rem; }
      .chat-panel .msg .body { font-size: .95rem; color: #a7aec0; }
      .msg .worth { font-size: .95rem; }
      .msg:hover { background: rgba(255,255,255,.03); border-radius: 10px; }
      .chat-panel { border-radius: 18px; }
      .chat-panel > .filters { border-bottom: 1px solid var(--line); }`,
  },
  {
    datei: 'design-5', name: 'Warm',
    kurz: 'Der Grund wird von blau auf braun gedreht',
    text: 'Dieselbe Helligkeit, andere Temperatur: Der Grund geht ins Warmgraue, das Licht wird Gold statt Violett. Gold ist schon Ansems Farbe – das macht die Seite persönlicher und weniger nach Software. Die vier Namensfarben sind allerdings für einen kalten Grund gewählt worden und müssten nachgezogen werden.',
    css: `
      :root { --bg: #0d0b09; --bg-1: #141110; --bg-2: #1b1815; --bg-3: #241f1b; --line: #2e2822; }
      body { background-color: #0d0b09;
        background-image: radial-gradient(1100px 500px at 80% -10%, rgba(255, 204, 77, .10), transparent 60%),
                          radial-gradient(900px 420px at 5% 105%, rgba(255, 176, 92, .07), transparent 60%); }
      .topbar { background: rgba(13, 11, 9, .85); }
      /* Ansems Zeilen tragen sonst ihr Petrol – ein kalter Ton auf warmem
         Grund, der wie ein Fehler aussieht. Damit die Richtung fair beurteilt
         wird, wandert er hier mit ins Warme. */
      .msg.is-admin { background: rgba(255, 204, 77, .06); }`,
  },
];

// --- Rendern ---------------------------------------------------------------
const seiteHtml = (extra) => `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
${extra ? `<style>${extra}</style>` : ''}
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
for (const r of RICHTUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  await seite.setContent(seiteHtml(r.css));
  await seite.waitForTimeout(350);
  const ziel = path.join(ausgabe, `${r.datei}.png`);
  await seite.screenshot({ path: ziel });
  bilder.push(fs.readFileSync(ziel).toString('base64'));
  await seite.close();
  console.log(`  ${ziel}`);
}

// --- Übersichtsblatt -------------------------------------------------------
// Die Einzelbilder sind zum Hinsehen, dieses eine zum Vergleichen.
const uebersicht = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; background-image: none; padding: 30px; }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 34px 26px; max-width: 1720px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 105ch; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-family: var(--mono); font-size: .8rem; }
  .kurz { color: var(--dim); font-weight: 400; font-size: .86rem; }
  p.t { margin: .35rem 0 .7rem; font-size: .84rem; color: #8b93a7; min-height: 5.6em; line-height: 1.55; }
  img { width: 100%; display: block; border-radius: 12px; border: 1px solid #232734; }
</style>
<h1>Sechs Richtungen für die Startseite</h1>
<p class="lead">Jeweils dieselbe Seite mit denselben Nachrichten – nur das Stilblatt ist anders. Nummer 0 ist der heutige Stand. Die Einzelbilder liegen in voller Größe daneben; dieses Blatt ist zum Vergleichen, nicht zum Beurteilen von Details.</p>
<div class="raster">
${RICHTUNGEN.map((r, i) => `
  <section>
    <h2><span class="nr">${i}</span>${r.name}<span class="kurz">${r.kurz}</span></h2>
    <p class="t">${r.text}</p>
    <img src="data:image/png;base64,${bilder[i]}" alt="${r.name}">
  </section>`).join('')}
</div>`;

const blatt = await browser.newPage({ viewport: { width: 1780, height: 1200 }, deviceScaleFactor: 1.5 });
await blatt.setContent(uebersicht);
await blatt.waitForTimeout(500);
await blatt.screenshot({ path: path.join(ausgabe, 'design-uebersicht.png'), fullPage: true });
await browser.close();

console.log(`\n  ${path.join(ausgabe, 'design-uebersicht.png')}\n`);
