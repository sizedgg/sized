// ============================================================================
// Checks how the polls tab looks: few panels, and an admin box that only
// shows up when it's needed.
//
// ----------------------------------------------------------------------------
// Why this COUNTS PANELS instead of comparing colors
//
// The tab had four panels stacked on top of each other - page background,
// card, answer row, border - with steps of 1.05 / 1.09 / 1.14:1. The
// problem was never the tones themselves, but their number at too-small
// gaps: you see that something changes, but not that it means anything.
//
// A test that pins down the hex values wouldn't notice any of that - you
// could swap in four new grays and keep the same problem. So this test
// measures what actually matters: how many DISTINGUISHABLE gray panels
// actually occur in the rendered tab, and how far each one stands out
// from the ground it sits on. Measured against the real elements in the
// browser, not the sheet - a rule later overridden by another would
// otherwise still count.
//
// The leading answer's blue does NOT count as another panel here. It's
// not a layer in the structure, it's a signal with exactly one meaning;
// the rule above targets near-identical grays, and a color is the
// opposite of that.
//
// ----------------------------------------------------------------------------
// And why readability gets checked here too
//
// The bar fill is measured from X, opaque, and there are two: gray for
// normal answers, blue for the leading one. That's the kind of change
// that shifts something nearby without anyone having thought about it:
// the answer text and the vote amount sit on top of the fill. The vote
// amount here once sat at 1.3:1 and was invisible - and switching to X's
// colors would have landed it at 3.99:1 on the blue, if it hadn't been
// measured here.
//
//   node scripts/test-polls-tab.mjs
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
const zeit = cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;');
const line = cut('const BALD_MS =', 'let fristT = null;');
// Who gets marked as leading - and that this only happens after closing.
// The calculation lives in ONE place in app.js, because the list and the
// shared image could otherwise drift apart.
const leading = cut('const leadingShare =', '\nasync function drawPoll');
const markup = cut('function pollHtml(p) {', 'async function deletePoll(id) {');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const escFn = cut('const esc = (s) =>', '\n\n');
const symbole = cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;');
// Note: this cut only ends right before FRIST_VORGABE, and so it also
// picks up the button's click listener registration. That's deliberate -
// the test should check the REAL path from click to state, not a rebuilt
// one. Registering a second listener here on top would toggle twice on
// every click and end up measuring nothing at all.
const toggleSource = cut('function pollFormClear()', 'function observeHeaderHeight() {');
// The fields with their counters and the "+ Option" button - and the
// duration.
//
// Neither used to be included, because pollFormular() didn't need them.
// Since closing became a cancel, it calls setTerm() and clears the
// answer fields; without these two cuts the test would run into an error
// instead of a check.
const fields = cut('const MIN_OPTIONEN =', 'function pollFormClear() {');
const laufzeit = cut('const LZ_MAX_MINUTEN =', "\n$('#btn-create-poll')");
// The observer that maintains the header height - taken literally,
// because the empty-state hint's position depends on it.
const beobachter = cut('function observeHeaderHeight()', 'const LZ_MAX_MINUTEN = 7 * 24 * 60;');
// The sentence itself from app.js, not retyped.
const emptyText = /list\.innerHTML = '(<div class="empty">[^']*<\/div>)'/.exec(appJs)?.[1];
if (!emptyText) throw new Error('Der Hinweis auf die leere Liste sieht anders aus als erwartet');

// The box from the real sheet, not rebuilt.
const panel = /<div id="poll-admin"[\s\S]*?\n    <\/div>/.exec(html);
if (!panel) throw new Error('Das Anlegeformular fehlt in index.html');

// And the list too. It used to be a retyped line here, and when it got a
// border in the sheet, the copy in the test still had none - the test was
// measuring a list that didn't actually exist that way.
const liste = /<div id="poll-list"[^>]*><\/div>/.exec(html);
if (!liste) throw new Error('Die Abstimmungsliste fehlt in index.html');


