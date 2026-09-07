// ============================================================================
// Checks the length of a poll.
//
// The mechanism behind it was already finished before this test: closes_at
// has been in the table since the first schema, the trigger rejects votes
// after it, the price refresh skips expired polls, the og Function accounts
// for it. What was missing was just the way in - and that's exactly the kind
// of gap no test notices, because nothing is broken: there simply never was
// anything there.
//
// That's why this test checks the CONNECTION first, not the arithmetic: that
// the form sends a deadline along, that it arrives in the header, and that
// the cutoff actually takes effect in the browser at the end, rather than
// only coming back as a red error from the database.
//
// The time math is checked against INTENT, not wording. "3h 12m left" may be
// rephrased; what must not happen is rounding up - someone who reads "3h" and
// in reality has 2h 5m arrives late, because the page promised time that
// wasn't there.
//
//   node scripts/test-poll-frist.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Verbatim from the source.
const zeit = cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;');
const line = cut('const BALD_MS =', 'let fristT = null;');
// Who gets marked as leading - and that this only happens after closing. The
// arithmetic lives in ONE place in app.js, because the list and the shared
// image could otherwise drift apart.
const leading = cut('const leadingShare =', '\nasync function drawPoll');
const markup = cut('function pollHtml(p) {', 'async function deletePoll(id) {');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const escFn = cut('const esc = (s) =>', '\n\n');
const symbole = cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;');
// The poll-length controls together with their listeners, verbatim - the
// test then actually operates the real lists instead of checking a
// reconstructed behavior.
// Careful: the excerpt already includes the registration of the change
// listeners. Anyone who registers their own on top of it here double-fires.
const fieldCode = cut('const LZ_MAX_MINUTEN =', "\n$('#btn-create-poll')");

// The box from the real page, not reconstructed.
const panel = /<div class="lz-block"[\s\S]*?<p id="lz-hinweis"[\s\S]*?<\/p>\s*<\/div>/.exec(html);
if (!panel) throw new Error('Die Laufzeitauswahl fehlt in index.html');

