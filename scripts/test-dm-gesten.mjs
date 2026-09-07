// ============================================================================
// On a finger: long-press and swipe left
//
// The finding from the device: on a phone there was only one way to reply -
// tap the message so the arrow appears, then hit the arrow. Long-pressing
// instead got you a text selection and iOS's own menu, which has nothing to
// do with this page.
//
// What was wanted was the same as in X's DMs: swiping right replies
// directly, the arrow appears along the way, and it buzzes once at the
// stop point.
//
// A long-press popup ("Reply / Copy") existed for one round and is gone
// again on request. What stayed is that nothing selects on a finger - that
// is still in here unchanged below.
//
// ----------------------------------------------------------------------------
// What is actually measured here
//
// Touches can be reconstructed in Chromium - TouchEvent exists there, and
// the handlers in app.js don't distinguish where an event comes from. So
// what's measured isn't "is the rule there", but what the sheet looks like
// after a gesture: is the popup open? Does it sit next to the bubble? Is the
// reply bar there afterward?
//
// What can't be measured is whether iOS actually holds back its own menu.
// That's what -webkit-touch-callout is for, and whether it works can only be
// seen on an iPhone. What's checked here is that the rule is present, and
// only for a finger.
//
// Just as unmeasurable: whether the buzz at the stop point can be felt.
// Safari on iPhone doesn't know navigator.vibrate. What's checked is that
// it gets called exactly once - on Android it's then also there.
//
// ----------------------------------------------------------------------------
// Why half the file gets cut out of app.js
//
// app.js needs a database at startup. Here it's only about the gestures, so
// exactly the pieces that make them up get cut out and run alongside a
// small piece of state. Nothing is rebuilt: if someone changes a threshold
// or the order in app.js, this test changes along with it - and if a piece
// disappears, the cut fails instead of quietly checking something else.
//
//   node scripts/test-dm-gesten.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const cssText = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b + bis.length);
};
/** Like cut, but up to the end of the line the marker sits on.
 *  That way the cut hangs off the NAME, not the value - otherwise this test
 *  would have to be updated every time a threshold changes, and whoever
 *  forgets that just sees a crash with no obvious connection to the cause. */
const cutLine = (von, bisName) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bisName, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von} .. ${bisName}`);
  return appJs.slice(a, appJs.indexOf('\n', b));
};

// The real pieces, verbatim.
const GESTEN = [
  cutLine('const SWIPE_START_PX =', 'const SWIPE_THRESHOLD_PX ='),
  'let griff = null;',
  cut('function swipeBack(g) {', '\n}'),
  // The click handler belongs here too: it's what makes the arrow reply and
  // a tap on the message do NOTHING. Without it the test would only check
  // half the story.
  cut("for (const sel of ['#dm-thread', '#admin-thread']) {\n  $(sel).addEventListener('click'", '\n  });\n}'),
  cut("for (const sel of ['#dm-thread', '#admin-thread']) {\n  const box = $(sel);", '\n}'),
].join('\n\n');

const MESSAGES = [
  { id: 1, from_admin: false, body: 'yo ansem, when is the next call?' },
  { id: 2, from_admin: true, body: 'thursday, same link as last time' },
  { id: 3, from_admin: false, body: 'perfect, see you there' },
];

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(pub, pfad);
  if (!file.startsWith(pub) || !fs.existsSync(file)) return res.writeHead(404).end('');
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}${detail && !ok ? `\n         ${detail}` : ''}`);
};

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const kontext = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 3, permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await kontext.newPage();
await page.goto(base, { waitUntil: 'load' });

console.log('\nGesten in den DMs\n');

