// ============================================================================
// The tabs in the header bar stay put.
//
// ----------------------------------------------------------------------------
// The bug that triggered this test
//
// The header was a flex row, and .tabs had margin-inline: auto. But that
// doesn't center a flex item in the box, it centers it in the LEFTOVER SPACE
// between its neighbors. So the tabs sat on the midpoint between the logo on
// the left and the block on the right - and that point drifts as soon as
// either one gets wider.
//
// It came up switching between Ansem and a regular user: a profile picture
// and "$12.4M" against three characters and "$153" are two different widths
// on the right. Measured, the tabs sat 11 px apart.
//
// The difference has since grown much bigger, and with it the value of this
// check: for everyone except Ansem, the top right no longer shows the
// three-character handle but their own address as "EMwU…QLxP" - nine
// characters instead of three. Ansem still has his picture there. Between
// the two roles there's now about 50 px of width.
//
// The worse case stood right next to it and nobody noticed: the amount on
// the right gets refreshed every minute. "$153" turns into "$1.2K", and the
// tabs shifted by 4.5 px - without anyone touching anything. A button that
// wanders out from under your finger because a number changed somewhere
// else.
//
// ----------------------------------------------------------------------------
// What's checked here
//
// Not "display: grid is in the stylesheet", but the claim behind it: the
// tabs sit at the midpoint of the header, regardless of who is logged in and
// how wide their balance currently is. That holds even if someone solves the
// path there differently.
//
// On a phone something else applies, and is therefore checked differently:
// there the header wraps, the tabs sit as their own row below and take the
// full width. "Centered" isn't a meaningful question there - "equally wide
// and in the same spot" is.
//
//   node scripts/test-kopfzeile.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

// Name and hue verbatim from app.js. Rebuilding them here would test our own
// version - and the hue hangs off a hash computed over the full address,
// which isn't something you write out correctly twice.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b + bis.length);
};
const kennungCode = cut('const HANDLE_TONES', '\n')
  + cut('const handleOf =', '\n')
  + cut('function toneOf(wallet) {', '\n}');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(publicDir, pfad);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.writeHead(404).end('');
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

// The header is set by hand into the state renderMe() produces in
// production - without logging in there's otherwise nothing to see at all.
// What matters is that the WIDTHS are right: the profile picture against
// three characters, and a long amount against a short one. Exactly those are
// what shifted the tabs.
// An address as long as a real one: the hue is computed over the FULL
// address, not the three characters. With a short placeholder you'd be
// measuring a hue that wouldn't exist in production.
const ADRESSE = 'EMwUZ7s9Kk3zR2xTvN8aQ1cLmP4dHjYbXfGwQLxP';

