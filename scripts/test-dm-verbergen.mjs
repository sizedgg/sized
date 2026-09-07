// ============================================================================
// Ansem takes a conversation out of his inbox.
//
// The claim in question has TWO sides:
//
//   For Ansem, the row disappears - but not without a trace. It gets counted
//   and comes back via a toggle. Without that, hiding would be a dead end:
//   hidden stays hidden here, even if the other person keeps writing (the
//   list is sorted by balance, not by time, so there is no movement at all
//   that would bring a conversation back).
//
//   For the other person, NOTHING changes. They see their history, they can
//   keep writing. That is not carelessness, it is the decision: whoever is
//   allowed to write here holds a minimum balance for it. What that buys is
//   the right to write, not the right to a reply.
//
// The first half is tested in the browser with the real renderThreads(), the
// second in the migration - the row rules are the part that actually
// decides, and no browser can confirm that.
//
//   node scripts/test-dm-verbergen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260831010000_dm_verbergen.sql'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const parts = [
  cut('const HANDLE_TONES', '\n'),
  cut('const handleOf =', '\n'),
  cut('function toneOf(wallet) {', '\n}') + '\n}',
  cut('const esc =', '\n\n'),
  cut('const TIERS =', '\n'),
  cut('function shortUsd(', '\n}') + '\n}',
  cut('function renderThreads() {', '\n}\n') + '\n}',
  // The bounds of the scroll marker, so the checks below stay tied to the
  // source and not to numbers copied by hand.
  cut('const STRICH_MAX =', '\n'),
  cut('const STRICH_MIN =', '\n'),
].join('\n');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(root, 'public', pfad);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    return res.writeHead(404).end('');
  }
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Test */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// Six conversations: two hidden, one of them also below the threshold.
// That last case is the interesting one - it decides which of the two rows
// below it gets counted in.
const THREADS = [
  { wallet: 'AAA1111111111111111111111111111111111111', usd: 50_000, unread: 0, preview: 'a', hidden: false },
  { wallet: 'BBB2222222222222222222222222222222222222', usd: 20_000, unread: 1, preview: 'b', hidden: true },
  { wallet: 'CCC3333333333333333333333333333333333333', usd: 10_000, unread: 0, preview: 'c', hidden: false },
  { wallet: 'DDD4444444444444444444444444444444444444', usd: 5_000, unread: 0, preview: 'd', hidden: true },
  { wallet: 'EEE5555555555555555555555555555555555555', usd: 800, unread: 0, preview: 'e', hidden: false },
  { wallet: 'FFF6666666666666666666666666666666666666', usd: 400, unread: 0, preview: 'f', hidden: true },
];

