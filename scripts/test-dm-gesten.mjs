// ============================================================================
// Am Finger: lange draufhalten und nach links wischen
//
// Der Befund vom Geraet: Auf dem Handy gab es fuer eine Antwort nur einen Weg –
// die Nachricht antippen, damit der Pfeil erscheint, dann den Pfeil treffen.
// Wer stattdessen lange draufhielt, bekam eine Textmarkierung und das Menue
// von iOS, das mit dieser Seite nichts zu tun hat.
//
// Verlangt war es wie in den DMs bei X: nach rechts wischen antwortet direkt,
// der Pfeil taucht dabei auf, und am Anschlag brummt es einmal.
//
// Ein Fenster beim langen Draufhalten ("Reply / Copy") gab es eine Runde lang
// und ist auf Wunsch wieder weg. Geblieben ist, dass sich am Finger
// kein Text markiert – das steht unten unveraendert drin.
//
// ----------------------------------------------------------------------------
// Was hier wirklich gemessen wird
//
// Beruehrungen lassen sich in Chromium nachstellen – TouchEvent gibt es dort,
// und die Handler in app.js unterscheiden nicht, woher ein Ereignis kommt.
// Gemessen wird deshalb nicht "steht die Regel da", sondern was nach einer
// Geste im Blatt steht: Ist das Fenster offen? Steht es neben der Blase? Ist
// die Antwortleiste danach da?
//
// Nicht gemessen werden kann, ob iOS sein eigenes Menue wirklich zurueckhaelt.
// Dafuer gibt es -webkit-touch-callout, und ob das greift, sieht man nur auf
// einem iPhone. Geprueft wird hier, dass die Regel gilt und nur am Finger.
//
// Ebenso wenig messbar: ob das Brummen am Anschlag zu spueren ist. Safari auf
// dem iPhone kennt navigator.vibrate nicht. Geprueft wird, dass es genau
// einmal gerufen wird – auf Android ist es dann auch da.
//
// ----------------------------------------------------------------------------
// Warum die halbe Datei aus app.js geschnitten wird
//
// app.js braucht beim Start eine Datenbank. Hier geht es nur um die Gesten,
// also werden genau die Teile herausgeschnitten, die sie ausmachen, und mit
// einem kleinen Zustand daneben ausgefuehrt. Nachgebaut wird nichts: Aendert
// jemand die Schwellen oder die Reihenfolge in app.js, aendert sich dieser
// Test mit – und wenn ein Stueck verschwindet, schlaegt das Schneiden fehl,
// statt still etwas anderes zu pruefen.
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b + bis.length);
};
/** Wie schneide, aber bis zum Ende der Zeile, in der die Marke steht.
 *  So haengt der Schnitt am NAMEN und nicht am Wert – sonst muesste dieser
 *  Test jedes Mal nachgezogen werden, wenn sich eine Schwelle aendert, und
 *  wer das vergisst, sieht nur einen Absturz ohne Bezug zur Sache. */
