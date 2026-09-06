// ============================================================================
// Ansem nimmt ein Gespraech aus seinem Posteingang.
//
// Die Aussage, um die es geht, ist eine ueber ZWEI Seiten:
//
//   Bei Ansem verschwindet die Zeile – aber nicht spurlos. Sie wird gezaehlt
//   und ist ueber einen Schalter wieder da. Ohne das waere Verbergen eine
//   Sackgasse: Verborgen bleibt hier verborgen, auch wenn derjenige
//   weiterschreibt (die Liste ist nach Bestand sortiert, nicht nach Zeit, es
//   gibt also gar keine Bewegung, die ein Gespraech zuruecktruege).
//
//   Beim anderen aendert sich NICHTS. Er sieht seinen Verlauf, er kann weiter
//   schreiben. Das ist keine Nachlaessigkeit, sondern die Entscheidung: Wer
//   hier schreiben darf, haelt dafuer einen Mindestbestand. Gekauft ist damit
//   das Recht zu schreiben, nicht das Recht auf Antwort.
//
// Geprueft wird die erste Haelfte im Browser mit dem echten renderThreads(),
// die zweite in der Migration – die Zeilenregeln sind der Teil, der wirklich
// entscheidet, und den kann kein Browser bestaetigen.
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const teile = [
  schneide('const HANDLE_TONES', '\n'),
  schneide('const handleOf =', '\n'),
  schneide('function toneOf(wallet) {', '\n}') + '\n}',
  schneide('const esc =', '\n\n'),
  schneide('const STUFEN =', '\n'),
  schneide('function kurzUsd(', '\n}') + '\n}',
  schneide('function renderThreads() {', '\n}\n') + '\n}',
  // Die Grenzen der Marke, damit die Pruefungen unten an der Quelle haengen
  // und nicht an abgeschriebenen Zahlen.
  schneide('const STRICH_MAX =', '\n'),
  schneide('const STRICH_MIN =', '\n'),
].join('\n');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Test */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// Sechs Gespraeche: zwei verborgen, eines davon zugleich unter der Schwelle.
// Der letzte Fall ist der interessante – er entscheidet, in welcher der beiden
// Zeilen darunter er gezaehlt wird.
const THREADS = [
  { wallet: 'AAA1111111111111111111111111111111111111', usd: 50_000, unread: 0, preview: 'a', hidden: false },
  { wallet: 'BBB2222222222222222222222222222222222222', usd: 20_000, unread: 1, preview: 'b', hidden: true },
  { wallet: 'CCC3333333333333333333333333333333333333', usd: 10_000, unread: 0, preview: 'c', hidden: false },
  { wallet: 'DDD4444444444444444444444444444444444444', usd: 5_000, unread: 0, preview: 'd', hidden: true },
  { wallet: 'EEE5555555555555555555555555555555555555', usd: 800, unread: 0, preview: 'e', hidden: false },
  { wallet: 'FFF6666666666666666666666666666666666666', usd: 400, unread: 0, preview: 'f', hidden: true },
];

