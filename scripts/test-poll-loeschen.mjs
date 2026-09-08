// ============================================================================
// Tests the delete button.
//
// The tricky part isn't the deletion itself - that's one line - but the
// safeguard in front of it. It has to do two things at once: catch an
// accidental hit AND not feel like the button is broken. Both can only be
// verified by measuring:
//
//   * One tap alone deletes nothing, it turns the trash can into a checkmark.
//   * The second one deletes.
//   * Nothing pops up and nothing turns red while that happens - the icon
//     is the entire confirmation.
//   * After five seconds the trash can is back; otherwise an armed button
//     would sit in the sheet that nobody remembers anymore.
//   * A database error is very much reported - otherwise you'd never see
//     that a delete did NOT happen.
//   * Anyone who isn't Ansem doesn't see the button at all.
//
//   node scripts/test-poll-loeschen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Verbatim from app.js - a reconstructed copy would pass the test while
// the real version is broken.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const deleter = cut('async function deletePoll', '\nasync function vote');
// Which option is marked leading - and that this only happens after
// closing. The calculation lives in ONE place in app.js, because the list
// and the shared image could otherwise drift apart.
const leading = cut('const leadingShare =', '\nasync function drawPoll');
const pollBuilder = cut('function pollHtml(p) {', '\nasync function deletePoll');
const TRASH_SVG = cut('const TRASH_SVG =', '\n// ------');
const CHECK_SVG = cut('const CHECK_SVG =', 'const DOWNLOAD_SVG =');
const wholeNumber = cut('const wholeNumber =', '\n');
// The state of the buttons - the core of this version. It does NOT live
// on the DOM node, and that is exactly what section 7 checks.
const buttonState = cut('const BUTTON_ROLES = {', 'const pollLink = (id) => `${location.origin}/p/${id}`;');
// And renderPolls verbatim, including the line that redraws the buttons
// after a rebuild. A reconstructed draw() would be the worst possible
// choice here: the bug lived exactly in this function, a reconstruction
// would never have had it and the test would have been green from the start.
const renderer = cut('const buttonTrait = (el) => {',
  'const LINK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
           <body><div id="poll-list" class="poll-list"></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);