const schneideZeile = (von, bisName) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bisName, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von} .. ${bisName}`);
  return appJs.slice(a, appJs.indexOf('\n', b));
};

// Die echten Stuecke, woertlich.
const GESTEN = [
  schneideZeile('const WISCH_START_PX =', 'const WISCH_SCHWELLE_PX ='),
  'let griff = null;',
  schneide('function wischZurueck(g) {', '\n}'),
  // Der Klick-Handler gehoert dazu: An ihm haengt, dass der Pfeil antwortet
  // und dass ein Tipp auf die Nachricht NICHTS tut. Ohne ihn pruefte der Test
  // die halbe Sache.
  schneide("for (const sel of ['#dm-thread', '#admin-thread']) {\n  $(sel).addEventListener('click'", '\n  });\n}'),
  schneide("for (const sel of ['#dm-thread', '#admin-thread']) {\n  const box = $(sel);", '\n}'),
].join('\n\n');

const NACHRICHTEN = [
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
  const datei = path.join(pub, pfad);
  if (!datei.startsWith(pub) || !fs.existsSync(datei)) return res.writeHead(404).end('');
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
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
const seite = await kontext.newPage();
await seite.goto(base, { waitUntil: 'load' });

console.log('\nGesten in den DMs\n');

// ---------------------------------------------------------------------------
// Aufbau: das echte Blatt, die echten Gesten-Teile, ein kleiner Zustand
// ---------------------------------------------------------------------------
await seite.evaluate(({ gesten, rows }) => {
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
}, { gesten: GESTEN, rows: NACHRICHTEN });

// ---------------------------------------------------------------------------
// Beruehrungen nachstellen
// ---------------------------------------------------------------------------
// Echte TouchEvents, keine Maus: Die Handler haengen an touchstart/-move/-end,
// und eine Maus loest davon nichts aus. Ohne das pruefte dieser Test nichts.
const geste = (schritte) => seite.evaluate(async (s) => {
  const ziel = document.querySelector(s.sel);
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const punkt = (x, y) => new Touch({
    identifier: 1, target: ziel, clientX: x, clientY: y,
    pageX: x, pageY: y, screenX: x, screenY: y,
  });
  const feuer = (typ, x, y) => {
    const t = punkt(x, y);
    ziel.dispatchEvent(new TouchEvent(typ, {
      bubbles: true, cancelable: true,
      touches: typ === 'touchend' ? [] : [t],
      targetTouches: typ === 'touchend' ? [] : [t],
      changedTouches: [t],
    }));
  };
  feuer('touchstart', x0, y0);
  if (s.haltenMs) await new Promise((r2) => setTimeout(r2, s.haltenMs));
  for (const [dx, dy] of s.zuege ?? []) feuer('touchmove', x0 + dx, y0 + dy);
  if (!s.ohneEnde) feuer('touchend', x0 + (s.zuege?.at(-1)?.[0] ?? 0), y0);
  await new Promise((r2) => setTimeout(r2, 60));
  return null;
}, schritte);

const zustand = () => seite.evaluate(() => ({
  leisteOffen: !document.querySelector('#dm-reply-bar').hidden,
  leisteText: document.querySelector('#dm-reply-bar-text').textContent,
  protokoll: [...window.protokoll],
  verschoben: document.querySelector('.dm-row[data-id="2"] .dm-block').style.transform,
}));

const zuruecksetzen = () => seite.evaluate(() => {
  window.protokoll = [];
  document.querySelector('#dm-reply-bar').hidden = true;
  document.querySelectorAll('.dm-block').forEach((b) => { b.style.transform = ''; });
});

// ---------------------------------------------------------------------------
// 1. Nach rechts wischen
// ---------------------------------------------------------------------------
await zuruecksetzen();
await geste({ sel: '.dm-row[data-id="2"] .msg.dm', zuege: [[20, 0], [36, 0], [48, 0]] });
let z = await zustand();
check('Ein Wisch nach rechts antwortet', z.protokoll.includes('reply:2'), z.protokoll.join());
check('Und die Blase steht danach wieder gerade', z.verschoben === '');

// Zu kurz gewischt: nichts. Sonst loeste jedes Verrutschen eine Antwort aus.
await zuruecksetzen();
await geste({ sel: '.dm-row[data-id="2"] .msg.dm', zuege: [[16, 0], [24, 0]] });
z = await zustand();
check('Gegenprobe: ein kurzer Wisch antwortet nicht',
  !z.protokoll.length, z.protokoll.join());
check('Und laesst die Blase ebenfalls gerade', z.verschoben === '');

// Senkrecht ist Rollen und darf die Blase gar nicht erst anfassen.
await zuruecksetzen();
await geste({ sel: '.dm-row[data-id="2"] .msg.dm', zuege: [[6, -30], [14, -80]] });
z = await zustand();
check('Ein senkrechter Wisch bleibt Rollen',
  !z.protokoll.length && z.verschoben === '', `${z.protokoll.join()} ${z.verschoben}`);

// Und der Schraege dazwischen.
// ---------------------------------------------------------------------------
// Der Fall oben trifft den Faktor 1.5 gar nicht: Bei 80 px senkrecht greift
// schon der Zweig davor ("eindeutig senkrecht") und beendet den Griff. Genau
// das hat die Gegenprobe gezeigt – der Faktor liess sich herausnehmen, ohne
// dass etwas fehlschlug.
//
// Gemeint ist mit ihm ein Wisch, der WAAGERECHT weit genug waere, aber schraeg
// laeuft: 14 px zur Seite, 11 px nach unten. Der gehoert der Liste, nicht uns –
// im Zweifel rollt man, man wischt nicht.
await zuruecksetzen();
const schraeg = await seite.evaluate(() => {
  const ziel = document.querySelector('.dm-row[data-id="2"] .msg.dm');
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const feuer = (typ, x, y) => {
    const t = new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y,
      pageX: x, pageY: y, screenX: x, screenY: y });
    ziel.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true,
      touches: typ === 'touchend' ? [] : [t],
      targetTouches: typ === 'touchend' ? [] : [t], changedTouches: [t] }));
  };
  feuer('touchstart', x0, y0);
  feuer('touchmove', x0 + 14, y0 - 11);
  const zeile = document.querySelector('.dm-row[data-id="2"]');
  const erg = {
    verschoben: zeile.querySelector('.dm-block').style.transform,
    klasse: zeile.classList.contains('wischt'),
  };
  feuer('touchend', x0 + 14, y0 - 11);
  return erg;
});
check('Ein schraeger Wisch gehoert der Liste, nicht der Blase',
  schraeg.verschoben === '' && !schraeg.klasse,
  `${schraeg.verschoben} ${schraeg.klasse}`);

// Waehrend des Ziehens muss man sehen, dass die Geste erkannt ist.
await zuruecksetzen();
const waehrend = await seite.evaluate(async () => {
  const ziel = document.querySelector('.dm-row[data-id="2"] .msg.dm');
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const feuer = (typ, x) => {
    const t = new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y0,
      pageX: x, pageY: y0, screenX: x, screenY: y0 });
    ziel.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true,
      touches: [t], targetTouches: [t], changedTouches: [t] }));
  };
  feuer('touchstart', x0);
  feuer('touchmove', x0 + 20);
  feuer('touchmove', x0 + 44);
  const zeile = document.querySelector('.dm-row[data-id="2"]');
  const erg = {
    verschoben: zeile.querySelector('.dm-block').style.transform,
    pfeil: zeile.querySelector('.reply-btn').style.opacity,
    klasse: zeile.classList.contains('wischt'),
  };
  feuer('touchend', x0 + 44);
  return erg;
});
check('Beim Ziehen folgt die Blase dem Finger',
  waehrend.verschoben === 'translateX(44px)', waehrend.verschoben);
check('Der Pfeil taucht dabei auf', Number(waehrend.pfeil) > 0.9, waehrend.pfeil);
check('Und die Zeile weiss, dass sie gezogen wird', waehrend.klasse);

// Am Anschlag brummt es einmal.
// ---------------------------------------------------------------------------
// Nur einmal, und das ist der Punkt: Am Anschlag kommen noch viele
// touchmove-Ereignisse, und ein Brummen bei jedem waere ein Dauerbrummen.
//
// Auf dem iPhone passiert dabei gar nichts – Safari kennt navigator.vibrate
// nicht. Der Test kann trotzdem etwas Echtes pruefen: DASS es genau einmal
// gerufen wird. Auf Android ist es dann auch spuerbar.
await zuruecksetzen();
const gebrummt = await seite.evaluate(() => {
  const rufe = [];
  navigator.vibrate = (n) => { rufe.push(n); return true; };
  const ziel = document.querySelector('.dm-row[data-id="2"] .msg.dm');
  const r = ziel.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width / 2);
  const y0 = Math.round(r.top + r.height / 2);
  const feuer = (typ, x) => {
    const t = new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y0,
      pageX: x, pageY: y0, screenX: x, screenY: y0 });
    ziel.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true,
      touches: typ === 'touchend' ? [] : [t],
      targetTouches: typ === 'touchend' ? [] : [t], changedTouches: [t] }));
  };
  feuer('touchstart', x0);
  feuer('touchmove', x0 + 20);
  const vorAnschlag = rufe.length;
  // Ueber den Anschlag hinaus, mehrfach – so wie ein echter Daumen es tut.
  feuer('touchmove', x0 + 60);
  feuer('touchmove', x0 + 75);
  feuer('touchmove', x0 + 90);
  const nachAnschlag = rufe.length;
  feuer('touchend', x0 + 90);
  return { vorAnschlag, nachAnschlag };
});
check('Vor dem Anschlag brummt nichts', gebrummt.vorAnschlag === 0,
  String(gebrummt.vorAnschlag));
check('Am Anschlag brummt es genau einmal', gebrummt.nachAnschlag === 1,
  `${gebrummt.nachAnschlag} Mal`);

// Die Blasen stehen an ihrem Rand – der Pfeil daneben, nicht davor.
// ---------------------------------------------------------------------------
// Eine Runde lang stand der Pfeil bei allen Nachrichten links. Damit ruecken
// die eingehenden Blasen um seine Breite vom linken Rand ab, und der Rand ist
// das, woran man eine eingehende Nachricht erkennt.
const seiten = await seite.evaluate(() => {
  const feld = document.querySelector('#dm-thread').getBoundingClientRect();
  const messen = (id) => {
    const z = document.querySelector(`.dm-row[data-id="${id}"]`);
    const b = z.querySelector('.msg.dm').getBoundingClientRect();
    return {
      eigen: z.classList.contains('mine'),
      linksVomRand: Math.round(b.left - feld.left),
      rechtsVomRand: Math.round(feld.right - b.right),
      pfeil: Math.round(z.querySelector('.reply-btn').getBoundingClientRect().left),
      blase: Math.round(b.left),
    };
  };
  return [messen(1), messen(2)];
});
const eigene = seiten.find((x) => x.eigen);
const rein = seiten.find((x) => !x.eigen);
// Der Pfeil ist 1,5 rem breit. Steht er VOR der eingehenden Blase, waere ihr
// Abstand zum Rand entsprechend groesser – genau das soll nicht sein.
check('Eine eingehende Nachricht steht am linken Rand',
  rein.linksVomRand < 8, `${rein.linksVomRand} px`);
check('Und eine eigene am rechten', eigene.rechtsVomRand < 8,
  `${eigene.rechtsVomRand} px`);
check('Der Pfeil liegt bei einer eigenen links daneben',
  eigene.pfeil < eigene.blase, `Pfeil ${eigene.pfeil}, Blase ${eigene.blase}`);
check('Und bei einer eingehenden rechts daneben',
  rein.pfeil > rein.blase, `Pfeil ${rein.pfeil}, Blase ${rein.blase}`);
// Gegenprobe: Die beiden Zeilen sind wirklich verschieden ausgerichtet.
check('Gegenprobe: die beiden Zeilen liegen auf verschiedenen Seiten',
  Math.abs(seiten[0].blase - seiten[1].blase) > 20,
  `${seiten[0].blase} vs ${seiten[1].blase}`);

// ---------------------------------------------------------------------------
// Ein Tipp auf eine Nachricht tut nichts
// ---------------------------------------------------------------------------
// Frueher schaltete er die Zeile auf "aktiv" und liess den Antwortpfeil
// erscheinen. Ein Tipp ist aber die haeufigste Beruehrung ueberhaupt – beim
// Rollen, beim Zielen auf etwas anderes –, und jedes Mal sprang ein Pfeil ins
// Bild, den niemand gerufen hat. Geantwortet wird durch Wischen.
await zuruecksetzen();
const nachTipp = await seite.evaluate(() => {
  const zeile = document.querySelector('.dm-row[data-id="2"]');
  zeile.querySelector('.msg.dm').click();
  return {
    aktiv: zeile.className,
    pfeil: getComputedStyle(zeile.querySelector('.reply-btn')).opacity,
    protokoll: [...window.protokoll],
  };
});
check('Ein Tipp auf eine Nachricht macht nichts sichtbar',
  !/is-active/.test(nachTipp.aktiv) && Number(nachTipp.pfeil) === 0,
  `${nachTipp.aktiv} / Deckkraft ${nachTipp.pfeil}`);
check('Und loest schon gar keine Antwort aus',
  !nachTipp.protokoll.length, nachTipp.protokoll.join());
// Gegenprobe: Der Knopf selbst antwortet weiterhin – am Rechner ist er ueber
// :hover erreichbar, und ohne diese Zeile waere oben auch dann alles gruen,
// wenn der Antwortweg ganz weg waere.
await zuruecksetzen();
const ueberKnopf = await seite.evaluate(() => {
  document.querySelector('.dm-row[data-id="2"] .reply-btn').click();
  return [...window.protokoll];
});
check('Gegenprobe: der Pfeil selbst antwortet noch',
  ueberKnopf.includes('reply:2'), ueberKnopf.join());

// ---------------------------------------------------------------------------
// Kein Markieren in einer Nachricht – ueberall
// ---------------------------------------------------------------------------
// Erst galt das nur am Finger, mit der Begruendung, am Rechner sei Markieren
// normal. Es sollte trotzdem ganz raus.
//
// Geprueft wird am gerechneten Stil und nicht am Regeltext: So faellt auch
// auf, wenn eine spaetere Regel es irgendwo wieder anschaltet.
const markieren = await seite.evaluate(() => {
  const st = getComputedStyle(document.querySelector('.msg.dm'));
  const pfeil = getComputedStyle(document.querySelector('.reply-btn'));
  const frei = getComputedStyle(document.querySelector('#dm-input'));
  return { blase: st.userSelect, pfeil: pfeil.userSelect, feld: frei.userSelect };
});
check('In einer Nachricht laesst sich nichts markieren',
  markieren.blase === 'none', markieren.blase);
// Der Pfeil gehoert dazu. Die Regel stand erst nur an der Blase, und wer den
// Pfeil auf dem Handy lange hielt, bekam ihn markiert samt Kopieren-Menue
// fuer ein einzelnes Zeichen.
check('Und im Antwortpfeil auch nicht',
  markieren.pfeil === 'none', markieren.pfeil);
// -webkit-touch-callout kennt dieses Chromium nicht – getComputedStyle gibt
// dort einen leeren Wert zurueck, egal was im Blatt steht. Eine Messung waere
// also immer rot, ganz gleich ob die Regel richtig ist. Deshalb hier
// ausnahmsweise am Regeltext, und mit dem Vermerk, warum: Ob das Systemmenue
// von iOS wirklich wegbleibt, sieht man nur auf einem iPhone.
check('Und die Zeile gegen das Systemmenue von iOS steht da (hier nicht messbar)',
  /\.dm-row \{[^}]*-webkit-touch-callout: none/.test(cssText));
// Gegenprobe: Die Regel trifft die Blase und nicht die ganze Seite – im
// Eingabefeld muss man weiter markieren koennen, sonst laesst sich ein Tippfehler
// nicht mehr korrigieren.
check('Gegenprobe: im Eingabefeld sehr wohl',
  markieren.feld !== 'none', markieren.feld);

// Und am RECHNER ebenfalls nicht.
// ---------------------------------------------------------------------------
// Das ist die Pruefung, die vorher fehlte, und ihr Fehlen war messbar: Die
// Regel liess sich wieder in @media (hover: none) einwickeln, ohne dass etwas
// fehlschlug. Kein Wunder – diese Suite laeuft mit Finger, dort gilt die
// Abfrage. Ob es AUCH ohne Finger gilt, sagt nur ein zweiter Browser.
const amRechner = await browser.newContext({
  viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false,
});
const rechnerSeite = await amRechner.newPage();
await rechnerSeite.goto(base, { waitUntil: 'load' });
const rechner = await rechnerSeite.evaluate(() => {
  const app = document.querySelector('#app');
  app.hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-thread').innerHTML =
    '<div class="dm-row" data-id="9"><div class="dm-block">'
    + '<div class="msg dm"><span class="body">Probe</span></div></div></div>';
  return {
    blase: getComputedStyle(document.querySelector('.msg.dm')).userSelect,
    zeiger: matchMedia('(hover: hover)').matches,
  };
});
await amRechner.close();
check('Auch am Rechner laesst sich in einer Nachricht nichts markieren',
  rechner.blase === 'none', rechner.blase);
// Gegenprobe dazu: Dieser zweite Browser ist wirklich einer ohne Finger –
// sonst maesse er dasselbe wie der erste und sagte nichts Neues.
check('Gegenprobe: dieser zweite Browser hat wirklich einen Zeiger',
  rechner.zeiger);

await browser.close();
server.close();

console.log(failed ? `\n  ${failed} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(failed ? 1 : 0);