// For this side, the WHOLE create box and not just the poll length: further
// down, the size of the label is measured against the heading next to it,
// and that heading happens to live in the same box. Rules like
// `.poll-admin input` also apply there, and they're interesting for exactly
// that reason - they've already silently slapped .6rem of padding onto the
// field once before.
const wholeBox = /<div id="poll-admin"[\s\S]*?\n {4}<\/div>/.exec(html);
if (!wholeBox) throw new Error('Der Anlegekasten fehlt in index.html');
const openBox = wholeBox[0]
  .replace('class="poll-admin" hidden', 'class="poll-admin offen"')
  .replace('id="poll-admin-felder" hidden', 'id="poll-admin-felder"');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="background:var(--bg)">
       <!-- offen: Der Anlegekasten ist seit dem Aufraeumen im Polls-Tab
            standardmaessig zu, und zugeklappt ist gar nichts davon zu sehen.
            Hier geht es um die Laufzeit, also um den offenen Zustand. -->
       <main class="pane" style="background:var(--bg)">${openBox}</main>
       <div class="polls-panel" id="ziel"></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false }, polls: [] };
    const toast = () => {};
    ${escFn}
    ${formate}
    ${symbole}
    ${zeit}
    ${line}
    ${leading}
    ${markup}
    ${fieldCode}
    window.fristText = fristText;
    window.deadlineLine = deadlineLine;
    window.pollHtml = pollHtml;
    window.chosenDeadlineMinutes = chosenDeadlineMinutes;
    window.setTerm = setTerm;
    window.renderLaufzeit = renderLaufzeit;
    window.LZ_MAX_MINUTEN = LZ_MAX_MINUTEN;`,
});

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
console.log('\nDie Zeitangabe\n');

const text = (ms) => page.evaluate((m) => window.fristText(new Date(Date.now() + m).toISOString()), ms);
const M = 60_000, H = 60 * M, T = 24 * H;

// 2 seconds added everywhere, and that's not a cosmetic touch: right at the
// boundary - 3 days to the millisecond - the result depends on whether the
// two Date.now() calls, in the test and in the function, land on the same
// millisecond. Sometimes "3d left", sometimes "2d 23h left", depending on
// the clock's mood. A test that fails one run in twenty eventually gets
// ignored instead of read.
const SURCHARGE = 2000;
for (const [ms, erwartet, was] of [
  [3 * T + 5 * H, '3d 5h left', 'Tage mit Stunden'],
  [3 * T, '3d left', 'volle Tage ohne Nullstunde'],
  [5 * H + 12 * M, '5h 12m left', 'Stunden mit Minuten'],
  [2 * H, '2h left', 'volle Stunden ohne Nullminute'],
  [47 * M, '47m left', 'nur Minuten'],
  [30_000, 'closing now', 'under einer Minute'],
]) {
  const t = await text(ms + SURCHARGE);
  check(`${was}`, t === erwartet, t);
}

// The point this is really about.
const knapp = await text(2 * H + 59 * M + 59_000);
check('Es wird abgerundet, nie auf', /^2h 59m/.test(knapp), knapp);
const knapp2 = await text(59 * M + 59_000);
check('Auch an der Stundengrenze', /^59m/.test(knapp2), knapp2);

// Expired must never appear as remaining time - not even as "0m".
for (const ms of [0, -1000, -5 * H]) {
  const t = await text(ms);
  check(`Abgelaufen (${ms} ms) zeigt keine Restzeit`, t === 'closing', t);
}

// ---------------------------------------------------------------------------
console.log('\nDie Zeile in der Abstimmung\n');

const build = async (closesAt, closed = false) => page.evaluate(([c, zu]) => {
  const p = {
    id: 1, closed: zu, closesAt: c, totalVotes: 191, totalUsd: 781420,
    question: 'Should we open the token gate?',
    options: [{ id: 1, label: 'Yes', votes: 100, usd: 500000, share: .64 },
              { id: 2, label: 'No', votes: 91, usd: 281420, share: .36 }],
  };
  document.querySelector('#ziel').innerHTML = window.pollHtml(p);
  const el = document.querySelector('.frist-rest');
  return el && {
    text: el.textContent,
    bald: el.classList.contains('is-bald'),
    color: getComputedStyle(el).color,
  };
}, [closesAt, closed]);

const inMs = (ms) => new Date(Date.now() + ms).toISOString();

const far = await build(inMs(3 * T + SURCHARGE));
check('Eine laufende Abstimmung zeigt die Restzeit', !!far && /3d/.test(far.text), far?.text);
check('Mit dem Trennpunkt der übrigen Kopfzeile', !!far && far.text.startsWith('· '), far?.text);

const bald = await build(inMs(20 * M));
check('Unter einer Stunde wird sie hervorgehoben', bald?.bald === true, bald?.text);
check('Und zwar farblich anders als vorher', far && bald && far.color !== bald.color,
  `${far?.color} → ${bald?.color}`);
// It's gold only for the attention - it still has to stay readable.
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (rgb) => { const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b); };
const kon = (a, b) => { const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05); };
const numbers = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const grund = numbers(/--bg-1:\s*(#[0-9a-f]{6})/i.exec(css)[1]
  .replace(/#(..)(..)(..)/, (_, a, b, c) => [a, b, c].map((h) => parseInt(h, 16)).join(' ')));
const kBald = kon(numbers(bald.color), grund);
check('Die hervorgehobene Zeile bleibt lesbar (mindestens 4,5:1)', kBald >= 4.5,
  `${kBald.toFixed(1)}:1`);

const eine = await build(inMs(59 * M + 30_000));
check('Die Grenze liegt bei einer Stunde, nicht bei Minuten', eine?.bald === true, eine?.text);
const justOver = await build(inMs(61 * M));
check('Knapp darüber noch nicht', justOver?.bald === false, justOver?.text);

check('Ohne Frist steht dort nichts', (await build(null)) === null);
// A closed poll no longer has a remaining time, it has a result. Both side
// by side would be a contradiction in the same sentence.
check('Eine geschlossene Abstimmung zeigt keine Restzeit',
  (await build(inMs(3 * T), true)) === null);

// ---------------------------------------------------------------------------
console.log('\nDer Weg vom Formular in die Datenbank\n');

check('Das Formular hat drei Listen',
  /id="lz-tage"/.test(html) && /id="lz-stunden"/.test(html) && /id="lz-minuten"/.test(html));
// NO <select>, and this isn't a formality here, it's the reason for the
// whole switch: in Chromium a <select> counts as :focus-visible after a
// MOUSE CLICK - like a text field, unlike a button. The rule
// :focus-visible:not(input):not(textarea) in the stylesheet applies to it as
// a result, and a bright ring nobody wanted sits around the field. That gets
// measured further down; here is the construction, so nobody reverts it by
// accident.
check('Und zwar keine <select>',
  !/<select id="lz-/.test(html),
  (html.match(/<select id="lz-\w+"/g) || []).join(' ') || 'keins');
check('Sondern Knöpfe mit eigener Klappe',
  (html.match(/<button type="button" id="lz-(tage|stunden|minuten)"/g) || []).length === 3);
check('Jede Klappe ist eine Listbox',
  (html.match(/class="lz-liste" role="listbox"/g) || []).length === 3);
check('Und jeder Knopf sagt, ob sie offen ist',
  (html.match(/aria-haspopup="listbox" aria-expanded="false"/g) || []).length === 3);
// Without a label, every list would be a number without a unit. It sits IN
// the button, not next to it: that way the whole box is the tappable target,
// and a screen reader says "Days 1" instead of just "1".
check('Jede Liste ist beschriftet',
  /<span class="lz-name">Days<\/span>/.test(html)
  && /<span class="lz-name">Hours<\/span>/.test(html)
  && /<span class="lz-name">Minutes<\/span>/.test(html));
check('Und die Beschriftung steht im Knopf, nicht daneben',
  (html.match(/<button type="button" id="lz-\w+"[\s\S]{0,220}?<span class="lz-name">/g) || [])
    .length === 3);
check('Die Gruppe ist beschriftet',
  /class="lz-block" role="group" aria-labelledby="lz-titel"/.test(html));
// The entries are NOT in the markup: 0 to 59 by hand would be ninety lines of
// transcription. app.js builds them.
check('Die Klappen sind im Blatt empty und werden im Code gefüllt',
  /<div id="lz-liste-tage" class="lz-liste" role="listbox"\s+aria-label="Days" hidden><\/div>/.test(html)
  && /function lzListe\(/.test(appJs));

check('Das Anlegen schickt closes_at mit',
  /\.from\('polls'\)\.insert\(\{ question, closes_at \}\)/.test(appJs));
// The one state that was the only one before deadlines existed: runs until
// Ansem closes it by hand. It must stay reachable.
check('Bei 0 wird ausdrücklich null geschickt',
  /const closes_at = minuten > 0\s*\n?\s*\?[\s\S]{0,120}?:\s*null;/.test(appJs));
check('Die Frist wird beim Anlegen in einen Zeitpunkt gerechnet',
  /Date\.now\(\) \+ minuten \* 60_000\)\.toISOString\(\)/.test(appJs));
check('Nach dem Anlegen steht die Vorgabe wieder da',
  /setTerm\(\);/.test(appJs));

// ---------------------------------------------------------------------------
console.log('\nDie drei Listen\n');

const stand = () => page.evaluate(() => {
  const count = (id, nurWaehlbar) =>
    [...document.querySelectorAll(`#lz-liste-${id} .lz-eintrag`)]
      .filter((e) => !nurWaehlbar || e.getAttribute('aria-disabled') !== 'true').length;
  return {
    tage: Number(document.querySelector('#lz-tage').dataset.wert),
    stunden: Number(document.querySelector('#lz-stunden').dataset.wert),
    minuten: Number(document.querySelector('#lz-minuten').dataset.wert),
    gesamt: window.chosenDeadlineMinutes(),
    // How many entries the dropdown has - and how many of them are pickable.
    // Separating these two numbers is the whole point of the week rule: the
    // list stays complete, individual entries are just disabled.
    auswahl: { tage: count('tage'), stunden: count('stunden'), minuten: count('minuten') },
    waehlbar: { tage: count('tage', true), stunden: count('stunden', true),
                minuten: count('minuten', true) },
    hinweis: document.querySelector('#lz-hinweis').hidden
      ? null : document.querySelector('#lz-hinweis').textContent,
  };
});