const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8">
       <!-- The viewport line here is not decoration, it's a requirement.
            Without it a browser in mobile mode internally computes with
            about 980px and scales the result down: @media (max-width:
            760px) then does NOT apply. A check at 375px would in that
            case silently measure the desktop layout and would always be
            green. The real sheet has this line too - it was only missing
            here because nothing had measured the phone up to that point. -->
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <style>${css}</style>
       <body style="margin:0">
       <!-- The height has to come from outside like on the real page:
            .pane is flex:1 and without a column of fixed height has
            nowhere to center anything in. Without this, what gets
            measured further down is the middle of a panel that doesn't
            actually exist. -->
       <div style="display:flex;flex-direction:column;height:100vh;background:var(--bg)">
       <main class="pane" id="pane-polls" style="background:var(--bg);padding:14px">
       ${panel[0].replace('class="poll-admin" hidden', 'class="poll-admin"')}
       ${liste[0]}</main></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: true }, polls: [] };
    const toast = () => {};
    ${escFn}
    ${formate}
    ${symbole}
    ${zeit}
    ${line}
    ${leading}
    ${markup}
    ${fields}
    ${toggleSource}
    ${laufzeit}
    window.pollFormular = pollFormular;
    window.chosenDeadlineMinutes = chosenDeadlineMinutes;
    $('#poll-list').innerHTML = [
      { id: 1, closed: false, myOptionId: 2, totalVotes: 191, totalUsd: 781420,
        closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
        question: 'Should we open the token gate to smaller holders?',
        options: [{ id: 1, label: 'Ship it this week', votes: 128, usd: 482900, share: .618 },
                  { id: 2, label: 'Wait for the audit', votes: 63, usd: 298520, share: .382 }] },
      { id: 2, closed: true, myOptionId: null, totalVotes: 240, totalUsd: 998400,
        closesAt: null, question: 'Should the DM minimum go up?',
        options: [{ id: 3, label: 'Yes, to $50', votes: 96, usd: 612000, share: .613 },
                  { id: 4, label: 'No, leave it', votes: 144, usd: 386400, share: .387 }] },
    ].map(pollHtml).join('');
    // Kept around so the list can be built once more further down, as a
    // user instead of as Ansem - the pointer rule depends on that.
    window.__pollDaten = [
      { id: 1, closed: false, myOptionId: 2, totalVotes: 191, totalUsd: 781420,
        closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
        question: 'Should we open the token gate to smaller holders?',
        options: [{ id: 1, label: 'Ship it this week', votes: 128, usd: 482900, share: .618 },
                  { id: 2, label: 'Wait for the audit', votes: 63, usd: 298520, share: .382 }] },
    ];
    window.__pollHtml = pollHtml;`,
});

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (rgb) => { const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b); };
const kon = (a, b) => { const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05); };
const numbers = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

// ---------------------------------------------------------------------------
console.log('\nDie Flächen im Tab\n');

// Measured against the real elements. Transparent panels count as
// whatever's visible through them - that's exactly how the eye sees it
// too.
const measured = await page.evaluate(() => {
  const sichtbar = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const f = getComputedStyle(e).backgroundColor;
      const [r, g, b, a] = (f.match(/[\d.]+/g) || []).map(Number);
      if (a === undefined || a > 0.9) return `rgb(${r}, ${g}, ${b})`;
    }
    return 'rgb(0, 0, 0)';
  };
  const stellen = {
    Seite: document.querySelector('#pane-polls'),
    Karte: document.querySelector('.poll'),
    Anlegekasten: document.querySelector('.poll-admin'),
    Antwortzeile: document.querySelector('.opt-bar'),
  };
  const aus = {};
  for (const [n, el] of Object.entries(stellen)) aus[n] = sichtbar(el);
  const bar = document.querySelector('.opt-bar');
  aus.Rand = getComputedStyle(bar).borderTopColor;
  // The fill. It used to be translucent and had to be blended with
  // whatever sat underneath; since it took on X's values it's opaque -
  // and there are two: the leading answer is blue.
  const fillingFor = (sel) => {
    const f = getComputedStyle(document.querySelector(sel)).backgroundColor;
    const [fr, fg, fb, fa] = (f.match(/[\d.]+/g) || []).map(Number);
    if (fa === undefined || fa > 0.99) return `rgb(${fr}, ${fg}, ${fb})`;
    const under = (aus.Antwortzeile.match(/\d+/g) || []).map(Number);
    return 'rgb(' + [fr, fg, fb].map((c, i) =>
      Math.round(fa * c + (1 - fa) * under[i])).join(', ') + ')';
  };
  aus.Fuellung = fillingFor('.opt:not(.leads) .opt-fill');
  aus.FuellungSpitze = fillingFor('.opt.leads .opt-fill');
  return aus;
});

for (const [n, w] of Object.entries(measured)) console.log(`     ${n.padEnd(16)}${w}`);

const areas = ['Seite', 'Karte', 'Anlegekasten', 'Antwortzeile'].map((n) => measured[n]);
const eindeutig = [...new Set([...areas, measured.Rand, measured.Fuellung])]
  .map(numbers).sort((a, b) => leucht(a) - leucht(b));

// The card has its own panel fill again - the same as the downloadable
// image. The admin box and the answer row still have none: the box sits
// on the page background, the row on the card.
check('Die Karte hat eine eigene Fläche, der Anlegekasten nicht',
  measured.Karte !== measured.Seite && measured.Anlegekasten === measured.Seite,
  `Karte ${measured.Karte}, Kasten ${measured.Anlegekasten}`);
check('Und die Antwortzeile auch nicht – sie liegt auf der Karte',
  measured.Antwortzeile === measured.Karte,
  `${measured.Antwortzeile} auf ${measured.Karte}`);

// Four instead of three like before, and this is the point to watch: at
// five the tab was already unreadable once. The fourth was deliberately
// brought back because the page and the download image would otherwise
// show two different things - not because a layer was missing.
check('Höchstens vier unterscheidbare graue Flächen im Tab', eindeutig.length <= 4,
  `${eindeutig.length}`);

// The actual point of this section, and the reason the steps are checked
// INDIVIDUALLY instead of as a chain:
//
// The chain used to be enough, because every tone sat stacked on top of
// the last. Since the fill took on X's gray, that's no longer true.
// --line and the fill sit 1.17:1 apart, so practically the same
// lightness - a chain would flag that as an error, and it would be
// wrong. The two don't actually sit on top of each other, they sit SIDE
// BY SIDE:
//
//   on the filled part   the border disappears into the fill
//                         -> the bar looks borderless, just like on X
//   on the empty part    it stands against the page background
//
// Both are intentional. So what gets checked is what a human actually
// sees: each panel against the ground it's actually resting on.
const gegen = (was, grund) => kon(numbers(measured[was]), numbers(measured[grund]));
check('Der Rand hebt sich vom Seitengrund ab', gegen('Rand', 'Seite') >= 1.25,
  `${gegen('Rand', 'Seite').toFixed(2)}:1`);
// And from the card it rests against on the inside - otherwise it only
// carries the answer row's shape outward and not inward.
check('Und von der Karte', gegen('Rand', 'Karte') >= 1.25,
  `${gegen('Rand', 'Karte').toFixed(2)}:1`);

// The card itself barely stands out at all - 1.05:1 against the page
// background. That's not an oversight and not a violation of the rule
// above either: the boundary is carried by the border, not the fill. The
// downloadable image does exactly the same, and nobody's ever missed it
// there.
//
// So what's checked is the OR condition, not the fill alone: a panel has
// to either stand out on its own, or be framed by a border that does. If
// someone one day removes the card's border, this catches it.
const cardAlone = gegen('Karte', 'Seite');
check('Die Karte setzt sich ab – notfalls über ihren Rand',
  cardAlone >= 1.25 || gegen('Rand', 'Seite') >= 1.25,
  `Fläche ${cardAlone.toFixed(2)}:1, Rand ${gegen('Rand', 'Seite').toFixed(2)}:1`);

// The edge where the share ends has to stay visible - otherwise the bar
// stops telling anything. Measured against the CARD, because that's where
// the fill sits now that the card has its own panel fill again.
//
// The threshold has been lowered twice, both times for a reason:
//   1.90  -> old, translucent fill, measured 1.95:1
//   1.55  -> X's gray on the page background, 1.62:1
//   1.50  -> the same gray on the brighter card, 1.54:1
// This last step is the price for the page and the download image now
// showing the same thing: it's exactly the value the image always had.
check('Die Kante der Füllung bleibt sichtbar', gegen('Fuellung', 'Karte') >= 1.5,
  `${gegen('Fuellung', 'Karte').toFixed(2)}:1`);
check('Die der führenden erst recht', gegen('FuellungSpitze', 'Karte') >= 1.5,
  `${gegen('FuellungSpitze', 'Karte').toFixed(2)}:1`);

// And the blue has to actually be a blue. Lightness alone says almost
// nothing (the two fills sit 1.67:1 apart) - the statement "this one is
// leading" is carried by the hue. A blue that gets desaturated into yet
// another gray shows up here; a lightness comparison alone would let it
// through.
const [gr, gg, gb] = numbers(measured.Fuellung);
const [br, bg2, bb] = numbers(measured.FuellungSpitze);
const spreizung = (rgb) => Math.max(...rgb) - Math.min(...rgb);
check('Die führende Füllung ist eine Farbe und kein weiteres Grau',
  spreizung([br, bg2, bb]) - spreizung([gr, gg, gb]) >= 25,
  `Spreizung ${spreizung([br, bg2, bb])} gegen ${spreizung([gr, gg, gb])}`);

// ---------------------------------------------------------------------------
console.log('\nWas auf der Füllung steht\n');

const font = await page.evaluate(() => ({
  label: getComputedStyle(document.querySelector('.opt-label')).color,
  // The amount sits on the right and gets reached by the leading
  // answer's bar - making it the second piece of text sitting on the
  // fill.
  amount: getComputedStyle(document.querySelector('.opt-num .held')).color,
  // Whatever else sits in this column - once a vote count, then a
  // percentage, both small and so the stricter case. Currently nothing;
  // the check below then gets skipped instead of silently passing.
  zweite: (() => {
    const el = document.querySelector('.opt-num > :not(.held)');
    return el ? getComputedStyle(el).color : null;
  })(),
}));
// Both fills, and the worse case is what counts. The blue is brighter
// than the gray, so text on it has less headroom - and of all places,
// that's exactly where the bar runs furthest to the right, under the
// numbers.
const fillUp = (color) => Math.min(
  kon(numbers(color), numbers(measured.Fuellung)),
  kon(numbers(color), numbers(measured.FuellungSpitze)));
const beide = (color) => `Grau ${kon(numbers(color), numbers(measured.Fuellung)).toFixed(1)}:1, `
  + `Blau ${kon(numbers(color), numbers(measured.FuellungSpitze)).toFixed(1)}:1`;
check('Der Antworttext bleibt auf beiden Füllungen lesbar (mindestens 4,5:1)',
  fillUp(font.label) >= 4.5, beide(font.label));
// The vote count used to sit here, with its own, lower threshold - it was
// secondary information and was allowed to be fainter. It's gone now,
// with nothing to replace it: splitting 100k across ten wallets changes
// nothing about the amount, but turns one vote into ten. What's left is
// the amount, and it's no longer secondary information - it's the
// result - so the same threshold applies to it as to the text.
check('Der Betrag auch', fillUp(font.amount) >= 4.5, beide(font.amount));
// If something else sits there again - a percentage, say - the same
// threshold applies to it, and a stricter one at that, because it's set
// smaller. If nothing sits there, that's stated rather than silently
// skipped: a check that hits a missing element and reports "ok" is
// exactly the kind that stops noticing anything later on.
if (font.zweite) {
  check('Was daneben steht auch', fillUp(font.zweite) >= 4.5,
    beide(font.zweite));
} else {
  console.log('  –  Neben dem Betrag steht nichts, nichts zu prüfen');
}
// What must NOT reappear here is the vote count. Not because of color:
// splitting 100k across ten wallets changes nothing about the amount, but
// turns one vote into ten.
check('Und es ist jedenfalls keine Stimmenzahl',
  !/class="votes"|>\s*\$\{[^}]*votes/.test(appJs));

// ---------------------------------------------------------------------------
console.log('\nBlau erst nach dem Schliessen\n');
//
// The list contains both: poll 1 is running, poll 2 is closed. Both have
// a clearly leading answer. As long as one is running, it must have no
// marked answer - the bar lengths already say where things stand, and a
// color on top of that turns it into a nudge for the next voter.
const markierung = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.poll')];
  return cards.map((k) => ({
    id: k.id,
    zu: Boolean(k.querySelector('.closed-tag')),
    markiert: k.querySelectorAll('.opt.leads').length,
    // The second styling depends on the same class too: the bolder
    // answer. Measured rather than inferred from the markup.
    fett: [...k.querySelectorAll('.opt-label')]
      .map((e) => Number(getComputedStyle(e).fontWeight)),
  }));
});
for (const k of markierung) {
  console.log(`     ${k.id.padEnd(8)} ${k.zu ? 'zu    ' : 'running'} `
    + `markiert: ${k.markiert}, Schriftschnitte: ${k.fett.join('/')}`);
}
const laufend = markierung.find((k) => !k.zu);
const beendet = markierung.find((k) => k.zu);
check('Vorprobe: die Liste enthält eine laufende und eine geschlossene',
  Boolean(laufend && beendet));
check('Die laufende hat keine markierte Antwort',
  laufend.markiert === 0, `${laufend.markiert} markiert`);
check('Und auch keine fettere – die hängt an derselben Klasse',
  new Set(laufend.fett).size === 1, laufend.fett.join('/'));
// Without this counter-check, everything above would still be green even
// if the marking were never applied at all anymore.
check('Die geschlossene hat genau eine',
  beendet.markiert === 1, `${beendet.markiert} markiert`);
check('Und die steht dort fetter als ihre Nachbarin',
  Math.max(...beendet.fett) > Math.min(...beendet.fett), beendet.fett.join('/'));

// ---------------------------------------------------------------------------
console.log('\nZeiger und eigene Stimme\n');
//
// Two signals that used to both be the BORDER: lighting up under the
// pointer, white on the answer you voted for. But the border already
// draws the row's shape - one signal for three meanings ends up saying
// none of them. Now the pointer carries the fill, and your own vote gets
// a checkmark in the text.
//
// The list gets built once more as a USER for this. As Ansem, every
// answer gets .locked, and the pointer rule doesn't apply at all - you'd
// measure that nothing changes and mistake that for a pass.
await page.evaluate(() => {
  state.me.isAdmin = false;
  document.querySelector('#poll-list').innerHTML =
    window.__pollDaten.map(window.__pollHtml).join('');
});

const optLine = async (sel) => page.evaluate((s) => {
  const bar = document.querySelector(`${s} .opt-bar`);
  const st = getComputedStyle(bar);
  // At rest the row has no fill of its own at all - what gets reported
  // is rgba(0, 0, 0, 0). Taking that as a color compares it against
  // BLACK and reports a jump of 1.31:1 where the real value is 1.17:1.
  // Transparent counts here as whatever's visible through the row -
  // that's exactly how the eye sees it too.
  const sichtbar = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const f = getComputedStyle(e).backgroundColor;
      const [r, g, b, a] = (f.match(/[\d.]+/g) || []).map(Number);
      if (a === undefined || a > .9) return `rgb(${r}, ${g}, ${b})`;
    }
    return 'rgb(0, 0, 0)';
  };
  return { grund: sichtbar(bar), margin: st.borderTopColor,
    fuellung: getComputedStyle(document.querySelector(`${s} .opt-fill`)).backgroundColor };
}, sel);

const ruhe = await optLine('.opt:not(.mine)');
await page.hover('.opt:not(.mine) .opt-bar');
await page.waitForTimeout(300);
const subPointer2 = await optLine('.opt:not(.mine)');
await page.mouse.move(0, 0);
await page.waitForTimeout(300);

// Not just "brighter", but measurably brighter. The number dropped when
// the card got its panel fill back: the hover background (--bg-3) now
// stands against the card instead of the page background, so 1.17:1
// instead of 1.22:1. If that ever gets too subtle, the next step up is
// --line (1.33:1) - but then the row's border disappears into the hover
// background.
const pointerJump = kon(numbers(subPointer2.grund), numbers(ruhe.grund));
check('Unter dem Zeiger wird der Grund der Zeile messbar heller',
  leucht(numbers(subPointer2.grund)) > leucht(numbers(ruhe.grund)) && pointerJump >= 1.15,
  `${ruhe.grund} → ${subPointer2.grund}, ${pointerJump.toFixed(2)}:1`);
// The actual point: the border stays as it is.
check('Und der Rand leuchtet dabei nicht auf',
  subPointer2.margin === ruhe.margin, `${ruhe.margin} → ${subPointer2.margin}`);
// And neither does the fill - that's the measured decision from the
// sheet: brightening it pushes the vote count on the blue below 4.5:1.
check('Die Füllung bleibt unangetastet',
  subPointer2.fuellung === ruhe.fuellung, `${ruhe.fuellung} → ${subPointer2.fuellung}`);

const eigene = await optLine('.opt.mine');
check('Die eigene Stimme bekommt keinen eigenen Rahmen mehr',
  eigene.margin === ruhe.margin, `${eigene.margin} gegen ${ruhe.margin}`);

const haken = await page.evaluate(() => {
  const m = document.querySelector('.opt.mine .opt-haken');
  const andere = document.querySelector('.opt:not(.mine) .opt-haken');
  if (!m) return { da: false };
  return {
    da: true, beiAnderen: !!andere,
    versteckt: m.getAttribute('aria-hidden') === 'true',
    color: getComputedStyle(m).color,
    textfarbe: getComputedStyle(m.closest('.opt-label')).color,
    gesprochen: (document.querySelector('.opt.mine .nur-vorlesen')?.textContent ?? '').trim(),
    // Visible means: actually has a rendered size. An SVG with no size
    // is present in the DOM and still invisible.
    wide: Math.round(m.getBoundingClientRect().width),
  };
});
check('Die eigene Stimme trägt einen Haken', haken.da && haken.wide >= 10,
  `${haken.wide} px wide`);
check('Und nur sie', haken.da && !haken.beiAnderen);
// currentColor instead of its own value: this way the checkmark reads
// just as well on any fill as the answer text next to it does.
check('Er nimmt seine Farbe vom Text daneben',
  haken.color === haken.textfarbe, `${haken.color} gegen ${haken.textfarbe}`);
// An image means nothing to a screen reader, and a spoken-out "checkmark"
// would tell it the wrong thing.
check('Für das Auge ein Bild, für die Vorlesestimme ein Satz',
  haken.versteckt && /your vote/i.test(haken.gesprochen), haken.gesprochen);

// ---------------------------------------------------------------------------
console.log('\nDer Anlegekasten\n');

const stand = () => page.evaluate(() => {
  const k = document.querySelector('#poll-admin');
  return {
    offen: k.classList.contains('offen'),
    fields: !document.querySelector('#poll-admin-felder').hidden,
    // The duration used to sit in the header and had to be specifically
    // hidden there when collapsed, without losing its spot. Since it
    // moved down into the box, it now disappears along with the rest -
    // and that's exactly what's checked: it belongs to the collapsible
    // part, not sitting off to the side of it.
    frist: (() => {
      const b = document.querySelector('.lz-block');
      return !!b && b.closest('#poll-admin-felder') !== null
        && b.getBoundingClientRect().height > 0;
    })(),
    sagt: document.querySelector('#btn-poll-neu').getAttribute('aria-expanded'),
    height: Math.round(k.getBoundingClientRect().height),
    rahmen: getComputedStyle(k).borderTopColor,
    // The toggle's own position, to two decimal places.
    button: (({ x, y }) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }))
      (document.querySelector('#btn-poll-neu').getBoundingClientRect()),
  };
});
// Transparent means alpha 0 - the browser reports "transparent" as
// rgba(0, 0, 0, 0), not as the word itself.
const durchsichtig = (f) => /rgba\([^)]*,\s*0\s*\)/.test(f);

const zu = await stand();
check('Er ist von Anfang an zugeklappt', !zu.offen && !zu.fields, JSON.stringify(zu.offen));
check('Die Laufzeit ist dann auch weg', !zu.frist);
check('Und sie steckt im aufklappbaren Teil, nicht in der Kopfzeile',
  /<div class="lz-block"[\s\S]*?<\/div>/.test(
    /<div id="poll-admin-felder"[\s\S]*?\n {6}<\/div>/.exec(html)?.[0] ?? ''));
check('Und er sagt es auch so', zu.sagt === 'false', String(zu.sagt));
// Collapsed, no box may be VISIBLE at all: a border around a single line
// implies content that isn't there.
check('Zugeklappt ist kein Rahmen zu sehen', durchsichtig(zu.rahmen), zu.rahmen);

await page.click('#btn-poll-neu');
await page.waitForTimeout(250);
const auf = await stand();
check('Ein Tipp klappt ihn auf', auf.offen && auf.fields);
check('Dann ist auch die Laufzeit da', auf.frist);
check('Und er sagt es', auf.sagt === 'true', String(auf.sagt));
check('Der Rahmen kommt zurück', !durchsichtig(auf.rahmen), auf.rahmen);

// The actual point of this version: the toggle stays exactly where it is.
// If the border and padding were removed when collapsed, "NEW POLL" would
// jump right and down on opening - the thing you just tapped would slide
// out from under your finger. One pixel of tolerance for rounding
// sub-pixels, nothing more.
check('Der Schalter steht auf und zu an derselben Stelle',
  Math.abs(zu.button.x - auf.button.x) <= 1 && Math.abs(zu.button.y - auf.button.y) <= 1,
  `zu (${zu.button.x}, ${zu.button.y}) → auf (${auf.button.x}, ${auf.button.y})`);
// And it sits on the same vertical line as the questions below it.
//
// This was broken for one whole round: the border sat on the list alone,
// its padding pushed the cards to the right, and the toggle stayed put.
// Since the border now wraps the whole tab, the admin box and the cards
// share the same padding and both carry 1.1rem - the line lines up again,
// and for a reason this time instead of by accident.
const flush = await page.evaluate(() => {
  const a = document.querySelector('#btn-poll-neu').getBoundingClientRect().x;
  const b = document.querySelector('.poll h4').getBoundingClientRect().x;
  return Math.abs(a - b);
});
check('Und auf einer Linie mit den Fragen in der Liste', flush <= 1,
  `${flush.toFixed(2)} px`);

check('Der Sprung geht ins first Feld',
  await page.evaluate(() => document.activeElement?.id === 'poll-question'),
  await page.evaluate(() => document.activeElement?.id));

// The gain this is all about - measured, not claimed.
check('Zugeklappt braucht er deutlich weniger Platz',
  zu.height * 3 < auf.height, `${zu.height} px statt ${auf.height} px`);

await page.click('#btn-poll-neu');
await page.waitForTimeout(250);
check('Und ein zweiter Tipp klappt ihn wieder zu', !(await stand()).offen);

// ---------------------------------------------------------------------------
console.log('\nZuklappen ist ein Abbruch\n');
//
// The box has no "Cancel" button - collapsing IS the cancel. So it has to
// look, the next time it's opened, exactly as it did the very first time,
// not like a half-filled-out form from the day before yesterday.
//
// This is checked via the button, not via pollFormular(false): the path
// Ansem actually takes is the click. A direct call would produce the same
// state and still wouldn't show that the button actually triggers it.
const populate = async () => {
  // Open it if it's closed - and don't just toggle it: the button
  // toggles, and a second call would close it again.
  if (!(await stand()).offen) await page.click('#btn-poll-neu');
  await page.waitForTimeout(120);
  await page.fill('#poll-question', 'Should the DM minimum go up again?');
  const fieldsNow = await page.$$('.poll-option');
  await fieldsNow[0].fill('Yes');
  await fieldsNow[1].fill('No');
  // Open it all the way: the extra fields are the part that "clearing
  // the texts" alone does NOT catch.
  await page.click('#btn-add-option');
  await page.click('#btn-add-option');
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    const f = document.querySelectorAll('.poll-option');
    f[2].value = 'Maybe';
    f[2].dispatchEvent(new Event('input'));
    // And a duration that isn't the default.
    document.querySelector('#lz-stunden').dataset.wert = '6';
    document.querySelector('#lz-tage').dataset.wert = '3';
  });
};

await populate();
const full = await page.evaluate(() => ({
  pollQuestion: document.querySelector('#poll-question').value,
  fields: document.querySelectorAll('.poll-option').length,
  minuten: window.chosenDeadlineMinutes(),
}));
check('Vorprobe: es steht wirklich etwas drin',
  full.pollQuestion.length > 0 && full.fields === 4 && full.minuten === 3 * 1440 + 360,
  `${full.fields} Felder, ${full.minuten} Minuten`);

await page.click('#btn-poll-neu');       // close = cancel
await page.waitForTimeout(150);
await page.click('#btn-poll-neu');       // and open again
await page.waitForTimeout(250);

const neu = await page.evaluate(() => ({
  pollQuestion: document.querySelector('#poll-question').value,
  antworten: Array.from(document.querySelectorAll('.poll-option')).map((f) => f.value),
  // The counters are tied to the fields and only get updated by an input
  // event. Setting value doesn't fire one - skip it and an empty field
  // would still show "37 / 60" next to it.
  zaehler: Array.from(document.querySelectorAll('#poll-options .zaehler'))
    .map((z) => z.textContent),
  frageZaehler: document.querySelector('.zaehl-feld:has(#poll-question) .zaehler')?.textContent,
  minuten: window.chosenDeadlineMinutes(),
  mehrDa: !document.querySelector('#btn-add-option').hidden,
  offen: document.querySelector('#poll-admin').classList.contains('offen'),
}));

check('Es geht wieder auf', neu.offen);
check('Die Frage ist weg', neu.pollQuestion === '', JSON.stringify(neu.pollQuestion));
check('Es sind wieder genau zwei Antwortfelder',
  neu.antworten.length === 2, `${neu.antworten.length}`);
check('Und beide sind empty', neu.antworten.every((v) => v === ''),
  JSON.stringify(neu.antworten));
check('Die Zähler zählen auch wieder von vorn',
  neu.zaehler.every((t) => /^0 \//.test(t)) && /^0 \//.test(neu.frageZaehler ?? ''),
  `${neu.frageZaehler} | ${neu.zaehler.join(' | ')}`);
// The duration is the quietest of the four: it sits at the bottom of the
// box, and a forgotten setting from the day before yesterday goes
// unnoticed at creation time - until the poll closes earlier than
// intended.
check('Die Laufzeit steht wieder auf der Vorgabe',
  neu.minuten === 1440, `${neu.minuten} Minuten`);
check('Und "+ Option" ist wieder da, weil wieder Platz ist', neu.mehrDa);

// A counter-check on the check itself: if the clearing were tied to the
// button instead of to pollFormular(), the second path - the one after
// creating a poll - would come up empty. So here's the same test via the
// direct call.
await populate();
await page.evaluate(() => { window.pollFormular(false); window.pollFormular(true); });
await page.waitForTimeout(150);
const direkt = await page.evaluate(() => ({
  pollQuestion: document.querySelector('#poll-question').value,
  fields: document.querySelectorAll('.poll-option').length,
  minuten: window.chosenDeadlineMinutes(),
}));
check('Auch der Weg nach dem Anlegen räumt auf, nicht nur der Knopf',
  direkt.pollQuestion === '' && direkt.fields === 2 && direkt.minuten === 1440,
  `${direkt.fields} Felder, ${direkt.minuten} Minuten`);

await page.evaluate(() => window.pollFormular(false));
await page.waitForTimeout(150);

// The glyph is ONE glyph rotated between two states, not two glyphs.
// The transition has to finish, or you measure the rotation's starting
// value instead of its target - the comparison would pass without
// showing anything.
const charTo = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.poll-neu .zeichen')).transform);
await page.evaluate(() => document.querySelector('#poll-admin').classList.add('offen'));
await page.waitForTimeout(300);
const zeichen = await page.evaluate(() => {
  const s = document.querySelector('.poll-neu .zeichen');
  const aufT = getComputedStyle(s).transform;
  document.querySelector('#poll-admin').classList.remove('offen');
  return { text: s.textContent.trim(), aufT };
}).then((r) => ({ ...r, zuT: charTo }));
check('Das Zeichen dreht sich, statt ausgetauscht zu werden',
  zeichen.text === '+' && zeichen.zuT !== zeichen.aufT, `${zeichen.zuT} → ${zeichen.aufT}`);
// It's decoration - a screen reader shouldn't say "plus sign New poll".
check('Und es wird nicht mitgelesen', /class="zeichen" aria-hidden="true"/.test(html));

// ---------------------------------------------------------------------------
console.log('\nDie Knöpfe im Anlegeformular\n');
//
// "Start poll" used to be the only filled button in the whole tab -
// bright background, dark text, bold weight. Next to a form that
// otherwise consists only of lines, it stuck out like a foreign object.
//
// What's checked here is the RULE, not a specific value: all three
// buttons in the box are text, not a box. No fill of their own, no
// border, the same muted color - and a background only shows up under
// the pointer. Whoever changes --dim later changes all three together;
// whoever gives one of them a fill again gets caught here.
//
// One inconsistency is stated deliberately, as-is: "+ Option" and "NEW
// POLL" are NOT the same size as each other (15px vs 12.3px, weight 400
// vs 700, plus uppercase with letter-spacing). What's equal is their
// COLOR. So "Start poll" matches its neighbor "+ Option" in size, and
// matches both of them in color.
//
// The pointer is still resting on "NEW POLL" after the last click -
// without moving it away, what gets measured there is the hover color,
// compared against the resting colors of the other three.
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
const buttons = await page.evaluate(() => {
  document.querySelector('#poll-admin').classList.add('offen');
  document.querySelector('#poll-admin-felder').hidden = false;
  const read = (sel) => {
    const el = document.querySelector(sel);
    const s = getComputedStyle(el);
    return {
      groesse: s.fontSize, gewicht: s.fontWeight, color: s.color,
      grund: s.backgroundColor, margin: s.borderTopColor, randBreit: s.borderTopWidth,
      polster: `${s.paddingTop} ${s.paddingLeft}`,
      height: Math.round(el.getBoundingClientRect().height),
    };
  };
  return {
    neu: read('#btn-poll-neu'),
    start: read('#btn-create-poll'),
    mehr: read('#btn-add-option'),
  };
});
for (const [n, w] of Object.entries(buttons)) {
  console.log(`     ${n.padEnd(9)}${w.groesse.padEnd(7)}w=${String(w.gewicht).padEnd(5)}`
    + `${w.color.padEnd(22)}Grund ${w.grund}`);
}

// Three buttons, one kind: no fill of their own, no border, the same
// color. The box shouldn't look like a toolbar.
//
// There used to be four, as long as "− Option" existed. That button is
// gone - an empty field was never a real answer anyway, and instead
// there's now "(optional)" in the placeholder from the third field on.
const alleVier = Object.values(buttons);
check('Keiner der drei hat einen eigenen Grund',
  alleVier.every((k) => durchsichtig(k.grund)),
  alleVier.map((k) => k.grund).join(' / '));
// Via the WIDTH, not the color: an element with no border still reports
// currentColor for its border color, i.e. the text color. Checking only
// the color here would report a border that doesn't actually exist -
// that's exactly what happened during the switch-over.
check('Und keiner einen Rahmen',
  alleVier.every((k) => k.randBreit === '0px' || durchsichtig(k.margin)),
  alleVier.map((k) => `${k.randBreit} ${k.margin}`).join(' / '));
check('Alle drei Schalter im Kasten haben dieselbe Farbe',
  new Set(alleVier.map((k) => k.color)).size === 1,
  alleVier.map((k) => k.color).join(' / '));
check('"Start poll" ist so big wie "+ Option"',
  buttons.start.groesse === buttons.mehr.groesse
  && buttons.start.gewicht === buttons.mehr.gewicht
  && buttons.start.polster === buttons.mehr.polster
  && Math.abs(buttons.start.height - buttons.mehr.height) <= 1,
  `${buttons.start.groesse}/${buttons.start.gewicht} gegen `
  + `${buttons.mehr.groesse}/${buttons.mehr.gewicht}`);

// The background only shows up under the pointer - and it has to be the
// same for both, or one button ends up looking like something different
// from the other.
const subPointer = async (sel) => {
  await page.hover(sel);
  await page.waitForTimeout(300);
  const w = await page.evaluate((s) => {
    const st = getComputedStyle(document.querySelector(s));
    return { grund: st.backgroundColor, color: st.color };
  }, sel);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  return w;
};
const pointerMore = await subPointer('#btn-add-option');
const pointerStart = await subPointer('#btn-create-poll');
check('Unter dem Zeiger erscheint bei "Start poll" ein Grund',
  !durchsichtig(pointerStart.grund), pointerStart.grund);
check('Und zwar derselbe wie bei "+ Option"',
  pointerStart.grund === pointerMore.grund && pointerStart.color === pointerMore.color,
  `${pointerStart.grund} gegen ${pointerMore.grund}`);
// The background isn't decoration - the label sits on top of it.
const aufZeiger = kon(numbers(pointerStart.color), numbers(pointerStart.grund));
check('Die Beschriftung bleibt auf diesem Grund lesbar (mindestens 4,5:1)',
  aufZeiger >= 4.5, `${aufZeiger.toFixed(1)}:1`);

await page.evaluate(() => {
  document.querySelector('#poll-admin').classList.remove('offen');
  document.querySelector('#poll-admin-felder').hidden = true;
});

// ---------------------------------------------------------------------------
console.log('\nDer Hinweis auf die leere Liste\n');
//
// It sits in the middle of the PAGE, not the middle of the list. The
// difference only shows up for Ansem, but there constantly: the admin
// box grows by a good 200px when opened, the list gets correspondingly
// shorter, and its middle drifts down by half of that - measured at
// 107px before this was compensated for.
//
// The counter-check belongs here too: on a short screen, the page's
// middle would fall inside the form. There the sentence MUST give way,
// or it would sit inside the input field. Better shifted than overlapped.
const emptyState = async (width, height) => {
  const s = await browser.newPage({ viewport: { width: width, height: height } });
  await s.goto(`http://127.0.0.1:${server.address().port}/`);
  await s.addScriptTag({ content: `const $ = (s, r = document) => r.querySelector(s);\n${beobachter}` });
  const r = await s.evaluate(async (content) => {
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const panel = document.querySelector('#poll-admin');
    document.querySelector('#poll-list').innerHTML = content;
    panel.classList.remove('offen');
    document.querySelector('#poll-admin-felder').hidden = true;
    await wait();
    const center = () => {
      const e = document.querySelector('.empty').getBoundingClientRect();
      return { y: Math.round(e.top + e.height / 2), peek: Math.round(e.top) };
    };
    const zu = center();
    panel.classList.add('offen');
    document.querySelector('#poll-admin-felder').hidden = false;
    await wait();
    const auf = center();
    return { zu, auf, formUnten: Math.round(panel.getBoundingClientRect().bottom) };
  }, emptyText);
  await s.close();
  return r;
};