// ---------------------------------------------------------------------------
// Setup: the real markup, the real gesture pieces, a small piece of state
// ---------------------------------------------------------------------------
await page.evaluate(({ gesten, rows }) => {
  const $ = (s, w = document) => w.querySelector(s);
  const $$ = (s, w = document) => [...w.querySelectorAll(s)];
  window.$ = $; window.$$ = $$;
  window.state = { dmMessages: rows, dmRepliesAvailable: true, me: { isAdmin: false } };
  window.protokoll = [];
  window.toast = (m) => window.protokoll.push(`toast:${m}`);
  window.setDmReply = (id) => {
    window.protokoll.push(`reply:${id}`);
    const q = window.state.dmMessages.find((x) => x.id === id);
    $('#dm-reply-bar-text').textContent = q ? q.body : '';
    $('#dm-reply-bar').hidden = false;
  };
  window.dmTeile = () => ({ box: '#dm-thread' });
  window.gotoDm = (id) => window.protokoll.push(`goto:${id}`);

  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#pane-polls').hidden = true;
  $('#pane-dms').hidden = false;
  $('#dm-user').hidden = false;
  $('#dm-thread').innerHTML = rows.map((r) => `
    <div class="dm-row ${r.from_admin ? '' : 'mine'}" data-id="${r.id}">
      <div class="dm-block"><div class="msg dm ${r.from_admin ? '' : 'mine'}">
        <span class="body">${r.body}</span></div></div>
      <button class="reply-btn" type="button" data-dm-reply="${r.id}">↩</button>
    </div>`).join('');

  // eslint-disable-next-line no-eval
  (0, eval)(gesten);
}, { gesten: GESTEN, rows: MESSAGES });

// ---------------------------------------------------------------------------
// Reconstructing touches
// ---------------------------------------------------------------------------
// Real TouchEvents, not a mouse: the handlers hang off touchstart/-move/-end,
// and a mouse fires none of those. Without this the test would check
// nothing.
const geste = (schritte) => page.evaluate(async (s) => {
  const ziel = document.querySelector(s.sel);
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const dot = (x, y) => new Touch({
    identifier: 1, target: ziel, clientX: x, clientY: y,
    pageX: x, pageY: y, screenX: x, screenY: y,
  });
  const fire = (typ, x, y) => {
    const t = dot(x, y);
    ziel.dispatchEvent(new TouchEvent(typ, {
      bubbles: true, cancelable: true,
      touches: typ === 'touchend' ? [] : [t],
      targetTouches: typ === 'touchend' ? [] : [t],
      changedTouches: [t],
    }));
  };
  fire('touchstart', x0, y0);
  if (s.haltenMs) await new Promise((r2) => setTimeout(r2, s.haltenMs));
  for (const [dx, dy] of s.zuege ?? []) fire('touchmove', x0 + dx, y0 + dy);
  if (!s.ohneEnde) fire('touchend', x0 + (s.zuege?.at(-1)?.[0] ?? 0), y0);
  await new Promise((r2) => setTimeout(r2, 60));
  return null;
}, schritte);

const zustand = () => page.evaluate(() => ({
  leisteOffen: !document.querySelector('#dm-reply-bar').hidden,
  leisteText: document.querySelector('#dm-reply-bar-text').textContent,
  protokoll: [...window.protokoll],
  verschoben: document.querySelector('.dm-row[data-id="2"] .dm-block').style.transform,
}));

const reset = () => page.evaluate(() => {
  window.protokoll = [];
  document.querySelector('#dm-reply-bar').hidden = true;
  document.querySelectorAll('.dm-block').forEach((b) => { b.style.transform = ''; });
});

// ---------------------------------------------------------------------------
// 1. Swiping right
// ---------------------------------------------------------------------------
await reset();
await geste({ sel: '.dm-row[data-id="2"] .msg.dm', zuege: [[20, 0], [36, 0], [48, 0]] });
let z = await zustand();
check('Ein Wisch nach right antwortet', z.protokoll.includes('reply:2'), z.protokoll.join());
check('Und die Blase steht danach wieder gerade', z.verschoben === '');

// Swiped too short: nothing happens. Otherwise any little slip would trigger
// a reply.
await reset();
await geste({ sel: '.dm-row[data-id="2"] .msg.dm', zuege: [[16, 0], [24, 0]] });
z = await zustand();
check('Gegenprobe: ein kurzer Wisch antwortet nicht',
  !z.protokoll.length, z.protokoll.join());