/** Set a value - like a human: open the dropdown, click an entry. */
const stelle = async (welche, wert) => {
  await page.click(`#lz-${welche}`);
  await page.click(`#lz-liste-${welche} [data-wert="${wert}"]`);
  return stand();
};

const anfang = await stand();
check('Es beginnt bei einem Tag', anfang.gesamt === 1440,
  `${anfang.tage}d ${anfang.stunden}h ${anfang.minuten}m`);

// The length of the lists is the real promise: 0 to 7, 0 to 23, 0 to 59. A
// list that stops at 24 hours would silently be an hour short.
check('Tage gehen von 0 bis 7', anfang.auswahl.tage === 8, String(anfang.auswahl.tage));
check('Stunden von 0 bis 23', anfang.auswahl.stunden === 24, String(anfang.auswahl.stunden));
check('Minuten von 0 bis 59', anfang.auswahl.minuten === 60, String(anfang.auswahl.minuten));

// ---------------------------------------------------------------------------
console.log('\nAlle drei Klappen sind gleich big\n');
//
// That was the second reason to give up on <select>: its dropdown is drawn
// by the operating system, and its height follows the number of entries -
// eight for Days, sixty for Minutes. Three differently tall dropdowns under
// three identical-looking boxes, and nothing the page can grab hold of.
const klappen = [];
for (const id of ['tage', 'stunden', 'minuten']) {
  await page.click(`#lz-${id}`);
  klappen.push(await page.evaluate((i) => {
    const r = document.querySelector(`#lz-liste-${i}`).getBoundingClientRect();
    return { id: i, b: Math.round(r.width), h: Math.round(r.height) };
  }, id));
  await page.keyboard.press('Escape');
}
for (const k of klappen) console.log(`     ${k.id.padEnd(9)}${k.b} x ${k.h} px`);
check('Alle drei sind gleich hoch',
  new Set(klappen.map((k) => k.h)).size === 1,
  klappen.map((k) => k.h).join(' / ') + ' px');
