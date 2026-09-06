// ============================================================================
// Fuenf Bilder fuer den Beitrag auf X
//
//   1  eine laufende Abstimmung, aus Sicht eines Nutzers
//   2  das Gespraech mit Ansem, aus Sicht eines Nutzers
//   3  Ansems Posteingang, nach Bestand sortiert
//   4  Ansem legt eine Abstimmung an
//   5  die Anmeldung: ein genauer Betrag an eine Adresse
//
// ----------------------------------------------------------------------------
// Warum das kein Bildbearbeitungsprogramm ist
//
// Die Bilder werden aus der ECHTEN index.html, der echten styles.css und den
// echten Zeichenfunktionen aus app.js erzeugt. Nichts davon ist nachgebaut.
//
// Das ist bei Werbebildern wichtiger als bei einer Vorschau fuer uns selbst:
// Ein nachgebautes Bild zeigt, was jemand gerne haette. Wer es sieht, meldet
// sich an und findet etwas anderes vor. Hier kann das nicht passieren – aendert
// sich die Oberflaeche, aendern sich diese Bilder beim naechsten Lauf mit, und
// verschwindet eine Funktion, schlaegt das Schneiden fehl.
//
// ----------------------------------------------------------------------------
// Zu den Beispieltexten
//
// Die Nachrichten sind erfunden, und das muessen sie sein – es gibt noch keine
// echten. Sie sind deshalb bewusst so gewaehlt, dass sie Ansem nichts in den
// Mund legen: keine Meinung, keine Zusage, keine Aussage ueber den Markt. Nur
// die Art von Satz, an der man sieht, wozu die Oberflaeche da ist.
//
//   node scripts/vorschau-post.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};

// Die echten Zeichenfunktionen, woertlich aus app.js.
const CODE = [
  schneide('const esc = (s) =>', '\n\n'),
  schneide('const nfGanz =', 'const ganzeZahl'),
  schneide('const ganzeZahl =', '\n'),
  schneide('const fmtTime =', '\n'),
  schneide('const STUFEN =', '\n'),
  schneide('function kurzUsd(', '\n}') + '\n}',
  schneide('const handleOf =', '\n'),
  schneide('const HANDLE_TONES', '\n'),
  schneide('function toneOf(wallet) {', '\n}') + '\n}',
  schneide('const LINK_MUSTER =', '\n'),
  schneide('function mitLinks(text) {', '\n}') + '\n}',
  schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen'),
  schneide('function fristText(closesAt)', '\n// Unter einer Stunde'),
  schneide('const BALD_MS =', '\n/**\n * Der Zeiger'),
  schneide('const fuehrenderAnteil =', '\nasync function zeichnePoll'),
  schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen'),
  schneide('function dmQuoteHtml(row) {', '\n}') + '\n}',
  schneide('function dmHtml(row) {', '\n}') + '\n}',
  schneide('const STRICH_MAX =', '\n'),
  schneide('const STRICH_MIN =', '\n'),
  schneide('function renderThreads() {', '\n}\n') + '\n}',
  // Mit const/let deklarierte Helfer bleiben in einem eigenen Bereich des
  // eval und sind von aussen nicht zu sehen; mit function deklarierte schon.
  // Die paar, die die Aufbauten unten brauchen, werden deshalb ausdruecklich
  // herausgereicht – die echten, nicht abgeschriebene.
  'window.handleOf = handleOf; window.esc = esc; window.vollUsd = vollUsd;',
].join('\n\n');

// ---------------------------------------------------------------------------
// Die Beispieldaten
// ---------------------------------------------------------------------------