check('Und laesst die Blase ebenfalls gerade', z.verschoben === '');

// Vertical is scrolling, and shouldn't touch the bubble at all.
await reset();
await geste({ sel: '.dm-row[data-id="2"] .msg.dm', zuege: [[6, -30], [14, -80]] });
z = await zustand();
check('Ein senkrechter Wisch bleibt Rollen',
  !z.protokoll.length && z.verschoben === '', `${z.protokoll.join()} ${z.verschoben}`);

// And the diagonal case in between.
// ---------------------------------------------------------------------------
// The case above doesn't actually exercise the 1.5 factor at all: at 80 px
// vertical, the earlier branch ("clearly vertical") already fires and ends
// the grip. That's exactly what the control check showed - the factor could
// be removed without anything failing.
//
// What it's meant to catch is a swipe that would be far enough
// HORIZONTALLY, but runs diagonally: 14 px sideways, 11 px down. That belongs
// to the scroll list, not to us - when in doubt, you scroll, you don't
// swipe.
await reset();
const diagonal = await page.evaluate(() => {
  const ziel = document.querySelector('.dm-row[data-id="2"] .msg.dm');
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const fire = (typ, x, y) => {
    const t = new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y,
      pageX: x, pageY: y, screenX: x, screenY: y });
    ziel.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true,
      touches: typ === 'touchend' ? [] : [t],
      targetTouches: typ === 'touchend' ? [] : [t], changedTouches: [t] }));
  };
  fire('touchstart', x0, y0);
  fire('touchmove', x0 + 14, y0 - 11);
  const line = document.querySelector('.dm-row[data-id="2"]');
  const erg = {
    verschoben: line.querySelector('.dm-block').style.transform,
    klasse: line.classList.contains('wischt'),
  };
  fire('touchend', x0 + 14, y0 - 11);
  return erg;
});
check('Ein schraeger Wisch gehoert der Liste, nicht der Blase',
  diagonal.verschoben === '' && !diagonal.klasse,
  `${diagonal.verschoben} ${diagonal.klasse}`);

// While dragging, it has to be visible that the gesture is recognized.
await reset();
const during = await page.evaluate(async () => {
  const ziel = document.querySelector('.dm-row[data-id="2"] .msg.dm');
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const fire = (typ, x) => {
    const t = new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y0,
      pageX: x, pageY: y0, screenX: x, screenY: y0 });
    ziel.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true,
      touches: [t], targetTouches: [t], changedTouches: [t] }));
  };
  fire('touchstart', x0);
  fire('touchmove', x0 + 20);
  fire('touchmove', x0 + 44);
  const line = document.querySelector('.dm-row[data-id="2"]');
  const erg = {
    verschoben: line.querySelector('.dm-block').style.transform,
    pfeil: line.querySelector('.reply-btn').style.opacity,
    klasse: line.classList.contains('wischt'),
  };
  fire('touchend', x0 + 44);
  return erg;
});
check('Beim Ziehen folgt die Blase dem Finger',
  during.verschoben === 'translateX(44px)', during.verschoben);
check('Der Pfeil taucht dabei auf', Number(during.pfeil) > 0.9, during.pfeil);
check('Und die Zeile weiss, dass sie gezogen wird', during.klasse);

