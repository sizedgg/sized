// ============================================================================
// Checks the answer fields in the "New poll" box.
//
// There used to be two buttons here, "+ Option" and "- Option". The
// second one is gone, and a word in the placeholder takes its place:
// from the third answer on, it reads "Option 3 [optional]".
//
// Square brackets, not round ones, and that's not a matter of taste: in a
// monospace font every character occupies the same cell. A round
// parenthesis is a narrow character within that cell - measured 4 px
// glyph in a 9 px cell - so "(optional)" ends up looking like "( optional )"
// even though there's no space in the text. The square bracket fills its
// cell almost completely.
//
// The reason belongs in this test because it explains half the checks: an
// empty field was never an answer - when creating a poll it falls out
// through filter(Boolean) whether it's there or not. So the minus button
// was cleaning up something that had no consequences anyway, while
// looking like cleanup was necessary. The word says something instead
// that the button never said: that the first two fields are NOT
// optional.
//
// On top of that there's now the character limit with its counter on the
// right of the field. Why it's set at 100 and 60 isn't explained here but
// in test-poll-bild.mjs: those numbers are measured against the card
// that goes out into the world. Here it's only checked that the limit
// applies in the form and that you can see it coming - maxlength alone
// is a keyboard that eventually stops responding without a word, and
// people assume it's broken before they think of a limit.
//
// What's left are the edges:
//
//   * At MAX_OPTIONEN fields there must be no more plus. The number
//     doesn't live in this test but is read from app.js - why it's 4 is
//     explained there and in the migration: up to four answers the
//     posted image stays at 16:9 and doesn't get cropped by X, from
//     five on it does. And the plus must DISAPPEAR, not just become
//     inert: a button that sits there doing nothing makes you doubt the
//     page, not your own click.
//   * The placeholder must apply from the third field on, and at all
//     three places where such a field gets created: in the markup, when
//     adding one, and when resetting after creating a poll.
//
//   node scripts/test-poll-optionen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Verbatim from app.js - a rebuilt copy would pass the test while the
// real version is broken.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const buttons = cut('const MIN_OPTIONEN =', 'function pollFormular(offen) {');
const esc = cut('const esc =', '\n\n');

// The box straight from the real markup, not rebuilt: that way it's
// noticed if a button in it gets renamed or moved.
const panel = /<div id="poll-admin"[\s\S]*?\n {4}<\/div>/.exec(html);
if (!panel) throw new Error('poll-admin nicht in index.html gefunden');

/**
 * Deliver the box already expanded.
 *
 * Since the cleanup of the polls tab it's CLOSED by default - one line
 * instead of five, because otherwise Ansem would always have it sitting
 * in front of the list. But this is about the buttons inside it, so
 * about the open state; collapsed, they're invisible, and Playwright
 * then waits until the timeout for a click that never arrives.
 *
 * Both places have to be switched - the class on the box controls the
 * stylesheet, the hidden on the field block controls the content.
 */
const aufgeklappt = (s) => s
  .replace('class="poll-admin" hidden', 'class="poll-admin offen"')
  .replace('id="poll-admin-felder" hidden', 'id="poll-admin-felder"');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
           <body><div class="pane">${aufgeklappt(panel[0])}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);