const measure = async (rolle, amount, width, adresse = ADRESSE) => {
  const page = await browser.newPage({ viewport: { width: width, height: 200 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: `${kennungCode}\nwindow.handleOf = handleOf; window.toneOf = toneOf;` });
  await page.waitForTimeout(250);
  const r = await page.evaluate(([istAnsem, geld, adresse]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    // Exactly the two shapes renderMe() builds. The whole element gets
    // swapped, not just its contents: Ansem gets his picture, everyone else
    // their three characters in their own color.
    document.querySelector('#me-handle').outerHTML = istAnsem
      ? '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
        + '<span class="kuerzel">4bo</span></span>'
      : `<span id="me-handle" class="handle h t${window.toneOf(adresse)}"`
        + `>${window.handleOf(adresse)}</span>`;
    // Just like renderMe(): for Ansem there's no amount in the top right.
    const h = document.querySelector('#me-holdings');
    h.hidden = istAnsem;
    if (!istAnsem) h.textContent = geld;
    document.querySelector('[data-tab="dms"]').classList.toggle('zeigt-s', istAnsem);
    const header = document.querySelector('.topbar').getBoundingClientRect();
    const tabs = document.querySelector('.tabs').getBoundingClientRect();
    const firstEl = document.querySelector('[data-tab="polls"]').getBoundingClientRect();
    const kennung = document.querySelector('#me-handle');
    return {
      kopfMitte: header.left + header.width / 2,
      tabsMitte: tabs.left + tabs.width / 2,
      tabsOben: Math.round(tabs.top),
      ersterLinks: Math.round(firstEl.left * 10) / 10,
      tabsBreite: Math.round(tabs.width),
      kennungText: kennung.textContent,
      kennungFarbe: getComputedStyle(kennung).color,
      betragFarbe: getComputedStyle(document.querySelector('#me-holdings')).color,
      betragDa: !document.querySelector('#me-holdings').hidden,
      kennungTag: kennung.tagName.toLowerCase(),
      rechtsBreite: Math.round(document.querySelector('.me').getBoundingClientRect().width),
    };
  }, [rolle === 'ansem', amount, adresse]);
  await page.close();
  return r;
};

console.log('\nAm Rechner: die Reiter liegen auf der Mitte\n');

const cases = [
  ['ansem', '$12.4M'],
  ['nutzer', '$153'],
  ['nutzer', '$1.2K'],
  ['nutzer', '<$1'],
];
const measured = [];
for (const [rolle, amount] of cases) {
  const r = await measure(rolle, amount, 1000);
  measured.push({ rolle, amount, ...r });
  const ab = Math.abs(r.tabsMitte - r.kopfMitte);
  check(`${rolle} mit ${amount}`, ab <= 1,
    `Mitte der Reiter ${r.tabsMitte.toFixed(1)}, Mitte der Kopfzeile ${r.kopfMitte.toFixed(1)}`);
}

// And the claim this is really about: nothing moves between the cases. The
// individual checks above could all report "centered" and the tabs could
// still be different widths - the midpoint would be the same then, not the
// position.
const centers = measured.map((g) => g.tabsMitte);
check('Die Mitte ist in allen Fällen dieselbe',
  Math.max(...centers) - Math.min(...centers) <= 1,
  centers.map((m) => m.toFixed(1)).join(' / '));

// For the same user, nothing at all is allowed to move, not even the left
// edge: their balance changes by itself every minute.
const nurNutzer = measured.filter((g) => g.rolle === 'nutzer');
const kanten = nurNutzer.map((g) => g.ersterLinks);
check('Für denselben Nutzer bewegt sich auch die linke Kante nicht',
  Math.max(...kanten) - Math.min(...kanten) <= 0.5,
  kanten.join(' / ') + ' px');

// Between Ansem and a user, the group gets NARROWER - and stays centered
// while it does.
//
// Here used to stand the opposite: "not even by the width of the s". So the
// "s" was only made invisible, its space stayed put. The price for that was
// a bug visible for every user, at every moment the tab is selected: the
// border and area were sized for "DMs", the text inside read "DM" - one
// character-width of air on the right, none on the left.
//
// So one bug EVERYONE sees was traded for one NOBODY sees: the offset is
// only noticeable if you put two screens side by side, since no single
// person sees both roles.
//
// What was NOT negotiable here, and is therefore already checked further
// up: the midpoint of the group has to stay the same in every case. And it
// does, because the header is a grid (1fr auto 1fr) - the group gets
// narrower instead of drifting.
const ansem = measured.find((g) => g.rolle === 'ansem');
const narrower = ansem.tabsBreite - nurNutzer[0].tabsBreite;
check('Ohne das "s" ist die Reitergruppe narrower',
  narrower > 0, `${ansem.tabsBreite} px / ${nurNutzer[0].tabsBreite} px`);
// And by EXACTLY one character. More would mean something else moved along
// with it - a padding, a gap.
{
  const zelle = await (async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 200 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const b = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute; font-family: var(--mono); font-size: 1rem;';
      probe.textContent = 's'.repeat(20);
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 20;
      probe.remove();
      return w;
    });
    await page.close();
    return b;
  })();
  check('Und zwar um genau eine Zeichenbreite',
    Math.abs(narrower - zelle) <= 1.5,
    `${narrower} px Unterschied, eine Zelle ist ${zelle.toFixed(1)} px`);
}
// The real claim: the "s" is GONE and not just invisible. A visibility:
// hidden would look identical in a screenshot and leave the space standing -
// exactly the bug this is about.
check('Das "s" nimmt seinen Platz mit, statt nur unsichtbar zu sein',
  /\.dm-s \{ display: none; \}/.test(css)
  && !/\.dm-s \{ visibility: hidden; \}/.test(css));

