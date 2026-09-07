/**
 * Checks that the page can really be added to the home screen.
 *
 * This is the kind of thing that fails silently: manifest linked, icons
 * present, everything looks right - and the browser still doesn't offer
 * the install prompt, because one icon file is 191 instead of 192 pixels,
 * or the service worker has no fetch handler. In the browser you see none
 * of that. Here you do.
 *
 *   node scripts/test-pwa.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  // Strip the query string first, then map to index.html - the other way
  // around, "/?sw=1" landed on the directory instead of the page.
  const pfad = req.url.split('?')[0];
  const file = pfad === '/' ? '/index.html' : pfad;
  const abs = path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(pub) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}${detail && !ok ? `\n         ${detail}` : ''}`);
};

/** Read PNG dimensions straight from the file header - no library. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

console.log('\nStartbildschirm (PWA)\n');

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const manifestPath = path.join(pub, 'manifest.webmanifest');
check('manifest.webmanifest existiert', fs.existsSync(manifestPath));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check('Manifest ist gültiges JSON', true);
} catch (e) {
  check('Manifest ist gültiges JSON', false, e.message);
}

if (manifest) {
  check('name gesetzt', Boolean(manifest.name));
  check('start_url gesetzt', Boolean(manifest.start_url));
  check('display ist "standalone" (ohne Browserleiste)',
        manifest.display === 'standalone', `ist: ${manifest.display}`);
  check('background_color gesetzt (kein weißes Aufblitzen beim Start)',
        Boolean(manifest.background_color));

  // This is exactly where it usually goes wrong.
  for (const icon of manifest.icons ?? []) {
    const f = path.join(pub, icon.src.replace(/^\//, ''));
    const exists = fs.existsSync(f);
    check(`Icon ${icon.src} vorhanden`, exists);
    if (!exists) continue;
    const size = pngSize(f);
    const [w, h] = icon.sizes.split('x').map(Number);
    check(`Icon ${icon.src} ist wirklich ${icon.sizes}`,
          size && size.w === w && size.h === h,
          size ? `measured: ${size.w}x${size.h}` : 'keine lesbare PNG-Datei');
  }

  const any = (manifest.icons ?? []).some((i) => (i.purpose ?? 'any').includes('any'));
  const mask = (manifest.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable'));
  check('Es gibt ein normales Icon', any);
  check('Es gibt ein maskierbares Icon (Android schneidet zu)', mask);

  const big = (manifest.icons ?? []).some((i) => Number(i.sizes.split('x')[0]) >= 512);
  check('Mindestens ein Icon mit 512 px (verlangt Chrome)', big);
}


// ---------------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------------

const swSrc = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
check('Service Worker reagiert auf fetch (sonst kein Ablegen-Angebot)',
      /addEventListener\(\s*['"]fetch['"]/.test(swSrc));
check('Service Worker fasst fremde Adressen nicht an',
      swSrc.includes('self.location.origin'));

// ---------------------------------------------------------------------------
// In the real browser
// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// ?sw=1, because the service worker is otherwise deliberately not
// registered on localhost (during development it would sit between the
// browser and the files). A secure context is mandatory, so localhost stays
// the only place it can be checked at all.
await page.goto(base + '/?sw=1', { waitUntil: 'load' });

check('Manifest ist in der Seite verlinkt',
      await page.$eval('link[rel=manifest]', (el) => Boolean(el.href)).catch(() => false));
check('apple-touch-icon ist verlinkt (iPhone nutzt nicht das Manifest)',
      await page.$eval('link[rel=apple-touch-icon]', (el) => Boolean(el.href)).catch(() => false));
check('theme-color gesetzt',
      await page.$eval('meta[name=theme-color]', (el) => Boolean(el.content)).catch(() => false));

// Load errors first: if the module aborts, the service worker never gets
// registered - the check below would then wait forever. A test that hangs
// doesn't tell you what's broken.
check('Keine JavaScript-Fehler beim Laden', errors.length === 0, errors.join(' | '));

// Wait for registration, but not forever.
const swOk = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'kein Service-Worker-Support';
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, ab) => setTimeout(() => ab(new Error('nach 10 s nicht bereit')), 10000)),
    ]);
    return reg.active ? true : 'nicht aktiv geworden';
  } catch (e) { return e.message; }
}).catch((e) => e.message);
check('Service Worker registriert und aktiv', swOk === true, String(swOk));


// Without a session, the login must be visible - and the app must not be.
//
// That sounds obvious, but it hasn't been for a while: in the sheet BOTH
// are hidden, so that a shared poll link doesn't flash the login and then
// the polls in quick succession. Only the script makes either one visible.
// If that fails, or a branch grabs the wrong one, the visitor sees a black
// page - and that is exactly the kind of thing you'd only hear about from
// someone else without this check.
// Wait before measuring.
// ---------------------------------------------------------------------------
// boot() now asks the database first whether the site is still closed. Only
// after that is it decided WHAT gets shown. The test server has no
// database, the request fails, and app.js falls back to the login - just a
// few milliseconds later. Without this wait, the test measures that gap and
// reports a failure that doesn't exist.
await page.waitForFunction(() =>
  !document.querySelector('#login').hidden
  || !document.querySelector('#app').hidden
  || !document.querySelector('#soon').hidden, null, { timeout: 5000 })
  .catch(() => {});
const sichtbar = await page.evaluate(() => ({
  login: !document.querySelector('#login').hidden,
  app: !document.querySelector('#app').hidden,
}));
check('Ohne Anmeldung ist der Login sichtbar', sichtbar.login);
check('Ohne Anmeldung ist die App verborgen', !sichtbar.app);

// ---------------------------------------------------------------------------
// The home-screen step: order, and the right sentence at the right time
// ---------------------------------------------------------------------------
//
// Two things you can't see in a screenshot, and both were wrong before:
//
//   1. The payment note stood on THIS step, even though it's not yet
//      about payment at all. It belongs one step later. That's handled
//      with a CSS rule using :has() and not with JavaScript - the step
//      change happens in five places in app.js, and a line that's only
//      in four of them goes unnoticed.
//
//   2. The instructions were a plain list. If a line wraps (two out of
//      three do at 375 px), the second line slid under the number and the
//      left edge got ragged. Now the text sits in its own column.
//
// Both are measured on the real page, not on the stylesheet.

await page.setViewportSize({ width: 375, height: 667 });
await page.evaluate(() => {
  document.querySelector('#login').hidden = false;
  document.querySelector('#app').hidden = true;
  document.querySelector('#step-install').hidden = false;
  document.querySelector('#step-address').hidden = true;
  document.querySelector('#ios-steps').hidden = false;
});
const install = await page.evaluate(() => {
  const fuss = document.querySelector('.foot-note');
  const kanten = [...document.querySelectorAll('.steps .txt')]
    .map((e) => Math.round(e.getBoundingClientRect().left));
  return {
    fussWeg: getComputedStyle(fuss).display === 'none',
    kanten: [...new Set(kanten)],
    anzahl: document.querySelectorAll('.steps li').length,
    height: Math.round(document.querySelector('#login .login-card').getBoundingClientRect().height),
    text: document.querySelector('#step-install .lede').textContent.trim(),
  };
});

check('Auf dem Startbildschirm-Schritt steht kein Zahlungshinweis', install.fussWeg);
check('Von einer Zahlung ist dort auch sonst keine Rede',
  !/payment|pay again|costs/i.test(install.text), install.text);
check('Die Anleitung hat drei Schritte', install.anzahl === 3, String(install.anzahl));
// THE check: all three texts start at the same edge. If a second line
// slid under the number, there'd be two different values here.
check('Alle Schritte beginnen an derselben Kante',
  install.kanten.length === 1, install.kanten.join(' / ') + ' px');
check('Und die Karte passt auf einen 667-px-Bildschirm',
  install.height <= 667, `${install.height} px`);

// Control: one step further the note MUST be there. Without this line the
// check above would pass even if the sentence were missing everywhere.
await page.evaluate(() => {
  document.querySelector('#step-install').hidden = true;
  document.querySelector('#step-address').hidden = false;
});
const beiAdresse = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.foot-note')).display !== 'none');
check('Gegenprobe: beim Adressschritt steht er sehr wohl da', beiAdresse);

// ---------------------------------------------------------------------------
// The safe area - from the home screen the page starts under the clock
// ---------------------------------------------------------------------------
//
// index.html sets viewport-fit=cover and black-translucent. Together that
// means: as an installed app, the content starts at y=0, i.e. UNDER the
// clock, signal bars and battery indicator. In a browser tab this doesn't
// show, because the browser chrome sits above it there - the bug only shows
// up on the home screen, and that's exactly where the report came from.
//
// There was ONE line in the whole stylesheet for this, and it covered the
// bottom only.
//
// This checks the text of the rules, not the rendered image: Chromium
// doesn't know env(safe-area-inset-*) without a real device notch, so the
// values would always be 0 in the test and any measurement based on them
// would always pass. What can be measured - the gap at the top of the
// content - is measured further below.
const cssText = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');
const regelFuer = (wahl) => {
  const i = cssText.indexOf(wahl + ' {');
  return i < 0 ? '' : cssText.slice(i, cssText.indexOf('}', i));
};

check('Die Kopfzeile weicht der Statusleiste aus',
  /env\(safe-area-inset-top/.test(regelFuer('.topbar')));
check('Die Anmeldekarte ebenso',
  /env\(safe-area-inset-top/.test(regelFuer('.login')));
check('Und beide auch der Kameraaussparung im Querformat',
  /env\(safe-area-inset-left/.test(regelFuer('.topbar'))
  && /env\(safe-area-inset-right/.test(regelFuer('.login')));
// At the bottom, on phones without a home button, sits the close-gesture
// bar. The line for that was on .composer - but that sits INSIDE the DM
// frame and couldn't lift the frame itself; its bottom corners disappeared
// underneath.
check('Die Eingabezeile weicht dem Schliess-Balken aus',
  /env\(safe-area-inset-bottom/.test(regelFuer('  .composer')));

// ---------------------------------------------------------------------------
// And now the bottom edge - measured, not read
// ---------------------------------------------------------------------------
//
// Above it says Chromium doesn't know env(safe-area-inset-*). That's true,
// but it's no reason to leave it at reading the rule text: what's missing
// is only the VALUES. The second server below serves the same styles.css,
// in which exactly these calls are replaced with the measurements of an
// iPhone 14 (47 top, 34 bottom) - otherwise character for character the
// shipped file. That lets us measure the actual case both reports from the
// device came from:
//
//   first  the bottom corners of the DM frame disappeared under the bar
//   then   46 px of empty ground below it, because two gaps added up
//
// Both bugs should have shown up here and didn't, because this check only
// looked at the rule text. A rule text says THAT someone thought about the
// safe area - not what comes out of it.
const SICHER = { top: 47, bottom: 34, left: 0, right: 0 };
const mitSicherenZonen = (css) => css.replace(
  /env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g,
  (_, page) => `${SICHER[page]}px`);

const serverSicher = http.createServer((req, res) => {
  const pfad = req.url.split('?')[0];
  const file = pfad === '/' ? '/index.html' : pfad;
  const abs = path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(pub) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return res.writeHead(404).end('nicht gefunden');
  }
  if (pfad === '/styles.css') {
    return res.writeHead(200, { 'content-type': 'text/css' })
      .end(mitSicherenZonen(fs.readFileSync(abs, 'utf8')));
  }
  // app.js stays empty: the state is set by hand here, otherwise the
  // script would start the login flow and hide everything again.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => serverSicher.listen(0, r));

const geraet = await browser.newPage({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await geraet.goto(`http://127.0.0.1:${serverSicher.address().port}/`);
const bottom = await geraet.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-thread').innerHTML =
    '<div class="dm-row"><div class="dm-block"><div class="msg dm">'
    + '<span class="body">Probe</span></div></div></div>';
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  return {
    unterRahmen: Math.round(innerHeight - r('#dm-user').bottom),
    eingabe: Math.round(innerHeight - r('#dm-input').bottom),
  };
});

// The bar itself is thin; 34 px are reserved. Anything tappable must stay
// above it, or the finger hits the bar instead of the button.
check('Die Eingabezeile bleibt ueber dem Schliess-Balken',
  bottom.eingabe >= SICHER.bottom, `${bottom.eingabe} px ueber der Kante`);
// And the frame runs underneath it instead of stopping short. This is where
// the sum of both gaps once stood - 46 px of empty ground, seen on device.
check('Der Rahmen endet nicht schon ueber dem Balken',
  bottom.unterRahmen < SICHER.bottom, `${bottom.unterRahmen} px empty darunter`);
// But not right at the edge either: without a margin the bottom corners
// would be clipped and the frame at the bottom wouldn't be a frame anymore.
check('Seine unteren Ecken bleiben trotzdem sichtbar', bottom.unterRahmen > 0,
  `${bottom.unterRahmen} px`);

// Control for the whole thing: the same measurement on the FIRST server,
// which serves the file unchanged. There env() is null, so the input sits
// right at the edge - if the value were already big enough there too, the
// three checks above wouldn't be measuring the safe area, but something
// else entirely.
await geraet.goto(base + '/');
const ohneErsatz = await geraet.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  return Math.round(innerHeight
    - document.querySelector('#dm-input').getBoundingClientRect().bottom);
});
check('Gegenprobe: ohne den Ersatz misst dieselbe Stelle deutlich weniger',
  ohneErsatz < SICHER.bottom, `${ohneErsatz} px`);
await geraet.close();
serverSicher.close();

// And the gap at the top of the content - that can be measured.
await page.setViewportSize({ width: 375, height: 667 });
await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-polls').hidden = false;
  document.querySelector('#poll-list').innerHTML =
    '<article class="poll"><div class="poll-head"><h4>Probe</h4></div></article>';
});
const luft = await page.evaluate(() => Math.round(
  document.querySelector('.poll').getBoundingClientRect().top
  - document.querySelector('.topbar').getBoundingClientRect().bottom));
// This used to be zero. The topmost poll butted straight up against the
// rule below the header and looked cut off there - the same reason the DM
// frame stuck to the top.
check('Die oberste Abstimmung klebt nicht am Strich', luft >= 6, `${luft} px`);

// ---------------------------------------------------------------------------
// The loading ring inside the button
// ---------------------------------------------------------------------------
// Between "Continue" and the amount there's a call over the phone network.
// The button only used to go pale during that - that looks broken, not
// busy, and someone who sees nothing happening taps again.
await page.evaluate(() => {
  document.querySelector('#app').hidden = true;
  document.querySelector('#login').hidden = false;
  document.querySelector('#step-install').hidden = true;
  document.querySelector('#step-address').hidden = false;
});
const button = await page.evaluate(() => {
  const b = document.querySelector('#btn-challenge');
  const vor = b.getBoundingClientRect();
  b.classList.add('laedt');
  const nach = b.getBoundingClientRect();
  // getComputedStyle returns a LIVE object: if the class is removed, its
  // values change along with it. Read first, clean up after - otherwise
  // you'd measure the button without the loading ring and wonder why it
  // says "none".
  const nachher = getComputedStyle(b, '::after');
  const ring = String(nachher.animationName);
  const dick = String(nachher.width);
  b.classList.remove('laedt');
  return {
    gleicheBreite: Math.abs(vor.width - nach.width) < 1,
    gleicheHoehe: Math.abs(vor.height - nach.height) < 1,
    ring, sichtbar: dick,
  };
});
check('Der Knopf springt beim Laden nicht in der Groesse',
  button.gleicheBreite && button.gleicheHoehe);
check('Und zeigt einen drehenden Ring', button.ring === 'kreisel', button.ring);
check('Der einen Durchmesser hat', parseFloat(button.sichtbar) > 8, button.sichtbar);

const appSource = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
check('Und der Knopf bekommt die Klasse wirklich – und nimmt sie back',
  /btn\.classList\.add\('laedt'\)/.test(appSource)
  && /btn\.classList\.remove\('laedt'\)/.test(appSource));

// ---------------------------------------------------------------------------
// Sharing means copying
// ---------------------------------------------------------------------------
// This is where the system share sheet used to pop up on the phone
// (WhatsApp, Mail, ...). But the button shows a chain-link icon, which
// promises a link, not a menu - and most of the time you just want it on
// the clipboard anyway. This checks EXACTLY sharePoll and not the whole
// file.
//
// The first attempt searched app.js as a whole for navigator.share and
// flagged it - rightly so: there's a second call, on the IMAGE button.
// That's a different matter and stays. An image is hard to put "on the
// clipboard" on a phone; there the system share sheet is the right way to
// get it onto X. For the link it isn't.
const shareSource = (() => {
  const a = appSource.indexOf('async function sharePoll(id) {');
  return a < 0 ? '' : appSource.slice(a, appSource.indexOf('\n}', a));
})();
check('sharePoll ist auffindbar', shareSource.length > 0);
check('Der Link-Knopf oeffnet kein Systemmenue mehr',
  !/navigator\.share/.test(shareSource.split('\n')
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')));
check('Sondern kopiert den Link', /if \(await copyText\(url\)\)/.test(shareSource));
// And the control, so the line above doesn't just pass because the
// snippet was empty: at the image button it still stands.
check('Beim Bild-Knopf bleibt das Menue dagegen stehen',
  /navigator\.share\(\{ files: \[file\] \}\)/.test(appSource));

// ---------------------------------------------------------------------------
// Scrolling happens INSIDE the lists, not on the page
// ---------------------------------------------------------------------------
//
// The report came from a device: swiping to the end in the DM window or in
// the polls, past that point the swipe got handed off to the page - the
// whole view slid up or down. On the home screen this looks like the app
// coming loose from its edge.
//
// Two things have to hold for that, and both are checked separately: the
// page must not be able to scroll at all, and the lists must not hand
// anything off.
await page.setViewportSize({ width: 375, height: 667 });
const rollen = await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  const t = document.querySelector('#dm-thread');
  // Plenty of content - otherwise nothing scrolls at all and the
  // measurement would be free.
  t.innerHTML = Array.from({ length: 60 }, (_, i) =>
    `<div class="dm-row"><div class="msg dm"><span class="body">Nachricht ${i}</span></div></div>`).join('');
  // An oversized block dropped into the body. Without it the page fits
  // exactly on the screen anyway and couldn't move even without any rule -
  // the measurement would then be free and find nothing. With it, the page
  // WOULD scroll if you let it; that's exactly the question.
  const klotz = document.createElement('div');
  klotz.style.cssText = 'height: 3000px';
  document.body.append(klotz);

  const se = document.scrollingElement;

  // Control first: with the lock lifted by hand, the page MUST be able to
  // move. If it doesn't, the block is too small or the setup is different
  // than assumed - and the measurement below would be worthless.
  document.documentElement.style.overflow = 'visible';
  document.body.style.overflow = 'visible';
  se.scrollTop = 9999;
  const ohneSperre = se.scrollTop;
  se.scrollTop = 0;
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';

  // And now with the lock from the stylesheet.
  se.scrollTop = 9999;
  const pageShifted = se.scrollTop;
  klotz.remove();

  t.scrollTop = 99999;
  return {
    pageShifted,
    ohneSperre,
    kette: getComputedStyle(t).overscrollBehaviorY,
    balken: getComputedStyle(t).scrollbarWidth,
    balkenPolls: getComputedStyle(document.querySelector('#poll-list')).scrollbarWidth,
    // Control: elsewhere the scrollbar stays. Without this line everything
    // above would pass even if the rule had accidentally disabled EVERY
    // scrollbar on the page.
    // The body has no rule of its own for this; its value is the
    // browser's default. If it says anything other than "auto", a rule
    // reached further than intended.
    balkenSonstwo: getComputedStyle(document.body).scrollbarWidth,
    listeRollt: t.scrollTop > 0,
  };
});
check('Die Seite selbst laesst sich nicht verschieben',
  rollen.pageShifted === 0, `scrollTop ${rollen.pageShifted}`);
// Control for that: the block really was oversized. Without this line the
// check above would pass even if there had been nothing to scroll at all.
check('Gegenprobe: ohne die Sperre liesse sie sich sehr wohl verschieben',
  rollen.ohneSperre > 0, `scrollTop ${rollen.ohneSperre}`);
check('Die Liste reicht den Wisch nicht an die Seite next',
  rollen.kette === 'contain', rollen.kette);
// Control: without this line everything above would pass even if the list
// didn't scroll at all.
check('Gegenprobe: die Liste rollt trotzdem', rollen.listeRollt);
check('Im Gespraech gibt es keine Rollleiste', rollen.balken === 'none', rollen.balken);
check('Bei den Abstimmungen auch nicht', rollen.balkenPolls === 'none', rollen.balkenPolls);
check('Gegenprobe: die Regel greift nicht auf die ganze Seite durch',
  rollen.balkenSonstwo === 'auto', rollen.balkenSonstwo);

// ---------------------------------------------------------------------------
// The keyboard may only shrink the conversation, not push the view around
// ---------------------------------------------------------------------------
//
// Report from a device: typing a DM on the phone moved everything up out
// of frame - header, tabs, the top edge of the frame.
//
// What can NOT be checked here: whether iOS really stops pushing after
// this. That needs an actual keyboard, and this Chromium doesn't have one.
// What CAN be checked is the consequence the fix relies on - and that's
// the real requirement:
//
//   When the page gets shorter, NOTHING above the conversation may move.
//   The entire shrink has to land in the list.
//
// If that doesn't hold, even the best keyboard detection is useless: then
// whatever used to move on push just moves on shrink instead.
await page.setViewportSize({ width: 390, height: 844 });
const tastatur = await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  // The polls pane is still open from an earlier check. Both panes are
  // flex: 1 in the same stack and would then share the height - the frame
  // would sit in the middle of the picture, and the measurement would
  // measure something other than what it claims to. In real use exactly
  // one is ever present.
  document.querySelector('#pane-polls').hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-thread').innerHTML =
    Array.from({ length: 40 }, (_, i) =>
      `<div class="dm-row"><div class="dm-block"><div class="msg dm">`
      + `<span class="body">Nachricht ${i}</span></div></div></div>`).join('');

  const measure = () => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return {
      header: Math.round(r('.topbar').top),
      reiter: Math.round(r('.tabs').top),
      rahmen: Math.round(r('#dm-user').top),
      eingabe: Math.round(r('#dm-input').bottom),
      liste: Math.round(r('#dm-thread').height),
    };
  };
  const vorher = measure();

  // Simulate the keyboard: exactly what app.js does when visualViewport
  // reports that something is covered at the bottom - BOTH lines.
  const TASTATUR = 336;
  // How far iOS shifts the viewport for this depends on where the input
  // field sits. A middling value is enough: the check is that the view
  // compensates for it, not how big it is.
  const VERSATZ = 120;
  document.documentElement.style.setProperty(
    '--sicht', `${innerHeight - TASTATUR}px`);
  document.documentElement.style.setProperty('--versatz', `${VERSATZ}px`);
  const nachher = measure();

  // And the same situation WITHOUT the compensation - this is what it
  // looked like when the report came in: the whole view sat too high by
  // the offset amount.
  document.documentElement.style.removeProperty('--versatz');
  const ohneAusgleich = measure();

  document.documentElement.style.setProperty('--versatz', `${VERSATZ}px`);
  document.documentElement.style.removeProperty('--sicht');
  document.documentElement.style.removeProperty('--versatz');
  const back = measure();

  return { vorher, nachher, ohneAusgleich, back,
    tastatur: TASTATUR, versatz: VERSATZ };
});

const t = tastatur;
// The header must sit where the visible viewport begins - i.e. lower than
// before by the offset amount, measured in page coordinates. On screen
// that is exactly the same spot as without the keyboard.
check('Die Kopfzeile bleibt stehen, wenn die Tastatur kommt',
  t.nachher.header === t.vorher.header + t.versatz,
  `${t.vorher.header} -> ${t.nachher.header}, erwartet ${t.vorher.header + t.versatz}`);
// This is the device report, reproduced: without the compensation
// everything sits too high by the offset amount - the whole page has
// shifted up.
check('Gegenprobe: ohne den Ausgleich wandert sie sehr wohl nach peek',
  t.ohneAusgleich.header === t.vorher.header,
  `${t.ohneAusgleich.header} statt ${t.vorher.header + t.versatz}`);
check('Die Reiter ebenso', t.nachher.reiter === t.vorher.reiter + t.versatz,
  `${t.vorher.reiter} -> ${t.nachher.reiter}`);
check('Und der obere Rand des Gespraechsrahmens',
  t.nachher.rahmen === t.vorher.rahmen + t.versatz,
  `${t.vorher.rahmen} -> ${t.nachher.rahmen}`);
// The shrink has to land somewhere - and specifically there, and only
// there.
check('Gekuerzt wird stattdessen das Gespraech',
  t.vorher.liste - t.nachher.liste === t.tastatur,
  `${t.vorher.liste} -> ${t.nachher.liste} px (erwartet ${t.tastatur} weniger)`);
// The whole point: the input field has to rise above the keyboard.
check('Und die Eingabezeile steigt genau um die Tastaturhoehe',
  t.vorher.eingabe - t.nachher.eingabe === t.tastatur - t.versatz,
  `${t.vorher.eingabe} -> ${t.nachher.eingabe}`);
// And back again once the keyboard is gone. Without this line everything
// above would pass even if --sicht stayed stuck.
check('Gegenprobe: ohne --sicht ist alles wieder wie vorher',
  JSON.stringify(t.back) === JSON.stringify(t.vorher));

// And the wiring: without the observer, nobody sets --sicht.
const appQ = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
// And the offset has to come from visualViewport.offsetTop and nowhere
// else - it can't be guessed at.
check('app.js liest den Versatz aus visualViewport.offsetTop',
  /--versatz['"`],\s*`\$\{vv\.offsetTop\}px`/.test(appQ));
check('app.js hoert auf visualViewport',
  /visualViewport/.test(appQ) && /addEventListener\('resize'/.test(appQ));
check('Und nimmt die Zeile wieder weg, statt sie zu ueberschreiben',
  /removeProperty\('--sicht'\)/.test(appQ));
// There has to be a threshold: visualViewport.height also changes when
// Safari's address bar slides in and out. Without a threshold, the sheet
// twitched on every swipe.
check('Und unterscheidet eine Tastatur von einer Browserleiste',
  /TASTATUR_AB_PX/.test(appQ));

// On the login screen, though, the card MAY move up.
// ---------------------------------------------------------------------------
// For a while the opposite stood here: app.js held the card in place so it
// wouldn't move. What was actually wanted was the other way round - room
// should be made there, and that's also the difference from the app: in
// the app something sits at the top that MUST stay put (header, tabs). On
// the login screen there's nothing there but air, and air is allowed to
// give way if the input field would otherwise sit under the keyboard.
//
// So the check is that NOBODY holds the card in place - otherwise the
// special case would come back unnoticed the next time this gets reworked.
const appSourceLogin = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
check('Die Anmeldekarte wird nicht festgehalten',
  !/loginEinfrieren|marginTop\s*=/.test(appSourceLogin));

// ---------------------------------------------------------------------------
// And the login card still stays fully reachable
// ---------------------------------------------------------------------------
// Since the page no longer scrolls, the login screen has to be able to do
// it itself. The trap here is justify-content: center in a scrollable box:
// if the content doesn't fit, it pushes its start UP AND OUT, and you
// can't scroll there. That's why the card is centered with an auto margin
// and not with justify-content.
const loginLage = async (height) => {
  await page.setViewportSize({ width: 375, height: height });
  return page.evaluate(() => {
    document.querySelector('#app').hidden = true;
    document.querySelector('#login').hidden = false;
    document.querySelector('#step-install').hidden = true;
    document.querySelector('#step-address').hidden = false;
    const l = document.querySelector('#login');
    // Explicitly the card WITHIN login. Since the curtain exists
    // ("Launching soon"), two sections carry the .login-card class, and the
    // first one in the sheet is the hidden curtain - a hidden element
    // measures as 0 x 0. The test then reported "0 px from the top" and
    // looked as if the login card sat right at the top edge.
    const k = document.querySelector('#login .login-card');
    l.scrollTop = 0;
    const topCutOff = Math.round(
      k.getBoundingClientRect().top - l.getBoundingClientRect().top);
    l.scrollTop = 999999;
    const bottomMissing = Math.round(
      k.getBoundingClientRect().bottom - l.getBoundingClientRect().bottom);
    return { topCutOff, bottomMissing, passt: l.scrollHeight <= l.clientHeight + 1 };
  });
};
const hoch = await loginLage(667);
const short = await loginLage(320);
check('Auf einem hohen Bildschirm steht die Karte mittig',
  hoch.passt && hoch.topCutOff > 40, `${hoch.topCutOff} px von peek`);
check('Auf einem kurzen ist peek nichts abgeschnitten',
  short.topCutOff >= 0, `${short.topCutOff} px`);
check('Und bottom alles erreichbar', short.bottomMissing <= 0, `${short.bottomMissing} px`);
await page.setViewportSize({ width: 375, height: 667 });

// ---------------------------------------------------------------------------
// Ten checks for the poll form on the phone used to be here
// ---------------------------------------------------------------------------
// Tap target size of the "+ New poll" switch, height of the duration
// entries, and whether the area can scroll with the keyboard open. All
// measured, all with a control, all passing.
//
// They're gone because the thing itself is gone: on the phone there's no
// longer a form, there's a sentence instead. What they checked can
// therefore no longer break - and a check that measures a state that
// doesn't exist either fails or gets kept green by being bent out of
// shape. Both are worse than deleting it and writing down why.
//
// What takes their place is further below: that the switch is missing on
// the phone, that the sentence is there, that a forcibly opened form stays
// closed - and the control that on desktop everything is as before.
//
// The rules in the sheet stay in place (the enlarged tap target, the
// 44 px tall entries): they don't hurt on desktop and help wherever
// someone is working with a finger on a big screen.


// ---------------------------------------------------------------------------
// Handle, address and "Hide" sit on one line
// ---------------------------------------------------------------------------
// Reported as "Hide sits offset, further down", measured: 5.3 px, identical
// on iPhone 15 and SE. The cause wasn't an alignment bug but an asymmetric
// padding: on the phone the title row lost its top padding but kept its
// bottom one - its text then sat at the top of a box that .thread-kopf
// centered. So the boxes were centered, not what you actually see.
//
// So what's checked here is the middle of the TEXT against the middle of
// the button, not the middle of the boxes. A check on the boxes would have
// passed even before the fix - they were always on one line.
const line = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
await line.goto(base + '/', { waitUntil: 'load' });
const headerLine = await line.evaluate(() => {
  const $ = (x) => document.querySelector(x);
  $('#login').hidden = true;
  $('#app').hidden = false;
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = true; });
  $('#pane-dms').hidden = false;
  $('#dm-user').hidden = true;
  $('#dm-admin').hidden = false;
  $('#dm-admin').classList.add('viewing');
  $('#thread-title').classList.remove('dim');
  $('#thread-title').innerHTML =
    '<span class="h">7xK</span><span class="addr">7xKm9QpLvRt2sYwE4nBc6HjA1dFgZuVmTqXrPyNb3Ks</span>';
  $('#btn-hide-thread').hidden = false;
  const center = (x) => {
    const r = document.querySelector(x).getBoundingClientRect();
    return (r.top + r.bottom) / 2;
  };
  return {
    kuerzel: center('.thread-title .h'),
    adresse: center('.thread-title .addr'),
    hide: center('#btn-hide-thread'),
    // The boxes - only to keep the control below honest.
    titelKasten: center('#thread-title'),
  };
});
await line.close();

check('"Hide" steht auf einer Linie mit dem Kuerzel',
  Math.abs(headerLine.hide - headerLine.kuerzel) <= 1,
  `${(headerLine.hide - headerLine.kuerzel).toFixed(1)} px Versatz`);
check('Und mit der Adresse',
  Math.abs(headerLine.hide - headerLine.adresse) <= 1,
  `${(headerLine.hide - headerLine.adresse).toFixed(1)} px Versatz`);
// Control on the check itself: the text now has to sit where its box sits.
// If it didn't, the padding would be asymmetric again and the bug back,
// without the two checks above having any way to notice.
check('Und der Text sitzt mittig in seiner Zeile, nicht peek',
  Math.abs(headerLine.kuerzel - headerLine.titelKasten) <= 1,
  `${(headerLine.kuerzel - headerLine.titelKasten).toFixed(1)} px`);

// ---------------------------------------------------------------------------
// Creating polls only works on desktop
// ---------------------------------------------------------------------------
// The form couldn't be used on the phone with the keyboard open, and
// instead of pulling at it further, that path is now closed there. Both
// are checked - that it's closed on the phone AND that it stays open on
// desktop. Only together do they say anything: a rule that applies
// everywhere would have abolished the feature instead of relocating it.
async function pollSwitch(w, h, handy) {
  const p = await browser.newPage({
    viewport: { width: w, height: h }, deviceScaleFactor: 2,
    isMobile: handy, hasTouch: handy,
  });
  await p.goto(base + '/', { waitUntil: 'load' });
  const r = await p.evaluate(() => {
    const $ = (x) => document.querySelector(x);
    $('#login').hidden = true;
    $('#app').hidden = false;
    document.querySelectorAll('.pane').forEach((x) => { x.hidden = true; });
    $('#pane-polls').hidden = false;
    $('#poll-admin').hidden = false;
    const sicht = (x) => {
      const e = document.querySelector(x);
      if (!e) return false;
      return getComputedStyle(e).display !== 'none'
        && e.getBoundingClientRect().height > 0;
    };
    // And what if the form is open after all - say, because someone
    // opened it on desktop and then narrowed the window?
    $('#poll-admin-felder').hidden = false;
    const erzwungen = sicht('#poll-admin-felder');
    $('#poll-admin-felder').hidden = true;
    return {
      button: sicht('#btn-poll-neu'),
      satz: sicht('.poll-nur-rechner'),
      text: ($('.poll-nur-rechner') || {}).textContent || '',
      erzwungen,
      // What MUST remain on the phone: the list and the tabs.
      liste: !!$('#poll-list'),
      reiter: sicht('.tabs'),
    };
  });
  await p.close();
  return r;
}

const handy = await pollSwitch(390, 844, true);
check('Auf dem Handy gibt es keinen Schalter fuer neue Abstimmungen',
  !handy.button);
check('Stattdessen steht dort ein Satz', handy.satz, handy.text.trim());
check('Und er nennt den Rechner beim Namen',
  /desktop/i.test(handy.text), handy.text.trim());
check('Auch ein erzwungen geoeffnetes Formular bleibt zu', !handy.erzwungen);
// Relocated, not abolished: everything else has to stay on the phone.
check('Die Abstimmungsliste ist weiterhin da', handy.liste);
check('Und die Reiter auch', handy.reiter);

const computer = await pollSwitch(1280, 900, false);
check('Gegenprobe: am Rechner ist der Schalter da', computer.button);
check('Gegenprobe: und der Satz steht dort nicht', !computer.satz);
check('Gegenprobe: und das Formular laesst sich oeffnen', computer.erzwungen);

// ---------------------------------------------------------------------------
// What got hardened before launch
// ---------------------------------------------------------------------------
// Four things none of the 22 rows above caught, because all of them assume
// a browser that behaves normally: locked storage, a very narrow window,
// a response with no spaces in it, a keyboard.

// 1. Locked localStorage must not turn the page black
// ---------------------------------------------------------------------------
// Not "empty", but FORBIDDEN: Safari with "block all cookies" throws on
// mere access. The line sat at top module level, so the error hit before
// the first frame - and the visitor saw nothing. No login, no message,
// reloading never helped.
//
// A dedicated server for this: the server for this row deliberately serves
// app.js EMPTY, because the other checks set state by hand. That would be
// exactly the wrong thing here though - what's being checked is whether
// the real app.js survives locked storage. Without the second server, this
// check would measure an empty page and proudly report that it's empty.
const echtServer = http.createServer((req, res) => {
  const pfad = req.url.split('?')[0];
  const file = pfad === '/' ? '/index.html' : pfad;
  const abs = path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(pub) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return res.writeHead(404).end('nicht gefunden');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => echtServer.listen(0, r));
const echtBasis = `http://127.0.0.1:${echtServer.address().port}`;

const gesperrt = await browser.newPage({ viewport: { width: 390, height: 844 } });
await gesperrt.addInitScript(() => {
  const werfen = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => ({ getItem: werfen, setItem: werfen, removeItem: werfen }),
  });
});
const fehlerImLauf = [];
gesperrt.on('pageerror', (e) => fehlerImLauf.push(e.message));
await gesperrt.goto(echtBasis + '/', { waitUntil: 'load' });
await gesperrt.waitForTimeout(3200);   // boot() asks the database first
const beiSperre = await gesperrt.evaluate(() => ({
  login: !document.querySelector('#login').hidden,
  text: (document.body.innerText || '').trim().length,
}));
await gesperrt.close();
echtServer.close();
check('Mit gesperrtem Speicher erscheint der Login trotzdem', beiSperre.login);
check('Und es steht ueberhaupt etwas auf der Seite',
  beiSperre.text > 0, `${beiSperre.text} Zeichen`);
check('Ohne unbehandelten Fehler beim Laden',
  fehlerImLauf.length === 0, fehlerImLauf.join(' | '));

// 2. A response with no spaces no longer eats the amount
// ---------------------------------------------------------------------------
// What was measured: at 320 px, 17 characters were enough to push the
// dollar amount out of the bar. Not squeezed - gone, because .opt-bar
// clips.
async function amountVisible(width, text) {
  const p = await browser.newPage({ viewport: { width: width, height: 800 } });
  await p.goto(base + '/', { waitUntil: 'load' });
  const r = await p.evaluate((label) => {
    const $ = (x) => document.querySelector(x);
    $('#login').hidden = true;
    $('#app').hidden = false;
    document.querySelectorAll('.pane').forEach((x) => { x.hidden = true; });
    $('#pane-polls').hidden = false;
    $('#poll-list').innerHTML = `
      <article class="poll"><div class="poll-body"><div class="opt">
        <div class="opt-bar"><div class="opt-fill" style="width:60%"></div>
        <div class="opt-text">
          <span class="opt-label">${label}</span>
          <span class="opt-num"><span class="held">$1,640,000</span></span>
        </div></div></div></div></article>`;
    const num = $('.opt-num').getBoundingClientRect();
    const bar = $('.opt-bar').getBoundingClientRect();
    return {
      innerhalb: num.right <= bar.right + 1 && num.left >= bar.left,
      width: Math.round(num.width),
      page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  }, text);
  await p.close();
  return r;
}
const adresse = '7xKm9QpLvRt2sYwE4nBc6HjA1dFgZuVmTqXrPyNb3Ks';
for (const width of [320, 375, 390]) {
  const r = await amountVisible(width, adresse);
  check(`Bei ${width} px bleibt der Betrag im Balken (44-Zeichen-Adresse)`,
    r.innerhalb, `${r.width} px wide`);
  check(`Und die Seite rollt bei ${width} px nicht seitlich`, r.page);
}
// Control: this measurement has to be able to measure something at all -
// with the rule artificially disabled, it has to fail.
const ohneRegel = await browser.newPage({ viewport: { width: 320, height: 800 } });
await ohneRegel.goto(base + '/', { waitUntil: 'load' });
const kaputt = await ohneRegel.evaluate((label) => {
  const st = document.createElement('style');
  st.textContent = '.opt-label { min-width: auto !important; overflow-wrap: normal !important; }';
  document.head.appendChild(st);
  const $ = (x) => document.querySelector(x);
  $('#login').hidden = true; $('#app').hidden = false;
  document.querySelectorAll('.pane').forEach((x) => { x.hidden = true; });
  $('#pane-polls').hidden = false;
  $('#poll-list').innerHTML = `
    <article class="poll"><div class="poll-body"><div class="opt">
      <div class="opt-bar"><div class="opt-fill" style="width:60%"></div>
      <div class="opt-text">
        <span class="opt-label">${label}</span>
        <span class="opt-num"><span class="held">$1,640,000</span></span>
      </div></div></div></div></article>`;
  const num = $('.opt-num').getBoundingClientRect();
  const bar = $('.opt-bar').getBoundingClientRect();
  return num.right <= bar.right + 1;
}, adresse);
await ohneRegel.close();
check('Gegenprobe: ohne die Regel faellt der Betrag heraus', !kaputt);

// 3. "Send" stays in frame at 320 px
const narrow = await browser.newPage({ viewport: { width: 320, height: 700 } });
await narrow.goto(base + '/', { waitUntil: 'load' });
const senden = await narrow.evaluate(() => {
  const $ = (x) => document.querySelector(x);
  $('#login').hidden = true; $('#app').hidden = false;
  document.querySelectorAll('.pane').forEach((x) => { x.hidden = true; });
  $('#pane-dms').hidden = false; $('#dm-user').hidden = false;
  const button = document.querySelector('#dm-form .btn-primary')
    || document.querySelector('#dm-form button');
  const r = button.getBoundingClientRect();
  return { right: Math.round(r.right), fenster: window.innerWidth };
});
await narrow.close();
check('Bei 320 px liegt "Send" im Bild',
  senden.right <= senden.fenster, `Kante bei ${senden.right} von ${senden.fenster} px`);

// 4. Voting works with the keyboard
// ---------------------------------------------------------------------------
// The answer row was a bare <div>: no focus, no keypress, and a screen
// reader announced it as plain text. This is the site's central action.
const keyboardPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await keyboardPage.goto(base + '/', { waitUntil: 'load' });
const bedienbar = await keyboardPage.evaluate(() => {
  const $ = (x) => document.querySelector(x);
  $('#login').hidden = true; $('#app').hidden = false;
  document.querySelectorAll('.pane').forEach((x) => { x.hidden = true; });
  $('#pane-polls').hidden = false;
  $('#poll-list').innerHTML = `
    <div class="opt" data-poll="1" data-option="2" role="button" tabindex="0"
         aria-disabled="false" aria-pressed="false"><div class="opt-bar">
    <div class="opt-text"><span class="opt-label">A</span></div></div></div>
    <div class="opt locked" data-poll="1" data-option="3" role="button" tabindex="-1"
         aria-disabled="true" aria-pressed="false"><div class="opt-bar">
    <div class="opt-text"><span class="opt-label">B</span></div></div></div>`;
  const offen = document.querySelector('.opt:not(.locked)');
  const zu = document.querySelector('.opt.locked');
  offen.focus();
  return {
    fokussierbar: document.activeElement === offen,
    rolle: offen.getAttribute('role'),
    gedrueckt: offen.getAttribute('aria-pressed'),
    zuNichtImTab: zu.getAttribute('tabindex') === '-1',
    zuGemeldet: zu.getAttribute('aria-disabled') === 'true',
  };
});
await keyboardPage.close();
check('Eine Antwort bekommt den Fokus', bedienbar.fokussierbar);
check('Und meldet sich als Knopf', bedienbar.rolle === 'button', bedienbar.rolle);
check('Und sagt, ob sie die eigene Stimme ist', bedienbar.gedrueckt !== null);
check('Eine geschlossene Antwort liegt nicht im Tab-Lauf', bedienbar.zuNichtImTab);
check('Und meldet sich als nicht bedienbar', bedienbar.zuGemeldet);
// In the source: Enter and Space really have to be wired up. The
// measurement above only shows that the element takes focus.
const appJsText = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
check("Enter und Leertaste sind am '.opt' verdrahtet",
  /\$\$\('\.opt'[\s\S]{0,900}addEventListener\('keydown'/.test(appJsText));

await browser.close();
server.close();

console.log(failed ? `\n  ${failed} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(failed ? 1 : 0);
