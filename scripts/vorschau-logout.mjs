// ============================================================================
// Preview image: what should the logout button look like?
//
// Today it's the character ⏻. Same problem as with the ◎ in the brand mark:
// it looks different on every system, on some it's missing entirely, and it
// rarely sits centered in its box - while the refresh button right next to
// it is long since a cleanly drawn SVG.
//
// There's also a substantive question here: a power symbol means "device
// off". What actually happens is "end session" - and that carries more
// weight than a click, because a new session costs a payment. A button
// that's easy to hit by accident is more expensive here than elsewhere.
//
// Produces preview/logout.png
// ============================================================================

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const svg = (content, w = 15) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">${content}</svg>`;

const VARIANTEN = [
  {
    nr: 0,
    name: 'Heute: ⏻ als Schriftzeichen',
    hinweis: 'Der jetzige Stand. Sieht je nach System anders aus und sitzt selten mittig – daneben steht ein gezeichnetes SVG, der Unterschied fällt auf.',
    html: '<button class="icon-btn" title="Sign out">⏻</button>',
  },
  {
    nr: 1,
    name: 'Derselbe Schalter, gezeichnet',
    hinweis: 'Dieselbe Bedeutung, aber als Pfad: überall identisch, exakt mittig. Die minSize mögliche Änderung.',
    html: `<button class="icon-btn" title="Sign out">${svg(
      '<path d="M12 4v8"/><path d="M7.5 6.6a7 7 0 1 0 9 0"/>')}</button>`,
  },
  {
    nr: 2,
    name: 'Pfeil aus der Tür',
    hinweis: 'Das übliche Zeichen für Abmelden. Sagt "hier geht es raus" statt "aus" – näher an dem, was wirklich passiert.',
    html: `<button class="icon-btn" title="Sign out">${svg(
      '<path d="M15 4h3.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/>' +
      '<path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>')}</button>`,
  },
  {
    nr: 3,
    name: 'Pfeil nach draußen',
    hinweis: 'Wie 2, nur andersherum gerichtet – der Pfeil zeigt hinaus statt hinein. Etwas weniger üblich, dafür eindeutiger als Richtung.',
    html: `<button class="icon-btn" title="Sign out">${svg(
      '<path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9"/>' +
      '<path d="M15 8l4 4-4 4"/><path d="M19 12h-9"/>')}</button>`,
  },
  {
    nr: 4,
    name: 'Mit Wort',
    hinweis: 'Kein Symbol raten müssen. Braucht Platz, den es peek right eigentlich gibt – bei Ansem sowieso, seit der Auffrischknopf dort weg ist.',
    html: '<button class="btn btn-ghost" style="font-size:.82rem">Sign out</button>',
  },
  {
    nr: 5,
    name: 'Symbol und Wort',
    hinweis: 'Beides. Am eindeutigsten, am breitesten – auf dem Handy wird das eng.',
    html: `<button class="btn btn-ghost" style="font-size:.82rem;gap:.35rem">${svg(
      '<path d="M15 4h3.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/>' +
      '<path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>', 14)}Sign out</button>`,
  },
];

const header = (v) => `
  <header class="topbar">
    <span class="brand small"><span class="brand-mark"><svg viewBox="29 16 42 64" fill="currentColor"><rect x="29" y="54" width="18" height="26" rx="9"/><rect x="53" y="16" width="18" height="64" rx="9"/></svg></span>SIZED</span>
    <nav class="tabs">
      <button class="tab is-active">Chat</button><button class="tab">Polls</button><button class="tab">DMs</button>
    </nav>
    <div class="me">
      <span class="handle h t2">7xK</span>
      <span class="holdings worth">$5.2K</span>
      <button class="icon-btn" title="Refresh balance">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/>
        </svg>
      </button>
      ${v.html}
    </div>
  </header>`;

const card = (v) => `
  <section class="card">
    <h2><span class="nr">${v.nr}</span>${v.name}</h2>
    <p class="hinweis">${v.hinweis}</p>
    ${header(v)}
  </section>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  body { padding: 26px; background: var(--bg); }
  .card { margin: 0 0 22px; max-width: 1180px; }
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    background: var(--bg-3); color: var(--dim);
    font-family: var(--mono); font-size: .78rem;
  }
  .hinweis { margin: 0 0 .5rem; font-size: .78rem; color: var(--dimmer); max-width: 80ch; }
  .topbar { border: 1px solid var(--line); border-radius: var(--radius); position: static; }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.5rem; font-size: .82rem; color: var(--dim); max-width: 90ch; }
</style>
<h1>Der Abmeldeknopf</h1>
<p class="lead">Jeweils die ganze Kopfzeile, damit man sieht, wie er neben dem Auffrischknopf wirkt.</p>
${VARIANTEN.map(card).join('')}
`;

mkdirSync('preview', { recursive: true });
writeFileSync('public/_vorschau-logout.html', html);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`file://${process.cwd()}/public/_vorschau-logout.html`);
await page.waitForTimeout(300);
await page.screenshot({ path: 'preview/logout.png', fullPage: true });
await browser.close();

rmSync('public/_vorschau-logout.html', { force: true });
console.log('preview/logout.png');