console.log('\nGegenprobe: Der Test sieht den alten Fehler auch\n');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 200 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: `${kennungCode}\nwindow.handleOf = handleOf; window.toneOf = toneOf;` });
  // Exactly the old setup: flex row, tabs centered via margin-inline.
  await page.addStyleTag({ content: '.topbar { display: flex; } .tabs { margin-inline: auto; }' });
  const lage = async (istAnsem, geld) => page.evaluate(([a, g, adresse]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    document.querySelector('#me-handle').outerHTML = a
      ? '<span id="me-handle" class="handle h admin-name">'
        + '<span class="kuerzel">4bo</span></span>'
      : `<span id="me-handle" class="handle h t${window.toneOf(adresse)}"`
        + `>${window.handleOf(adresse)}</span>`;
    const h = document.querySelector('#me-holdings');
    h.hidden = a;
    if (!a) h.textContent = g;
    document.querySelector('[data-tab="dms"]').classList.toggle('zeigt-s', a);
    const t = document.querySelector('.tabs').getBoundingClientRect();
    return t.left + t.width / 2;
  }, [istAnsem, geld, ADRESSE]);
  const a1 = await lage(true, '$12.4M');
  const n1 = await lage(false, '$153');
  const n2 = await lage(false, '$1.2K');
  await page.close();
  check('Ohne das Raster wandern die Reiter – der Test würde anschlagen',
    Math.abs(a1 - n1) > 1 || Math.abs(n1 - n2) > 1,
    `Ansem ${a1.toFixed(1)}, Nutzer ${n1.toFixed(1)}, derselbe Nutzer eine Minute später ${n2.toFixed(1)}`);
}

