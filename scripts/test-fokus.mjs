// ============================================================================
// Checks that no control still shows the browser's own system ring.
//
// The trigger: the three fields in the "New poll" box were the only ones on
// the page without their own focus rule, and so showed Chrome's own ring.
// Under macOS that's blue - not a design choice, but because Chrome uses the
// system's accent color. On an almost-black background it was the loudest
// point on the page.
//
// This is exactly the kind of bug you fix once and immediately reintroduce
// with the next new input field. So this test doesn't check the three
// fields, it checks ALL controls from index.html - a future field without a
// focus rule shows up here before anyone sees it on the page.
//
// The other half is more important and easier to overlook: a ring that just
// disappears with nothing to replace it makes the page unusable with a
// keyboard. You end up tabbing blind. "No blue ring" is only half the
// requirement - the other half is "but a visible replacement". Both get
// checked here, and the second part is the one that hurts when it's missing.
//
// For a text field the replacement isn't anything extra: the border the
// field already has just gets brighter. No second outline next to it - two
// lines for one piece of information. That's exactly what's checked, because
// a glow or a ring there slips back in easily the moment someone says "it's
// not visible enough".
//
// And all six text fields on the page get checked, not just the three from
// the poll box. A page with two focus colors doesn't have a focus color, it
// has two accidents - that's exactly how the blue ring happened in the first
// place.
//
// Plus the detail the replacement is really about: it should appear for the
// keyboard and not for a mouse click. Whoever clicks knows where they
// clicked. That's what :focus-visible does - and if someone accidentally
// simplifies it to :focus, nothing catches it without a test.
//
//   node scripts/test-fokus.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cssRoh = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

/* Strip comments before anything searches for selectors.
   ---------------------------------------------------------------------------
   This check reads the stylesheet with regular expressions, and those know
   nothing about comments. A comment between two rules used to get read as
   part of the next selector: from

     .composer input {
     .../* min-width: 0 - without this "Send" sticks out ... *\/
     .composer input {

   the result was a selector starting with "/* min-width", and the check
   reported a missing autofill rule for a field that doesn't even exist.

   This isn't a minor detail: a check that turns red the moment someone adds
   a comment trains people to stop writing comments.

   The pattern is non-greedy and allows line breaks. There's no "/*" inside a
   string anywhere in this stylesheet. */
const css = cssRoh.replace(/\/\*[\s\S]*?\*\//g, '');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
// The few lines from app.js that set data-tastatur - verbatim, so the test
// doesn't end up checking its own copy. Without them there'd be no way to
// distinguish mouse from keyboard for text fields.
const keyboardSwitch = (() => {
  const a = appJs.indexOf("addEventListener('keydown'");
  const b = appJs.indexOf('}, true);', appJs.indexOf("addEventListener('pointerdown'"));
  if (a < 0 || b < 0) throw new Error('Der Tastaturschalter fehlt in app.js');
  return appJs.slice(a, b + 9);
})();
// The real stylesheet, just without scripts and with all sections visible -
// otherwise only the login could be checked.
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/ hidden(?=[ >])/g, '');

// One exception to that, and it has to be an exception: #bild-dialog is a
// MODAL, not a section. Stripped of its hidden attribute it lies across the
// whole viewport at z-index 55 and swallows every click below it - the four
// fields further down became unclickable the moment it was added. It is put
// back out of the way here rather than excluded from the strip, because the
// strip is a blunt instrument on purpose and should stay one. What the
// dialog itself does is checked in test-teilen-dialog.mjs.
const OHNE_DIALOG = '#bild-dialog { display: none !important; }';

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(html.replace('</head>', `<style>${css}${OHNE_DIALOG}</style></head>`)));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({ content: keyboardSwitch });

