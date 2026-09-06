// ============================================================================
// Prüft den Teilen-Knopf und den geteilten Link.
//
// Beides ist im Browser nicht zu erraten: Ob die Zwischenablage wirklich den
// richtigen Text bekommt, ob der Sprung die richtige Karte trifft und ob die
// Markierung tatsächlich läuft, sieht man erst, wenn es läuft.
//
// Die App selbst braucht dafür eine Datenbank. Deshalb wird hier nur die
// fertige Struktur einer Abstimmung ins Blatt gesetzt – dieselbe, die
// pollHtml() erzeugt – und die beiden Funktionen aus app.js darüber laufen
// gelassen.
//
//   node scripts/test-poll-link.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// Die beiden Funktionen aus app.js, wörtlich herausgeschnitten. Wörtlich ist
// wichtig: Eine nachgebaute Kopie würde den Test bestehen, während die echte
// Fassung kaputt ist.
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};

const LINK_SVG = schneide('const LINK_SVG =', 'const CHECK_SVG =');
const CHECK_SVG = schneide('const CHECK_SVG =', '\n/* Der Haken an der Antwort');
const pollLink = schneide('const pollLink =', '\n/**\n * Link teilen');
// Der Zustand der Knoepfe – teilePoll setzt seinen Haken darueber. Er haengt
// nicht mehr am Knoten: renderPolls baut die Liste bei jeder fremden Stimme
// neu, und ein Zustand am Knopf ueberlebt das nicht.
const knopfStand = schneide('const KNOPF_ROLLEN = {', '\n/**\n * Die Adresse einer einzelnen');
const teilePoll = schneide('async function teilePoll', 'function springeZuPollAusUrl');
const springe = schneide('function springeZuPollAusUrl', 'window.addEventListener(\'hashchange\'');

const seiteHtml = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>body { padding: 20px; } .poll-list { height: 420px; overflow-y: auto; }</style>
<div id="app"></div>
<div class="poll-list" id="poll-list"></div>
<div id="toast" hidden></div>
`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' }).end(seiteHtml);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({
  viewport: { width: 900, height: 700 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const seite = await ctx.newPage();
await seite.goto(base);

// Das Umfeld, das die beiden Funktionen erwarten – klein gehalten, damit klar
// bleibt, worauf sie sich wirklich stützen.
await seite.addScriptTag({
  content: `
    const $ = (s) => document.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.tosts = [];
    const toast = (m, err) => window.tosts.push({ m, err: Boolean(err) });
    const selectTab = (t) => { window.tab = t; };
    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    }
    const state = { polls: [
      { id: 1, question: 'Should we open the token gate to smaller holders?' },
      { id: 2, question: 'Next AMA time?' },
    ] };
    ${LINK_SVG}
    ${CHECK_SVG}
    const DOWNLOAD_SVG = '<i></i>', TRASH_SVG = '<i></i>';
    ${knopfStand}
    ${pollLink}
    ${teilePoll}
    ${springe}
    window.teilePoll = teilePoll;
    window.springeZuPollAusUrl = springeZuPollAusUrl;
    window.pollLink = pollLink;

    // Sechs Karten, damit die zweite nicht zufaellig schon sichtbar ist und der
    // Sprung wirklich etwas tun muss.
    document.querySelector('#poll-list').innerHTML = [1,2,3,4,5,6].map((i) => \`
      <article class="poll" id="poll-\${i}">
        <div class="poll-head">
          <h4>Poll number \${i}</h4>
          <button class="icon-btn poll-share" data-share="\${i}">\${LINK_SVG}</button>
        </div>
        <div class="poll-meta"><span>\${i * 7} votes</span></div>
        <div class="opt"><div class="opt-bar"><div class="opt-fill" style="width:40%"></div>
          <div class="opt-text"><span class="opt-label">Yes</span></div></div></div>
      </article>\`).join('');
    $$('.poll-share').forEach((b) =>
      b.addEventListener('click', () => teilePoll(b.dataset.share)));
  `,
});

const befunde = [];
const pruefe = (name, ok, zusatz = '') =>
  befunde.push({ name, ok, zusatz }) && console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);

console.log('\nTeilen-Knopf und geteilter Link\n');

// --- 1. Der Link selbst ----------------------------------------------------
const link = await seite.evaluate(() => pollLink(3));
// Pfad statt Raute: Alles ab dem # wird niemals an einen Server geschickt, und
// Xs Crawler saehe deshalb bei jeder Abstimmung dieselbe Adresse.
pruefe('Link endet auf /p/ mit der Nummer', link.endsWith('/p/3'), link);
pruefe('Link enthaelt keine Raute', !link.includes('#'), link);
pruefe('Link enthaelt keine Fragezeichen-Parameter', !link.includes('?'), link);