check('Und gleich wide',
  new Set(klappen.map((k) => k.b)).size === 1,
  klappen.map((k) => k.b).join(' / ') + ' px');
// And they must overflow, otherwise the equality would be a coincidence: if
// the dropdown were taller than eight entries, Days would be shorter than
// the other two.
const laeuftUeber = await page.evaluate(() => {
  const l = document.querySelector('#lz-liste-tage');
  document.querySelector('#lz-tage').click();
  const r = l.scrollHeight > l.clientHeight;
  document.querySelector('#lz-tage').click();
  return r;
});
check('Auch die kürzeste Liste (Days) läuft über und rollt',
  laeuftUeber, laeuftUeber ? 'ja' : 'nein');

// ---------------------------------------------------------------------------
console.log('\nKein Ring beim Anklicken\n');
//
// The reason for the whole switch. What gets measured is the EFFECT (no
// outline after a mouse click), not the construction - whoever solves it a
// different way shouldn't fail on a technicality.
await page.mouse.move(0, 0);
await page.click('#lz-tage');
const nachKlick = await page.evaluate(() => {
  const c = getComputedStyle(document.querySelector('#lz-tage'));
  return { umriss: `${c.outlineStyle} ${c.outlineWidth}`,
           shadow: c.boxShadow,
           tastatur: document.documentElement.hasAttribute('data-tastatur') };
});
await page.keyboard.press('Escape');
check('Nach einem Mausklick liegt kein Umriss um das Feld',
  /none/.test(nachKlick.umriss) || /^0px/.test(nachKlick.umriss.split(' ')[1] ?? ''),
  nachKlick.umriss);
