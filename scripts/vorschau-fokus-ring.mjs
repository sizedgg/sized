// ============================================================================
// Vorschaubild: Was passiert, wenn Ansem in ein Feld der neuen Abstimmung tippt
//
// Der blaue Ring ist nicht gebaut worden – er ist der, den der Browser selbst
// malt, wenn ihm niemand etwas anderes sagt. Und "blau" ist dabei nicht einmal
// fest: Chrome nimmt die Akzentfarbe des Betriebssystems, unter macOS also das,
// was der Nutzer in den Systemeinstellungen stehen hat. Die Seite hat dort
// keine Kontrolle, solange sie die Stelle nicht selbst besetzt.
//
// Und besetzt ist sie fast überall schon: Das Feld im Login, die Zeile im Chat,
// beide DM-Felder – alle haben "outline: none; border-color: var(--accent)".
// Nur die drei Felder im "New poll"-Kasten wurden übersehen. Es ist also kein
// Umbau, sondern eine vergessene Stelle.
//
// Die Frage ist nur, wie viel Schein es sein soll. Der Browserring ist 2 px
// deckend und damit das Lauteste auf der Seite – deshalb "zu grell". Deshalb
// stehen hier Stufen von "nur der Rand" bis "deckender Ring".
//
// Der Fokusring darf nicht ersatzlos verschwinden: Wer mit der Tastatur durch
// die Seite geht, sieht sonst nicht, wo er ist. "outline: none" ohne einen
// sichtbaren Ersatz ist kein Geschmacksfehler, sondern macht die Seite
// unbedienbar. Jede Fassung hier hat deshalb einen Ersatz.
//
// Erzeugt preview/fokus-ring.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const FASSUNGEN = [
  // Nachgestellt, nicht echt: Dieser Rechner ist Linux und hat keine
  // macOS-Systemfarbe, der echte Ring käme hier weiß heraus. Damit der
  // Vergleich etwas taugt, wird Chromes Ring unter macOS hier nachgebaut –
  // 2 px in der Standard-Akzentfarbe, mit der hellen Innenlinie, die Chrome
  // dazwischenlegt, damit der Ring auch auf dunklem Grund sichtbar bleibt.
  { name: 'Jetzt (nachgestellt)',
    css: 'outline: none; box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 3px #0a84ff;',
    hinweis: 'Was der Browser von sich aus malt – hier nachgebaut, weil dieser Rechner keine macOS-Systemfarbe hat. 2 px deckend plus helle Innenlinie: der lauteste Punkt der ganzen Seite.' },

  { name: 'Nur der Rand', css: 'outline: none; border-color: var(--accent);',
    hinweis: 'Genau das, was Login, Chat und DMs schon tun. Kein Schein – der Rahmen wechselt von Graublau auf Knochenweiß. Ruhigste Fassung und die einzige, die nichts Neues einführt.' },

  { name: 'Rand + Hauch', css: 'outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .08);',
    hinweis: 'Dazu ein sehr schwacher Schein. Man sieht ihn eher, als dass man ihn liest – er gibt dem Feld Tiefe, ohne selbst aufzufallen.' },

  { name: 'Rand + Schein', css: 'outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .16);',
    hinweis: 'Derselbe Schein, doppelt so stark. Deutlich als Leuchten erkennbar, aber weit unter dem Browserring – und weiß statt blau.' },

  { name: 'Nur Schein', css: 'outline: none; box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .16);',
    hinweis: 'Der Rahmen bleibt grau, nur der Schein kommt dazu. Weicher, aber die Kante des Feldes ändert sich nicht – etwas unentschlossen.' },

  { name: 'Weißer Ring', css: 'outline: 2px solid var(--accent); outline-offset: 1px;',
    hinweis: 'Der Browserring, nur in Weiß statt Blau. So laut wie vorher – hier nur, um zu zeigen, dass die Farbe allein das Problem nicht löst.' },
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
      <span class="poll-anzahl">
        <button class="btn btn-ghost" type="button">+ Option</button>
      </span>
      <button class="btn btn-primary" type="button">Start poll</button>
    </div>
  </div>`;

const regeln = FASSUNGEN
  .map((f, i) => f.css ? `#v${i} input.fokus:focus { ${f.css} }` : '')
  .filter(Boolean).join('\n');

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
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); min-height: 5.6em; }
  .poll-admin { margin: 0; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 96ch; }
</style>
<style>${regeln}</style>
<h1>Das Fragefeld beim Anlegen einer Abstimmung</h1>
<p class="lead">Jeweils das obere Feld hat den Fokus. Nummer 0 ist der jetzige Zustand – nicht gebaut, sondern das, was der Browser von sich aus malt, und hier nachgestellt: Dieser Rechner hat keine macOS-Systemfarbe, der echte Ring käme weiß heraus statt blau.</p>
<div class="raster">
  ${FASSUNGEN.map((f, i) => `
  <section class="karte">
    <h2><span class="nr">${i}</span>${f.name}</h2>
    <p class="hinweis">${f.hinweis}</p>
    ${kasten(i)}
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-fokus.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1460, height: 900 }, deviceScaleFactor: 2 });
await seite.goto(`file://${tmp}`);

// Alle sechs Felder gleichzeitig im Fokus zeigen: Fokus hat immer nur ein
// Element. Deshalb wird der Zustand nachgestellt – dieselben Regeln, nur unter
// einer Klasse statt unter :focus. Sonst muesste man sechs Bilder machen und
// koennte sie nicht nebeneinander vergleichen.
await seite.evaluate(() => {
  for (const bl of document.querySelectorAll('style')) {
    if (bl.textContent.includes(':focus')) {
      bl.textContent = bl.textContent.replace(/:focus/g, '.tut-so');
    }
  }
  document.querySelectorAll('input.fokus').forEach((el) => el.classList.add('tut-so'));
});
await seite.waitForTimeout(400);
await seite.screenshot({ path: `${ausgabe}fokus-ring.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log(`  ${ausgabe}fokus-ring.png`);