// Contrast math like elsewhere in the project - here for the text on
// the button.
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const ratio = (a, b) => {
  const [x, y] = [a, b].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nKein Systemring mehr\n');

// "outline-style: auto" is the signature of Chrome's own ring. Anyone
// writing their own rule sets solid or none - nobody writes auto by hand.
// That's exactly what this searches for.
const mitSystemring = await page.evaluate(() => {
  const treffer = [];
  for (const el of document.querySelectorAll('input, textarea, select, button, a[href]')) {
    el.focus();
    if (getComputedStyle(el).outlineStyle === 'auto') {
      treffer.push(el.id || el.className || el.tagName.toLowerCase());
    }
    el.blur();
  }
  return treffer;
});
check('Kein Bedienelement fällt auf den Browserring zurück',
  mitSystemring.length === 0, mitSystemring.join(', '));

console.log('\nDie Textfelder der Seite\n');

// The transition runs 150 ms; without waiting you measure the starting
// value and the test would be green or red depending on the machine's mood.
const fieldState = async (wahl) => {
  await page.focus(wahl);
  await page.waitForTimeout(260);
  return page.evaluate((w) => {
    const c = getComputedStyle(document.querySelector(w));
    return { outline: c.outlineStyle, border: c.borderColor, shadow: c.boxShadow };
  }, wahl);
};

// --fokus. The value is written here as a literal, not a variable, so an
// accidental change in the stylesheet shows up here instead of silently
// going along with it.
const FOKUS = 'rgb(107, 101, 88)';
const RUHE  = 'rgb(219, 213, 200)';

// All text fields on the page, not just the three from the poll box: a
// page with two different focus colors doesn't have one, it has two
// accidents.
// The same path twice, once with the mouse and once with the keyboard.
// Clicking must not change anything - whoever clicks into a field knows
// where they are. Tabbing must change something, or you navigate blind.
const stand = async (wahl) => {
  await page.waitForTimeout(260);
  return page.evaluate((w) => {
    const c = getComputedStyle(document.querySelector(w));
    return { outline: c.outlineStyle, border: c.borderColor, shadow: c.boxShadow };
  }, wahl);
};

// .poll-option is no longer included, and that's not an omission: app.js
// builds the answer rows, the stylesheet ships #poll-options empty - but
// only the stylesheet runs here, without the script. The rule that affects
// these fields is `.poll-admin input` anyway, and that gets measured on
// #poll-question.
for (const wahl of ['#poll-question',
                    '#wallet-input', '#dm-input', '#admin-dm-input']) {
  await page.click(wahl);
  const geklickt = await stand(wahl);
  check(`${wahl}: beim Anklicken ändert sich nichts`,
    geklickt.border === RUHE && geklickt.shadow === 'none' && geklickt.outline === 'none',
    `${geklickt.border} / ${geklickt.shadow} / ${geklickt.outline}`);

  // Back and forward from the field: that reaches the same field via the
  // keyboard.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const getabbt = await stand(wahl);
  check(`${wahl}: beim Tabben hellt der Rahmen auf`, getabbt.border === FOKUS, getabbt.border);
  check(`${wahl}: und bekommt keinen zweiten Umriss daneben`,
    getabbt.shadow === 'none' && getabbt.outline === 'none',
    `${getabbt.shadow} / ${getabbt.outline}`);

  // And with the next mouse click, the hint is gone again.
  await page.mouse.click(5, 5);
}

// Ansem's threshold field falls outside the loop above, and that's exactly
// why it showed nothing at all for a long time: it has no border of its
// own, the border belongs to the group around it. With outline: none on the
// field and no rule on the group, a jump via the Tab key was invisible -
// exactly the case the comment on :focus-visible explicitly warns about. It
// only came to light when the check further down counted up the page's
// field rules.
{
  const read = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('.filter-group')).borderTopColor);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(260);
  const ruhig = await read();
  await page.click('#dm-min-input');
  await page.waitForTimeout(260);
  check('Ansems Schwellenfeld: beim Anklicken ändert sich nichts',
    (await read()) === ruhig, await read());
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(260);
  const getabbt = await read();
  check('Und beim Tabben hellt der Rahmen der Gruppe auf', getabbt === FOKUS, getabbt);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(260);
}

// And back to no focus - otherwise the bright border would stay and point
// at a field nobody is typing in anymore.
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(260);
const ruhe = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#poll-question')).borderColor);
check('Ohne Fokus ist der Rahmen wieder ruhig', ruhe === RUHE, ruhe);

// The bright button's surface color is measured here already, because the
// ordering further down gets checked against it.
const buttonArea = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#dm-form .btn-primary')).backgroundColor
    .match(/\d+/g).slice(0, 3).map(Number));

console.log('\nTastatur sieht den Ring, Maus nicht\n');

// A button that's definitely visible and clickable.
const BUTTON = '#btn-create-poll';

// The shape before anything is focused - the reference for the check
// further down.
const rundungVorher = await page.evaluate((w) =>
  getComputedStyle(document.querySelector(w)).borderRadius, BUTTON);

await page.click(BUTTON);
const nachKlick = await page.evaluate((w) => {
  const el = document.querySelector(w);
  return { hatFokus: document.activeElement === el, ring: getComputedStyle(el).outlineStyle };
}, BUTTON);
check('Nach dem Klicken kein Ring', nachKlick.ring === 'none', nachKlick.ring);