check('Und auch kein Schein', nachKlick.shadow === 'none', nachKlick.shadow);
// Control check: with the keyboard it MUST be there, otherwise the page
// would be unusable - "outline: none" with no replacement is the actual
// bug.
await page.keyboard.press('Tab');
const nachTab = await page.evaluate(() => {
  document.documentElement.setAttribute('data-tastatur', '');
  document.querySelector('#lz-tage').focus();
  const c = getComputedStyle(document.querySelector('#lz-tage'));
  return `${c.outlineStyle} ${c.outlineWidth}`;
});
check('Mit der Tastatur ist er da – sonst wäre die Seite blind bedienbar',
  !/none/.test(nachTab), nachTab);
await page.evaluate(() => document.documentElement.removeAttribute('data-tastatur'));

// The math happens in minutes, and the three fields must add up - not one
// overwriting the other.
const proben = [
  [{ tage: 0, stunden: 0, minuten: 5 }, 5],
  [{ tage: 0, stunden: 1, minuten: 0 }, 60],
  [{ tage: 0, stunden: 2, minuten: 30 }, 150],
  [{ tage: 1, stunden: 0, minuten: 0 }, 1440],
  [{ tage: 3, stunden: 12, minuten: 0 }, 3 * 1440 + 720],
  [{ tage: 6, stunden: 23, minuten: 59 }, 6 * 1440 + 23 * 60 + 59],
];
for (const [w, erwartet] of proben) {
  const r = await page.evaluate((w) => {
    window.setTerm(w);
    return window.chosenDeadlineMinutes();
  }, w);
  check(`${w.tage}d ${w.stunden}h ${w.minuten}m sind ${erwartet} Minuten`,
    r === erwartet, String(r));
}

// ---------------------------------------------------------------------------
console.log('\nAlles auf null heisst kein Ende\n');

// This state used to hang as a special case below the shortest poll length,
// because it had to go somewhere in a row. With three fields, no duration IS
// no deadline - and that's exactly what's being checked here, not a
// position in a list.
await page.evaluate(() => window.setTerm({ tage: 0, stunden: 0, minuten: 0 }));
const null3 = await stand();
check('0d 0h 0m sind 0 Minuten', null3.gesamt === 0, String(null3.gesamt));
// And nobody should have to just guess this.
check('Und es steht ein Satz dabei', /no end/i.test(null3.hinweis ?? ''),
  null3.hinweis ?? '(nichts)');

await page.evaluate(() => window.setTerm({ tage: 0, stunden: 0, minuten: 1 }));
const eineMinute = await stand();
check('Eine Minute ist schon eine Frist', eineMinute.gesamt === 1);
check('Und der Satz ist dann weg', eineMinute.hinweis === null,
  eineMinute.hinweis ?? '(nichts)');

// ---------------------------------------------------------------------------
console.log('\nDie Woche als Obergrenze\n');

// Seven days was already the maximum before. What's new is that the limit
// now comes from THREE fields together - 7 days plus 6 hours would be too
// much.
//
// One rule, applied three times: an entry is disabled if it, together with
// the other two, would come to more than a week. The list stays COMPLETE
// while this happens - so it's visible that the limit is a limit and not a
// hole in the list.
await page.evaluate(() => window.setTerm({ tage: 0, stunden: 0, minuten: 0 }));
const beiSieben = await stelle('tage', 7);
check('Sieben Tage lassen sich einstellen',
  beiSieben.gesamt === 7 * 1440, `${beiSieben.gesamt} Minuten`);
check('Die Stundenliste bleibt trotzdem vollständig',
  beiSieben.auswahl.stunden === 24, String(beiSieben.auswahl.stunden));