// The compensation can only go as far as there's still room below the
// form. If there isn't, "safe center" falls back to the start and the
// sentence shifts - that's what the check below is for. 800px is enough.
const far = await emptyState(1000, 800);
check('Auf einem normalen Bildschirm bleibt er beim Aufklappen liegen',
  Math.abs(far.auf.y - far.zu.y) <= 1, `${far.zu.y} → ${far.auf.y}`);

const knapp = await emptyState(390, 520);
check('Auf einem kurzen Bildschirm weicht er dem Formular aus',
  knapp.auf.peek >= knapp.formUnten,
  `Text ab ${knapp.auf.peek}, Formular bis ${knapp.formUnten}`);

// And without the admin box - so for everyone except Ansem - it's simply
// the middle, without the variable even needing to be set at all.
const withoutBox = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await withoutBox.goto(`http://127.0.0.1:${server.address().port}/`);
const nutzer = await withoutBox.evaluate((content) => {
  document.querySelector('#poll-admin').hidden = true;
  document.querySelector('#poll-list').innerHTML = content;
  // Measured against the list's whole rectangle, not its content area:
  // the 1rem of bottom padding is there so the last card doesn't touch
  // the edge - with an EMPTY list there's nothing there, and the middle
  // a human sees is the middle of the visible rectangle.
  const l = document.querySelector('#poll-list').getBoundingClientRect();
  const e = document.querySelector('.empty').getBoundingClientRect();
  return Math.round(Math.abs((l.top + l.bottom) / 2 - (e.top + e.height / 2)));
}, emptyText);
await withoutBox.close();
check('Ohne Anlegekasten steht er genau mittig', nutzer <= 1, `${nutzer} px daneben`);

