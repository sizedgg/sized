// ============================================================================
// Vorschaubild: Wie steht Ansem im Chat?
//
// Zwei Anforderungen, die einander widersprechen:
//   * Sein Text soll an derselben Stelle beginnen wie bei allen anderen.
//   * Er soll trotzdem sofort als Ansem erkennbar sein.
//
// Der Widerspruch: In der Kürzelspalte stehen drei Schreibmaschinenzeichen,
// das sind 26 px. "ANSEM" ist 47 px breit. Genau deshalb hatte seine Zeile
// bisher eine eigene Spaltenbreite – und genau deshalb fing sein Text weiter
// rechts an.
//
// Also muss in die Spalte etwas, das in drei Zeichen passt, und die
// Erkennbarkeit muss woanders herkommen: aus Farbe, aus der Fläche, aus einem
// Zeichen.
//
// Gold fällt raus, weil André es nicht mag – und es hatte ohnehin einen
// Nachbarn: .h.t3 (Sand, #dcc088) ist nicht weit weg.
//
// Erzeugt preview/ansem-im-chat.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

// Das Zeichen aus der Kopfzeile, für die Variante mit Marke statt Kürzel.
const MARKE = `<svg viewBox="29 16 42 64" fill="currentColor" aria-hidden="true"
  style="height:1em;width:auto;display:block"><rect x="29" y="54" width="18" height="26" rx="9"/>
  <rect x="53" y="16" width="18" height="64" rx="9"/></svg>`;

const VARIANTEN = [
  {
    nr: 1,
    name: 'Kürzel in Knochenweiß',
    hinweis: 'Er bekommt ein Kürzel wie alle, nur in der Akzentfarbe. Die ist die hellste im ganzen Bild und gehört sonst der Seite selbst – das liest sich als "hier spricht das Haus".',
    kopf: '<span class="h ansem-weiss">4bo</span>',
    css: '@ .ansem-weiss { color: var(--accent); }',
  },
  {
    nr: 2,
    name: 'Kürzel weiß, Zeile getönt',
    hinweis: 'Wie 1, dazu liegt seine Zeile auf einer schwach helleren Fläche. Beim Überfliegen findet man ihn, ohne zu lesen.',
    kopf: '<span class="h ansem-weiss">4bo</span>',
    css: `@ .ansem-weiss { color: var(--accent); }
          @ .msg.is-admin { background: rgba(var(--accent-rgb), .055); }`,
  },
  {
    nr: 3,
    name: 'Das Zeichen statt Kürzel',
    hinweis: 'In der Spalte steht die Marke der Seite. Unverwechselbar, passt in jede Breite – aber es ist kein Name, man muss es einmal gelernt haben.',
    kopf: `<span class="h ansem-weiss ansem-marke">${MARKE}</span>`,
    css: `@ .ansem-weiss { color: var(--accent); }
          @ .ansem-marke { display: inline-flex; align-items: center; }`,
  },
  {
    nr: 4,
    name: 'Petrol',
    hinweis: 'Eine echte Farbe, weit genug von den vier Namensfarben und vom Warnrot entfernt. Fällt auf, ohne die Akzentfarbe zu verbrauchen.',
    kopf: '<span class="h ansem-petrol">4bo</span>',
    css: '@ .ansem-petrol { color: #2fbfa8; }',
  },
  {
    nr: 5,
    name: 'Kürzel weiß, Text hell',
    hinweis: 'Nicht der Name ist anders, sondern seine Nachricht: Sie steht in voller Helligkeit, während die anderen gedämpft sind. Wer den Raum überfliegt, sieht zuerst ihn.',
    kopf: '<span class="h ansem-weiss">4bo</span>',
    css: `@ .ansem-weiss { color: var(--accent); }
          @ .chat-panel .msg.is-admin .body { color: var(--text); }`,
  },
  {
    nr: 6,
    name: 'Kürzel weiß, Strich am Rand',
    hinweis: 'Ein senkrechter Strich ganz links an seiner Zeile. Sehr leise, stört die Spalten nicht – aber er kostet die Zeile drei Pixel Einzug.',
    kopf: '<span class="h ansem-weiss">4bo</span>',
    css: `@ .ansem-weiss { color: var(--accent); }
          @ .msg.is-admin { box-shadow: inset 3px 0 0 var(--accent); }`,
  },
  {
    nr: 7,
    name: 'Heute',
    hinweis: 'Der jetzige Stand zum Vergleich: "ANSEM" in Gold, und weil das nicht in die Spalte passt, beginnt sein Text weiter rechts als alle anderen.',
    kopf: '<span class="h admin-name">ANSEM</span>',
    css: '@ .msg.is-admin { grid-template-columns: auto minmax(0, 1fr) auto auto; }',
    heute: true,
  },
];

const NACHRICHTEN = [
  { h: '9Qm', ton: 0, usd: '$3.4K', body: 'gm', zeit: '14:02' },
  { h: 'bH2', ton: 1, usd: '$8.8K', body: 'when is the next poll going up', zeit: '14:03' },
  { admin: true, body: 'New poll is up. Go vote.', zeit: '14:03' },
  { h: 'Km9', ton: 3, usd: '$1.3K', body: 'lfg', zeit: '14:04' },
  { h: 'zQ4', ton: 0, usd: '$781K', body: 'sold half my bag last week and the vote weight dropped immediately', zeit: '14:05' },
  { admin: true, body: 'thats the whole point', zeit: '14:06' },
  { h: '7xK', ton: 2, usd: '$5.2K', body: 'ser', zeit: '14:07' },
];

const zeile = (m, v) => `
  <div class="msg ${m.admin ? 'is-admin' : ''}">
    <span class="who">${m.admin
      ? v.kopf
      : `<span class="h t${m.ton}">${m.h}</span>`}</span>
    ${m.admin ? '' : `<span class="worth">${m.usd}</span>`}
    <span class="body">${m.body}</span>
    <span class="meta"><span class="time">${m.zeit}</span></span>
  </div>`;

const karte = (v) => `
  <section class="karte">
    <style>${v.css.replaceAll('@', `#v${v.nr}`)}</style>
    <h2><span class="nr">${v.nr}</span>${v.name}${v.heute ? '<span class="jetzt">heute</span>' : ''}</h2>
    <p class="hinweis">${v.hinweis}</p>
    <div class="chat-panel" id="v${v.nr}">
      <div class="chat-list">${NACHRICHTEN.map((m) => zeile(m, v)).join('')}</div>
    </div>
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px; background: var(--bg); }
  .raster { display: grid; grid-template-columns: repeat(2, 1fr); gap: 26px 22px; max-width: 1240px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .jetzt {
    margin-left: .4rem; padding: .1rem .45rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim); font-size: .68rem; font-weight: 400;
  }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 4.2em; }
  .chat-panel { flex: none; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 92ch; }
</style>
<h1>Ansem im Chat</h1>
<p class="lead">In allen Varianten außer der letzten beginnt sein Text an derselben Stelle wie bei allen anderen. Unterschiedlich ist nur, woher die Erkennbarkeit kommt.</p>
<div class="raster">${VARIANTEN.map(karte).join('')}</div>
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-ansem.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${process.cwd()}/public/_vorschau-ansem.html`);
await seite.waitForTimeout(300);
await seite.screenshot({ path: 'preview/ansem-im-chat.png', fullPage: true });
await browser.close();

rmSync('public/_vorschau-ansem.html', { force: true });
console.log('preview/ansem-im-chat.png');