await page.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    // esc() lives further up in app.js, with the other formatters. Without
    // it, optionField() throws, the click does nothing, and the test
    // reports "no field added" - a finding about itself instead of about
    // the page.
    ${esc}
    ${buttons}
    window.renderOptionButtons = renderOptionButtons;
    window.optionPlaceholder = optionPlaceholder;
    window.anzahl = () => document.querySelectorAll('.poll-option').length;
    window.sichtbar = (id) => !document.querySelector(id).hidden;
  `,
});

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

const stand = () => page.evaluate(() => ({
  n: window.anzahl(),
  plus: window.sichtbar('#btn-add-option'),
  platzhalter: [...document.querySelectorAll('.poll-option')].map((i) => i.placeholder),
}));
/** From the third field on, "(optional)" must be there; before that, not. */
const placeholderVotes = (liste) =>
  liste.every((t, i) => (i < 2 ? t === `Option ${i + 1}` : t === `Option ${i + 1} [optional]`));

console.log('\nAntwortfelder im "New poll"-Kasten\n');

// --- 1. Starting state -------------------------------------------------------
let s = await stand();
check('Startet mit zwei Feldern', s.n === 2, String(s.n));
check('Bei zwei Feldern gibt es ein Plus', s.plus);
// The two required fields carry NO "(optional)" - otherwise it would
// imply you could create a poll with zero answers.
check('Die ersten beiden sind nicht als optional beschriftet',
  placeholderVotes(s.platzhalter), s.platzhalter.join(' | '));

// --- 2. A third answer ------------------------------------------------
await page.click('#btn-add-option');
s = await stand();
check('Plus legt ein Feld an', s.n === 3, String(s.n));
check('Und das dritte ist als optional beschriftet',
  placeholderVotes(s.platzhalter), s.platzhalter.join(' | '));

// --- 3. No counter-button anymore ----------------------------------------------
// Explicitly checked and not just left out: whoever adds it back should
// stumble over this and find the reason in the head of this test.
check('Es gibt keinen "− Option"-Knopf mehr',
  !/id="btn-remove-option"/.test(html) && !/btn-remove-option/.test(appJs));

// --- 4. An empty field is not an answer ----------------------------------
// This is the real reason the minus button was dispensable. What's
// checked is the line that decides it - not its effect in the browser,
// since there it depends on the database.
check('Leere Felder fallen beim Anlegen heraus',
  /\$\$\('\.poll-option'\)\.map\(\(i\) => i\.value\.trim\(\)\)\.filter\(Boolean\)/.test(appJs));
// And the lower bound lives in ONE place, not as a stray 2 elsewhere.
check('Die Untergrenze kommt aus MIN_OPTIONEN',
  /options\.length < MIN_OPTIONEN/.test(appJs));

// --- 5. The upper bound -----------------------------------------------------
// The number comes from app.js and isn't duplicated here: otherwise the
// test would check its own copy and stay green if someone moves the
// limit.
const MAX_OPTIONEN = (() => {
  const m = /const MAX_OPTIONEN = (\d+);/.exec(appJs);
  if (!m) throw new Error('MAX_OPTIONEN nicht in app.js gefunden');
  return Number(m[1]);
})();
// Where "Start poll" sits, AS LONG AS the plus is still there.
const rightMargin = () => page.evaluate(() =>
  document.querySelector('#btn-create-poll').getBoundingClientRect().right);
const startVorher = await rightMargin();

// Keep clicking as long as the plus is there - a few times more than
// needed, so a broken counter doesn't run the test forever.
for (let i = 0; i < MAX_OPTIONEN + 4; i++) {
  if (!(await page.evaluate(() => window.sichtbar('#btn-add-option')))) break;
  await page.click('#btn-add-option');
}
s = await stand();
const startNachher = await rightMargin();
check(`Mehr als ${MAX_OPTIONEN} Felder gibt es nicht`, s.n === MAX_OPTIONEN, String(s.n));
check(`Bei ${MAX_OPTIONEN} Feldern verschwindet das Plus`, !s.plus);
check('Und alle zusätzlichen sind als optional beschriftet',
  placeholderVotes(s.platzhalter), s.platzhalter.slice(-2).join(' | '));
// "Start poll" must NOT move during this.
//
// This isn't a cosmetic flaw, but the worst possible moment for something
// to move: creating the last allowed answer makes the plus disappear -
// and that's exactly when you reach for "Start poll". If the button
// jumps across the row at that moment, you click into empty space.
//
// The cause would have been justify-content: space-between: with only one
// child left, that one child sits on the left. So what's measured is the
// POSITION before and after the disappearance, not the CSS rule - that
// way any other cause is caught too.
check('"Start poll" steht am rechten Rand, auch wenn das Plus verschwindet',
  Math.abs(startVorher - startNachher) < 1,
  `${Math.round(startVorher)} px → ${Math.round(startNachher)} px`);
// Counter-check: without the rule, the button would have moved.
// Otherwise this could be a measurement that sees nothing at all.
{
  const gewandert = await page.evaluate(() => {
    const row = document.querySelector('.row');
    const button = document.querySelector('#btn-create-poll');
    const vorher = button.getBoundingClientRect().right;
    // Recreate the state that the rule prevents.
    button.style.marginLeft = '0';
    row.style.justifyContent = 'space-between';
    const nachher = button.getBoundingClientRect().right;
    button.style.marginLeft = '';
    row.style.justifyContent = '';
    return Math.abs(vorher - nachher);
  });
  check('Gegenprobe: ohne die Regel wandert er wirklich',
    gewandert > 50, `${Math.round(gewandert)} px Unterschied`);
}

// And the database must enforce the same number - the form is the
// browser, and the browser is the part that can be bypassed.
const countMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830020000_antwortzahl.sql'), 'utf8');
check('Dieselbe Grenze steht als Trigger in der Datenbank',
  new RegExp(`having count\\(\\*\\) > ${MAX_OPTIONEN}`).test(countMigration)
  && /create or replace trigger trg_poll_options_anzahl/.test(countMigration));

// --- 6. After creating a poll ----------------------------------
// The box gets reset: values cleared, extra fields removed. This
// recreates exactly the lines from btn-create-poll.
//
// This spot is trickier than it looks: if a field that once said
// "Option 5 (optional)" is left standing here, "(optional)" ends up
// on one of the two required fields afterward.
await page.evaluate(() => {
  document.querySelectorAll('#poll-options > .zaehl-feld').forEach((panel, idx) => {
    const field = panel.querySelector('.poll-option');
    if (idx >= 2) { panel.remove(); return; }
    field.value = '';
    field.dispatchEvent(new Event('input'));
  });
  document.querySelector('#poll-question').value = '';
  document.querySelector('#poll-question').dispatchEvent(new Event('input'));
  window.renderOptionButtons();
});
s = await stand();
check('Nach dem Zuruecksetzen stehen wieder zwei Felder', s.n === 2, String(s.n));
check('Das Plus ist da', s.plus);
check('Und die Platzhalter stehen wieder richtig',
  placeholderVotes(s.platzhalter), s.platzhalter.join(' | '));
// The BOX gets removed, not just the field inside it - otherwise a
// "0 / 60" would be left standing without a field under it.
check('Und es bleibt kein Zähler ohne Feld zurück',
  await page.evaluate(() =>
    document.querySelectorAll('.zaehler').length
      === document.querySelectorAll('.zaehl-feld > input').length));

// --- 7. The brackets ------------------------------------------------------
//
// Five checks used to stand here about a second label that sat above the
// field, in which the round parentheses got their own, narrower cell.
// It's gone again: swapping one character does the same thing and costs
// nothing.
//
// So all that's checked now is the character itself - and specifically
// because it's easily reverted as a matter of taste. It isn't one.
// What's searched for is the string that ACTUALLY goes into the field -
// not just any "(optional)" somewhere in the file. The comment right
// above it explains why round ones are wrong and therefore contains them
// itself; a test that searches the whole file would trip over that and
// report an error that doesn't exist.
const gesetzt = (appJs.match(/`Option \$\{nr\}[^`]*`/g) || []);
check('Es sind eckige Klammern, keine runden',
  gesetzt.some((t) => t.includes('[optional]'))
  && !gesetzt.some((t) => t.includes('(optional)')),
  gesetzt.join(' , ') || 'nichts gefunden');