// It buzzes once at the stop point.
// ---------------------------------------------------------------------------
// Only once, and that's the point: at the stop point, many more touchmove
// events keep coming in, and buzzing on each of them would be a constant
// buzz.
//
// On an iPhone nothing happens here at all - Safari doesn't know
// navigator.vibrate. The test can still check something real: THAT it gets
// called exactly once. On Android it's then also felt.
await reset();
const gebrummt = await page.evaluate(() => {
  const rufe = [];
  navigator.vibrate = (n) => { rufe.push(n); return true; };
  const ziel = document.querySelector('.dm-row[data-id="2"] .msg.dm');
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const fire = (typ, x) => {
    const t = new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y0,
      pageX: x, pageY: y0, screenX: x, screenY: y0 });
    ziel.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true,
      touches: typ === 'touchend' ? [] : [t],
      targetTouches: typ === 'touchend' ? [] : [t], changedTouches: [t] }));
  };
  fire('touchstart', x0);
  fire('touchmove', x0 + 20);
  const beforeTap = rufe.length;
  // Past the stop point, several times - the way a real thumb does it.
  fire('touchmove', x0 + 60);
  fire('touchmove', x0 + 75);
  fire('touchmove', x0 + 90);
  const afterTap = rufe.length;
  fire('touchend', x0 + 90);
  return { beforeTap, afterTap };
});
check('Vor dem Anschlag brummt nichts', gebrummt.beforeTap === 0,
  String(gebrummt.beforeTap));
check('Am Anschlag brummt es genau einmal', gebrummt.afterTap === 1,
  `${gebrummt.afterTap} Mal`);

// The bubbles sit at their edge - the arrow beside them, not in front.
// ---------------------------------------------------------------------------
// For one round the arrow sat on the left for every message. That pushed
// incoming bubbles away from the left edge by its width, and the edge is
// what tells you a message is incoming.
const pages = await page.evaluate(() => {
  const field = document.querySelector('#dm-thread').getBoundingClientRect();
  const measure = (id) => {
    const z = document.querySelector(`.dm-row[data-id="${id}"]`);
    const b = z.querySelector('.msg.dm').getBoundingClientRect();
    return {
      eigen: z.classList.contains('mine'),
      linksVomRand: Math.round(b.left - field.left),
      rechtsVomRand: Math.round(field.right - b.right),
      pfeil: Math.round(z.querySelector('.reply-btn').getBoundingClientRect().left),
      bubble: Math.round(b.left),
    };
  };
  return [measure(1), measure(2)];
});
const eigene = pages.find((x) => x.eigen);
const rein = pages.find((x) => !x.eigen);
// The arrow is 1.5rem wide. If it sat IN FRONT OF the incoming bubble, its
// distance from the edge would be correspondingly larger - exactly what
// shouldn't happen.
check('Eine eingehende Nachricht steht am linken Rand',
  rein.linksVomRand < 8, `${rein.linksVomRand} px`);
check('Und eine eigene am rechten', eigene.rechtsVomRand < 8,
  `${eigene.rechtsVomRand} px`);
check('Der Pfeil liegt bei einer eigenen left daneben',
  eigene.pfeil < eigene.bubble, `Pfeil ${eigene.pfeil}, Blase ${eigene.bubble}`);
check('Und bei einer eingehenden right daneben',
  rein.pfeil > rein.bubble, `Pfeil ${rein.pfeil}, Blase ${rein.bubble}`);
// Control check: the two rows really are aligned differently.
check('Gegenprobe: die beiden Zeilen liegen auf verschiedenen Seiten',
  Math.abs(pages[0].bubble - pages[1].bubble) > 20,
  `${pages[0].bubble} vs ${pages[1].bubble}`);

// ---------------------------------------------------------------------------
// A tap on a message does nothing
// ---------------------------------------------------------------------------
// It used to switch the row to "active" and make the reply arrow appear.
// But a tap is the single most common touch there is - while scrolling,
// while aiming at something else - and every time an arrow would pop up
// that nobody asked for. Replying happens by swiping.
await reset();
const nachTipp = await page.evaluate(() => {
  const line = document.querySelector('.dm-row[data-id="2"]');
  line.querySelector('.msg.dm').click();
  return {
    aktiv: line.className,
    pfeil: getComputedStyle(line.querySelector('.reply-btn')).opacity,
    protokoll: [...window.protokoll],
  };
});
check('Ein Tipp auf eine Nachricht macht nichts sichtbar',
  !/is-active/.test(nachTipp.aktiv) && Number(nachTipp.pfeil) === 0,
  `${nachTipp.aktiv} / Deckkraft ${nachTipp.pfeil}`);