console.log('\nDer Weg im Code\n');

// An observer instead of calls scattered across five places: opening,
// closing, one more answer, one fewer, a wrap on rotation - the sixth
// path is the one where the call gets forgotten.
check('Die Kopfhöhe wird beobachtet, nicht an jeder Stelle nachgetragen',
  /new ResizeObserver\(melde\)\.observe\(panel\)/.test(appJs));
check('Und der Rand nach bottom zählt mit',
  /marginBottom/.test(appJs) && /--poll-kopf/.test(appJs));

check('Nach dem Anlegen klappt er wieder zu',
  /toast\('Poll started'\)/.test(appJs) && /pollFormular\(false\);/.test(appJs));
// The clearing belongs to the closing, not to the button. Both used to
// sit side by side here at one point: the button only closed it, and the
// path after creating cleaned up on its own. Two paths to close, only
// one of them clearing - that's how you get a form that remembers, on
// cancel, exactly what you meant to discard.
const zuklappen = cut('function pollFormular(offen)', "\n$('#btn-poll-neu')");
check('Und das Leeren hängt am Zuklappen, nicht am Knopf',
  /pollFormClear\(\)/.test(zuklappen)
  && !/pollFormClear\(\)/.test(cut("$('#btn-poll-neu').addEventListener", '\n/**')));