// --- 8. The character limit ---------------------------------------------------
//
// Why the numbers are 100 and 60 is explained in test-poll-bild.mjs: they
// are measured against the card that goes out into the world. Here it's
// only about the form - about the limit being THERE and being visible as
// it approaches.
//
// The counter is the actual point. maxlength alone is a keyboard that
// eventually stops responding without a word; people assume it's broken
// before they think of a limit.
console.log('\nDie Zeichengrenze in den Feldern\n');

const grenzeAus = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(appJs);
  if (!m) throw new Error(`${name} nicht in app.js gefunden`);
  return Number(m[1]);
};
const MAX_QUESTION = grenzeAus('MAX_QUESTION');
const MAX_ANSWER = grenzeAus('MAX_ANSWER');

const fieldState = (wahl) => page.evaluate((w) => {
  const field = document.querySelector(w);
  const panel = field.closest('.zaehl-feld');
  const zaehler = panel.querySelector('.zaehler');
  return {
    max: field.maxLength,
    text: zaehler.textContent,
    knapp: panel.classList.contains('ist-knapp'),
    full: panel.classList.contains('ist-voll'),
    sichtbar: getComputedStyle(zaehler).visibility === 'visible',
    color: getComputedStyle(zaehler).color,
    // The space on the right must ALWAYS be free, even when the number
    // isn't showing right now. Otherwise the text under the cursor would
    // jump away the moment you enter the field.
    platzRechts: parseFloat(getComputedStyle(field).paddingRight),
  };
}, wahl);

