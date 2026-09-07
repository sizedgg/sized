// ============================================================================
// Checks the share button and the shared link.
//
// Neither can be guessed at in the browser: whether the clipboard really
// gets the right text, whether the jump lands on the right card, and
// whether the highlight actually plays only shows once it's running.
//
// The app itself needs a database for this. So only the finished
// structure of a poll is set into the page here - the same one
// pollHtml() produces - and the two functions from app.js are run on
// top of it.
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

// The two functions from app.js, cut out verbatim. Verbatim matters: a
// rebuilt copy would pass the test while the real version is broken.
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};

const LINK_SVG = cut('const LINK_SVG =', 'const CHECK_SVG =');
const CHECK_SVG = cut('const CHECK_SVG =', 'const VOTE_SVG = `<svg class="opt-haken" viewBox="0 0 24 24" width="15" height="15"');
const pollLink = cut('const pollLink =', 'async function sharePoll(id) {');
// The buttons' state - sharePoll sets its checkmark through it. It no
// longer lives on the node itself: renderPolls rebuilds the list on
// every stranger's vote, and state on the button doesn't survive that.
const buttonState = cut('const BUTTON_ROLES = {', 'const pollLink = (id) => `${location.origin}/p/${id}`;');
const sharePoll = cut('async function sharePoll', 'function springeZuPollAusUrl');
const springe = cut('function springeZuPollAusUrl', 'window.addEventListener(\'hashchange\'');

const pageHtml = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>body { padding: 20px; } .poll-list { height: 420px; overflow-y: auto; }</style>
<div id="app"></div>
<div class="poll-list" id="poll-list"></div>
<div id="toast" hidden></div>
`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({
  viewport: { width: 900, height: 700 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
await page.goto(base);

// The environment the two functions expect - kept small, so it stays
// clear what they actually depend on.
await page.addScriptTag({
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
    ${buttonState}
    ${pollLink}
    ${sharePoll}
    ${springe}
    window.sharePoll = sharePoll;
    window.springeZuPollAusUrl = springeZuPollAusUrl;
    window.pollLink = pollLink;

    // Six cards, so the second one isn't already visible by chance and
    // the jump actually has to do something.
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
      b.addEventListener('click', () => sharePoll(b.dataset.share)));
  `,
});

const befunde = [];
const check = (name, ok, zusatz = '') =>
  befunde.push({ name, ok, zusatz }) && console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);

console.log('\nTeilen-Knopf und geteilter Link\n');

// --- 1. The link itself ----------------------------------------------------
const link = await page.evaluate(() => pollLink(3));
// A path, not a hash: everything after the # is never sent to a server,
// so X's crawler would otherwise see the same address for every poll.
check('Link endet auf /p/ mit der Nummer', link.endsWith('/p/3'), link);
check('Link enthaelt keine Raute', !link.includes('#'), link);
check('Link enthaelt keine Fragezeichen-Parameter', !link.includes('?'), link);

// --- 2. A click puts it on the clipboard -------------------------------
await page.click('#poll-4 .poll-share');
await page.waitForTimeout(150);
const ablage = await page.evaluate(() => navigator.clipboard.readText());
check('Klick kopiert den Link der angeklickten Abstimmung',
  ablage.endsWith('/p/4'), ablage);

const tosts = await page.evaluate(() => window.tosts);
check('Es kommt eine Rueckmeldung', tosts.some((t) => /copied/i.test(t.m)),
  tosts.map((t) => t.m).join(' | '));

// The checkmark must appear AND disappear again. A button that stays on
// the checkmark permanently stops saying anything the second time.
const hakenDa = await page.evaluate(() =>
  document.querySelector('#poll-4 .poll-share').classList.contains('is-copied'));
check('Knopf zeigt short den Haken', hakenDa);
await page.waitForTimeout(2000);
const hakenWeg = await page.evaluate(() => {
  const b = document.querySelector('#poll-4 .poll-share');
  return !b.classList.contains('is-copied') && b.innerHTML.includes('M10 13a5');
});
check('Knopf faellt danach auf die Kette back', hakenWeg);

// --- 3. The jump ---------------------------------------------------------
// The hash stays the way things travel INSIDE the app: /p/12 redirects
// there, and anyone with an old link from before still lands correctly.
await page.evaluate(() => { document.querySelector('#poll-list').scrollTop = 0; });
await page.evaluate(() => {
  location.hash = '#poll-5';
  springeZuPollAusUrl();
});
await page.waitForTimeout(700);

const sprung = await page.evaluate(() => {
  const el = document.getElementById('poll-5');
  const box = document.querySelector('#poll-list').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    tab: window.tab,
    markiert: el.classList.contains('is-linked'),
    sichtbar: r.top >= box.top - 4 && r.bottom <= box.bottom + 4,
    running: getComputedStyle(el).animationName,
  };
});
check('Wechselt auf den Abstimmungs-Tab', sprung.tab === 'polls', String(sprung.tab));
check('Scrollt die gemeinte Karte ins Bild', sprung.sichtbar);
check('Markiert sie', sprung.markiert);
check('Die Markierung ist eine laufende Animation',
  sprung.running === 'poll-linked', sprung.running);

// --- 4. The same link twice ----------------------------------------------
// Without resetting the class, the animation wouldn't play a second time.
await page.waitForTimeout(2600);
const vorher = await page.evaluate(() =>
  document.getElementById('poll-5').classList.contains('is-linked'));
await page.evaluate(() => springeZuPollAusUrl());
await page.waitForTimeout(200);
const nochmal = await page.evaluate(() => {
  const el = document.getElementById('poll-5');
  return el.classList.contains('is-linked') && getComputedStyle(el).animationName === 'poll-linked';
});
check('Derselbe Link ein zweites Mal markiert wieder', nochmal,
  vorher ? 'Klasse war noch gesetzt' : '');

// --- 5. A poll that doesn't exist ---------------------------------
await page.evaluate(() => { window.tosts = []; location.hash = '#poll-999'; springeZuPollAusUrl(); });
await page.waitForTimeout(150);
const fehlt = await page.evaluate(() => window.tosts);
check('Unbekannte Nummer wird gemeldet statt still zu scheitern',
  fehlt.some((t) => t.err && /not in the list/i.test(t.m)),
  fehlt.map((t) => t.m).join(' | '));

// --- 6. An address without a hash --------------------------------------------
await page.evaluate(() => {
  window.tosts = []; window.tab = null;
  history.replaceState(null, '', location.pathname);
  springeZuPollAusUrl();
});
const ruhig = await page.evaluate(() => ({ tab: window.tab, tosts: window.tosts.length }));
check('Ohne Raute passiert nichts', ruhig.tab === null && ruhig.tosts === 0,
  `tab=${ruhig.tab}, Meldungen=${ruhig.tosts}`);

// --- Image ------------------------------------------------------------------
await page.evaluate(() => { location.hash = '#poll-2'; springeZuPollAusUrl(); });
await page.waitForTimeout(250);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await page.screenshot({ path: path.join(root, 'preview', 'poll-link.png') });

await browser.close();
server.close();

const durchgefallen = befunde.filter((b) => !b.ok);
console.log(durchgefallen.length
  ? `\n  ${durchgefallen.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durchgefallen.length ? 1 : 0);