const POLLS = [
  { id: 1, closed: false, myOptionId: 2, totalUsd: 1284000,
    closesAt: new Date(Date.now() + 19 * 3600e3).toISOString(),
    question: 'Which chain should we cover next?',
    options: [
      { id: 1, label: 'Base', usd: 214000, share: 0.167 },
      { id: 2, label: 'Hyperliquid', usd: 731000, share: 0.569 },
      { id: 3, label: 'Stay Solana only', usd: 339000, share: 0.264 },
    ] },
  // Beendet. Erst dann hebt pollHtml die fuehrende Antwort hervor – vorher
  // waere es eine Prognose, die den Ausgang beeinflusst: Wer sieht, was gerade
  // fuehrt, stimmt anders.
  { id: 2, closed: true, myOptionId: 4, totalUsd: 486500, closesAt: null,
    question: 'Next AMA time?',
    options: [
      { id: 4, label: 'Friday 8pm ET', usd: 301200, share: 0.619 },
      { id: 5, label: 'Sunday 2pm ET', usd: 185300, share: 0.381 },
    ] },
];

// Neutral gehalten – siehe der Hinweis oben.
const GESPRAECH = [
  { id: 1, from_admin: false, reply_to: null, created_at: heute(8, 41),
    body: 'gm' },
  { id: 2, from_admin: false, reply_to: null, created_at: heute(8, 42),
    body: 'holding since june, never sold a single one' },
  { id: 3, from_admin: true, reply_to: null, created_at: heute(9, 2),
    body: 'gm' },
  { id: 4, from_admin: false, reply_to: null, created_at: heute(9, 4),
    body: 'would love a longer format on market structure. the threads are good but they end where it gets interesting' },
  { id: 5, from_admin: true, reply_to: null, created_at: heute(9, 12),
    body: 'how long are you thinking' },
  { id: 6, from_admin: false, reply_to: null, created_at: heute(9, 13),
    body: 'an hour, once a month' },
  { id: 7, from_admin: false, reply_to: null, created_at: heute(9, 14),
    body: 'even recorded is fine, does not have to be live' },
  { id: 8, from_admin: true, reply_to: null, created_at: heute(9, 31),
    body: 'noted. put it in the next poll' },
  { id: 9, from_admin: false, reply_to: null, created_at: heute(9, 32),
    body: 'appreciate it' },
  { id: 10, from_admin: false, reply_to: null, created_at: heute(9, 33),
    body: 'and thanks for actually reading these' },
];
function heute(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// Ein voller Posteingang. Die Liste ist nach Bestand sortiert, und genau das
// soll das Bild zeigen: oben die groessten Halter, unten die kleineren, und
// die Spalte reicht ueber den ganzen Bildschirm.
//
// Die Adressen sind erfunden. Echte Halteradressen in ein Werbebild zu setzen
// hiesse, fremde Bestaende zu veroeffentlichen – das sind Leute, die sich das
// nicht ausgesucht haben.
const POSTEINGANG = [
  // wallet, $ Bestand, letzte Nachricht, ungelesen, von Ansem?
  ['7xKm9QpLvRt2sYwE4nBc6HjA1dFgZuVmTqXrPyNb3Ks', 2840000, 'longer format on market structure would be great', 3, false],
  ['Kd2Vn8XwPq5LzTc7HyBf3RjE9aUmGtVrZoXbM1Ns6Jp', 1190000, 'the last poll flipped in the final hour', 2, false],
  ['Hs7QvNmK4dGbXe2LpRcTfZaU9wYjB6xM1noAiEuS3rVt', 812000, 'will look at it', 0, true],
  ['Bq4Nz7VtLmXs9WcHy2RfEd6KjP1aUgTvZnQrYbM5Jx8', 604500, 'sent you the numbers from last quarter', 4, false],
  ['Wf5Tj1KcRb8NxMz3VqHd7LpA2eUsGmYtZoXnPr9Bk4', 478000, 'friday, yes', 0, true],
  ['Ms3Yd8FkQwLp5TvNc7HxBz2RjE9aUmGtVrZoXbP1Kn6', 341000, 'when is the next one', 2, false],
  ['Ln7Rq2WbKt4XyPz9HcVf6MdJ3aEsUgTvZoXnYrB8Km5', 276400, 'added more this morning', 1, false],
  ['Zp8Vc3NkWq6LxTy1HbRf9MdJ4aEsUgTvOnXrYmB2Kt7', 219800, 'noted', 0, true],
  ['Gt1Xb6MnKw9LzPc4HyRf2VdJ7aEsUqTvZoXnYrB5Km3', 168000, 'first poll i ever voted in', 1, false],
  ['Ct6Wg1PbNxKm4RzVy8HfLd3JqA7eUsTvZoXnYrM9Bk2', 124500, 'welcome', 0, true],
  ['Hj9Kz4VbNq7LxWc2TyRf5MdP1aEsUgOvZnXrYmB6Kt8', 96700, 'how does the vote weight work', 2, false],
  ['Yr2Bn5KwQt8LzXc6HyVf1MdJ9aEsUgTpZoXnRmB4Kk7', 71300, 'in since last week', 1, false],
  ['Dv4Mk7RbQn1LzXc9HyWf6TdJ2aEsUgOpZoXnYmB3Kt5', 54900, 'can i change my vote', 1, false],
  ['Nq6Pt3XbKw2LzMc8HyRf4VdJ5aEsUgTiZoXnYmB7Kr1', 38200, 'gm', 0, true],
  ['Ux8Lb1KnWq5LzTc3HyVf7MdJ6aEsUgOpZoXnYrB9Km2', 21600, 'holding, not selling', 1, false],
// Die Feldnamen sind die aus loadThreads: preview und last_from_admin. Sie
// hiessen hier erst last_body, und die Vorschauzeile blieb daraufhin leer –
// ohne Fehler, ohne Hinweis. Genau die Sorte Stelle, an der ein nachgebautes
// Bild anfaengt, etwas anderes zu zeigen als die Seite.
//
// Welche Zeile von Ansem stammt, steht pro Zeile und wird nicht gerechnet:
// Erst stand dort "jede vierte", und dann sagte "You: when is the next one" –
// Ansem fragt seine eigenen Leute, wann das naechste Mal ist.
].map(([wallet, usd, preview, unread, last_from_admin], i) => ({
  wallet, usd, preview, unread, last_from_admin, hidden: false,
  last_at: heute(9 - Math.floor(i / 2), 55 - (i % 2) * 20),
}));

// ---------------------------------------------------------------------------

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(pub, pfad);
  if (!datei.startsWith(pub) || !fs.existsSync(datei)) return res.writeHead(404).end('');
  // app.js bleibt leer: Die Vorschau setzt den Zustand selbst, sonst startet
  // das Skript den Anmeldeablauf und versteckt alles wieder.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

/**
 * Ein Bild.
 *
 * @param name    Dateiname ohne Endung
 * @param geraet  Bildgroesse
 * @param aufbau  laeuft IM Browser, mit den echten Funktionen im Zugriff
 */
async function bild(name, geraet, aufbau, daten = {}) {
  const seite = await browser.newPage({
    viewport: { width: geraet.w, height: geraet.h },
    deviceScaleFactor: geraet.dpr ?? 2,
    isMobile: geraet.w < 800, hasTouch: geraet.w < 800,
  });
  await seite.goto(base, { waitUntil: 'load' });
  const aufbauen = () => seite.evaluate(({ code, bau, d }) => {
    const $ = (s, w = document) => w.querySelector(s);
    const $$ = (s, w = document) => [...w.querySelectorAll(s)];
    window.$ = $; window.$$ = $$;
    window.state = {
      cfg: { symbol: 'ANSEM', min_dm_usd: 1000 },
      me: { isAdmin: false, wallet: '' },
      dmThreads: [], dmMessages: [], dmMinEntwurf: null,
      dmHideAvailable: true, zeigeVerborgene: false, dmRepliesAvailable: true,
    };
    // eslint-disable-next-line no-eval
    (0, eval)(code);
    $('#login').hidden = true;
    $('#app').hidden = false;
    $$('.pane').forEach((p) => { p.hidden = true; });
    // eslint-disable-next-line no-new-func
    new Function('d', bau)(d);
  }, { code: CODE, bau: aufbau, d: daten });

  await aufbauen();

  // Auf den Inhalt zuschneiden.
  // ---------------------------------------------------------------------------
  // Ein Bildschirmfoto in voller Geraetehoehe ist ehrlich, aber im Beitrag
  // steht darunter dann ein Drittel schwarze Flaeche – und in einer Zeitleiste
  // wird jedes Bild auf dieselbe Breite skaliert, das leere Drittel also
  // mitverkleinert. Deshalb wird gemessen, wo der Inhalt endet, die Hoehe
  // darauf gesetzt und NEU aufgebaut: Die Seite ist ein Flex-Stapel auf volle
  // Hoehe, ein blosses Verkleinern wuerde sie umbrechen statt zuschneiden.
  if (geraet.zuschneiden !== false) {
    const noetig = await seite.evaluate((wahl) => {
      const teile = [...document.querySelectorAll(wahl)];
      if (!teile.length) return null;
      const unten = Math.max(...teile.map((e) => e.getBoundingClientRect().bottom));
      return Math.ceil(unten + 24);
    }, geraet.messen ?? '.pane > *:not([hidden]) > *:not([hidden])');
    // In BEIDE Richtungen. Erst wurde nur verkleinert, und das hat einen
    // Fehler gemacht statt behoben: In Ansems Ansicht stehen unter dem
    // Formular zwei Abstimmungen, zusammen hoeher als der Bildschirm – die
    // zweite war unten abgeschnitten, und im Bild sah es aus, als fehle sie.
    // Nach oben mit Deckel, sonst waere aus einem Bildschirmfoto irgendwann
    // eine Bahn.
    const hoehe = Math.min(Math.max(noetig ?? geraet.h, 320), geraet.maxH ?? 1400);
    if (noetig && hoehe !== geraet.h) {
      await seite.setViewportSize({ width: geraet.w, height: hoehe });
      await aufbauen();
    }
  }

  const datei = path.join(root, 'preview', `post-${name}.png`);
  await seite.screenshot({ path: datei });
  const { width, height } = seite.viewportSize();
  await seite.close();
  console.log(`  ${path.relative(root, datei).padEnd(26)} ${width}x${height}`);
}

console.log('\nFuenf Bilder fuer den Beitrag\n');

// 1 – laufende Abstimmung, Nutzersicht
await bild('1-poll', { w: 1280, h: 800, dpr: 2 }, `
  $('#pane-polls').hidden = false;
  $('#poll-admin').hidden = true;
  $('#poll-list').innerHTML = d.polls.map(pollHtml).join('');
`, { polls: POLLS });

// 2 – Gespraech mit Ansem, Nutzersicht
await bild('2-dm', { w: 1280, h: 800, dpr: 2, zuschneiden: false }, `
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'dms'));
  $('#pane-dms').hidden = false;
  $('#dm-user').hidden = false;
  $('#dm-thread').innerHTML = d.rows.map(dmHtml).join('');
  $('#dm-thread').scrollTop = 1e6;
`, { rows: GESPRAECH });

// 3 – Ansems Posteingang
await bild('3-inbox', { w: 1280, h: 800, dpr: 2, zuschneiden: false }, `
  state.me.isAdmin = true;
  state.dmThreads = d.threads;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'dms'));
  $('#pane-dms').hidden = false;
  $('#dm-user').hidden = true;
  $('#dm-admin').hidden = false;
  renderThreads();
  $('#dm-min-input').value = '1,000';
  $('#dm-min-unit').textContent = 'in $ANSEM';

  // Ein offenes Gespraech daneben. Ohne das steht rechts "Select a thread" und
  // die Haelfte des Bildes ist leer – im Betrieb sieht Ansem dort das
  // Gespraech, das er gerade angetippt hat.
  const oben = d.threads[0];
  $$('#thread-items .thread').forEach((b, i) => b.classList.toggle('is-active', i === 0));
  $('#thread-title').classList.remove('dim');
  $('#thread-title').innerHTML =
    '<strong class="h t' + toneOf(oben.wallet) + '">' + handleOf(oben.wallet) + '</strong>'
    + '<span class="addr dim">' + oben.wallet + '</span>';
  $('#admin-thread').innerHTML = d.rows.map(dmHtml).join('');
  $('#admin-dm-form').hidden = false;
  $('#btn-hide-thread').hidden = false;
`, { threads: POSTEINGANG, rows: GESPRAECH });

// 4 – Ansem legt eine Abstimmung an
await bild('4-neu', { w: 1280, h: 800, dpr: 2 }, `
  state.me.isAdmin = true;
  $('#pane-polls').hidden = false;
  $('#poll-admin').hidden = false;
  $('#poll-admin-felder').hidden = false;
  $('#btn-poll-neu')?.setAttribute('aria-expanded', 'true');
  // Eine ANDERE Frage als die, die darunter schon laeuft: Zweimal dieselbe
  // waere im Bild ein Fehler, den jeder sieht. Diese hier kommt aus dem
  // Gespraech in Bild 2 – "put it in the next poll".
  $('#poll-question').value = 'Monthly AMA, one hour?';
  // Im Blatt stehen zwei Antwortfelder; ein drittes legt im Betrieb der Knopf
  // "+ Option" an. Hier wird das zweite geklont – dasselbe Element, nicht ein
  // nachgebautes.
  const kasten = $('#poll-options');
  while (kasten.children.length < 3) {
    kasten.append(kasten.lastElementChild.cloneNode(true));
  }
  const felder = $$('#poll-options input');
  ['Yes, recorded is fine', 'Yes, but live', 'Not interested'].forEach((t, i) => {
    if (felder[i]) felder[i].value = t;
  });
  $('#poll-list').innerHTML = d.polls.map(pollHtml).join('');
`, {
  // Ohne myOptionId: In Ansems Ansicht stand sonst ein Haken an einer Antwort,
  // waehrend eine Zeile darueber "you do not vote in your own polls" steht.
  // Die Datenbank weist seine Stimme ohnehin ab – im Bild darf sie erst recht
  // nicht auftauchen.
  // Beide: die laufende und die beendete. Auch in Ansems Ansicht soll eine
  // abgeschlossene dabei sein, damit man den blauen Balken sieht.
  polls: POLLS.map((p) => ({ ...p, myOptionId: null })),
});

// 5 – die Anmeldung
// ---------------------------------------------------------------------------
// Der Schritt, der SIZED von allem anderen unterscheidet: kein Wallet
// verbinden, sondern einen genauen Betrag an eine Adresse schicken. Die
// letzten Nachkommastellen sind die Kennung.
//
// Der Betrag ist echt gerechnet und nicht ausgedacht: dieselbe Formel wie in
// verify (base_lamports + ein Vielfaches von 1.000 Lamports), damit im Bild
// keine Zahl steht, die es so nie gaebe.
const LAMPORTS = 2_000_000 + 437 * 1_000;
// Knapper als die anderen: Die Karte ist nur 520 px breit und steht mittig –
// bei voller Schreibtischhoehe waere das Bild zu zwei Dritteln leer.
await bild('5-login', { w: 1280, h: 470, dpr: 2, zuschneiden: false }, `
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#step-install').hidden = true;
  $('#step-address').hidden = true;
  $('#step-pay').hidden = false;
  $('#pay-amount').textContent = d.betrag + ' SOL';
  $('#pay-treasury').textContent = d.adresse;
  $('#pay-timer').textContent = '· 21m left';
`, {
  betrag: (LAMPORTS / 1e9).toFixed(6),
  // Eine ausgedachte Adresse im richtigen Format: 44 Zeichen aus dem
  // Base58-Alphabet, wie eine echte Solana-Adresse. Sie gehoert niemandem –
  // zu diesem Muster gibt es keinen Schluessel, und wer aus dem Bild heraus
  // etwas dorthin schickt, ist es los. Das gilt aber fuer JEDE Adresse in
  // einem Werbebild, auch fuer die echte Treasury: Der Betrag passt dort auf
  // keine Challenge.
  adresse: 'MASi45ub7Qe4ZE36UT5G6cU4ud8Fhhe4deS4F3cw9KTA',
});

await browser.close();
server.close();
console.log('');