check('Aber nur die Null ist dort noch wählbar',
  beiSieben.waehlbar.stunden === 1, String(beiSieben.waehlbar.stunden));
check('Bei den Minuten genauso',
  beiSieben.auswahl.minuten === 60 && beiSieben.waehlbar.minuten === 1,
  `${beiSieben.auswahl.minuten} Einträge, ${beiSieben.waehlbar.minuten} wählbar`);

// A disabled entry really must do nothing. Without this check it could sit
// there grayed out and still take effect.
//
// dispatchEvent instead of click(): Playwright refuses to click on
// something with aria-disabled - and that's already a piece of information
// in itself. A human CAN press on it, though, so the event is dispatched by
// hand here, so the code itself stands guard and not just the library.
await page.click('#lz-stunden');
await page.locator('#lz-liste-stunden [data-wert="6"]').dispatchEvent('click');
const nachKlickAufGrau = await stand();
check('Ein Klick auf einen grauen Eintrag ändert nichts',
  nachKlickAufGrau.gesamt === 7 * 1440, `${nachKlickAufGrau.gesamt} Minuten`);
await page.keyboard.press('Escape');

// The way back. Without it, seven days would be a dead end.
const back = await stelle('tage', 3);
check('Zurück under sieben Tagen ist wieder alles wählbar',
  back.waehlbar.stunden === 24 && back.waehlbar.minuten === 60,
  `${back.waehlbar.stunden} / ${back.waehlbar.minuten}`);

// And the rule works in EVERY direction - that's the real payoff. If an
// hour is already set, the 7 for days is grayed out, and nobody has to
// afterward correct a number that changed on its own.
await page.evaluate(() => window.setTerm({ tage: 0, stunden: 6, minuten: 0 }));
const mitStunden = await stand();
check('Mit sechs Stunden im Feld ist die 7 bei den Tagen nicht mehr wählbar',
  mitStunden.waehlbar.tage === 7, `${mitStunden.waehlbar.tage} von ${mitStunden.auswahl.tage}`);
// And the limit also holds underneath the surface. This isn't duplication
// out of caution, it's a question of ownership: "a poll runs at most one
// week" is a statement about the poll length, not about the controls. If it
// only lived in the dropdowns, it would silently vanish for the next second
// caller of setTerm().
const exceeded = await page.evaluate(() => {
  const aus = [];
  for (const w of [{ tage: 7, stunden: 23, minuten: 59 },
                   { tage: 9, stunden: 0, minuten: 0 },
                   { tage: 6, stunden: 30, minuten: 0 }]) {
    window.setTerm(w);
    aus.push([`${w.tage}d ${w.stunden}h ${w.minuten}m`, window.chosenDeadlineMinutes()]);
  }
  return aus;
});
for (const [wunsch, ist] of exceeded) {
  check(`${wunsch} wird auf höchstens eine Woche gekürzt`, ist <= 7 * 1440,
    `${ist} von höchstens ${7 * 1440} Minuten`);
}
// Trimming happens from the bottom: whoever specifies seven days means the
// seven days.
check('Und die grösste Einheit bleibt dabei stehen',
  exceeded[0][1] === 7 * 1440, `${exceeded[0][1]} Minuten`);

// ---------------------------------------------------------------------------
console.log('\nDie Tastatur\n');
//
// A <select> brings arrows, Home/End, Enter and Escape for free. This
// dropdown is hand-built, so all of that lives in app.js - and built halfway
// would be worse than not at all: someone who opens a dropdown and then
// reaches into empty space with the arrow keys is stuck.
await page.evaluate(() => window.setTerm({ tage: 2, stunden: 0, minuten: 0 }));
const taste = async (...tasten) => {
  for (const t of tasten) { await page.keyboard.press(t); await page.waitForTimeout(40); }
  return page.evaluate(() => ({
    offen: document.querySelector('#lz-tage').getAttribute('aria-expanded') === 'true',
    marker: document.querySelector('#lz-liste-tage .ist-marke')?.dataset.wert ?? null,
    wert: document.querySelector('#lz-tage').dataset.wert,
  }));
};
await page.evaluate(() => document.querySelector('#lz-tage').focus());
const downward = await taste('ArrowDown');
check('Pfeil ab öffnet die Klappe', downward.offen);
check('Und die Marke steht auf dem gewählten Wert', downward.marker === '2', downward.marker);
const twoNext = await taste('ArrowDown', 'ArrowDown');
check('Zwei weitere Pfeile bewegen die Marke um zwei', twoNext.marker === '4',
  twoNext.marker);
