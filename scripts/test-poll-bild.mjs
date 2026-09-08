// ============================================================================
// Checks the image button - and drops the generated image somewhere to look at.
//
// A rendered image can be wrong in two ways: it can fail to appear at all
// (then the error reports itself), or it can appear and look bad - text
// running off a bar, numbers overlapping, a cut-off question. The second
// kind only shows up if you actually look. That's why this script writes
// the finished PNGs to preview/.
//
// The unpleasant cases are checked: a very long question, a very long
// answer, huge numbers, ten answers, a closed poll, and one nobody has
// voted in yet.
//
//   node scripts/test-poll-bild.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Cut verbatim out of app.js - a rebuilt copy would pass the test while
// the real version is broken.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const drawSource = cut('const cssWert =', 'async function ladePollBild');

// The version number lives in TWO places: app.js writes the image, the
// Edge Function looks for it. If they drift apart, every shared link
// shows the fallback card - silently, because each side looks correct
// on its own. That's exactly what this check is for.
const ogTs = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'og', 'index.ts'), 'utf8');
const versionAus = (text, wo) => {
  const m = /const CARD_VERSION = (\d+);/.exec(text);
  if (!m) throw new Error(`CARD_VERSION nicht gefunden in ${wo}`);
  return Number(m[1]);
};
const vApp = versionAus(appJs, 'public/app.js');
const vOg = versionAus(ogTs, 'supabase/functions/og/index.ts');
// The number formats live further up with the other formatters - also
// verbatim, so the test doesn't check its own copy.
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const lader = cut('async function ladePollBild', '\nfunction pollHtml');
const CHECK_SVG = cut('const CHECK_SVG =', 'const DOWNLOAD_SVG =');
const DOWNLOAD_SVG = cut('const DOWNLOAD_SVG =', 'const TRASH_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"');
const TRASH_SVG = cut('const TRASH_SVG =', '\n// ------');
// The buttons' state. ladePollBild uses it to lock its own button and then
// set the checkmark - both used to live as btn.disabled and btn.innerHTML
// on the node itself and didn't survive the list being rebuilt.
const buttonState = cut('const BUTTON_ROLES = {', 'const pollLink = (id) => `${location.origin}/p/${id}`;');

const pageHtml = `<!doctype html><meta charset="utf-8"><style>${css}</style><body>`;
const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);