// The duration dropdown can be sitting open above the box. It belongs to
// the form.
check('Die offene Laufzeitliste geht mit zu', /lzZu\(\);/.test(zuklappen));
// A second place to track "open" would be a second place that can be
// wrong.
check('"Offen" steht nur an einer Stelle – als Klasse am Kasten',
  /panel\.classList\.toggle\('offen', offen\)/.test(appJs)
  && !/let (pollOffen|formularOffen)/.test(appJs));
check('Der Schalter meldet seinen Zustand an das Blatt next',
  /setAttribute\('aria-expanded', String\(offen\)\)/.test(appJs));

// ---------------------------------------------------------------------------
// The same row on the phone as on the computer
// ---------------------------------------------------------------------------
//
// There used to be a separate layout here for narrow screens: answer on
// top, amount below. The reasoning was that a long text and a six-digit
// amount wouldn't fit side by side.
//
// Measured, that stopped being true once .opt-num got flex: none - and it
// cost something: the fill's edge now also ran through the amount below
// it. Now the same rules apply everywhere.
//
// This check records that. It measures three things on a 375px screen:
//   * the amount sits to the RIGHT of the answer, not below it
//   * no number gets squeezed
//   * every amount in a poll starts at the same height
//
// The test case is deliberately the edge case the database allows: 60
// character answer, eight-digit amount. With "Ship it this week"
// everything would be green here, which was never the kind of thing that
// caused trouble anyway.
const handy = await browser.newPage({
  viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true,
});
await handy.goto(`http://127.0.0.1:${server.address().port}/`);
await handy.addScriptTag({ content: `
  const $ = (s, r = document) => r.querySelector(s);
  const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false } };
  ${escFn}
  ${formate}
  ${symbole}
  ${zeit}
  ${line}
  ${leading}
  ${markup}
  $('#poll-list').innerHTML = [
    { id: 1, closed: false, myOptionId: 1, totalUsd: 42881420, closesAt: null,
      question: 'Should we open the token gate to smaller holders?',
      // One SHORT and one LONG answer, not two of equal length. With two
      // equal-length ones, both wrap equally often, and then alignment
      // (top vs. center) couldn't make any difference at all - the check
      // for it would always be green. That's exactly what it was here at
      // first.
      options: [
        { id: 1, label: 'Yes', usd: 28429000, share: .663 },
        { id: 2, label: 'Keep the current schedule exactly as it is written',
          usd: 12105400, share: .282 },
        // A single long word. Text normally wraps at spaces and so never
        // actually crowds the amount - a word with no break point does.
        // This exact case shows whether flex: none really holds up, and
        // the database allows it (60 characters, any content).
        { id: 3, label: 'Supercalifragilisticexpialidociousandthensomemorewords',
          usd: 2347020, share: .055 },
      ] },
  ].map(pollHtml).join('');` });