console.log('\nWas peek right steht\n');
//
// Two different pieces of information, and the difference isn't taste:
//
//   The three characters are the NAME someone appears under here. They
//   stand next to their messages, in a quote, and in the inbox - the same
//   three characters in the same color everywhere.
//
// For a while, the shortened address (EMwU…QLxP) stood here instead, with
// the argument: in the top right, the question isn't "who am I" but "which
// wallet am I here as". The argument is correct and still isn't enough:
// whoever sees themself under a different name in the top right than next
// to their own messages sees themself under two names.
//
// The color carries the information along. It's computed from the FULL
// address, so it's different for every wallet - even two with the same
// three characters. That's exactly what it's there for.
{
  const nutzer = measured.find((g) => g.rolle === 'nutzer');
  check('Bei einem Nutzer stehen dort seine drei Zeichen',
    nutzer.kennungText === ADRESSE.slice(0, 3), nutzer.kennungText);

  // The same color as everywhere else, checked against the list of four
  // hues from the stylesheet - not against a value copied down here. Whoever
  // changes the hues shouldn't have to touch anything here.
  const tones = [...css.matchAll(/\.h\.t\d \{ color: (#[0-9a-f]{6}); \}/gi)]
    .map((m) => m[1]);
  check('Das Blatt kennt vier Namensfarben', tones.length === 4, tones.join(' '));
  const alsRgb = (hex) => 'rgb(' + (hex.replace('#', '').match(/../g) || [])
    .map((h) => parseInt(h, 16)).join(', ') + ')';
  check('Und die Kennung traegt eine davon',
    tones.map(alsRgb).includes(nutzer.kennungFarbe),
    `${nutzer.kennungFarbe} gegen ${tones.map(alsRgb).join(' / ')}`);

  // NOT the color of the amount next to it - that was the old rule, and it's
  // deliberately gone. Two pieces of information, two colors: who I am, and
  // how much I hold.
  check('Und nicht die Farbe des Betrags daneben',
    nutzer.kennungFarbe !== nutzer.betragFarbe,
    `Kennung ${nutzer.kennungFarbe}, Betrag ${nutzer.betragFarbe}`);

  // --- And who even sees the amount -----------------------------------------
  //
  // Only the users. For them it's the number everything hangs off: it
  // decides whether they're allowed to write, and it stands next to every
  // one of their messages.
  //
  // For Ansem it doesn't answer any question. He doesn't run up against any
  // threshold, and it would stand right above an inbox where every single
  // row already carries an amount - there, one more number isn't
  // information any more, it's something you read along and discard again.
  //
  // Both are checked, because only together do they make a rule and not
  // just a missing element.
  check('Ein Nutzer sieht seinen Bestand', nutzer.betragDa);
  check('Ansem nicht', !ansem.betragDa);
  // And renderMe() really ties this to the role. Without that, the
  // stylesheet could be hiding it on its own above, and the checks would
  // look the same either way.
  check('Und renderMe() entscheidet das an der Rolle',
    /holdings\.hidden = Boolean\(state\.me\.isAdmin\)/.test(appJs));
  // The tabs stay centered regardless - that's already covered right at the
  // top, but it now hinges on this: if an element on the right falls away,
  // the group drifts as soon as the header stops being a grid.

  // The hue hangs off the full address and not off the three characters.
  // Otherwise it would be exactly the look-alikes that got the same color -
  // exactly the ones the color exists for.
  const gleicherAnfang = ADRESSE.slice(0, 3) + 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
  const andersRum = await measure('nutzer', '$5,208', 1000, gleicherAnfang);
  check('Zwei Wallets mit denselben drei Zeichen bekommen verschiedene Farben',
    andersRum.kennungFarbe !== nutzer.kennungFarbe,
    `${nutzer.kennungFarbe} gegen ${andersRum.kennungFarbe}`);
  check('Und tragen trotzdem denselben Namen',
    andersRum.kennungText === nutzer.kennungText,
    `${nutzer.kennungText} / ${andersRum.kennungText}`);

  // And for neither of them a button: there's nothing to press here. The
  // tooltip next to Ansem's picture comes with the pointer and goes with
  // it - that needs no control element, and a button that does nothing on
  // click reads as broken.
  check('Bei beiden ist es kein Knopf',
    nutzer.kennungTag === 'span' && ansem.kennungTag === 'span',
    `${nutzer.kennungTag} / ${ansem.kennungTag}`);
  check('Und in app.js steht auch keiner',
    !/<button[^`]*id="me-handle"/.test(appJs),
    (appJs.match(/<\w+ id="me-handle"/g) || []).join(' , '));
}

console.log('\nDer Hinweis neben Ansems Profilbild\n');
//
// For him, a picture sits in the top right instead of an address - and a
// picture doesn't say which account you're on here. The tooltip supplies the
// information everyone else can read off without doing anything.
//
// And that's exactly why it appears on HOVER and not only on click: it's an
// explanation, not a control. Whoever has to press first to find out what it
// says has already guessed.
//
// A phone has no pointer, there a tap takes over. Both are checked here, in
// two windows with different capabilities - and that's not a formality:
// :hover stays stuck on some phones after a tap, which is why the rule in
// the stylesheet is deliberately wrapped in @media (hover: hover).
{
  // WITH app.js, unlike the measurements above: this is about behavior,
  // and that's where it lives. Without logging in, startup doesn't get
  // through, but the listeners are attached as soon as the module loads.
  const page = await browser.newPage({ viewport: { width: 1100, height: 220 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<button type="button" id="me-handle" class="handle h admin-name"'
      + ' aria-haspopup="true" aria-expanded="false" aria-controls="me-info">'
      + '<span class="kuerzel">4bo</span></button>';
    document.querySelector('#me-holdings').hidden = true;
  });
  check('Der Hinweis steht im Blatt', /id="me-info"/.test(html));
  check('Und sagt, mit welchem Konto man hier ist',
    /You are logged in as Ansem/i.test(html));
  // It hangs off the button as a description. That way a screen reader gets
  // the sentence even when it's not currently visible - a tooltip that only
  // the pointer brings up would otherwise not exist for it at all.
  check('Und hangs als Beschreibung am Bild',
    /aria-describedby="me-info"/.test(appJs), 'aria-describedby in renderMe');

  const sichtbar = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('#me-info')).display !== 'none');
  await page.mouse.move(5, 190);
  await page.waitForTimeout(120);
  check('Ohne Zeiger und ohne Tipp ist er nicht da', !(await sichtbar()));

  // The box sits TO THE LEFT of the picture, not below it and not to the
  // left of the whole group of picture, amount and log-out button.
  //
  // Measured via the REAL path, meaning with the pointer on the picture.
  // During the rebuild, a class used to sit here that no longer existed: the
  // box stayed on display: none, all measurements came back as null, and two
  // of the three checks still reported "ok" - null is simply smaller than
  // everything. A measurement on something invisible says nothing, but it's
  // happy to report anyway.
  await page.hover('#me-handle');
  await page.waitForTimeout(150);
  const lage2 = await page.evaluate(() => {
    const p = document.querySelector('#me-info').getBoundingClientRect();
    const bild = document.querySelector('#me-handle').getBoundingClientRect();
    return { right: Math.round(p.right), bildLinks: Math.round(bild.left),
             left: Math.round(p.left),
             center: Math.round(p.top + p.height / 2),
             bildMitte: Math.round(bild.top + bild.height / 2) };
  });
  check('Beim Messen war er überhaupt zu sehen',
    lage2.right > 0 && lage2.left > 0, `${lage2.left} bis ${lage2.right}`);
  check('Er steht left neben dem Bild', lage2.right <= lage2.bildLinks,
    `Hinweis endet bei ${lage2.right}, Bild beginnt bei ${lage2.bildLinks}`);
  // A third check used to stand here: that the tooltip doesn't only end to
  // the left of the AMOUNT. It's gone because the amount is gone for
  // Ansem - and a measurement on a hidden element would have reported
  // whatever it liked. That's exactly what the paragraph above warns
  // against.
  check('Auf derselben Höhe wie das Bild',
    Math.abs(lage2.center - lage2.bildMitte) <= 1,
    `${lage2.center} gegen ${lage2.bildMitte}`);
  check('Und bleibt im Bild', lage2.left >= 0, `linke Kante bei ${lage2.left}`);

  // --- The pointer, and nothing else -----------------------------------------
  check('Das Fenster kann überhaupt schweben',
    await page.evaluate(() => matchMedia('(hover: hover)').matches));
  await page.hover('#me-handle');
  await page.waitForTimeout(150);
  check('Der Zeiger allein holt ihn hervor', await sichtbar());
  await page.mouse.move(5, 190);
  await page.waitForTimeout(150);
  check('Und er geht wieder, sobald der Zeiger herunterfährt', !(await sichtbar()));

  // A click is supposed to do NOTHING - neither open it up nor pin it in
  // place. So what's checked is that it doesn't change the state: during the
  // click the pointer is still on the picture, so the tooltip is there; as
  // soon as the pointer moves away, it has to be gone. If it stayed, the
  // click would have pinned something.
  await page.click('#me-handle');
  await page.waitForTimeout(150);
  check('Beim Klicken bleibt er, weil der Zeiger noch daraufsteht',
    await sichtbar());
  await page.mouse.move(5, 190);
  await page.waitForTimeout(150);
  check('Und ist danach weg – der Klick hat nichts festgehalten',
    !(await sichtbar()));

  // And for a regular user, the pointer brings up nothing. The box is
  // defined in the stylesheet for everyone; if the rule hangs off the wrong
  // element, the user reads "You are logged in as Ansem" over their own
  // handle.
  await page.evaluate(() => {
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h t1">EMw</span>';
  });
  await page.hover('#me-handle');
  await page.waitForTimeout(150);
  check('Bei einem Nutzer holt der Zeiger nichts hervor', !(await sichtbar()));
  await page.close();
}

// --- Without a pointer, it doesn't exist -------------------------------------
//
// On a phone, the tooltip isn't visible, and that's the decision: a box that
// opens on touch needs a button, an outside-click handler and the Escape
// key - controls for an explanation. What's left is aria-describedby: a
// screen reader gets the sentence there too.
//
// This is checked explicitly so :hover doesn't slip through after all: in
// some browsers it stays stuck after a touch, and the box would then sit
// somewhere else on the screen until the next touch.
{
  const kontext = await browser.newContext({
    viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true,
  });
  const page = await kontext.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
      + '<span class="kuerzel">4bo</span></span>';
    document.querySelector('#me-holdings').hidden = true;
  });
  const sichtbar = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('#me-info')).display !== 'none');
  check('Das Fenster kann nicht schweben',
    !(await page.evaluate(() => matchMedia('(hover: hover)').matches)));
  check('Am Anfang ist er nicht da', !(await sichtbar()));
  await page.tap('#me-handle');
  await page.waitForTimeout(150);
  check('Und eine Berührung holt ihn auch nicht hervor', !(await sichtbar()));
  await kontext.close();
}

console.log('\nAuf dem Handy: eine eigene Zeile, volle Breite\n');
{
  const a = await measure('ansem', '$12.4M', 390);
  const n = await measure('nutzer', '$153', 390);
  // There the tabs are their own row below the handle - "centered" isn't a
  // meaningful question any more, "in the same spot" is.
  check('Die Reiter stehen under der Kennung', a.tabsOben > 20 && n.tabsOben > 20,
    `${a.tabsOben} px / ${n.tabsOben} px`);
  check('Und sind bei beiden gleich wide und gleich hoch',
    Math.abs(a.tabsBreite - n.tabsBreite) <= 1 && a.tabsOben === n.tabsOben,
    `${a.tabsBreite} px / ${n.tabsBreite} px`);
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