// --- 2. Klick legt ihn in die Zwischenablage -------------------------------
await seite.click('#poll-4 .poll-share');
await seite.waitForTimeout(150);
const ablage = await seite.evaluate(() => navigator.clipboard.readText());
pruefe('Klick kopiert den Link der angeklickten Abstimmung',
  ablage.endsWith('/p/4'), ablage);

const tosts = await seite.evaluate(() => window.tosts);
pruefe('Es kommt eine Rueckmeldung', tosts.some((t) => /copied/i.test(t.m)),
  tosts.map((t) => t.m).join(' | '));

// Der Haken muss erscheinen UND wieder verschwinden. Ein Knopf, der dauerhaft
// auf Haken stehen bleibt, sagt beim zweiten Mal nichts mehr.
const hakenDa = await seite.evaluate(() =>
  document.querySelector('#poll-4 .poll-share').classList.contains('is-copied'));
pruefe('Knopf zeigt kurz den Haken', hakenDa);
await seite.waitForTimeout(2000);
const hakenWeg = await seite.evaluate(() => {
  const b = document.querySelector('#poll-4 .poll-share');
  return !b.classList.contains('is-copied') && b.innerHTML.includes('M10 13a5');
});
pruefe('Knopf faellt danach auf die Kette zurueck', hakenWeg);

// --- 3. Der Sprung ---------------------------------------------------------
// Die Raute bleibt der Weg INNERHALB der App: /p/12 leitet dorthin weiter,
// und wer einen alten Link von vorher hat, landet weiterhin richtig.
await seite.evaluate(() => { document.querySelector('#poll-list').scrollTop = 0; });
await seite.evaluate(() => {
  location.hash = '#poll-5';
  springeZuPollAusUrl();
});
await seite.waitForTimeout(700);

const sprung = await seite.evaluate(() => {
  const el = document.getElementById('poll-5');
  const box = document.querySelector('#poll-list').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    tab: window.tab,
    markiert: el.classList.contains('is-linked'),
    sichtbar: r.top >= box.top - 4 && r.bottom <= box.bottom + 4,
    laeuft: getComputedStyle(el).animationName,
  };
});
pruefe('Wechselt auf den Abstimmungs-Tab', sprung.tab === 'polls', String(sprung.tab));
pruefe('Scrollt die gemeinte Karte ins Bild', sprung.sichtbar);
pruefe('Markiert sie', sprung.markiert);
pruefe('Die Markierung ist eine laufende Animation',
  sprung.laeuft === 'poll-linked', sprung.laeuft);

// --- 4. Zweimal derselbe Link ----------------------------------------------
// Ohne das Zuruecksetzen der Klasse liefe die Animation kein zweites Mal.
await seite.waitForTimeout(2600);
const vorher = await seite.evaluate(() =>
  document.getElementById('poll-5').classList.contains('is-linked'));
await seite.evaluate(() => springeZuPollAusUrl());
await seite.waitForTimeout(200);
const nochmal = await seite.evaluate(() => {
  const el = document.getElementById('poll-5');
  return el.classList.contains('is-linked') && getComputedStyle(el).animationName === 'poll-linked';
});
pruefe('Derselbe Link ein zweites Mal markiert wieder', nochmal,
  vorher ? 'Klasse war noch gesetzt' : '');

// --- 5. Eine Abstimmung, die es nicht gibt ---------------------------------
await seite.evaluate(() => { window.tosts = []; location.hash = '#poll-999'; springeZuPollAusUrl(); });
await seite.waitForTimeout(150);
const fehlt = await seite.evaluate(() => window.tosts);
pruefe('Unbekannte Nummer wird gemeldet statt still zu scheitern',
  fehlt.some((t) => t.err && /not in the list/i.test(t.m)),
  fehlt.map((t) => t.m).join(' | '));

// --- 6. Eine Adresse ohne Raute --------------------------------------------
await seite.evaluate(() => {
  window.tosts = []; window.tab = null;
  history.replaceState(null, '', location.pathname);
  springeZuPollAusUrl();
});
const ruhig = await seite.evaluate(() => ({ tab: window.tab, tosts: window.tosts.length }));
pruefe('Ohne Raute passiert nichts', ruhig.tab === null && ruhig.tosts === 0,
  `tab=${ruhig.tab}, Meldungen=${ruhig.tosts}`);

// --- Bild ------------------------------------------------------------------
await seite.evaluate(() => { location.hash = '#poll-2'; springeZuPollAusUrl(); });
await seite.waitForTimeout(250);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await seite.screenshot({ path: path.join(root, 'preview', 'poll-link.png') });

await browser.close();
server.close();

const durchgefallen = befunde.filter((b) => !b.ok);
console.log(durchgefallen.length
  ? `\n  ${durchgefallen.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durchgefallen.length ? 1 : 0);
