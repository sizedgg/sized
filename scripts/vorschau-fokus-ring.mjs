// ============================================================================
// Preview image: what happens when Ansem taps into a field of the new poll
//
// The blue ring was never built - it's the one the browser draws on its own
// when nobody tells it otherwise. And "blue" isn't even fixed: Chrome takes
// the operating system's accent color, on macOS whatever the user has set in
// System Settings. The page has no control over that unless it claims the
// spot itself.
//
// And it's already claimed almost everywhere: the login field, the chat
// input, both DM fields - all of them have "outline: none;
// border-color: var(--accent)". Only the three fields in the "New poll" box
// were missed. So this isn't a redesign, it's a forgotten spot.
//
// The only open question is how much glow it should have. The browser's ring
// is 2 px solid and thereby the loudest thing on the page - hence "too
// harsh". So here are gradations from "just the border" to "solid ring".
//
// The focus ring must not just disappear without a replacement: anyone
// navigating the page by keyboard would otherwise lose track of where they
// are. "outline: none" without a visible substitute isn't a matter of taste,
// it makes the page unusable. Every version here therefore has a
// replacement.
//
// Produces preview/fokus-ring.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const FASSUNGEN = [
  // Reconstructed, not real: this machine is Linux and has no macOS system
  // color, so the real ring here would come out white. To make the
  // comparison worth anything, Chrome's ring under macOS is rebuilt here -
  // 2 px in the default accent color, with the bright inner line Chrome
  // inserts so the ring stays visible on a dark background too.
  { name: 'Jetzt (nachgestellt)',
    css: 'outline: none; box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 3px #0a84ff;',
    hinweis: 'Was der Browser von sich aus malt – hier nachgebaut, weil dieser Rechner keine macOS-Systemfarbe hat. 2 px deckend plus helle Innenlinie: der lauteste Punkt der ganzen Seite.' },

  { name: 'Nur der Rand', css: 'outline: none; border-color: var(--accent);',
    hinweis: 'Genau das, was Login, Chat und DMs schon tun. Kein Schein – der Rahmen wechselt von Graublau auf Knochenweiß. Ruhigste Fassung und die einzige, die nichts Neues einführt.' },

  { name: 'Rand + Hauch', css: 'outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .08);',
    hinweis: 'Dazu ein sehr schwacher Schein. Man sieht ihn eher, als dass man ihn liest – er gibt dem Feld Tiefe, ohne selbst aufzufallen.' },

  { name: 'Rand + Schein', css: 'outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .16);',
    hinweis: 'Derselbe Schein, doppelt so stark. Deutlich als Leuchten erkennbar, aber far under dem Browserring – und weiß statt blau.' },

  { name: 'Nur Schein', css: 'outline: none; box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .16);',
    hinweis: 'Der Rahmen bleibt grau, nur der Schein kommt dazu. Weicher, aber die Kante des Feldes ändert sich nicht – etwas unentschlossen.' },

  { name: 'Weißer Ring', css: 'outline: 2px solid var(--accent); outline-offset: 1px;',
    hinweis: 'Der Browserring, nur in Weiß statt Blau. So laut wie vorher – hier nur, um zu show, dass die Farbe allein das Problem nicht löst.' },
];

const panel = (i) => `
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
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
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
  <section class="card">
    <h2><span class="nr">${i}</span>${f.name}</h2>
    <p class="hinweis">${f.hinweis}</p>
    ${panel(i)}
  </section>`).join('')}
</div>`;

const ausgabe = new URL('../preview/', import.meta.url).pathname;
mkdirSync(ausgabe, { recursive: true });
const tmp = new URL('../public/_vorschau-fokus.html', import.meta.url).pathname;
writeFileSync(tmp, html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1460, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`file://${tmp}`);

// Showing all six fields focused at once: focus can only ever be on one
// element. So the state is reconstructed - the same rules, just under a
// class instead of :focus. Otherwise it would take six separate screenshots
// and they couldn't be compared side by side.
await page.evaluate(() => {
  for (const bl of document.querySelectorAll('style')) {
    if (bl.textContent.includes(':focus')) {
      bl.textContent = bl.textContent.replace(/:focus/g, '.tut-so');
    }
  }
  document.querySelectorAll('input.fokus').forEach((el) => el.classList.add('tut-so'));
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${ausgabe}fokus-ring.png`, fullPage: true });
await browser.close();
rmSync(tmp);

console.log(`  ${ausgabe}fokus-ring.png`);