const type = (wahl, text) => page.evaluate(([w, t]) => {
  const field = document.querySelector(w);
  field.value = t.slice(0, field.maxLength);
  field.dispatchEvent(new Event('input'));
}, [wahl, text]);

for (const [wahl, max, name] of [
  ['#poll-question', MAX_QUESTION, 'Die Frage'],
  ['.poll-option', MAX_ANSWER, 'Eine Antwort'],
]) {
  let f = await fieldState(wahl);
  check(`${name}: maxlength steht auf ${max}`, f.max === max, String(f.max));
  check(`${name}: der Zähler steht auf 0 / ${max}`, f.text === `0 / ${max}`, f.text);
  // Empty and untouched: silent. Ten fields with ten numbers next to
  // them would be a jumble of digits next to a row of empty fields.
  check(`${name}: im clear Feld ist er unsichtbar`, !f.sichtbar);
  check(`${name}: der Platz right ist trotzdem frei`,
    f.platzRechts > 60, `${f.platzRechts} px`);

  await type(wahl, 'x'.repeat(max - 20));
  f = await fieldState(wahl);
  check(`${name}: bei ${max - 20} Zeichen ist noch nichts knapp`, !f.knapp && !f.full);

  // Tight means: the last ten characters. And from there the number is
  // visible even WITHOUT focus - someone who pastes in a long text and
  // clicks away shouldn't have to click back in just to notice.
  await type(wahl, 'x'.repeat(max - 10));
  f = await fieldState(wahl);
  check(`${name}: bei zehn übrigen Zeichen wird es knapp`, f.knapp && !f.full);
  check(`${name}: und der Zähler ist ab da auch ohne Fokus zu sehen`, f.sichtbar);

  const knappFarbe = f.color;
  await type(wahl, 'x'.repeat(max + 50));
  f = await fieldState(wahl);
  check(`${name}: mehr als ${max} Zeichen gehen nicht hinein`,
    f.text === `${max} / ${max}`, f.text);
  check(`${name}: und das Feld ist als full gekennzeichnet`, f.full);
  check(`${name}: die Zahl wechselt dabei die Farbe`,
    f.color !== knappFarbe, `${knappFarbe} → ${f.color}`);

  await type(wahl, '');
}

// Counter-check: the counter really is tied to the field and isn't just
// a piece of markup that happened to carry the right number.
{
  await type('#poll-question', 'abc');
  const f = await fieldState('#poll-question');
  check('Gegenprobe: der Zähler folgt dem Feld', f.text === `3 / ${MAX_QUESTION}`, f.text);
  await type('#poll-question', '');
}

// And the limit must also live in the database. The browser is the part
// that can be bypassed; PostgREST accepts any insert that gets past the
// row policies.
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830010000_laengen.sql'), 'utf8');
check('Dieselbe Grenze steht in der Datenbank – für die Frage',
  new RegExp(`btrim\\(question\\)\\) between 1 and ${MAX_QUESTION}`).test(migration));
check('Und für die Antworten',
  new RegExp(`btrim\\(label\\)\\) between 1 and ${MAX_ANSWER}`).test(migration));

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