await page.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const state = { cfg: { symbol: 'ANSEM' }, polls: [] };
    const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
    window.tosts = [];
    window.BILD = {};
    const toast = (m, err) => window.tosts.push({ m, err: Boolean(err) });
    ${formate}
    ${CHECK_SVG}
    ${DOWNLOAD_SVG}
    ${TRASH_SVG}
    ${buttonState}
    ${drawSource}
    ${lader}
    window.drawPoll = drawPoll;
    window.umbrechen = umbrechen;
    window.ladePollBild = ladePollBild;
    window.state = state;
  `,
});

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });

const CASES = {
  'normal': {
    id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
    question: 'Should we open the token gate to smaller holders?',
    options: [
      opt('Ship it this week', 128, 482900, 4829 / 7814.2),
      opt('Wait for the audit', 44, 210400, 2104 / 7814.2),
      opt('Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
    ],
  },
  'long': {
    id: 2, closed: false, totalVotes: 3, totalUsd: 12,
    question: 'If we were to change the minimum holding required to message Ansem, '
      + 'which of these thresholds would you personally consider fair for the community?',
    options: [
      opt('Donaudampfschifffahrtsgesellschaftskapitaenswitwe and then some more words that will not fit', 2, 8, 8 / 12),
      opt('No', 1, 4, 4 / 12),
    ],
  },
  'big': {
    id: 3, closed: false, totalVotes: 41822, totalUsd: 918_400_000,
    question: 'Biggest vote yet',
    options: [
      opt('Yes', 38_100, 902_000_000, 902 / 918.4),
      opt('No', 3_722, 16_400_000, 16.4 / 918.4),
    ],
  },
  'zehn': {
    id: 4, closed: false, totalVotes: 235, totalUsd: 2_650_000,
    question: 'Pick the next AMA guest',
    // The shares are computed from the amounts, exactly as in loadPolls().
    // So they must add up to 1 - otherwise the test only checks its own
    // invention instead of what the app actually does.
    options: (() => {
      const usd = Array.from({ length: 10 }, (_, i) => 400000 - i * 30000);
      const gesamt = usd.reduce((a, b) => a + b, 0);
      return usd.map((u, i) => opt(`Guest number ${i + 1}`, 55 - i * 4, u, u / gesamt));
    })(),
  },
  'shut': {
    id: 5, closed: true, totalVotes: 77, totalUsd: 310000,
    question: 'Next AMA time?',
    options: [opt('Friday 8pm ET', 55, 220100, 2201 / 3100), opt('Sunday 2pm ET', 22, 89900, 899 / 3100)],
  },
  'empty': {
    id: 6, closed: false, totalVotes: 0, totalUsd: 0,
    question: 'Nobody has voted yet',
    options: [opt('Option A', 0, 0, 0), opt('Option B', 0, 0, 0)],
  },
};

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nBild einer Abstimmung\n');

check('CARD_VERSION stimmt in app.js und in der Edge Function ueberein',
  vApp === vOg, `app.js: ${vApp}, og/index.ts: ${vOg}`);

// --- How fast the card appears when sharing --------------------------
//
// X's crawler doesn't wait long. If the response doesn't show up within
// its window, the post shows the bare link. So the Edge Function's
// critical path is checked here - not because the timing is measured,
// but because each of these three properties can quietly get lost in
// the next rewrite.
check('Die Zahlen haengen nicht mehr an der ersten Abfrage',
  /poll_results'\)[\s\S]{0,60}\.eq\('poll_id'/.test(ogTs),
  'poll_results wird ueber poll_id geholt, nicht ueber die Options-Nummern');
check('Und alle drei Abfragen laufen gleichzeitig',
  /await Promise\.all\(\[[\s\S]{0,400}poll_results/.test(ogTs));
// The image check is a courtesy to old polls. Without a cap it becomes a
// drag on everyone: the crawler would then hang on a question whose
// answer is almost always "yes".
check('Die Bildpruefung kann die Antwort nicht aufhalten',
  /Promise\.race\(\[[\s\S]{0,160}setTimeout/.test(ogTs));

// The image never changes under its own name - the name carries the
// version number. A short cache lifetime here would just be wasted
// waiting.
check('Die Karte wird lange zwischengespeichert',
  /cacheControl: '31536000, immutable'/.test(appJs));

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

for (const [name, poll] of Object.entries(CASES)) {
  const ergebnis = await page.evaluate(async (p) => {
    const c = await window.drawPoll(p);
    const card = await window.drawPoll(p, { fuerKarte: true });
    const ctx = c.getContext('2d');
    return {
      w: c.width, h: c.height, data: c.toDataURL('image/png'),
      ecke: [...ctx.getImageData(1, 1, 1, 1).data],
      center: [...ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data],
      grund: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      geometrie: c.geometrie,
      card: {
        w: card.width, h: card.height, geo: card.geometrie,
        data: card.toDataURL('image/png'),
      },
    };
  }, poll);

  const file = path.join(root, 'preview', `poll-bild-${name}.png`);
  fs.writeFileSync(file, Buffer.from(ergebnis.data.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(root, 'preview', `poll-karte-${name}.png`),
    Buffer.from(ergebnis.card.data.split(',')[1], 'base64'));

  // 3200 = 1600 points at double resolution. If this isn't right, the
  // scaling has slipped and the image would look blurry on a phone.
  check(`${name}: 3200 px wide`, ergebnis.w === 3200, String(ergebnis.w));

  // The measure that actually matters for X: wider than 16:9 is shown in
  // full in the timeline, taller than 4:5 gets cropped top and bottom.
  const v = ergebnis.w / ergebnis.h;
  check(`${name}: Seitenverhältnis zwischen 4:5 und 16:9`,
    v >= 0.795 && v <= 1.782, `${v.toFixed(2)}:1`);

  check(`${name}: PNG ist nicht empty`, fs.statSync(file).size > 5000,
    `${Math.round(fs.statSync(file).size / 1024)} KB`);

  // The card image for X has a different, FIXED aspect ratio: 1.91:1.
  // That's exactly what X crops a link card to - a taller image would
  // lose a strip top and bottom, and the border would be the first thing
  // to go.
  const kv = ergebnis.card.w / ergebnis.card.h;
  check(`${name}: Kartenbild ist 1,91:1`, Math.abs(kv - 1.91) < .01, `${kv.toFixed(3)}:1`);
  // Single resolution, not double: PNG dithers the glow in the background
  // with noise that quadruples at double resolution. The file would weigh
  // many times more without anyone seeing the difference - and X shows a
  // card at around 600 px wide anyway.
  check(`${name}: Kartenbild ist 1600 px wide`, ergebnis.card.w === 1600,
    String(ergebnis.card.w));
  const kb = Math.round(ergebnis.card.data.length * 0.75 / 1024);
  check(`${name}: Kartenbild bleibt under 2 MB`, kb < 2048, `${kb} KB`);
  // If not all answers fit, the rest must be NAMED. A card that silently
  // shows only half is making a claim about the result.
  const g = ergebnis.card.geo;
  check(`${name}: Karte zeigt entweder alle Antworten oder nennt die fehlenden`,
    g.gezeigt + g.ausgelassen === poll.options.length,
    `${g.gezeigt} gezeigt, ${g.ausgelassen} genannt, ${poll.options.length} gesamt`);

  // The corners carry the page's background color and are OPAQUE.
  // Transparent would be the cleaner file, but X often converts PNGs to
  // JPEG - and then transparent corners would turn black.
  const [er, eg, eb, ea] = ergebnis.ecke;
  const expected = ergebnis.grund.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  check(`${name}: Ecken sind deckend`, ea === 255, `Alpha peek left: ${ea}`);
  check(`${name}: Ecken tragen die Grundfarbe der Seite`,
    er === expected[0] && eg === expected[1] && eb === expected[2],
    `rgb(${er}, ${eg}, ${eb}) statt rgb(${expected.join(', ')})`);
  // And the card itself stands out against it - otherwise the rounding
  // would be invisible.
  const [mr, mg, mb] = ergebnis.center;
  check(`${name}: die Karte hebt sich vom Rand ab`,
    Math.abs(mr - er) + Math.abs(mg - eg) + Math.abs(mb - eb) > 8,
    `Karte rgb(${mr}, ${mg}, ${mb})`);

  // The core check: the filled pieces laid end to end must add up to
  // exactly one full bar. Otherwise the image is making a claim about the
  // distribution that isn't true - and for a poll about money that's not
  // a cosmetic flaw. Tolerance is half a pixel for drawing rounding.
  if (poll.totalVotes > 0) {
    const summe = poll.options.reduce((a, o) => a + o.share, 0);
    check(`${name}: die Anteile ergeben zusammen genau eins`,
      Math.abs(summe - 1) < 1e-9, summe.toFixed(12));

    // Not recomputed, but read off: the widths come from the finished
    // image. A separate calculation here would only check its own
    // calculation - it stayed green once already after the page margin
    // changed.
    const { content, fuellungen } = ergebnis.geometrie;
    const widths = fuellungen.reduce((a, b) => a + b, 0);
    check(`${name}: die gefüllten Stücke ergeben genau die volle Breite`,
      Math.abs(widths - content) < .5, `${widths.toFixed(2)} von ${content} px`);
  }
}

// No crash on missing data: a poll without answers doesn't actually
// occur, but it still must not produce an image with broken height.
const ohne = await page.evaluate(async () => {
  try {
    const c = await window.drawPoll(
      { id: 9, question: 'x', closed: false, totalVotes: 0, totalUsd: 0, options: [] });
    return { ok: true, h: c.height };
  } catch (e) { return { ok: false, fehler: e.message }; }
});
check('Abstimmung ohne Antworten stürzt nicht ab', ohne.ok && ohne.h > 0,
  ohne.ok ? `${ohne.h} px hoch` : ohne.fehler);

// --- The button itself ------------------------------------------------------
// Up to here, only drawing has happened. Whether a file actually reaches
// the user in the end hinges on an a[download] pointing at a blob address -
// and that's exactly the part that can fail silently.
await page.evaluate((p) => {
  window.state.polls = [p];
  const b = document.createElement('button');
  b.id = 'button';
  b.className = 'icon-btn poll-image';
  // WITH data-image, as in the real markup: that's how paintButtons()
  // recognizes which poll the button belongs to. Without that attribute
  // the checkmark would never appear here - and the test would have
  // checked a button that doesn't actually exist like this.
  b.dataset.image = String(p.id);
  b.innerHTML = DOWNLOAD_SVG;
  b.addEventListener('click', () => ladePollBild(p.id));
  document.body.appendChild(b);
}, CASES.normal);

const waitForFile = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.click('#button');
const file = await waitForFile;
check('Klick liefert wirklich eine Datei aus', Boolean(file),
  file ? file.suggestedFilename() : 'kein Download ausgelöst');
if (file) {
  check('Dateiname nennt die Abstimmung',
    file.suggestedFilename() === 'sized-poll-1.png', file.suggestedFilename());
  const pfad = await file.path();
  const big = pfad ? fs.statSync(pfad).size : 0;
  check('Die ausgelieferte Datei ist ein volles PNG', big > 5000,
    `${Math.round(big / 1024)} KB`);
}

await page.waitForTimeout(120);
const haken = await page.evaluate(() =>
  document.querySelector('#button').classList.contains('is-copied'));
check('Knopf bestätigt mit dem Haken', haken);

// A number that doesn't exist: the button must not silently do nothing.
const fehltMeldung = await page.evaluate(async () => {
  window.tosts = [];
  const b = document.querySelector('#button');
  await ladePollBild(999, b);
  return { tosts: window.tosts, wiederFrei: !b.disabled };
});
check('Unbekannte Abstimmung wird gemeldet',
  fehltMeldung.tosts.some((t) => t.err), fehltMeldung.tosts.map((t) => t.m).join(' | '));
check('Knopf ist danach wieder bedienbar', fehltMeldung.wiederFrei);

// --- Blue only after closing -----------------------------------------
//
// While a poll is still running, the bar lengths already say where things
// stand. A blue fill on top of that turns it into a DECLARATION, and a
// declaration about a mid-poll standing is a nudge: someone arriving
// undecided who sees that one answer is "the" answer is more likely to
// vote for it. The ranking can still flip up to the last minute,
// especially here - a single large holder flips it.
//
// This is checked against the PIXELS of the finished canvas, not against
// the calculation behind it. The calculation could be correct and the
// brush still paint blue.
console.log('\nDas Blau kommt erst zum Schluss\n');

// What counts as "the winner's blue" used to be "noticeably more blue than
// red", and that worked for exactly as long as the leading fill was the only
// blue thing in the palette. On paper it no longer is: the accent is a dark
// blue and the mark is a pale one, so the old rule found 346 blue pixels on
// an open card and called them a declaration - they were the logo.
//
// A proxy that stops standing for the thing it was a proxy for is worse than
// no check, because it still reports a number. So this now matches the fill
// ITSELF, read from the same stylesheet the card draws from: whatever
// --fuellung-spitze happens to be, this finds that colour and nothing else.
// Antialiased edges are why it is a distance and not an equality.
// Two things had to change here, and both were the instrument being wrong
// rather than the card.
//
// 1. "Noticeably more blue than red" worked for exactly as long as the
//    leading fill was the only blue in the palette. On paper it is not: the
//    accent is a dark blue, the mark a pale one. The old rule found 346 blue
//    pixels on an open card and called them a declaration - they were the
//    logo. So this matches the fill ITSELF, read from the same stylesheet the
//    card draws from. Antialiasing is why it is a distance, not an equality.
//
// 2. Matching the fill exactly is not enough either, because the mark now
//    carries that very value (--marke references --fuellung-spitze - that was
//    the decision, see styles.css). The colour is therefore on every card,
//    open or closed, up in the header. The claim was never about the header:
//    it is that the WINNER'S BAR is not painted before the poll closes. So
//    the header comes out of the frame.
//
// Measured, so the boundary is not a guess: on an open card the matching
// pixels sit at y 80..109, which is the logo and nothing else. On a closed
// one they run 80..496 - logo plus bars. 168 (a fifth of the 838px card)
// sits clear of the first and well above the second.
const KOPFBAND = 0.2;

const blauImBild = (poll) => page.evaluate(async ({ p, anteil }) => {
  const roh = getComputedStyle(document.documentElement)
    .getPropertyValue('--fuellung-spitze').trim();
  const soll = roh.startsWith('#')
    ? [1, 3, 5].map((i) => parseInt(roh.slice(i, i + 2), 16))
    : roh.match(/\d+/g).slice(0, 3).map(Number);
  const c = await window.drawPoll(p, { fuerKarte: true });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const treffer = (von, bis) => {
    let n = 0;
    for (let y = von; y < bis; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(d[i] - soll[0]) <= 6
          && Math.abs(d[i + 1] - soll[1]) <= 6
          && Math.abs(d[i + 2] - soll[2]) <= 6) n++;
      }
    }
    return n;
  };
  const grenze = Math.round(c.height * anteil);
  return { balken: treffer(grenze, c.height), kopf: treffer(0, grenze) };
}, { p: poll, anteil: KOPFBAND });

const offenBlau = await blauImBild(CASES.normal);
const zuBlau = await blauImBild(CASES.shut);
check('Eine laufende Abstimmung hat kein Blau auf den Balken',
  offenBlau.balken === 0, `${offenBlau.balken} blaue Punkte unter dem Kopf`);
// The counter-check belongs here too: without it, the check above would
// also stay green if the blue stopped being drawn at all.
check('Eine geschlossene sehr wohl – und zwar flächig',
  zuBlau.balken > 10000, `${zuBlau.balken} blaue Punkte`);

// And the same thing one level deeper: it hinges on closing, not on this
// particular poll happening to have different numbers.
const gedreht = await blauImBild({ ...CASES.normal, closed: true });
check('Dieselbe Abstimmung, nur shut, bekommt ihr Blau',
  gedreht.balken > 10000, `${gedreht.balken} blaue Punkte`);

// The cut itself needs a check, otherwise it is just a number that makes the
// test pass. Above the line the colour has to BE there on an open card - that
// is the mark, drawn in the winner's colour on purpose. If this ever goes to
// zero, either the mark stopped following --marke or the band slipped, and in
// both cases the check above would be green for the wrong reason.
check('Über dem Schnitt liegt sie auch bei laufender Abstimmung – das ist die Marke',
  offenBlau.kopf > 100, `${offenBlau.kopf} Punkte im Kopf`);

// The calculation lives in ONE place, because the list and the card would
// otherwise drift apart: a shared image would then show a winner the page
// next to it doesn't know about - and both would look correct on their
// own.
check('Karte und Liste fetch sich denselben Wert',
  (appJs.match(/leadingShare\(p\)/g) || []).length === 2);
check('Und niemand rechnet daneben noch selbst den Groessten aus',
  (appJs.match(/Math\.max\(\.\.\.p\.options\.map/g) || []).length === 1);

// --- The amount stands alone in the right column -------------------------
//
// This column has held three things in turn: the amount with the vote
// count below it, then the amount alone, then the amount with the
// percentage below it, now the amount alone again.
//
// As long as two lines stood there, these checks tested the gap between
// them. Now there's only one, and the requirement is different: it must
// sit CENTERED in the row. That used to be the part people forgot when
// moving things around - setting only the top line lower tipped the pair
// downward.
//
// Centeredness is checked not as "the value is 13", but against the
// font's actually measured cap height. Checking against the number itself
// would just echo back what's already in app.js.
console.log('\nDer Betrag in der Zeile\n');

const versatz = (() => {
  const m = /fullUsd\(o\.usd\), B - margin - 26, center \+ (-?\d+)\)/.exec(appJs);
  if (!m) throw new Error('Die Zeile, die den Betrag zeichnet, steht nicht mehr so in app.js');
  return Number(m[1]);
})();

// The cap height of the 36px font, measured in the exact browser that also
// draws the image - not copied from a table.
const capHeight = await page.evaluate(() => {
  const mono = getComputedStyle(document.documentElement)
    .getPropertyValue('--mono').trim() || 'monospace';
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `700 36px ${mono}`;
  const m = ctx.measureText('$1,234,567');
  return m.actualBoundingBoxAscent;
});
// Centered means: the baseline sits half a cap height below the center,
// so the number ends up with equal air above and below it.
const expected = capHeight / 2;
check('Der Betrag sitzt mittig in seiner Zeile',
  Math.abs(versatz - expected) <= 2,
  `Versatz ${versatz} px, halbe Versalhöhe ${expected.toFixed(1)} px`);

// And it's truly the only thing standing on the right. Both former
// secondary lines took their position from the same center - if one of
// them came back without the offset being adjusted, the pair would look
// crooked without anything else here catching it.
const drawSourceText = cut('async function drawPoll', '\nasync function ladePollBild');
check('Neben dem Betrag steht keine zweite Zeile',
  (drawSourceText.match(/B - margin - 26, center/g) || []).length === 1);
// The percentage may come back if someone likes it - that's a matter of
// taste.
check('Kein Prozentsatz mehr auf der Karte',
  !/o\.share \* 100/.test(drawSourceText));
// The VOTE COUNT must not come back, and that isn't a matter of taste:
// splitting your balance across ten wallets right before the deadline
// doesn't change the amount, but it does turn one vote into ten. The
// amount can't be inflated this way. This line stands here as a
// safeguard, not as a description.
check('Und keine Stimmenzahl – die liesse sich durch Verteilen aufblasen',
  !/\bvotes\b/.test(drawSourceText));

// --- The amount on the bar --------------------------------------------
//
// The amount sits in the right column, and a leading answer's bar runs all
// the way there. That makes it the only text in the image whose
// background can change: sometimes the row background, sometimes the
// fill on top of it.
//
// The small line below it that existed for a while sat on --dimmer and
// measured 1.3:1 there - not slightly too pale, but invisible. And of all
// places, on the winning answer - exactly the case where the card gets
// shared most. Whoever brings a second line back will need its own color
// again.
//
// Checked against the fill itself, not against the row background:
// touching the fill makes the number unreadable without changing its own
// color.
//
// This used to be a calculation with opacity - the fill was translucent
// white over the row background, and the test recomputed the mix. Since
// the fill switched to X's colors, it's now OPAQUE and there are TWO of
// them: gray for normal answers, blue for the leading one. Both are
// checked, and the leading one is the stricter case - exactly the row
// whose bar runs into the right column.
console.log('\nDer Betrag auf dem Balken\n');

const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const asNumbers = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const leucht = (rgb) => {
  const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kon = (a, b) => {
  const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const wert = (name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!m) throw new Error(`${name} steht nicht im Blatt`);
  return m[1];
};
// The fill is no longer mixed, it's a value in the stylesheet.
const grau = asNumbers(wert('--fuellung'));
const blau = asNumbers(wert('--fuellung-spitze'));
const amount = asNumbers(wert('--text'));
const empty = asNumbers(wert('--bg-1'));   // the card background next to the bar

// The worse of the two cases counts. Blue is lighter than gray, so the
// text sits closer to the edge on it - and that's exactly where the bar
// runs furthest to the right, under the numbers.
check('Der Betrag bleibt auf beiden Füllungen lesbar (mindestens 4,5:1)',
  Math.min(kon(amount, grau), kon(amount, blau)) >= 4.5,
  `Grau ${kon(amount, grau).toFixed(1)}:1, Blau ${kon(amount, blau).toFixed(1)}:1`);
check('Und auf dem clear Teil erst recht',
  kon(amount, empty) >= 4.5,
  `${kon(amount, empty).toFixed(1)}:1`);
// The leading answer is set brighter than the others. This color also
// sits on the blue fill - always, because its bar is the longest.
const peakColor = asNumbers(wert('--accent'));
check('Auch der Betrag der führenden Antwort bleibt auf dem Blau lesbar',
  kon(peakColor, blau) >= 4.5, `${kon(peakColor, blau).toFixed(1)}:1`);
// And the two fills must stay distinguishable - otherwise the blue stops
// saying anything. Brightness alone barely does that (1.67:1); the
// message is carried by the hue. So BOTH are checked here: that they
// really differ in hue and aren't just two shades of gray.
const toneSpacing = Math.max(...[0, 1, 2].map((i) => Math.abs(blau[i] - grau[i])))
  - Math.min(...[0, 1, 2].map((i) => Math.abs(blau[i] - grau[i])));
check('Die führende Füllung ist eine Farbe und kein weiteres Grau',
  toneSpacing >= 25, `${toneSpacing} Stufen Abstand zwischen den Kanälen`);
// And the canvas must really read the variables instead of bringing its
// own values - otherwise the image would eventually drift away from the
// page.
//
// --votes and --anteil stood here in turn. Both only existed for the
// small line under the amount, and they both vanished from the stylesheet
// along with it.
check('Keine Farbe mehr für eine zweite Zeile, weil es keine gibt',
  !/--anteil/.test(appJs) && !/--votes/.test(appJs));
check('Beide Füllungen kommen aus dem Blatt',
  /cssWert\('--fuellung'\)/.test(appJs) && /cssWert\('--fuellung-spitze'\)/.test(appJs));
check('Die führende Antwort wird auf der Karte blau gefüllt',
  /ctx\.fillStyle = spitze \? color\.fuellungSpitze : color\.fuellung;/.test(appJs));
// The second, lighter border around the leading bar is gone - the blue
// already says it. Two signals for the same message read as two
// messages.
check('Und bekommt keinen zweiten Rahmen obendrauf',
  !/lineWidth = spitze \? 2 : 1/.test(appJs));

// ---------------------------------------------------------------------------
// The form's character limits against what the card actually shows
//
// MAX_QUESTION and MAX_ANSWER live in app.js but act on the form. Their
// justification lives HERE: the card is the version that goes out into
// the world.
//
// Two different promises, and they must not get mixed up:
//
//   1. NOTHING gets lost. That's a promise of the card itself, not of the
//      limit: drawPoll() shrinks the question until it fits three
//      lines. It used to be just .slice(0, 3), and the fourth line fell
//      away silently - the form showed the full question while the
//      posted image cut off mid-sentence.
//
//   2. It's shown at full size. THAT is the promise of the limit. A
//      question that would push the card down to 44 px is no longer a
//      headline in the timeline.
//
// This is checked not by recomputing, but by DRAWING: drawPoll hangs
// the numbers off the canvas. A rebuilt formula would again just be a
// second opinion; it has already stayed green once after the page margin
// changed.
//
// And with many sentences instead of one, because wrapping doesn't depend
// on length but on word boundaries: a long word at the end of a line
// leaves half a line empty. Word lengths here go up to 16 - longer than
// English prose, deliberately.
// ---------------------------------------------------------------------------
console.log('\nDie Zeichengrenzen des Formulars passen zur Karte\n');

const grenzeAus = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(appJs);
  if (!m) throw new Error(`${name} nicht in app.js gefunden`);
  return Number(m[1]);
};
const MAX_QUESTION = grenzeAus('MAX_QUESTION');
const MAX_ANSWER = grenzeAus('MAX_ANSWER');

/** A sentence of words from 2 to maxW characters, exactly n characters long. */
const satz = (n, maxW) => {
  const worte = [];
  while (worte.join(' ').length < n) {
    worte.push('x'.repeat(2 + Math.floor(Math.random() * (maxW - 1))));
  }
  while (worte.join(' ').length > n) worte.pop();
  const rest = n - worte.join(' ').length;
  if (rest > 0) worte[worte.length - 1] += 'x'.repeat(rest);
  return worte.join(' ');
};

const drawGeometry = (fall) => page.evaluate(async (p) =>
  (await window.drawPoll(p)).geometrie, fall);
const withQuestion = (pollQuestion) => ({
  id: 91, closed: false, totalVotes: 3, totalUsd: 12,
  question: pollQuestion, options: [opt('A', 2, 8, 2 / 3), opt('B', 1, 4, 1 / 3)],
});

// The most expensive case for answers: the widest amount that can ever
// occur, since it eats into the answer's width. And the leading answer,
// because it's set in the heavier weight.
const longAnswer = 'M'.repeat(MAX_ANSWER);
const gAnswer = await drawGeometry({
  id: 90, closed: false, totalVotes: 41822, totalUsd: 12_345_678,
  question: 'Kurz',
  options: [opt(longAnswer, 41_000, 12_345_678, .97), opt(longAnswer, 822, 300_000, .03)],
});
check(`Eine Antwort mit ${MAX_ANSWER} Zeichen bekommt neben $12.345.678 keine Auslassungspunkte`,
  gAnswer.answersTruncated === 0, `${gAnswer.answersTruncated} von 2 gekürzt`);

// The promise of the LIMIT: full size. Word lengths up to 16 - longer
// than English prose, deliberately.
let minSize = 54;
let worst = '';
for (let i = 0; i < 300; i++) {
  const pollQuestion = satz(MAX_QUESTION, 16);
  const g = await drawGeometry(withQuestion(pollQuestion));
  if (g.questionSize < minSize) { minSize = g.questionSize; worst = pollQuestion; }
}
check(`Eine Frage mit ${MAX_QUESTION} Zeichen bleibt in voller Größe (54 px)`,
  minSize === 54, `minSize von 300 Sätzen: ${minSize} px`
    + (worst ? ` – "${worst}"` : ''));

// The promise of the CARD: nothing gets lost. Here with words up to 20
// characters, exactly the case where the assumption behind the limit
// breaks. It's allowed to break - then the font shrinks, and the
// sentence still stands there in full.
let mostLines = 0;
for (let i = 0; i < 300; i++) {
  const g = await drawGeometry(withQuestion(satz(MAX_QUESTION, 20)));
  mostLines = Math.max(mostLines, g.questionLinesRaw);
}
check('Auch mit sehr langen Wörtern fällt keine Zeile weg',
  mostLines <= 3, `schlimmster von 300 Sätzen: ${mostLines} Zeilen`);

// Counter-checks. Without them, these would be measurements nobody knows
// could ever catch anything.
//
// 140 characters is more than the limit allows - but the card also draws
// polls from before this migration. At 54 px they'd need a fourth line;
// it used to get silently cut off.
let gBiggest = null;
for (let i = 0; i < 40 && !gBiggest; i++) {
  const g = await drawGeometry(withQuestion(satz(140, 12)));
  if (g.questionSize < 54) gBiggest = g;
}
check('Gegenprobe: bei 140 Zeichen greift die Verkleinerung wirklich',
  Boolean(gBiggest), gBiggest ? `${gBiggest.questionSize} px statt 54` : 'nie ausgelöst');
check('Und rettet dabei die Zeile, die früher wegfiel',
  gBiggest ? gBiggest.questionLinesRaw <= 3 : false,
  gBiggest ? `${gBiggest.questionLinesRaw} Zeilen` : '');
// Text WITHOUT spaces. This is the case where it actually broke, and it's
// worth calling out because every measurement of how many characters fit
// in three lines couldn't see it: they worked with random SENTENCES, and
// a sentence has spaces.
//
// umbrechen() only broke at spaces. A question made of a single 100
// character word was ONE line to it - too wide, but still just one. The
// shrinking kicks in from the fourth line, and so does the ellipsis;
// neither of them saw anything. What was left was truncate() at draw time,
// which threw away two thirds of the text. The form had explicitly
// allowed it.
{
  const wort = 'abshridmaj'.repeat(MAX_QUESTION / 10);
  const g = await drawGeometry(withQuestion(wort));
  check(`Eine Frage aus EINEM Wort mit ${MAX_QUESTION} Zeichen wird umbrochen, nicht abgeschnitten`,
    g.questionLinesRaw <= 3 && !g.frageGekuerzt,
    `${g.questionLinesRaw} Zeilen, gekürzt: ${g.frageGekuerzt}`);

  const mediumAnswer = 'abshridmaj'.repeat(MAX_ANSWER / 10);
  const gA = await drawGeometry({
    id: 94, closed: false, totalVotes: 0, totalUsd: 0, question: 'Kurz',
    options: [{ id: 1, label: mediumAnswer, votes: 0, usd: 12_345_678, share: 1 }],
  });
  check(`Eine Antwort aus EINEM Wort mit ${MAX_ANSWER} Zeichen steht ganz da`,
    gA.answersTruncated === 0, `${gA.answersTruncated} gekürzt bei ${gA.optSize} px`);

  // Counter-check: without the character-level wrap in umbrechen() this
  // would be one line. What's checked is the spot itself, because it's
  // exactly the one that used to be missing - `|| !line` stood here, and
  // that meant "too wide is fine too".
  check('Gegenprobe: umbrechen() zerlegt zu width Wörter wirklich',
    !/<= maxW \|\| !line/.test(appJs) && /rest\.slice\(n\)/.test(appJs));
  const gGegenWort = await page.evaluate(([w, width]) => {
    // Same function, same text - just a width the word truly doesn't fit
    // into. If this came out as 1, it wouldn't be breaking at all.
    const c = document.createElement('canvas').getContext('2d');
    c.font = '700 54px monospace';
    return window.umbrechen(c, w, width).length;
  }, [wort, 300]);
  check('Und zwar in so viele Zeilen, wie die Breite hergibt',
    gGegenWort > 3, `${gGegenWort} Zeilen bei 300 px`);
}

// And the emergency exit: if even the smallest font isn't enough, an
// ellipsis appears. A sentence that stops mid-word looks like a typo;
// three dots say it was trimmed. This case can no longer get in through
// the form and database - but the card also draws whatever is already
// sitting in storage.
const gRiesig = await drawGeometry(withQuestion(satz(400, 20)));
check('Reicht selbst 44 px nicht, wird die Frage sichtbar gekürzt',
  gRiesig.frageGekuerzt === true, `${gRiesig.questionLinesRaw} Zeilen bei ${gRiesig.questionSize} px`);
check('Und app.js hängt dafür ein Auslassungszeichen an',
  /questionLines\[2\] = `\$\{questionLines\[2\]\}…`/.test(appJs));

const gGegen = await drawGeometry({
  id: 93, closed: false, totalVotes: 3, totalUsd: 12_345_678,
  question: 'Kurz', options: [opt('M'.repeat(100), 2, 12_345_678, 1)],
});
check('Gegenprobe: eine Antwort mit 100 Zeichen wird gekürzt',
  gGegen.answersTruncated === 1, `${gGegen.answersTruncated} gekürzt`);

// And the database must know the same numbers. The form is the browser,
// and the browser is the part that can be bypassed.
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830010000_laengen.sql'), 'utf8');
check('Die Datenbank kennt dieselbe Grenze für die Frage',
  new RegExp(`btrim\\(question\\)\\) between 1 and ${MAX_QUESTION}`).test(migration));
check('Und dieselbe für die Antworten',
  new RegExp(`btrim\\(label\\)\\) between 1 and ${MAX_ANSWER}`).test(migration));

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden. Bilder in preview/poll-bild-*.png\n`);
process.exit(durch.length ? 1 : 0);