await page.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nfGanz = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const fullUsd = (n) => '$' + nfGanz.format(Math.round(Number(n) || 0));
    ${wholeNumber}
    window.tosts = [];
    const toast = (m, err) => window.tosts.push({ m, err: Boolean(err) });
    const LINK_SVG = '<i></i>', DOWNLOAD_SVG = '<i></i>';
    ${TRASH_SVG}
    ${CHECK_SVG}
    // How the test tells the two apart: the trash can has the lid stroke
    // M4 6.5h16, the checkmark the single stroke M4.5 12.5.
    window.istHaken = (b) => b.innerHTML.includes('M4.5 12.5');
    window.istKorb = (b) => b.innerHTML.includes('M4 6.5h16');

    // A stub for the database: it records WHAT was supposed to be
    // deleted. That's exactly the point here - whether a single click
    // even reaches it.
    window.geloescht = [];
    window.dbFehler = null;
    const state = {
      me: { isAdmin: true },
      cfg: { symbol: 'ANSEM' },
      polls: [],
      db: {
        from: () => ({
          delete: () => ({
            eq: async (_spalte, wert) => {
              if (window.dbFehler) return { error: { message: window.dbFehler } };
              window.geloescht.push(wert);
              return { error: null };
            },
          }),
        }),
      },
    };
    window.state = state;
    window.neuGeladen = 0;
    const loadPolls = async () => { window.neuGeladen++; };

    // Whatever else renderPolls touches and is beside the point here.
    let fristT = null;
    const deadlineCadence = () => {};
    const vote = () => {};
    const sharePoll = () => {};
    const ladePollBild = () => {};

    ${buttonState}
    ${leading}
    ${pollBuilder}
    ${deleter}
    ${renderer}
    window.deletePoll = deletePoll;
    window.renderPolls = renderPolls;
    window.buttonActive = buttonActive;
    // The rebuild of the list is NOT reconstructed here: it's the same
    // call that a stranger's vote also triggers over realtime.
    window.draw = () => renderPolls();
  `,
});

const POLL = {
  id: 7, closed: false, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  myOptionId: null,
  options: [
    { id: 1, label: 'Ship it this week', votes: 128, usd: 482900, share: .618 },
    { id: 2, label: 'Wait for the audit', votes: 63, usd: 298520, share: .382 },
  ],
};

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nLöschknopf bei den Abstimmungen\n');

const setUp = (admin = true) => page.evaluate(({ p, admin }) => {
  window.state.me.isAdmin = admin;
  window.state.polls = [p];
  window.geloescht = [];
  window.tosts = [];
  window.neuGeladen = 0;
  window.dbFehler = null;
  // The armed state has to be EXPLICITLY cleared here, and that it has to
  // be is the whole point of this version: it used to be cleared away
  // automatically by the list rebuild, because it hung off the button and
  // the button disappeared. That was exactly the bug. Now it survives the
  // rebuild - including the one between two sections of this test, and a
  // section would otherwise start with a button still armed from the
  // previous one.
  window.buttonActive.clear();
  window.draw();
}, { p: POLL, admin });

// --- 1. Only Ansem sees it --------------------------------------------------
await setUp(false);
check('Ohne Adminrechte gibt es den Knopf nicht',
  await page.evaluate(() => !document.querySelector('.poll-delete')));
check('Die harmlosen Knöpfe sind trotzdem da',
  await page.evaluate(() =>
    Boolean(document.querySelector('.poll-share') && document.querySelector('.poll-image'))));

await setUp(true);
check('Als Ansem ist er da',
  await page.evaluate(() => Boolean(document.querySelector('.poll-delete'))));

// --- 2. At rest, a trash can ------------------------------------------------
check('Vorher steht dort ein Papierkorb',
  await page.evaluate(() => window.istKorb(document.querySelector('.poll-delete'))));

// --- 3. One tap doesn't delete, it makes a checkmark ------------------------
await page.click('.poll-delete');
await page.waitForTimeout(120);
const nachEins = await page.evaluate(() => {
  const b = document.querySelector('.poll-delete');
  return {
    geloescht: window.geloescht,
    tosts: window.tosts,
    haken: window.istHaken(b),
    korb: window.istKorb(b),
    titel: b.title,
    color: getComputedStyle(b).backgroundColor,
  };
});
check('Ein einzelner Tipper löscht nichts',
  nachEins.geloescht.length === 0, JSON.stringify(nachEins.geloescht));
check('Aus dem Papierkorb wird ein Häkchen',
  nachEins.haken && !nachEins.korb,
  `Haken: ${nachEins.haken}, Korb: ${nachEins.korb}`);
check('Es poppt nichts auf', nachEins.tosts.length === 0,
  nachEins.tosts.map((t) => t.m).join(' | '));
// Red was the previous state and is explicitly no longer wanted.
check('Der Knopf wird nicht eingefärbt',
  !/rgb\(2[0-9][0-9]/.test(nachEins.color), nachEins.color);
check('Der Tooltip sagt, was der zweite Tipper tut',
  /again/i.test(nachEins.titel), nachEins.titel);

// --- 4. The second tap deletes -----------------------------------------------
await page.click('.poll-delete');
await page.waitForTimeout(150);
const nachZwei = await page.evaluate(() => {
  const b = document.querySelector('.poll-delete');
  return {
    geloescht: window.geloescht,
    tosts: window.tosts,
    neuGeladen: window.neuGeladen,
    korb: b ? window.istKorb(b) : null,
  };
});
check('Der zweite Tipper löscht – und die richtige Abstimmung',
  nachZwei.geloescht.length === 1 && nachZwei.geloescht[0] === 7,
  JSON.stringify(nachZwei.geloescht));
check('Danach wird die Liste neu geladen', nachZwei.neuGeladen === 1,
  String(nachZwei.neuGeladen));
check('Auch beim Erfolg poppt nichts auf', nachZwei.tosts.length === 0,
  nachZwei.tosts.map((t) => t.m).join(' | '));
check('Das Häkchen ist wieder ein Papierkorb', nachZwei.korb === true);

// --- 5. The checkmark expires ------------------------------------------------
// Without that an armed button would sit in the sheet that nobody
// remembers anymore - and the next casual tap deletes.
await setUp(true);
await page.click('.poll-delete');
await page.waitForTimeout(5400);
check('Nach fünf Sekunden ist wieder der Papierkorb da',
  await page.evaluate(() => window.istKorb(document.querySelector('.poll-delete'))));
await page.click('.poll-delete');
await page.waitForTimeout(120);
check('Der nächste Tipper macht nur wieder ein Häkchen, statt zu löschen',
  (await page.evaluate(() => window.geloescht.length)) === 0);

// --- 6. When the database rejects --------------------------------------------
await setUp(true);
await page.evaluate(() => { window.dbFehler = 'new row violates row-level security policy'; });
await page.click('.poll-delete');
await page.waitForTimeout(80);
await page.click('.poll-delete');
await page.waitForTimeout(150);
const abgelehnt = await page.evaluate(() => ({
  tosts: window.tosts,
  neuGeladen: window.neuGeladen,
  bedienbar: !document.querySelector('.poll-delete').disabled,
}));
check('Eine Ablehnung der Datenbank wird sehr wohl gemeldet',
  abgelehnt.tosts.some((t) => t.err && /row-level/.test(t.m)),
  abgelehnt.tosts.map((t) => t.m).join(' | '));
check('Und die Liste wird dann NICHT neu geladen', abgelehnt.neuGeladen === 0,
  String(abgelehnt.neuGeladen));
check('Der Knopf bleibt bedienbar', abgelehnt.bedienbar);

// --- 7. Rebuilding the list must not take the checkmark away ----------------
//
// The bug this is about, and why it only happened "sometimes":
//
//   The armed state hung off the button as btn._scharf. renderPolls()
//   rebuilds the list completely with innerHTML, and every button is a
//   different node afterward - without _scharf and with a trash can
//   instead of the checkmark.
//
//   A rebuild happens on every stranger's vote: realtime reports votes,
//   reloadSoon waits 400 ms, loadPolls loads. But one to two seconds pass
//   between the first and second tap. If a vote landed in between, the
//   second tap just re-armed it instead of deleting - and it looked like
//   the button was stuck.
//
// That's why exactly this order is checked here, and the rebuild is the
// REAL call to renderPolls, not a reconstructed one.
console.log('\nEine fremde Stimme mittendrin\n');

await setUp(true);
await page.click('.poll-delete');
await page.waitForTimeout(80);
const between = await page.evaluate(() => {
  const vorher = document.querySelector('.poll-delete');
  window.renderPolls();                       // wie eine fremde Stimme
  const nachher = document.querySelector('.poll-delete');
  return {
    // A check on the test itself: if it were the same node, it would be
    // testing nothing at all - the old version would have passed too.
    neuerKnoten: vorher !== nachher,
    haken: window.istHaken(nachher),
    korb: window.istKorb(nachher),
  };
});
check('Vorprobe: der Neubau tauscht den Knopf wirklich aus', between.neuerKnoten);
check('Das Häkchen steht nach dem Neubau immer noch da',
  between.haken && !between.korb,
  `Haken: ${between.haken}, Korb: ${between.korb}`);

await page.click('.poll-delete');
await page.waitForTimeout(150);
check('Und der zweite Tipper löscht, als wäre nichts gewesen',
  (await page.evaluate(() => window.geloescht)).join() === '7',
  JSON.stringify(await page.evaluate(() => window.geloescht)));

// The reverse case belongs here too: the state may survive the rebuild,
// but not the five seconds. Otherwise the one bug would have been traded
// for a worse one - an armed button that nobody remembers anymore.
await setUp(true);
await page.click('.poll-delete');
await page.waitForTimeout(80);
await page.evaluate(() => window.renderPolls());
await page.waitForTimeout(5400);
await page.evaluate(() => window.renderPolls());
check('Nach fünf Sekunden ist er trotzdem stumpf – auch über Neubauten hinweg',
  await page.evaluate(() => window.istKorb(document.querySelector('.poll-delete'))));
check('Und der Zustand ist wirklich weg, nicht nur unsichtbar',
  await page.evaluate(() => window.buttonActive.size === 0));

// Keyboard focus is the same case, quietly: innerHTML throws it back to
// <body>, and whoever tabbed their way to the delete button presses Enter
// into empty space afterward.
await setUp(true);
await page.evaluate(() => document.querySelector('.poll-delete').focus());
await page.evaluate(() => window.renderPolls());
check('Der Tastaturfokus bleibt auf dem Knopf, wenn die Liste neu gebaut wird',
  await page.evaluate(() =>
    document.activeElement === document.querySelector('.poll-delete')),
  await page.evaluate(() => document.activeElement?.className || 'body'));

// Und dasselbe fuer die Antwortzeilen - das wichtigere Ziel in der Liste.
//
// Sie stehen nicht in BUTTON_ROLES, waren also von der Merkregel oben nicht
// erfasst: wer sich zu einer Antwort getabbt hatte, verlor den Fokus beim
// naechsten Neuaufbau, und der kommt bei jeder fremden Stimme. Ohne
// Adminrechte, denn nur dann sind die Zeilen ueberhaupt anwaehlbar.
await setUp(false);
check('Die zweite Antwort ist mit der Tastatur erreichbar',
  await page.evaluate(() =>
    document.querySelectorAll('.opt')[1]?.getAttribute('tabindex') === '0'));
await page.evaluate(() => document.querySelectorAll('.opt')[1].focus());
await page.evaluate(() => window.renderPolls());
check('Der Fokus bleibt auf DERSELBEN Antwort, wenn die Liste neu gebaut wird',
  await page.evaluate(() =>
    document.activeElement === document.querySelectorAll('.opt')[1]),
  await page.evaluate(() =>
    document.activeElement?.querySelector('.opt-label')?.textContent?.trim()
    || document.activeElement?.className || 'body'));
// Gegenprobe: es ist nicht einfach die erste Zeile, auf der der Fokus
// landet. Sonst wuerde die Pruefung oben auch bestehen, wenn die Merkregel
// die Antwort gar nicht wiedererkennt und irgendetwas anfasst.
check('Und nicht auf der ersten – die Zeile wird wirklich wiedererkannt',
  await page.evaluate(() =>
    document.activeElement !== document.querySelectorAll('.opt')[0]));

// --- Image -------------------------------------------------------------------
await setUp(true);
await page.click('.poll-delete');
await page.waitForTimeout(150);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await page.screenshot({ path: path.join(root, 'preview', 'poll-loeschen.png') });

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