const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
    const openThread = () => {};
    const state = {
      cfg: { symbol: 'ANSEM', min_dm_usd: 0 }, dmMinEntwurf: null,
      zeigeVerborgene: false, activeThread: null, dmHideAvailable: true,
      dmThreads: ${JSON.stringify(THREADS)},
    };
    ${parts}
    window.state = state;
    window.renderThreads = renderThreads;
  `,
});
await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('.app').hidden = false;
  for (const p of document.querySelectorAll('.pane')) p.hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-admin').hidden = false;
});

const stand = () => page.evaluate(() => {
  window.renderThreads();
  const sicht = (el) => el && !el.hidden;
  return {
    lines: [...document.querySelectorAll('.thread')].map((t) => t.dataset.wallet.slice(0, 3)),
    verborgenZeile: sicht(document.querySelector('#thread-versteckt'))
      ? document.querySelector('#thread-versteckt-zahl').textContent : null,
    button: document.querySelector('#btn-versteckt').textContent,
    knopfSichtbar: sicht(document.querySelector('#thread-versteckt')),
    // What's shown when the list is empty. The sentence is not always the
    // same: in the hidden view, the inbox is not empty.
    empty: document.querySelector('#thread-items .empty')?.textContent ?? null,
    // Where the unread-message dot sits and whether it gets drawn at all.
    // ::before can't be clicked, but it can be measured.
    punkte: [...document.querySelectorAll('.thread')].filter((t) => {
      const v = getComputedStyle(t.querySelector('.w'), '::before');
      return v.content === '""' && v.width !== 'auto' && parseFloat(v.width) > 0;
    }).map((t) => t.dataset.wallet.slice(0, 3)),
  };
});

console.log('\nGespraeche verbergen\n');

// --- 1. Collapsed -----------------------------------------------------------
let s = await stand();
check('Verborgene stehen nicht in der Liste',
  s.lines.join(',') === 'AAA,CCC,EEE', s.lines.join(','));
check('Sie werden aber counted',
  s.verborgenZeile === '3 conversations hidden by you', String(s.verborgenZeile));
// The toggle names the ACTION, not the state. A toggle that names the state
// reads as its own opposite in half the cases.
check('Der Schalter sagt, was ein Druck tut', s.button === 'Show', s.button);

// --- 1b. Where the count row sits -------------------------------------------
//
// It sits AT THE TOP of the header bar, under the slider, and so stays put
// while scrolling. With forty conversations the list is 1,674 px long -
// below it, the row would only be visible after scrolling, and then hiding
// would be a dead end all over again.
//
// Above it used to be a SECOND count row: how many conversations the
// threshold filters out. That one is removed, and this check pins that down.
// The reason is the slider itself - it sits right above and names the number
// being filtered on. Two rows stacked on top of each other, both saying "N
// hidden", were one piece of information too many, and right above the
// first row of the list, of all places.
{
  const lage = await page.evaluate(() => {
    const peek = document.querySelector('.thread-top-bar');
    const liste = document.querySelector('#thread-items');
    const v = document.querySelector('#thread-versteckt');
    return {
      verstecktInKopf: peek.contains(v),
      vorDerListe: Boolean(
        liste.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_PRECEDING),
      schwellenzeileWeg: !document.querySelector('#thread-hidden'),
    };
  });
  check('Die Verborgen-Zeile steht in der Kopfleiste', lage.verstecktInKopf);
  check('Und damit vor der Liste', lage.vorDerListe);
  // Checked explicitly and not just left out: whoever brings the threshold
  // counter back should trip over this and find the reason above.
  check('Der Schwellenzaehler ist raus und bleibt raus',
    lage.schwellenzeileWeg && !/thread-hidden/.test(html));

  // --- And where the scrollbar starts ---------------------------------------
  //
  // What scrolls is the INNER box, not the whole column. Otherwise the bar
  // on the right runs the full height - so also next to the header, the
  // threshold and the hidden-count row, which all stay fixed. A thumb next
  // to something that doesn't move says nothing, and it comes out longer for
  // it too.
  //
  // Both are checked: that the column itself does NOT scroll (otherwise
  // there would be two bars stacked on top of each other) and that the
  // scrolling area only starts below the header.
  const rollen = await page.evaluate(() => {
    // Six conversations don't scroll - this one question needs a list
    // longer than its box. Switched back afterwards, so the checks that
    // follow find their own dataset in place.
    const echte = window.state.dmThreads;
    window.state.dmThreads = Array.from({ length: 40 }, (_, i) => ({
      wallet: `Z${String(i).padStart(2, '0')}${'x'.repeat(41)}`,
      usd: 100000 - i * 1000, unread: 0, preview: 'x', hidden: false,
    }));
    window.renderThreads();

    const column = document.querySelector('.thread-list');
    const items = document.querySelector('#thread-items');
    const header = document.querySelector('.thread-top-bar');
    const mass = {
      spalteRollt: column.scrollHeight > column.clientHeight,
      itemsRollt: items.scrollHeight > items.clientHeight,
      itemsOben: Math.round(items.getBoundingClientRect().top),
      kopfUnten: Math.round(header.getBoundingClientRect().bottom),
      bahn: items.clientHeight,
      spaltenhoehe: column.clientHeight,
    };

    window.state.dmThreads = echte;
    window.renderThreads();
    return mass;
  });
  check('Die Spalte selbst rollt nicht', !rollen.spalteRollt);
  check('Gerollt wird die Zeilenliste', rollen.itemsRollt);
  check('Und sie beginnt erst under der Kopfleiste',
    rollen.itemsOben >= rollen.kopfUnten - 1,
    `${rollen.itemsOben} gegen ${rollen.kopfUnten}`);
  // The counter-check for the length: the track is shorter than the column
  // by the header's height. Without it, the check above would also pass if
  // the list took up the full height.
  check('Die Bahn ist um die Kopfleiste kuerzer',
    rollen.bahn < rollen.spaltenhoehe - 40,
    `${rollen.bahn} von ${rollen.spaltenhoehe} px`);

  // --- And what stands next to it on the right ------------------------------
  //
  // Not the browser's own scrollbar, but our own small marker.
  //
  // The reason is what the previous three attempts foundered on: the
  // browser's own bar has no length you get to choose - it's the share of
  // the visible in the whole. With three conversations it fills almost the
  // entire track. It's "small" nowhere in that setup, no matter how narrow
  // you make it.
  //
  // On top of that, there was no way to measure from here what a real
  // browser makes of it: Chrome decides for itself between an overlaid and a
  // space-consuming bar, and the Chromium these tests use only knows the
  // former. Every measurement reported 0 px and so said nothing. A marker of
  // our own can be measured like any other element - that's what makes the
  // checks here possible in the first place.
  const marker = await page.evaluate(() => {
    const liste = document.querySelector('#thread-items');
    const m = document.querySelector('#thread-strich');

    const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const leucht = (s) => {
      const [r, g, b] = s.match(/[\d.]+/g).slice(0, 3).map(Number);
      // color() returns 0..1, rgb() 0..255 - tell them apart by the jump in
      // order of magnitude. Without this you measure against black and get
      // a number that looks fine and means nothing.
      const f = (r <= 1 && g <= 1 && b <= 1) ? 1 : 1 / 255;
      return 0.2126 * kanal(r * f) + 0.7152 * kanal(g * f) + 0.0722 * kanal(b * f);
    };
    const grund = getComputedStyle(document.querySelector('.thread-list')).backgroundColor;
    const [x, y] = [leucht(getComputedStyle(m).backgroundColor), leucht(grund)]
      .sort((a, b) => b - a);

    return {
      browserleiste: liste.offsetWidth - liste.clientWidth,
      // The measured width alone isn't enough: wherever Chrome draws an
      // overlay bar, it's 0 even without any rule at all. Only the property
      // itself says the bar is really switched off.
      abgeschaltet: getComputedStyle(liste).scrollbarWidth === 'none',
      height: m.offsetHeight,
      width: m.offsetWidth,
      inRuhe: Number(getComputedStyle(m).opacity),
      max: STRICH_MAX,
      min: STRICH_MIN,
      // How far the marker sits from the outer edge of the column. 0
      // means: it read right on the border and is the border for its length.
      vonDerKante: document.querySelector('.thread-list').getBoundingClientRect().right
        - m.getBoundingClientRect().right,
      kontrast: (x + 0.05) / (y + 0.05),
    };
  });
  check('Der Browser zeichnet keine eigene Leiste mehr',
    marker.browserleiste === 0 && marker.abgeschaltet,
    `${marker.browserleiste} px, abgeschaltet: ${marker.abgeschaltet}`);
  // The length itself is tied to the list and is set while scrolling; it's
  // checked in test-realtime-switching, where list lengths can be dictated
  // freely. What matters here is what only a real browser can tell us: that
  // this actually turns into something visible.
  // The value from the CSS is the initial state, before the first scroll.
  // It has to lie within the range app.js sets afterwards - otherwise the
  // marker jumps on the first scroll.
  check('Die Anfangshoehe liegt in der Spanne',
    marker.height >= marker.min && marker.height <= marker.max,
    `${marker.height} px, erlaubt ${marker.min}–${marker.max}`);
  check('Und sie ist ein Strich, keine Spalte', marker.width <= 4,
    `${marker.width} px`);
  // It doesn't float inside the column, it sits on its edge - for its
  // length, it is the border. Sitting further in, it looked like a foreign
  // object; that's the difference this is about.
  check('Sie liegt auf dem Rahmen', Math.abs(marker.vonDerKante) < 0.5,
    `${marker.vonDerKante.toFixed(1)} px von der Aussenkante`);
  // Small must not mean gone. --bg-3 stood at 1.17:1 - just barely
  // something as a wide area, nothing at all any more as a two-pixel-wide
  // marker.
  check('Sie ist noch zu sehen', marker.kontrast >= 1.8,
    `${marker.kontrast.toFixed(2)}:1`);
  check('In Ruhe ist sie unsichtbar', marker.inRuhe === 0, String(marker.inRuhe));
}

// --- 2. Looking at the hidden ones ------------------------------------------
//
// They stand INSTEAD of the others, not mixed in among them.
//
// At first they were mixed in and dimmed. That read wrong: whoever checks
// who they took out then has to search forty rows for three - and the
// dimming was the only clue about which ones were meant.
await page.evaluate(() => { window.state.zeigeVerborgene = true; });
s = await stand();
check('Es stehen NUR die verborgenen da',
  s.lines.join(',') === 'BBB,DDD,FFF', s.lines.join(','));
// The row above has to say which list you're looking at. If it still said
// "3 conversations hidden by you", you'd have three rows and a number that
// seems to be counting the same thing - and no hint that the inbox isn't
// what you're currently looking at.
check('Und die Zeile darueber sagt, welche Liste das ist',
  s.verborgenZeile === 'Showing 3 hidden conversations', String(s.verborgenZeile));
check('Der Schalter leads back', s.button === 'Back', s.button);
await page.evaluate(() => { window.state.zeigeVerborgene = false; });
s = await stand();
check('Zurueck steht wieder der Posteingang da',
  s.lines.join(',') === 'AAA,CCC,EEE', s.lines.join(','));

// --- 3. Only those above the threshold get counted --------------------------
//
// The case in question: FFF is below the threshold AND hidden. It wouldn't
// show up even without hiding - counting it in would mean stating a number
// that changes by itself as soon as the threshold is lowered.
await page.evaluate(() => { window.state.cfg.min_dm_usd = 1000; });
s = await stand();
check('Unter der Schwelle faellt zuerst heraus',
  s.lines.join(',') === 'AAA,CCC', s.lines.join(','));
check('Gezaehlt werden nur die beiden ueber der Schwelle',
  s.verborgenZeile === '2 conversations hidden by you', String(s.verborgenZeile));
await page.evaluate(() => { window.state.cfg.min_dm_usd = 0; });

// --- 4. No row when nothing is hidden ---------------------------------------
await page.evaluate(() => {
  window.state.zeigeVerborgene = false;
  window.state.dmThreads.forEach((t) => { t.hidden = false; });
});
s = await stand();
check('Ohne verborgene Gespraeche steht die Zeile gar nicht da',
  s.verborgenZeile === null && s.lines.length === 6);

// --- 4b. Bringing back the last hidden conversation -------------------------
//
// The dead end, and the worst kind of it: you're in the hidden view, you
// bring back the last conversation - and the row with the back button
// disappears along with it. What's left is an empty list and the sentence
// "Inbox is empty", which is also wrong at this point: the inbox is full,
// it's just sitting somewhere else right now.
//
// A fallback for this already existed in the code, but BELOW the line that
// assembles the list - so it only took effect on the next call, which
// nobody triggers. It's removed rather than moved to the right place:
// swapping out the whole list behind the scenes just because the
// conversation you brought back happened to be the last one is a movement
// nobody triggered.
await page.evaluate(() => {
  window.state.dmThreads.forEach((t) => { t.hidden = false; });
  window.state.dmThreads.find((t) => t.wallet.startsWith('BBB')).hidden = true;
  window.state.zeigeVerborgene = true;
});
s = await stand();
check('Ein einzelnes verborgenes Gespraech steht da',
  s.lines.join(',') === 'BBB', s.lines.join(','));

await page.evaluate(() => {
  window.state.dmThreads.find((t) => t.wallet.startsWith('BBB')).hidden = false;
});
s = await stand();
check('Zurueckgeholt ist die Liste empty', s.lines.length === 0, s.lines.join(','));
check('Die Zeile bleibt stehen und nennt die Null',
  s.verborgenZeile === 'Showing 0 hidden conversations', String(s.verborgenZeile));
check('Und mit ihr der Weg back',
  s.knopfSichtbar && s.button === 'Back', `${s.knopfSichtbar} / ${s.button}`);
check('Der leere Hinweis behauptet keinen clear Posteingang',
  s.empty === 'Nothing hidden any more.', String(s.empty));

// And the button then does what it promises, too.
await page.evaluate(() => { window.state.zeigeVerborgene = false; });
s = await stand();
check('Zurueck leads in den vollen Posteingang',
  s.lines.length === 6 && s.verborgenZeile === null, s.lines.join(','));

// --- 5. Old database, new interface -----------------------------------------
//
// The frontend lives on a webspace, the migration in Supabase; both get
// uploaded by hand and can therefore end up out of sync in age. That's
// exactly what happened: the button was there, and pressing it produced
// "Could not find the table 'public.dm_hidden' in the schema cache" - a
// message from the engine room, for a button the page itself had offered.
//
// The state is detected from the column the new view delivers. Here it's
// tested with rows WITHOUT it - exactly what a database returns before the
// migration.
{
  await page.evaluate(() => {
    // eslint-disable-next-line no-param-reassign
    window.state.dmThreads = window.state.dmThreads.map(({ hidden, ...rest }) => rest);
    window.state.dmHideAvailable = false;
  });
  const alt = await stand();
  check('Ohne die Migration gibt es keine Verborgen-Zeile',
    alt.verborgenZeile === null, String(alt.verborgenZeile));
  check('Und es faellt auch nichts aus der Liste',
    alt.lines.length === 6, alt.lines.join(','));
  // And the check has to detect the state on its own, not just trust the
  // flag that was set.
  const erkannt = await page.evaluate(() => {
    window.state.dmHideAvailable = true;
    // The same line as in loadThreads().
    if (window.state.dmThreads?.length) {
      window.state.dmHideAvailable = 'hidden' in window.state.dmThreads[0];
    }
    return window.state.dmHideAvailable;
  });
  check('Der Zustand wird an den Daten erkannt, nicht geraten', erkannt === false);
}
check('Und der Knopf im Gespraech hangs an derselben Angabe',
  /button\.hidden = !state\.dmHideAvailable;/.test(appJs));

// --- 5b. The unread-message dot ---------------------------------------------
//
// It sits TO THE LEFT OF THE AMOUNT, not by the name: in this list the eye
// travels right, to where you decide which conversation to open.
//
// What's checked is that it hangs off exactly the unread rows - not off all
// of them and not off none. A rule that always draws it or never draws it
// would look plausible either way in a screenshot.
{
  await page.evaluate(() => {
    window.state.zeigeVerborgene = false;
    window.state.dmThreads.forEach((t) => { t.hidden = false; t.unread = 0; });
    window.state.dmThreads[1].unread = 1;
    window.state.dmThreads[4].unread = 2;
  });
  const p = await stand();
  check('Der Punkt hangs genau an den ungelesenen Zeilen',
    p.punkte.join(',') === 'BBB,EEE', p.punkte.join(',') || 'keiner');
  // And it's visible: measured against the list's background. A dot you
  // can't see is the same as no dot.
  const kontrast = await page.evaluate(() => {
    const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const leucht = (s) => {
      const [r, g, b] = s.match(/[\d.]+/g).slice(0, 3).map(Number);
      return 0.2126 * kanal(r / 255) + 0.7152 * kanal(g / 255) + 0.0722 * kanal(b / 255);
    };
    const line = document.querySelector('.thread.is-unread');
    const dot = getComputedStyle(line.querySelector('.w'), '::before').backgroundColor;
    const grund = getComputedStyle(document.querySelector('.thread-list')).backgroundColor;
    const [x, y] = [leucht(dot), leucht(grund)].sort((a, b) => b - a);
    return (x + 0.05) / (y + 0.05);
  });
  // 3:1 is the threshold for anything that isn't text - a dot counts.
  check('Und er hebt sich vom Grund ab', kontrast >= 3, `${kontrast.toFixed(2)}:1`);
  await page.evaluate(() => {
    window.state.dmThreads.forEach((t) => { t.unread = 0; });
  });
}

// --- 5c. The previews all end at the same spot ------------------------------
//
// With "You:" in front as much as without. It used to be one width for
// everyone, and "You:" pushed the text four characters to the right - every
// other row ended further out than its neighbors. A ragged edge right in
// the middle of a list whose entire order consists of reading it top to
// bottom.
//
// What's measured is the RENDERED edge, not the rule: the rule computes in
// ch and rem, and only the browser can say whether the arithmetic works
// out.
{
  const kanten = await page.evaluate(() => {
    const long = 'I sold half my bag last week and now I am not sure that was right';
    document.querySelector('#thread-items').innerHTML =
      `<button class="thread" data-wallet="ohne"><span class="h t0">R8C</span>`
      + `<span class="thread-prev">${long}</span><span class="w">$1.2M</span></button>`
      + `<button class="thread" data-wallet="mit"><span class="h t1">aQ4</span>`
      + `<span class="thread-du">You:</span>`
      + `<span class="thread-prev">${long}</span><span class="w">$88K</span></button>`;
    const [ohne, mit] = [...document.querySelectorAll('.thread-prev')]
      .map((e) => e.getBoundingClientRect().right);
    return { ohne: +ohne.toFixed(2), mit: +mit.toFixed(2), ab: Math.abs(ohne - mit) };
  });
  check('Vorschau mit und ohne "You:" endet an derselben Stelle',
    kanten.ab < 1, `${kanten.ohne} gegen ${kanten.mit} px`);

  // Counter-check: without the second width it frays out - by exactly the
  // four characters of "You:". Without this, there'd be a measurement here
  // that nobody knows can actually see anything.
  const ohneRegel = await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.thread-du + .thread-prev { max-width: var(--vorschau) !important; }';
    document.head.appendChild(st);
    const [ohne, mit] = [...document.querySelectorAll('.thread-prev')]
      .map((e) => e.getBoundingClientRect().right);
    st.remove();
    return Math.abs(ohne - mit);
  });
  check('Gegenprobe: ohne die zweite Breite laufen sie auseinander',
    ohneRegel > 20, `${ohneRegel.toFixed(1)} px Unterschied`);
}

// --- 6. Counter-check --------------------------------------------------------
// Without this, there'd be a measurement here that nobody knows can
// actually see anything.
await page.evaluate(() => {
  window.state.dmHideAvailable = true;
  window.state.dmThreads.forEach((t) => { t.hidden = false; });
  window.state.dmThreads[0].hidden = true;
});
s = await stand();
check('Gegenprobe: ein einzelnes verborgenes verschwindet wirklich',
  !s.lines.includes('AAA') && s.verborgenZeile === '1 conversation hidden by you',
  `${s.lines.join(',')} / ${s.verborgenZeile}`);

await page.close();
await browser.close();
server.close();

// ---------------------------------------------------------------------------
// The other half: the database
//
// It's the part that actually decides - the browser is the part you can
// bypass. What's checked here is the TEXT of the migration and not its
// effect; that was verified against a real Postgres before the interface
// was built. What's written here pins down that the four decisions don't
// get quietly reverted.
// ---------------------------------------------------------------------------
console.log('\nWas die Datenbank dazu sagt\n');

check('Nur Ansem darf die Liste ueberhaupt lesen',
  /create policy dm_hidden_admin_select[\s\S]*?for select to authenticated using \(app\.is_admin\(\)\)/
    .test(migration));
check('Nur Ansem darf verbergen',
  /create policy dm_hidden_admin_insert[\s\S]*?with check \(app\.is_admin\(\)\)/.test(migration));
check('Nur Ansem darf zurueckholen',
  /create policy dm_hidden_admin_delete[\s\S]*?using \(app\.is_admin\(\)\)/.test(migration));
// This is the line that makes sure nobody can tell from their own row that
// it was hidden: the subquery runs under THEIR privileges, and dm_hidden
// hands them back no row at all.
check('Die Ansicht running mit den Rechten des Aufrufers',
  /create or replace view public\.dm_threads\s*\nwith \(security_invoker = on\)/.test(migration));
check('Und liefert hidden als Spalte, statt selbst zu filtern',
  /as\s+hidden/.test(migration) && !/where[\s\S]{0,80}not exists[\s\S]{0,80}dm_hidden/i.test(migration));
// Checked explicitly and not just left out: hiding must NOT take away the
// other person's ability to write. Whoever wants to change that should trip
// over this and find the reason in the migration's header.
check('Verbergen fasst die Schreibregeln fuer dms nicht an',
  !/dms_insert_user/.test(migration) && !/dm_hidden/.test(
    fs.readFileSync(path.join(root, 'supabase', 'migrations',
      '20260825030000_min_balance_for_dms.sql'), 'utf8')));

console.log('\nUnd die Oberflaeche\n');
check('Der Verbergen-Knopf steht NEBEN dem Titel, nicht darin',
  /<div class="thread-kopf">[\s\S]*?id="thread-title"[\s\S]*?id="btn-hide-thread"[\s\S]*?<\/div>/
    .test(html),
  'sonst raeumt renderThread() bei jedem Oeffnen seinen Zuhoerer weg');
check('Und bekommt seinen Zuhoerer genau einmal',
  (appJs.match(/\$\('#btn-hide-thread'\)\.addEventListener/g) || []).length === 1);
check('Ohne offenes Gespraech ist er weg',
  /\$\('#btn-hide-thread'\)\.hidden = true;/.test(appJs));
check('Geschrieben wird erst in die Datenbank, dann in die Anzeige',
  appJs.indexOf("from('dm_hidden')") < appJs.indexOf('line.hidden = verbergen'));

// ---------------------------------------------------------------------------
console.log('\nDer Sperrhinweis\n');
//
// Whoever sees this notice already has their own balance sitting up in the
// top right - the same number from the same source, a couple of handbreadths
// above. Here it used to stand a second time ("You hold $102."), and two
// spots for the same number are two spots that can drift apart.
//
// Executed, not just read: gateText() comes verbatim from app.js and is
// really called here. A test on the source text alone would have found
// "You hold" in the comment above it too - and it's there on purpose.
const gate = (() => {
  const source = cut('function gateText(min, was) {', '\n}') + '\n}';
  const esc = (t) => String(t);
  const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
  const state = { cfg: { symbol: 'ANSEM' }, me: { usd: 102 } };
  const f = new Function('esc', 'fmtUsd', 'state', `${source}; return gateText;`)(esc, fmtUsd, state);
  return f(1000, 'to message Ansem');
})();

console.log(`     ${gate}`);
check('Der Hinweis nennt die Schwelle', /1,000/.test(gate) && /ANSEM/.test(gate));
check('Und sagt, wofuer sie gilt', /to message Ansem/.test(gate));
check('Aber nicht den eigenen Bestand',
  !/You hold/i.test(gate) && !/102/.test(gate), gate);

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