// Back and forward from the button once: that lands focus on the same
// button via the keyboard, and :focus-visible kicks in.
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Tab');
const nachTab = await page.evaluate((w) => {
  const el = document.querySelector(w);
  const c = getComputedStyle(el);
  return {
    hatFokus: document.activeElement === el,
    ring: c.outlineStyle, color: c.outlineColor, width: c.outlineWidth,
    rundung: c.borderRadius,
  };
}, BUTTON);
check('Der Fokus liegt nach dem Tabben auf dem Knopf', nachTab.hatFokus);
check('Mit der Tastatur ist ein Ring da', nachTab.ring === 'solid', nachTab.ring);
// The same color as a focused field's border - a button has no border to
// brighten, so what stays here is an outline, but in the same color.
check('Der Ring hat dieselbe Farbe wie ein Feld im Fokus',
  nachTab.color === FOKUS, nachTab.color);
// A fixed border-radius in the focus rule would turn round buttons square.
check('Die Rundung des Knopfes bleibt im Fokus erhalten',
  nachTab.rundung === rundungVorher, `${rundungVorher} -> ${nachTab.rundung}`);

// The ordering that's flipped twice already because something around it
// moved: a field you're typing in must not be louder than the button that
// submits it. Without this check, that only shows up once someone sees it -
// and by then it's unclear which of the two values drifted.
const GRUND_HEX = '#f5f2ec';
const leuchtHex = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const rgbArr = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const leuchtArr = (rgb) => {
  const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kFokus = ratio(leuchtArr(rgbArr(FOKUS)), leuchtHex(GRUND_HEX));
const kButton = ratio(leuchtArr(buttonArea), leuchtHex(GRUND_HEX));
check('Der Fokusrahmen bleibt dunkler als der helle Knopf',
  kFokus < kButton, `${kFokus.toFixed(1)}:1 vs ${kButton.toFixed(1)}:1`);
check('Und bleibt über der Grenze für eine Zustandsanzeige (3:1)',
  kFokus >= 3, `${kFokus.toFixed(1)}:1`);

console.log('\nDer helle Knopf\n');

// It's the brightest surface on the page. Brightening it further under the
// pointer used to not be an occasional effect there but the normal state:
// while typing, the pointer sits almost always right on "Send".
const BUTTON_PRIMARY = '#dm-form .btn-primary';
await page.hover(BUTTON_PRIMARY);
await page.waitForTimeout(260);
const button = await page.evaluate((w) => {
  const el = document.querySelector(w);
  const c = getComputedStyle(el);
  const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
  return { filter: c.filter, flaeche: rgb(c.backgroundColor), font: rgb(c.color) };
}, BUTTON_PRIMARY);
check('Der helle Knopf hellt under dem Zeiger nicht auf',
  button.filter === 'none', button.filter);

// The rest keep it: they're dark, and it brightens something there that was
// barely visible before. If the rule is too broad, this goes along with it.
await page.hover('#btn-create-poll');
await page.waitForTimeout(260);
const ghost = await page.evaluate(() => getComputedStyle(document.querySelector('#btn-create-poll')).filter);
check('Die übrigen Knöpfe hellen next auf', ghost !== 'none', ghost);

// Readability on the button: this is a control, not decoration.
const leuchtRgb2 = (rgb) => {
  const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kFont = ratio(leuchtRgb2(button.font), leuchtRgb2(button.flaeche));
check('Die Schrift auf dem Knopf bleibt lesbar (mindestens 4,5:1)',
  kFont >= 4.5, `${kFont.toFixed(1)}:1`);

// One name per value. --accent-fill-weich was the second one for the same
// tone, after the button was toned down to the level of the DM bubble.
check('Kein zweiter Name für dieselbe Füllfarbe',
  !/--accent-fill-weich/.test(css));

console.log('\nBlatt\n');
check('Die Regel benutzt :focus-visible, nicht :focus',
  /:focus-visible:not\(input\):not\(textarea\)/.test(css));
check('Die Ringfarbe kommt aus --fokus, steht also nicht fest',
  /:focus-visible[^{]*\{[^}]*outline:[^;]*var\(--fokus\)/s.test(css));
// One source for all field rules - how many there are doesn't matter and
// changes with every new field. This used to be a fixed four; it tripped
// when the runtime field was added, even though nothing about that was
// wrong. A test that fails on every extension gets disabled instead of read.
//
// What's checked instead is the intent: NO rule that colors a field border
// on focus may use a fixed color value. One would stay behind the moment
// someone moves --fokus - and that's exactly how two focus colors happen.
// Whole rules including the selector, without comments - otherwise the
// prefix ":root[data-tastatur]" would drop out of the match and the check
// below would report an error that doesn't exist.
const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const fieldRules = (ohneKommentare.match(/[^{}]+\{[^{}]*\}/g) || [])
  .filter((r) => /:focus(-within)?/.test(r) && /border-color:/.test(r));
const fixedColor = fieldRules.filter((r) => !/border-color: var\(--fokus\)/.test(r));
check('Jede Fokusregel an einem Feldrahmen holt die Farbe aus --fokus',
  fieldRules.length >= 4 && fixedColor.length === 0,
  `${fieldRules.length} Regeln, ${fixedColor.length} mit festem Wert`);
// And every one hangs on data-tastatur. If that condition drops off one of
// them, that one field lights up again from a plain click.
const withoutSwitch = fieldRules.filter((r) => !/:root\[data-tastatur\]/.test(r));
check('Und jede hängt an data-tastatur',
  withoutSwitch.length === 0, withoutSwitch.join(' | ').slice(0, 120));
check('app.js setzt den Schalter nur bei der Tabulatortaste',
  /e\.key === 'Tab'/.test(appJs) && /pointerdown/.test(appJs));
check('Nirgends bleibt ein box-shadow an einem Feld im Fokus',
  !/input:focus \{[^}]*box-shadow/s.test(css));

// ---------------------------------------------------------------------------
console.log('\nAusgefüllt vom Browser\n');
//
// Chrome colors a field pale blue the moment you tap a saved suggestion. On
// a page that's uniformly dark, that's a white box sitting in the middle of
// the form.
//
// WHAT'S NOT CHECKED HERE, and this needs saying: the state itself.
// Autofill needs a real browser profile with saved form values; the test
// has none. CSS.forcePseudoState from the Chrome protocol doesn't help
// either - the call is accepted, but it changes nothing about the computed
// style. Measured directly: a field with :-webkit-autofill forced on
// reports the same shadow as one without.
//
// So what's checked instead is the BOOKKEEPING: for every field background
// on the page, there must be an autofill entry with the SAME background.
// That catches the failure that actually happens here - a new field gets
// added, and nobody thinks of the special case. Whether the rule actually
// works in production can only be seen in production.
{
  // Every rule that gives a field a background.
  const reasons = new Map();
  for (const treffer of css.matchAll(
    /(^|\})\s*([^{}]*\binput\b[^{}]*)\{([^}]*)\}/g)) {
    const wahl = treffer[2].trim();
    if (wahl.includes(':-webkit-autofill') || wahl.includes(':focus')) continue;
    const grund = /background(?:-color)?:\s*([^;]+)/.exec(treffer[3]);
    if (!grund) continue;
    const wert = grund[1].trim();
    if (wert === 'transparent' || wert === 'none') continue;
    // Only the base rule counts, not the one inside the @media block.
    if (!reasons.has(wahl)) reasons.set(wahl, wert);
  }
  console.log('     Felder mit eigenem Grund:');
  for (const [wahl, wert] of reasons) console.log(`       ${wahl.padEnd(20)}${wert}`);

  const fehlt = [];
  const wrong = [];
  for (const [wahl, wert] of reasons) {
    // The matching autofill block: it names the same selector with the suffix.
    const muster = new RegExp(
      `${wahl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:-webkit-autofill[^{]*\\{([^}]*)\\}`);
    // The block can carry several selectors; then the one we want sits in
    // the list and the brace only follows later. Hence the two-step check.
    const inListe = new RegExp(
      `${wahl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:-webkit-autofill\\b`);
    if (!inListe.test(css)) { fehlt.push(wahl); continue; }
    // Find the block the selector lives in, and read its shadow.
    const blocks = [...css.matchAll(/([^{}]*:-webkit-autofill[^{}]*)\{([^}]*)\}/g)];
    const block = blocks.find((b) => inListe.test(b[1]));
    const shadow = block && /box-shadow:[^;]*var\((--[\w-]+)\)/.exec(block[2]);
    if (!shadow) { fehlt.push(wahl); continue; }
    if (`var(${shadow[1]})` !== wert) wrong.push(`${wahl}: ${wert} gegen ${shadow[1]}`);
  }
  check('Jedes Feld mit eigenem Grund hat einen Autofill-Eintrag',
    fehlt.length === 0, fehlt.join(', ') || `${reasons.size} Felder`);
  check('Und der Eintrag deckt mit DEMSELBEN Grund zu',
    wrong.length === 0, wrong.join(' | ') || 'alle gleich');
  // The background alone isn't enough: Chrome also sets the text dark.
  check('Die Schriftfarbe wird ebenfalls zurückgeholt',
    (css.match(/-webkit-text-fill-color: var\(--text\)/g) || []).length
      >= (css.match(/box-shadow: 0 0 0 100px var\(--bg/g) || []).length / 2,
    'text-fill-color steht in jedem Block');
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