check('Und loest schon gar keine Antwort aus',
  !nachTipp.protokoll.length, nachTipp.protokoll.join());
// Control check: the button itself still replies - on desktop it's reachable
// via :hover, and without this line, everything above would still pass even
// if the whole reply path were gone.
await reset();
const overButton = await page.evaluate(() => {
  document.querySelector('.dm-row[data-id="2"] .reply-btn').click();
  return [...window.protokoll];
});
check('Gegenprobe: der Pfeil selbst antwortet noch',
  overButton.includes('reply:2'), overButton.join());

// ---------------------------------------------------------------------------
// No selecting inside a message - on a finger
// ---------------------------------------------------------------------------
// On a finger, selecting is an accident: held too long, text selected,
// system menu on top. With a mouse it's intentional - so the rule only
// applies where no pointer can hover. The check for that is further down
// and is the more important of the two.
//
// Checked against the computed style, not the rule text: that way it also
// shows if a later rule quietly turns it back on somewhere.
const markieren = await page.evaluate(() => {
  const st = getComputedStyle(document.querySelector('.msg.dm'));
  const pfeil = getComputedStyle(document.querySelector('.reply-btn'));
  const frei = getComputedStyle(document.querySelector('#dm-input'));
  return { bubble: st.userSelect, pfeil: pfeil.userSelect, field: frei.userSelect };
});
check('In einer Nachricht laesst sich nichts markieren',
  markieren.bubble === 'none', markieren.bubble);
// The arrow belongs here too. The rule first sat only on the bubble, and
// whoever long-pressed the arrow on a phone got it selected, copy menu and
// all, for a single character.
check('Und im Antwortpfeil auch nicht',
  markieren.pfeil === 'none', markieren.pfeil);
// This Chromium doesn't know -webkit-touch-callout - getComputedStyle
// returns an empty value there regardless of what the stylesheet says. So a
// measurement would always fail, no matter whether the rule is correct.
// Hence, as an exception, checking the rule text here instead, with a note
// on why: whether iOS's system menu really stays away can only be seen on
// an iPhone.
check('Und die Zeile gegen das Systemmenue von iOS steht da (hier nicht messbar)',
  /\.dm-row \{[^}]*-webkit-touch-callout: none/.test(cssText));
// Control check: the rule targets the bubble and not the whole page - the
// input field still has to allow selecting, otherwise a typo can no longer
// be fixed.
check('Gegenprobe: im Eingabefeld sehr wohl',
  markieren.field !== 'none', markieren.field);

// On DESKTOP, though, you SHOULD.
// ---------------------------------------------------------------------------
// This check was missing for a long time, and its absence was measurable:
// the rule could be wound in and out arbitrarily without anything failing.
// No wonder - this suite runs with a finger, where (hover: none) applies
// either way. What happens on desktop only a second browser can tell you.
//
// It once demanded the opposite ("not on desktop either"). The requirement
// changed, not the measurement: with a mouse you should be able to select
// and copy a message's text again.
const amRechner = await browser.newContext({
  viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false,
});
const computerPage = await amRechner.newPage();
await computerPage.goto(base, { waitUntil: 'load' });
const computer = await computerPage.evaluate(() => {
  const app = document.querySelector('#app');
  app.hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-thread').innerHTML =
    '<div class="dm-row" data-id="9"><div class="dm-block">'
    + '<div class="msg dm"><span class="body">Probe</span></div></div></div>';
  return {
    bubble: getComputedStyle(document.querySelector('.msg.dm')).userSelect,
    zeiger: matchMedia('(hover: hover)').matches,
  };
});
await amRechner.close();
check('Am Rechner laesst sich der Text einer Nachricht markieren',
  computer.bubble !== 'none', computer.bubble);
// Control check for that: this second browser really is one without a
// finger - otherwise it would measure the same thing as the first and say
// nothing new.
check('Gegenprobe: dieser zweite Browser hat wirklich einen Zeiger',
  computer.zeiger);

await browser.close();
server.close();

console.log(failed ? `\n  ${failed} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(failed ? 1 : 0);