const seite = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({
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
    ${teile}
    window.state = state;
    window.renderThreads = renderThreads;
  `,
});
await seite.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('.app').hidden = false;
  for (const p of document.querySelectorAll('.pane')) p.hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-admin').hidden = false;
});

const stand = () => seite.evaluate(() => {
  window.renderThreads();
  const sicht = (el) => el && !el.hidden;
  return {
    zeilen: [...document.querySelectorAll('.thread')].map((t) => t.dataset.wallet.slice(0, 3)),
    verborgenZeile: sicht(document.querySelector('#thread-versteckt'))
      ? document.querySelector('#thread-versteckt-zahl').textContent : null,
    knopf: document.querySelector('#btn-versteckt').textContent,
    knopfSichtbar: sicht(document.querySelector('#thread-versteckt')),
    // Was dasteht, wenn die Liste leer ist. Der Satz ist nicht immer derselbe:
    // In der Verborgen-Ansicht ist der Posteingang nicht leer.
    leer: document.querySelector('#thread-items .empty')?.textContent ?? null,
    // Wo der Punkt fuer ungelesene Nachrichten steht und ob er ueberhaupt
    // gezeichnet wird. ::before laesst sich nicht anklicken, aber messen.
    punkte: [...document.querySelectorAll('.thread')].filter((t) => {
      const v = getComputedStyle(t.querySelector('.w'), '::before');
      return v.content === '""' && v.width !== 'auto' && parseFloat(v.width) > 0;
    }).map((t) => t.dataset.wallet.slice(0, 3)),
  };
});

console.log('\nGespraeche verbergen\n');

// --- 1. Zugeklappt ---------------------------------------------------------
let s = await stand();
pruefe('Verborgene stehen nicht in der Liste',
  s.zeilen.join(',') === 'AAA,CCC,EEE', s.zeilen.join(','));
pruefe('Sie werden aber gezaehlt',
  s.verborgenZeile === '3 conversations hidden by you', String(s.verborgenZeile));
// Der Schalter benennt die HANDLUNG, nicht den Zustand. Ein Schalter, der den
// Zustand nennt, liest sich in der Haelfte der Faelle als sein Gegenteil.
pruefe('Der Schalter sagt, was ein Druck tut', s.knopf === 'Show', s.knopf);

// --- 1b. Wo die Zaehlzeile steht ------------------------------------------
//
// Sie steht OBEN in der Kopfleiste, unter dem Regler, und bleibt damit beim
// Blaettern stehen. Bei vierzig Gespraechen ist die Liste 1.674 px lang –
// unter ihr waere die Zeile nur nach dem Blaettern zu sehen, und dann waere
// verborgen doch wieder eine Sackgasse.
//
// Ueber ihr stand eine ZWEITE Zaehlzeile: wie viele Gespraeche die Schwelle
// ausblendet. Die ist entfernt, und diese Pruefung haelt das fest. Der Grund
// ist der Regler selbst – er steht direkt darueber und nennt die Zahl, nach
// der gefiltert wird. Zwei Zeilen uebereinander, die beide "N ausgeblendet"
// sagen, waren eine Auskunft zu viel, und zwar ausgerechnet vor der ersten
// Zeile der Liste.
{
  const lage = await seite.evaluate(() => {
    const oben = document.querySelector('.thread-top-bar');
    const liste = document.querySelector('#thread-items');
    const v = document.querySelector('#thread-versteckt');
    return {
      verstecktInKopf: oben.contains(v),
      vorDerListe: Boolean(
        liste.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_PRECEDING),
      schwellenzeileWeg: !document.querySelector('#thread-hidden'),
    };
  });
  pruefe('Die Verborgen-Zeile steht in der Kopfleiste', lage.verstecktInKopf);
  pruefe('Und damit vor der Liste', lage.vorDerListe);
  // Ausdruecklich geprueft und nicht nur weggelassen: Wer den Schwellenzaehler
  // wieder einbaut, soll hier darueber stolpern und den Grund oben finden.
  pruefe('Der Schwellenzaehler ist raus und bleibt raus',
    lage.schwellenzeileWeg && !/thread-hidden/.test(html));

  // --- Und wo der Rollbalken anfaengt ---------------------------------------
  //
  // Gerollt wird der INNERE Kasten, nicht die ganze Spalte. Sonst laeuft die
  // Leiste rechts ueber die volle Hoehe – also auch neben Kopfzeile, Schwelle
  // und Verborgen-Zeile, die alle feststehen. Ein Schieber neben etwas, das
  // sich nicht bewegt, sagt nichts, und laenger ist er dadurch auch.
  //
  // Geprueft wird beides: dass die Spalte selbst NICHT rollt (sonst gaebe es
  // zwei Leisten uebereinander) und dass die rollende Flaeche erst unter der
  // Kopfleiste beginnt.
  const rollen = await seite.evaluate(() => {
    // Sechs Gespraeche rollen nicht – fuer diese eine Frage braucht es eine
    // Liste, die laenger ist als ihr Kasten. Danach wieder zurueck, damit die
    // folgenden Pruefungen ihren Datensatz vorfinden.
    const echte = window.state.dmThreads;
    window.state.dmThreads = Array.from({ length: 40 }, (_, i) => ({
      wallet: `Z${String(i).padStart(2, '0')}${'x'.repeat(41)}`,
      usd: 100000 - i * 1000, unread: 0, preview: 'x', hidden: false,
    }));
    window.renderThreads();

    const spalte = document.querySelector('.thread-list');
    const items = document.querySelector('#thread-items');
    const kopf = document.querySelector('.thread-top-bar');
    const mass = {
      spalteRollt: spalte.scrollHeight > spalte.clientHeight,
      itemsRollt: items.scrollHeight > items.clientHeight,
      itemsOben: Math.round(items.getBoundingClientRect().top),
      kopfUnten: Math.round(kopf.getBoundingClientRect().bottom),
      bahn: items.clientHeight,
      spaltenhoehe: spalte.clientHeight,
    };

    window.state.dmThreads = echte;
    window.renderThreads();
    return mass;
  });
  pruefe('Die Spalte selbst rollt nicht', !rollen.spalteRollt);
  pruefe('Gerollt wird die Zeilenliste', rollen.itemsRollt);
  pruefe('Und sie beginnt erst unter der Kopfleiste',
    rollen.itemsOben >= rollen.kopfUnten - 1,
    `${rollen.itemsOben} gegen ${rollen.kopfUnten}`);
  // Die Gegenprobe zur Laenge: Die Bahn ist um die Kopfleiste kuerzer als die
  // Spalte. Ohne sie waere die Pruefung darueber auch dann erfuellt, wenn die
  // Liste die ganze Hoehe einnaehme.
  pruefe('Die Bahn ist um die Kopfleiste kuerzer',
    rollen.bahn < rollen.spaltenhoehe - 40,
    `${rollen.bahn} von ${rollen.spaltenhoehe} px`);

  // --- Und was rechts daneben steht ----------------------------------------
  //
  // Kein Rollbalken des Browsers, sondern eine eigene kleine Marke.
  //
  // Der Grund ist der, an dem die vorigen drei Anlaeufe gescheitert sind: Die
  // Leiste des Browsers hat keine frei waehlbare Laenge – sie ist der Anteil
  // des Sichtbaren am Ganzen. Bei drei Gespraechen fuellt sie fast die ganze
  // Bahn. "Klein" ist sie dort nirgends, egal wie schmal man sie macht.
  //
  // Dazu kam, dass sich von hier aus gar nicht messen liess, was ein echter
  // Browser daraus macht: Chrome entscheidet selbst zwischen ueberlagerter und
  // platzverbrauchender Leiste, und das Chromium dieser Tests kennt nur die
  // erste. Jede Messung meldete 0 px und sagte damit nichts. Eine eigene Marke
  // laesst sich ausmessen wie jedes andere Element – die Pruefungen hier sind
  // erst dadurch ueberhaupt moeglich.
  const marke = await seite.evaluate(() => {
    const liste = document.querySelector('#thread-items');
    const m = document.querySelector('#thread-strich');

    const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const leucht = (s) => {
      const [r, g, b] = s.match(/[\d.]+/g).slice(0, 3).map(Number);
      // color() liefert 0..1, rgb() 0..255 – am Groessenordnungssprung zu
      // erkennen. Ohne das misst man gegen Schwarz und bekommt eine Zahl, die
      // gut aussieht und nichts bedeutet.
      const f = (r <= 1 && g <= 1 && b <= 1) ? 1 : 1 / 255;
      return 0.2126 * kanal(r * f) + 0.7152 * kanal(g * f) + 0.0722 * kanal(b * f);
    };
    const grund = getComputedStyle(document.querySelector('.thread-list')).backgroundColor;
    const [x, y] = [leucht(getComputedStyle(m).backgroundColor), leucht(grund)]
      .sort((a, b) => b - a);

    return {
      browserleiste: liste.offsetWidth - liste.clientWidth,
      // Die gemessene Breite allein taugt nicht: Wo Chrome ueberlagert
      // zeichnet, ist sie auch ohne jede Regel 0. Erst die Angabe selbst
      // sagt, dass die Leiste wirklich abgeschaltet ist.
      abgeschaltet: getComputedStyle(liste).scrollbarWidth === 'none',
      hoehe: m.offsetHeight,
      breite: m.offsetWidth,
      inRuhe: Number(getComputedStyle(m).opacity),
      max: STRICH_MAX,
      min: STRICH_MIN,
      // Wie weit die Marke von der Aussenkante der Spalte entfernt ist. 0
      // heisst: Sie liegt auf dem Rahmen und ist fuer ihre Laenge der Rahmen.
      vonDerKante: document.querySelector('.thread-list').getBoundingClientRect().right
        - m.getBoundingClientRect().right,
      kontrast: (x + 0.05) / (y + 0.05),
    };
  });
  pruefe('Der Browser zeichnet keine eigene Leiste mehr',
    marke.browserleiste === 0 && marke.abgeschaltet,
    `${marke.browserleiste} px, abgeschaltet: ${marke.abgeschaltet}`);
  // Die Laenge selbst haengt an der Liste und wird beim Rollen gesetzt; sie
  // ist in test-realtime-switching geprueft, wo sich Listenlaengen frei
  // vorgeben lassen. Hier geht es um das, was nur ein echter Browser sagen
  // kann: dass daraus ueberhaupt etwas Sichtbares wird.
  // Der Wert aus der CSS ist der Anfangszustand, bevor zum ersten Mal gerollt
  // wurde. Er muss in der Spanne liegen, die app.js danach setzt – sonst
  // springt die Marke beim ersten Rollen.
  pruefe('Die Anfangshoehe liegt in der Spanne',
    marke.hoehe >= marke.min && marke.hoehe <= marke.max,
    `${marke.hoehe} px, erlaubt ${marke.min}–${marke.max}`);
  pruefe('Und sie ist ein Strich, keine Spalte', marke.breite <= 4,
    `${marke.breite} px`);
  // Sie schwimmt nicht in der Spalte, sondern liegt auf deren Kante – fuer
  // ihre Laenge ist sie der Rahmen. Innen liegend sah sie aus wie ein
  // Fremdkoerper; das ist der Unterschied, um den es hier ging.
  pruefe('Sie liegt auf dem Rahmen', Math.abs(marke.vonDerKante) < 0.5,
    `${marke.vonDerKante.toFixed(1)} px von der Aussenkante`);
  // Klein darf nicht heissen: weg. --bg-3 stand bei 1,17:1 – als breite
  // Flaeche gerade noch etwas, als zwei Pixel schmale Marke nichts mehr.
  pruefe('Sie ist noch zu sehen', marke.kontrast >= 1.8,
    `${marke.kontrast.toFixed(2)}:1`);
  pruefe('In Ruhe ist sie unsichtbar', marke.inRuhe === 0, String(marke.inRuhe));
}

// --- 2. Die verborgenen ansehen -------------------------------------------
//
// Sie stehen ANSTATT der anderen da, nicht dazwischen.
//
// Zuerst waren sie gemischt und gedaempft. Das las sich falsch: Wer nachsieht,
// wen er weggenommen hat, sucht dann in vierzig Zeilen nach dreien – und die
// Daempfung war die einzige Auskunft darueber, welche gemeint sind.
await seite.evaluate(() => { window.state.zeigeVerborgene = true; });
s = await stand();
pruefe('Es stehen NUR die verborgenen da',
  s.zeilen.join(',') === 'BBB,DDD,FFF', s.zeilen.join(','));
// Die Zeile darueber muss sagen, welche Liste man sieht. Bliebe dort "3
// conversations hidden by you", haette man drei Zeilen und eine Zahl, die
// dasselbe zu zaehlen scheint – und keinen Hinweis, dass der Posteingang
// gerade nicht zu sehen ist.
pruefe('Und die Zeile darueber sagt, welche Liste das ist',
  s.verborgenZeile === 'Showing 3 hidden conversations', String(s.verborgenZeile));
pruefe('Der Schalter fuehrt zurueck', s.knopf === 'Back', s.knopf);
await seite.evaluate(() => { window.state.zeigeVerborgene = false; });
s = await stand();
pruefe('Zurueck steht wieder der Posteingang da',
  s.zeilen.join(',') === 'AAA,CCC,EEE', s.zeilen.join(','));

// --- 3. Gezaehlt wird nur ueber der Schwelle ------------------------------
//
// Der Fall, um den es geht: FFF liegt unter der Schwelle UND ist verborgen.
// Er taucht auch ohne Verbergen nicht auf – ihn mitzuzaehlen hiesse, eine Zahl
// zu nennen, die sich beim Senken der Schwelle von selbst aendert.
await seite.evaluate(() => { window.state.cfg.min_dm_usd = 1000; });
s = await stand();
pruefe('Unter der Schwelle faellt zuerst heraus',
  s.zeilen.join(',') === 'AAA,CCC', s.zeilen.join(','));
pruefe('Gezaehlt werden nur die beiden ueber der Schwelle',
  s.verborgenZeile === '2 conversations hidden by you', String(s.verborgenZeile));
await seite.evaluate(() => { window.state.cfg.min_dm_usd = 0; });

// --- 4. Ohne Verborgene keine Zeile ---------------------------------------
await seite.evaluate(() => {
  window.state.zeigeVerborgene = false;
  window.state.dmThreads.forEach((t) => { t.hidden = false; });
});
s = await stand();
pruefe('Ohne verborgene Gespraeche steht die Zeile gar nicht da',
  s.verborgenZeile === null && s.zeilen.length === 6);

// --- 4b. Das letzte verborgene Gespraech zurueckholen ----------------------
//
// Die Sackgasse, und zwar die schlimmste Art davon: Man steht in der
// Verborgen-Ansicht, holt das letzte Gespraech zurueck – und die Zeile mit dem
// Zurueck-Knopf verschwindet mit ihm. Uebrig bleiben eine leere Liste und der
// Satz "Inbox is empty", der an dieser Stelle auch noch falsch ist: Der
// Posteingang ist voll, er steht nur gerade woanders.
//
// Ein Ruecksprung stand dafuer schon im Code, aber UNTER der Zeile, die die
// Liste zusammenstellt – er wirkte also erst beim naechsten Aufruf, den
// niemand ausloest. Er ist raus statt an die richtige Stelle geschoben: Die
// ganze Liste unter der Hand auszutauschen, weil das zurueckgeholte Gespraech
// zufaellig das letzte war, ist eine Bewegung, die man nicht ausgeloest hat.
await seite.evaluate(() => {
  window.state.dmThreads.forEach((t) => { t.hidden = false; });
  window.state.dmThreads.find((t) => t.wallet.startsWith('BBB')).hidden = true;
  window.state.zeigeVerborgene = true;
});
s = await stand();
pruefe('Ein einzelnes verborgenes Gespraech steht da',
  s.zeilen.join(',') === 'BBB', s.zeilen.join(','));

await seite.evaluate(() => {
  window.state.dmThreads.find((t) => t.wallet.startsWith('BBB')).hidden = false;
});
s = await stand();
pruefe('Zurueckgeholt ist die Liste leer', s.zeilen.length === 0, s.zeilen.join(','));
pruefe('Die Zeile bleibt stehen und nennt die Null',
  s.verborgenZeile === 'Showing 0 hidden conversations', String(s.verborgenZeile));
pruefe('Und mit ihr der Weg zurueck',
  s.knopfSichtbar && s.knopf === 'Back', `${s.knopfSichtbar} / ${s.knopf}`);
pruefe('Der leere Hinweis behauptet keinen leeren Posteingang',
  s.leer === 'Nothing hidden any more.', String(s.leer));

// Und der Knopf tut dann auch, was er verspricht.
await seite.evaluate(() => { window.state.zeigeVerborgene = false; });
s = await stand();
pruefe('Zurueck fuehrt in den vollen Posteingang',
  s.zeilen.length === 6 && s.verborgenZeile === null, s.zeilen.join(','));

// --- 5. Alte Datenbank, neue Oberflaeche -----------------------------------
//
// Das Blatt liegt auf einem Webspace, die Migration in Supabase; beide werden
// von Hand hochgeladen und sind deshalb manchmal ungleich alt. Genau das ist
// passiert: Der Knopf stand da, und ein Druck brachte "Could not find the
// table 'public.dm_hidden' in the schema cache" – eine Meldung aus dem
// Maschinenraum, fuer einen Knopf, den die Seite selbst angeboten hat.
//
// Erkannt wird der Zustand an der Spalte, die die neue Ansicht mitliefert.
// Geprueft wird hier mit Zeilen OHNE sie – also genau dem, was eine
// Datenbank vor der Migration zurueckgibt.
{
  await seite.evaluate(() => {
    // eslint-disable-next-line no-param-reassign
    window.state.dmThreads = window.state.dmThreads.map(({ hidden, ...rest }) => rest);
    window.state.dmHideAvailable = false;
  });
  const alt = await stand();
  pruefe('Ohne die Migration gibt es keine Verborgen-Zeile',
    alt.verborgenZeile === null, String(alt.verborgenZeile));
  pruefe('Und es faellt auch nichts aus der Liste',
    alt.zeilen.length === 6, alt.zeilen.join(','));
  // Und die Pruefung muss den Zustand von selbst erkennen, nicht nur den
  // gesetzten Schalter glauben.
  const erkannt = await seite.evaluate(() => {
    window.state.dmHideAvailable = true;
    // Dieselbe Zeile wie in loadThreads().
    if (window.state.dmThreads?.length) {
      window.state.dmHideAvailable = 'hidden' in window.state.dmThreads[0];
    }
    return window.state.dmHideAvailable;
  });
  pruefe('Der Zustand wird an den Daten erkannt, nicht geraten', erkannt === false);
}
pruefe('Und der Knopf im Gespraech haengt an derselben Angabe',
  /knopf\.hidden = !state\.dmHideAvailable;/.test(appJs));

// --- 5b. Der Punkt fuer ungelesene Nachrichten ----------------------------
//
// Er steht LINKS VOM BETRAG und nicht am Namen: Der Blick geht in dieser Liste
// nach rechts, dorthin, wo entschieden wird, welches Gespraech man aufmacht.
//
// Geprueft wird, dass er genau an den ungelesenen Zeilen haengt – nicht an
// allen und nicht an keiner. Eine Regel, die immer oder nie zeichnet, saehe auf
// einem Bildschirmfoto beides plausibel aus.
{
  await seite.evaluate(() => {
    window.state.zeigeVerborgene = false;
    window.state.dmThreads.forEach((t) => { t.hidden = false; t.unread = 0; });
    window.state.dmThreads[1].unread = 1;
    window.state.dmThreads[4].unread = 2;
  });
  const p = await stand();
  pruefe('Der Punkt haengt genau an den ungelesenen Zeilen',
    p.punkte.join(',') === 'BBB,EEE', p.punkte.join(',') || 'keiner');
  // Und er ist sichtbar: gemessen gegen den Grund der Liste. Ein Punkt, den man
  // nicht sieht, ist dasselbe wie keiner.
  const kontrast = await seite.evaluate(() => {
    const kanal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const leucht = (s) => {
      const [r, g, b] = s.match(/[\d.]+/g).slice(0, 3).map(Number);
      return 0.2126 * kanal(r / 255) + 0.7152 * kanal(g / 255) + 0.0722 * kanal(b / 255);
    };
    const zeile = document.querySelector('.thread.is-unread');
    const punkt = getComputedStyle(zeile.querySelector('.w'), '::before').backgroundColor;
    const grund = getComputedStyle(document.querySelector('.thread-list')).backgroundColor;
    const [x, y] = [leucht(punkt), leucht(grund)].sort((a, b) => b - a);
    return (x + 0.05) / (y + 0.05);
  });
  // 3:1 ist die Grenze fuer alles, was kein Text ist – ein Punkt gehoert dazu.
  pruefe('Und er hebt sich vom Grund ab', kontrast >= 3, `${kontrast.toFixed(2)}:1`);
  await seite.evaluate(() => {
    window.state.dmThreads.forEach((t) => { t.unread = 0; });
  });
}

// --- 5c. Die Vorschauen enden alle an derselben Stelle --------------------
//
// Mit "You:" davor wie ohne. Vorher war es eine Breite fuer alle, und "You:"
// schob den Text um vier Zeichen nach rechts – jede zweite Zeile endete weiter
// aussen als ihre Nachbarn. Eine ausgefranste Kante mitten in einer Liste,
// deren ganze Ordnung darin besteht, dass man sie von oben nach unten liest.
//
// Gemessen wird die GERENDERTE Kante und nicht die Regel: Die Regel rechnet in
// ch und rem, und ob die Rechnung aufgeht, sagt erst der Browser.
{
  const kanten = await seite.evaluate(() => {
    const lang = 'I sold half my bag last week and now I am not sure that was right';
    document.querySelector('#thread-items').innerHTML =
      `<button class="thread" data-wallet="ohne"><span class="h t0">R8C</span>`
      + `<span class="thread-prev">${lang}</span><span class="w">$1.2M</span></button>`
      + `<button class="thread" data-wallet="mit"><span class="h t1">aQ4</span>`
      + `<span class="thread-du">You:</span>`
      + `<span class="thread-prev">${lang}</span><span class="w">$88K</span></button>`;
    const [ohne, mit] = [...document.querySelectorAll('.thread-prev')]
      .map((e) => e.getBoundingClientRect().right);
    return { ohne: +ohne.toFixed(2), mit: +mit.toFixed(2), ab: Math.abs(ohne - mit) };
  });
  pruefe('Vorschau mit und ohne "You:" endet an derselben Stelle',
    kanten.ab < 1, `${kanten.ohne} gegen ${kanten.mit} px`);

  // Gegenprobe: Ohne die zweite Breite franst es aus – und zwar um genau die
  // vier Zeichen von "You:". Ohne sie stuende hier eine Messung, von der
  // niemand weiss, ob sie ueberhaupt etwas sehen kann.
  const ohneRegel = await seite.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.thread-du + .thread-prev { max-width: var(--vorschau) !important; }';
    document.head.appendChild(st);
    const [ohne, mit] = [...document.querySelectorAll('.thread-prev')]
      .map((e) => e.getBoundingClientRect().right);
    st.remove();
    return Math.abs(ohne - mit);
  });
  pruefe('Gegenprobe: ohne die zweite Breite laufen sie auseinander',
    ohneRegel > 20, `${ohneRegel.toFixed(1)} px Unterschied`);
}

// --- 6. Gegenprobe ---------------------------------------------------------
// Ohne sie stuende hier eine Messung, von der niemand weiss, ob sie ueberhaupt
// etwas sehen kann.
await seite.evaluate(() => {
  window.state.dmHideAvailable = true;
  window.state.dmThreads.forEach((t) => { t.hidden = false; });
  window.state.dmThreads[0].hidden = true;
});
s = await stand();
pruefe('Gegenprobe: ein einzelnes verborgenes verschwindet wirklich',
  !s.zeilen.includes('AAA') && s.verborgenZeile === '1 conversation hidden by you',
  `${s.zeilen.join(',')} / ${s.verborgenZeile}`);

await seite.close();
await browser.close();
server.close();

// ---------------------------------------------------------------------------
// Die andere Haelfte: die Datenbank
//
// Sie ist der Teil, der wirklich entscheidet – der Browser ist der Teil, den
// man umgehen kann. Geprueft wird hier der TEXT der Migration und nicht ihre
// Wirkung; die ist gegen ein echtes Postgres nachgestellt worden, bevor die
// Oberflaeche gebaut wurde. Was hier steht, haelt fest, dass die vier
// Entscheidungen nicht stillschweigend zurueckgedreht werden.
// ---------------------------------------------------------------------------
console.log('\nWas die Datenbank dazu sagt\n');

pruefe('Nur Ansem darf die Liste ueberhaupt lesen',
  /create policy dm_hidden_admin_select[\s\S]*?for select to authenticated using \(app\.is_admin\(\)\)/
    .test(migration));
pruefe('Nur Ansem darf verbergen',
  /create policy dm_hidden_admin_insert[\s\S]*?with check \(app\.is_admin\(\)\)/.test(migration));
pruefe('Nur Ansem darf zurueckholen',
  /create policy dm_hidden_admin_delete[\s\S]*?using \(app\.is_admin\(\)\)/.test(migration));
// Das ist die Zeile, die dafuer sorgt, dass niemand seinem eigenen Eintrag
// ansieht, dass er verborgen wurde: Die Unterabfrage laeuft unter SEINEN
// Rechten, und dm_hidden gibt ihm keine Zeile heraus.
pruefe('Die Ansicht laeuft mit den Rechten des Aufrufers',
  /create or replace view public\.dm_threads\s*\nwith \(security_invoker = on\)/.test(migration));
pruefe('Und liefert hidden als Spalte, statt selbst zu filtern',
  /as\s+hidden/.test(migration) && !/where[\s\S]{0,80}not exists[\s\S]{0,80}dm_hidden/i.test(migration));
// Ausdruecklich geprueft und nicht nur weggelassen: Verbergen darf dem anderen
// das Schreiben NICHT nehmen. Wer das aendern will, soll hier darueber
// stolpern und den Grund im Kopf der Migration finden.
pruefe('Verbergen fasst die Schreibregeln fuer dms nicht an',
  !/dms_insert_user/.test(migration) && !/dm_hidden/.test(
    fs.readFileSync(path.join(root, 'supabase', 'migrations',
      '20260825030000_min_balance_for_dms.sql'), 'utf8')));

console.log('\nUnd die Oberflaeche\n');
pruefe('Der Verbergen-Knopf steht NEBEN dem Titel, nicht darin',
  /<div class="thread-kopf">[\s\S]*?id="thread-title"[\s\S]*?id="btn-hide-thread"[\s\S]*?<\/div>/
    .test(html),
  'sonst raeumt renderThread() bei jedem Oeffnen seinen Zuhoerer weg');
pruefe('Und bekommt seinen Zuhoerer genau einmal',
  (appJs.match(/\$\('#btn-hide-thread'\)\.addEventListener/g) || []).length === 1);
pruefe('Ohne offenes Gespraech ist er weg',
  /\$\('#btn-hide-thread'\)\.hidden = true;/.test(appJs));
pruefe('Geschrieben wird erst in die Datenbank, dann in die Anzeige',
  appJs.indexOf("from('dm_hidden')") < appJs.indexOf('zeile.hidden = verbergen'));

// ---------------------------------------------------------------------------
console.log('\nDer Sperrhinweis\n');
//
// Wer den Hinweis sieht, hat seinen eigenen Bestand schon oben rechts stehen –
// dieselbe Zahl aus derselben Quelle, zwei Handbreit darueber. Hier stand sie
// ein zweites Mal ("You hold $102."), und zwei Stellen fuer dieselbe Zahl sind
// zwei Stellen, die auseinanderlaufen koennen.
//
// Ausgefuehrt, nicht gelesen: gateText() kommt woertlich aus app.js und wird
// hier wirklich aufgerufen. Ein Test auf den Quelltext haette "You hold" auch
// im Kommentar darueber gefunden – und der steht dort mit Absicht.
const gate = (() => {
  const quelle = schneide('function gateText(min, was) {', '\n}') + '\n}';
  const esc = (t) => String(t);
  const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
  const state = { cfg: { symbol: 'ANSEM' }, me: { usd: 102 } };
  const f = new Function('esc', 'fmtUsd', 'state', `${quelle}; return gateText;`)(esc, fmtUsd, state);
  return f(1000, 'to message Ansem');
})();

console.log(`     ${gate}`);
pruefe('Der Hinweis nennt die Schwelle', /1,000/.test(gate) && /ANSEM/.test(gate));
pruefe('Und sagt, wofuer sie gilt', /to message Ansem/.test(gate));
pruefe('Aber nicht den eigenen Bestand',
  !/You hold/i.test(gate) && !/102/.test(gate), gate);

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