check('Der Wert selbst ändert sich dabei noch nicht', twoNext.wert === '2',
  twoNext.wert);
const chosen = await taste('Enter');
check('Enter übernimmt die Marke', chosen.wert === '4', chosen.wert);
check('Und schliesst die Klappe', !chosen.offen);
const anfangEnde = await taste('ArrowDown', 'Home');
check('Pos1 springt auf den ersten Eintrag', anfangEnde.marker === '0', anfangEnde.marker);
const ende = await taste('End');
check('Ende auf den letzten wählbaren', ende.marker === '7', ende.marker);
const weg = await taste('Escape');
check('Escape schliesst, ohne zu übernehmen',
  !weg.offen && weg.wert === '4', `offen=${weg.offen}, Wert=${weg.wert}`);

// Disabled entries get SKIPPED, not landed on. Landing on one that Enter
// then refuses would be a dead end in the middle of the list - you press,
// and nothing happens.
await page.evaluate(() => window.setTerm({ tage: 0, stunden: 6, minuten: 0 }));
await page.evaluate(() => document.querySelector('#lz-tage').focus());
const bisAnsEnde = await taste('ArrowDown', 'End');
check('Ende überspringt die abgeschaltete 7', bisAnsEnde.marker === '6', bisAnsEnde.marker);
await page.keyboard.press('Escape');

// ---------------------------------------------------------------------------
console.log('\nDas Formular bleibt ruhig\n');

// The three boxes must not breathe while being set: "1" is narrower than
// "23", and a box that changes its width on every choice pushes the other
// two along with it.
const widths = await page.evaluate(() => {
  const aus = [];
  for (const w of [{ tage: 0, stunden: 0, minuten: 0 }, { tage: 1, stunden: 0, minuten: 0 },
                   { tage: 7, stunden: 0, minuten: 0 }, { tage: 3, stunden: 23, minuten: 59 }]) {
    window.setTerm(w);
    aus.push([...document.querySelectorAll('.lz-feld')]
      .map((e) => Math.round(e.getBoundingClientRect().width)).join('/'));
  }
  window.setTerm();
  return aus;
});
check('Die drei Kästen behalten ihre Breite über alle Werte',
  new Set(widths).size === 1, [...new Set(widths)].join('  |  '));

// The hint appears and disappears - and must not grow the box while doing
// so, or "Start poll" and the list below it would jump on every choice. It's
// the only spot in the form that comes and goes.
const heights = await page.evaluate(() => {
  const panel = document.querySelector('#poll-admin');
  const aus = {};
  window.setTerm({ tage: 1, stunden: 0, minuten: 0 });
  aus.mit = Math.round(panel.getBoundingClientRect().height);
  window.setTerm({ tage: 0, stunden: 0, minuten: 0 });
  aus.ohne = Math.round(panel.getBoundingClientRect().height);
  window.setTerm();
  return aus;
});
console.log(`     mit Frist ${heights.mit} px, ohne Frist ${heights.ohne} px`);
// The box deliberately GROWS here by the line of the hint. That's the
// trade: one more line is better than a form that silently creates a poll
// with no end. What must not happen is a jump on the order of a whole
// field.
check('Der Hinweis kostet höchstens eine Zeile',
  heights.ohne - heights.mit > 0 && heights.ohne - heights.mit <= 30,
  `${heights.ohne - heights.mit} px`);

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