await handy.waitForTimeout(200);

const phoneLine = await handy.evaluate(() => {
  const amounts = [...document.querySelectorAll('.opt-num')];
  const labels = [...document.querySelectorAll('.opt-label')];
  return {
    // Beside it, to the right, means: the amount starts further right
    // than the answer ends - and both sit at the same height.
    daneben: amounts.every((b, i) => {
      const bb = b.getBoundingClientRect(), lb = labels[i].getBoundingClientRect();
      return bb.left >= lb.right - 1 && bb.top < lb.bottom;
    }),
    // And: the number must not wrap. "$28,429,000" has a break point
    // after every comma - without flex: none the amount can fall apart
    // into two lines instead of being visibly squeezed. Torn apart is
    // just as bad as cut off.
    umgebrochen: amounts
      .map((b) => b.querySelector('.held'))
      .filter((h) => h.getClientRects().length > 1)
      .map((h) => h.textContent.trim()),
    squeezed: amounts
      .map((b) => b.querySelector('.held'))
      .filter((h) => h.scrollWidth > Math.ceil(h.getBoundingClientRect().width) + 1)
      .map((h) => h.textContent.trim()),
    // Don't measure against the bar, measure against the answer BESIDE
    // it.
    //
    // What used to sit here was the distance to the bar's top edge - but
    // that varies even with correct alignment, because .opt-bar has a
    // minimum height and a single-line answer sits centered inside it.
    // The check would trip even though nothing was actually wrong.
    //
    // What's actually meant is something else: the amount should sit at
    // the HEIGHT of the answer's first line, not at the halfway point of
    // a wrapped block. So the gap between the two, line by line.
    versatz: amounts.map((b, i) => Math.round(
      b.getBoundingClientRect().top - labels[i].getBoundingClientRect().top)),
  };
});
await handy.close();

check('Auf 375 px steht der Betrag right neben der Antwort, nicht darunter',
  phoneLine.daneben);
check('Auch beim laengsten erlaubten Text wird keine Zahl squeezed',
  phoneLine.squeezed.length === 0, phoneLine.squeezed.join(', '));
check('Und keine Zahl in zwei Zeilen zerrissen',
  phoneLine.umgebrochen.length === 0, phoneLine.umgebrochen.join(', '));
// Without align-items: flex-start, the amount would sit at half height
// next to a wrapped answer - and the amounts within one poll would no
// longer line up.
check('Und jeder Betrag steht auf Hoehe der ersten Zeile seiner Antwort',
  phoneLine.versatz.every((v) => Math.abs(v) <= 2),
  phoneLine.versatz.join(' / ') + ' px Versatz');

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
