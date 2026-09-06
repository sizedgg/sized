// ============================================================================
// Prüft die Laufzeit einer Abstimmung.
//
// Die Mechanik dahinter war schon vor diesem Test fertig: closes_at steht seit
// dem ersten Schema in der Tabelle, der Trigger weist Stimmen danach ab, die
// Kursaktualisierung überspringt abgelaufene Abstimmungen, die og-Function
// rechnet damit. Gefehlt hat nur der Weg hinein – und genau das ist die Sorte
// Lücke, die kein Test bemerkt, weil nichts kaputt ist: Es war schlicht nie
// etwas da.
//
// Deshalb prüft dieser Test zuerst die VERBINDUNG und nicht die Rechnung: dass
// das Formular eine Frist mitschickt, dass sie in der Kopfzeile ankommt, und
// dass die Sperre am Ende auch im Browser greift und nicht erst als rote
// Meldung aus der Datenbank zurückkommt.
//
// Die Zeitrechnung wird auf ABSICHT geprüft, nicht auf Wortlaut. "3h 12m left"
// darf umformuliert werden; was nicht passieren darf, ist Aufrunden – wer
// "3h" liest und in Wahrheit 2h 5m hat, kommt zu spät, weil die Seite ihm Zeit
// versprochen hat, die es nicht gab.
//
//   node scripts/test-poll-frist.mjs
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Woertlich aus der Quelle.
const zeit = schneide('function fristText(closesAt)', '\n// Unter einer Stunde');
const zeile = schneide('const BALD_MS =', '\n/**\n * Der Zeiger');
// Wer als führend markiert wird – und dass das erst nach dem Schliessen
// passiert. Die Rechnung steht an EINER Stelle in app.js, weil Liste und
// geteiltes Bild sonst auseinanderlaufen könnten.
const fuehrend = schneide('const fuehrenderAnteil =', '\nasync function zeichnePoll');
const markup = schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');
const escFn = schneide('const esc = (s) =>', '\n\n');
const symbole = schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen');
// Die Laufzeitsteuerung samt ihrer Zuhoerer, woertlich – der Test stellt
// gleich wirklich an den Listen, statt ein nachgebautes Verhalten zu pruefen.
// Achtung: Der Ausschnitt enthaelt die Anmeldung der change-Zuhoerer schon.
// Wer hier zusaetzlich selbst einen anmeldet, schaltet doppelt.
const feldCode = schneide('const LZ_MAX_MINUTEN =', "\n$('#btn-create-poll')");

// Der Kasten aus dem echten Blatt, nicht nachgebaut.
const kasten = /<div class="lz-block"[\s\S]*?<p id="lz-hinweis"[\s\S]*?<\/p>\s*<\/div>/.exec(html);
if (!kasten) throw new Error('Die Laufzeitauswahl fehlt in index.html');

// Fuer die Seite der GANZE Anlegekasten und nicht nur die Laufzeit: Weiter
// unten wird die Groesse der Beschriftung gegen die Ueberschrift daneben
// gehalten, und die steht nun einmal im selben Kasten. Ausserdem gelten dort
// Regeln wie `.poll-admin input`, die genau deshalb interessant sind – sie
// haben dem Feld schon einmal stillschweigend .6rem Innenabstand verpasst.
const ganzerKasten = /<div id="poll-admin"[\s\S]*?\n {4}<\/div>/.exec(html);
if (!ganzerKasten) throw new Error('Der Anlegekasten fehlt in index.html');
const offenerKasten = ganzerKasten[0]
  .replace('class="poll-admin" hidden', 'class="poll-admin offen"')
  .replace('id="poll-admin-felder" hidden', 'id="poll-admin-felder"');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="background:var(--bg)">
       <!-- offen: Der Anlegekasten ist seit dem Aufraeumen im Polls-Tab
            standardmaessig zu, und zugeklappt ist gar nichts davon zu sehen.
            Hier geht es um die Laufzeit, also um den offenen Zustand. -->
       <main class="pane" style="background:var(--bg)">${offenerKasten}</main>
       <div class="polls-panel" id="ziel"></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 900, height: 700 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false }, polls: [] };
    const toast = () => {};
    ${escFn}
    ${formate}
    ${symbole}
    ${zeit}
    ${zeile}
    ${fuehrend}
    ${markup}
    ${feldCode}
    window.fristText = fristText;
    window.fristZeile = fristZeile;
    window.pollHtml = pollHtml;
    window.gewaehlteFristMinuten = gewaehlteFristMinuten;
    window.setzeLaufzeit = setzeLaufzeit;
    window.renderLaufzeit = renderLaufzeit;
    window.LZ_MAX_MINUTEN = LZ_MAX_MINUTEN;`,
});

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
console.log('\nDie Zeitangabe\n');

const text = (ms) => seite.evaluate((m) => window.fristText(new Date(Date.now() + m).toISOString()), ms);
const M = 60_000, H = 60 * M, T = 24 * H;

// Ueberall 2 Sekunden drauf, und das ist kein Schoenheitsfehler: Genau auf der
// Grenze – 3 Tage auf die Millisekunde – haengt das Ergebnis davon ab, ob die
// beiden Date.now() im Test und in der Funktion dieselbe Millisekunde treffen.
// Mal "3d left", mal "2d 23h left", je nach Laune der Uhr. Ein Test, der eine
// von zwanzig Laeufen scheitert, wird irgendwann uebersehen statt gelesen.
const ZUSCHLAG = 2000;
for (const [ms, erwartet, was] of [
  [3 * T + 5 * H, '3d 5h left', 'Tage mit Stunden'],
  [3 * T, '3d left', 'volle Tage ohne Nullstunde'],
  [5 * H + 12 * M, '5h 12m left', 'Stunden mit Minuten'],
  [2 * H, '2h left', 'volle Stunden ohne Nullminute'],
  [47 * M, '47m left', 'nur Minuten'],
  [30_000, 'closing now', 'unter einer Minute'],
]) {
  const t = await text(ms + ZUSCHLAG);
  pruefe(`${was}`, t === erwartet, t);
}

// Der Punkt, um den es wirklich geht.
const knapp = await text(2 * H + 59 * M + 59_000);
pruefe('Es wird abgerundet, nie auf', /^2h 59m/.test(knapp), knapp);
const knapp2 = await text(59 * M + 59_000);
pruefe('Auch an der Stundengrenze', /^59m/.test(knapp2), knapp2);

// Abgelaufen darf nie als Restzeit erscheinen – auch nicht als "0m".
for (const ms of [0, -1000, -5 * H]) {
  const t = await text(ms);
  pruefe(`Abgelaufen (${ms} ms) zeigt keine Restzeit`, t === 'closing', t);
}

// ---------------------------------------------------------------------------
console.log('\nDie Zeile in der Abstimmung\n');

const bau = async (closesAt, closed = false) => seite.evaluate(([c, zu]) => {
  const p = {
    id: 1, closed: zu, closesAt: c, totalVotes: 191, totalUsd: 781420,
    question: 'Should we open the token gate?',
    options: [{ id: 1, label: 'Yes', votes: 100, usd: 500000, share: .64 },
              { id: 2, label: 'No', votes: 91, usd: 281420, share: .36 }],
  };
  document.querySelector('#ziel').innerHTML = window.pollHtml(p);
  const el = document.querySelector('.frist-rest');
  return el && {
    text: el.textContent,
    bald: el.classList.contains('is-bald'),
    farbe: getComputedStyle(el).color,
  };
}, [closesAt, closed]);

const inMs = (ms) => new Date(Date.now() + ms).toISOString();

const weit = await bau(inMs(3 * T + ZUSCHLAG));
pruefe('Eine laufende Abstimmung zeigt die Restzeit', !!weit && /3d/.test(weit.text), weit?.text);
pruefe('Mit dem Trennpunkt der übrigen Kopfzeile', !!weit && weit.text.startsWith('· '), weit?.text);

const bald = await bau(inMs(20 * M));
pruefe('Unter einer Stunde wird sie hervorgehoben', bald?.bald === true, bald?.text);
pruefe('Und zwar farblich anders als vorher', weit && bald && weit.farbe !== bald.farbe,
  `${weit?.farbe} → ${bald?.farbe}`);
// Golden ist sie nur wegen der Aufmerksamkeit – lesbar muss sie trotzdem sein.
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (rgb) => { const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b); };
const kon = (a, b) => { const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05); };
const zahlen = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const grund = zahlen(/--bg-1:\s*(#[0-9a-f]{6})/i.exec(css)[1]
  .replace(/#(..)(..)(..)/, (_, a, b, c) => [a, b, c].map((h) => parseInt(h, 16)).join(' ')));
const kBald = kon(zahlen(bald.farbe), grund);
pruefe('Die hervorgehobene Zeile bleibt lesbar (mindestens 4,5:1)', kBald >= 4.5,
  `${kBald.toFixed(1)}:1`);

const eine = await bau(inMs(59 * M + 30_000));
pruefe('Die Grenze liegt bei einer Stunde, nicht bei Minuten', eine?.bald === true, eine?.text);
const knappDrueber = await bau(inMs(61 * M));
pruefe('Knapp darüber noch nicht', knappDrueber?.bald === false, knappDrueber?.text);

pruefe('Ohne Frist steht dort nichts', (await bau(null)) === null);
// Eine geschlossene Abstimmung hat keine Restzeit mehr, sie hat ein Ergebnis.
// Beides nebeneinander waere ein Widerspruch im selben Satz.
pruefe('Eine geschlossene Abstimmung zeigt keine Restzeit',
  (await bau(inMs(3 * T), true)) === null);

// ---------------------------------------------------------------------------
console.log('\nDer Weg vom Formular in die Datenbank\n');

pruefe('Das Formular hat drei Listen',
  /id="lz-tage"/.test(html) && /id="lz-stunden"/.test(html) && /id="lz-minuten"/.test(html));
// KEIN <select>, und das ist hier keine Formalie, sondern der Grund fuer die
// ganze Umstellung: Ein <select> gilt in Chromium nach einem MAUSKLICK als
// :focus-visible – wie ein Textfeld, anders als ein Knopf. Die Regel
// :focus-visible:not(input):not(textarea) im Blatt greift damit, und um das
// Feld liegt ein heller Ring, den niemand wollte. Weiter unten wird das
// gemessen; hier steht die Bauform, damit niemand versehentlich zurueckbaut.
pruefe('Und zwar keine <select>',
  !/<select id="lz-/.test(html),
  (html.match(/<select id="lz-\w+"/g) || []).join(' ') || 'keins');
pruefe('Sondern Knöpfe mit eigener Klappe',
  (html.match(/<button type="button" id="lz-(tage|stunden|minuten)"/g) || []).length === 3);
pruefe('Jede Klappe ist eine Listbox',
  (html.match(/class="lz-liste" role="listbox"/g) || []).length === 3);
pruefe('Und jeder Knopf sagt, ob sie offen ist',
  (html.match(/aria-haspopup="listbox" aria-expanded="false"/g) || []).length === 3);
// Ohne Beschriftung waere jede Liste eine Zahl ohne Einheit. Sie steht IM
// Knopf und nicht daneben: So ist der ganze Kasten das antippbare Ziel, und
// eine Vorlesestimme sagt "Days 1" statt nur "1".
pruefe('Jede Liste ist beschriftet',
  /<span class="lz-name">Days<\/span>/.test(html)
  && /<span class="lz-name">Hours<\/span>/.test(html)
  && /<span class="lz-name">Minutes<\/span>/.test(html));
pruefe('Und die Beschriftung steht im Knopf, nicht daneben',
  (html.match(/<button type="button" id="lz-\w+"[\s\S]{0,220}?<span class="lz-name">/g) || [])
    .length === 3);
pruefe('Die Gruppe ist beschriftet',
  /class="lz-block" role="group" aria-labelledby="lz-titel"/.test(html));
// Die Eintraege stehen NICHT im Blatt: 0 bis 59 von Hand waeren neunzig Zeilen
// Abschrift. app.js baut sie.
pruefe('Die Klappen sind im Blatt leer und werden im Code gefüllt',
  /<div id="lz-liste-tage" class="lz-liste" role="listbox"\s+aria-label="Days" hidden><\/div>/.test(html)
  && /function lzListe\(/.test(appJs));

pruefe('Das Anlegen schickt closes_at mit',
  /\.from\('polls'\)\.insert\(\{ question, closes_at \}\)/.test(appJs));
// Der eine Zustand, der vor der Frist der einzige war: laeuft, bis Ansem sie
// von Hand schliesst. Er muss erreichbar bleiben.
pruefe('Bei 0 wird ausdrücklich null geschickt',
  /const closes_at = minuten > 0\s*\n?\s*\?[\s\S]{0,120}?:\s*null;/.test(appJs));
pruefe('Die Frist wird beim Anlegen in einen Zeitpunkt gerechnet',
  /Date\.now\(\) \+ minuten \* 60_000\)\.toISOString\(\)/.test(appJs));
pruefe('Nach dem Anlegen steht die Vorgabe wieder da',
  /setzeLaufzeit\(\);/.test(appJs));

// ---------------------------------------------------------------------------
console.log('\nDie drei Listen\n');

const stand = () => seite.evaluate(() => {
  const zaehl = (id, nurWaehlbar) =>
    [...document.querySelectorAll(`#lz-liste-${id} .lz-eintrag`)]
      .filter((e) => !nurWaehlbar || e.getAttribute('aria-disabled') !== 'true').length;
  return {
    tage: Number(document.querySelector('#lz-tage').dataset.wert),
    stunden: Number(document.querySelector('#lz-stunden').dataset.wert),
    minuten: Number(document.querySelector('#lz-minuten').dataset.wert),
    gesamt: window.gewaehlteFristMinuten(),
    // Wie viele Eintraege die Klappe hat – und wie viele davon waehlbar sind.
    // Die beiden Zahlen zu trennen ist der Punkt der Woche-Regel: Die Liste
    // bleibt vollstaendig, einzelne Eintraege sind nur abgeschaltet.
    auswahl: { tage: zaehl('tage'), stunden: zaehl('stunden'), minuten: zaehl('minuten') },
    waehlbar: { tage: zaehl('tage', true), stunden: zaehl('stunden', true),
                minuten: zaehl('minuten', true) },
    hinweis: document.querySelector('#lz-hinweis').hidden
      ? null : document.querySelector('#lz-hinweis').textContent,
  };
});

/** Einen Wert stellen – wie ein Mensch: Klappe auf, Eintrag anklicken. */
const stelle = async (welche, wert) => {
  await seite.click(`#lz-${welche}`);
  await seite.click(`#lz-liste-${welche} [data-wert="${wert}"]`);
  return stand();
};

const anfang = await stand();
pruefe('Es beginnt bei einem Tag', anfang.gesamt === 1440,
  `${anfang.tage}d ${anfang.stunden}h ${anfang.minuten}m`);

// Die Laenge der Listen ist die eigentliche Zusage: 0 bis 7, 0 bis 23, 0 bis 59.
// Eine Liste, die bei 24 Stunden aufhoert, waere still um eine Stunde zu kurz.
pruefe('Tage gehen von 0 bis 7', anfang.auswahl.tage === 8, String(anfang.auswahl.tage));
pruefe('Stunden von 0 bis 23', anfang.auswahl.stunden === 24, String(anfang.auswahl.stunden));
pruefe('Minuten von 0 bis 59', anfang.auswahl.minuten === 60, String(anfang.auswahl.minuten));

// ---------------------------------------------------------------------------
console.log('\nAlle drei Klappen sind gleich gross\n');
//
// Das war der zweite Grund, das <select> aufzugeben: Dessen Klappe zeichnet
// das Betriebssystem, und ihre Hoehe folgt der Anzahl der Eintraege – acht bei
// Days, sechzig bei Minutes. Drei verschieden hohe Klappen unter drei gleich
// aussehenden Kaesten, und von der Seite aus kein Griff daran.
const klappen = [];
for (const id of ['tage', 'stunden', 'minuten']) {
  await seite.click(`#lz-${id}`);
  klappen.push(await seite.evaluate((i) => {
    const r = document.querySelector(`#lz-liste-${i}`).getBoundingClientRect();
    return { id: i, b: Math.round(r.width), h: Math.round(r.height) };
  }, id));
  await seite.keyboard.press('Escape');
}
for (const k of klappen) console.log(`     ${k.id.padEnd(9)}${k.b} x ${k.h} px`);
pruefe('Alle drei sind gleich hoch',
  new Set(klappen.map((k) => k.h)).size === 1,
  klappen.map((k) => k.h).join(' / ') + ' px');
pruefe('Und gleich breit',
  new Set(klappen.map((k) => k.b)).size === 1,
  klappen.map((k) => k.b).join(' / ') + ' px');
// Und sie muessen ueberlaufen, sonst waere die Gleichheit ein Zufall: Waere die
// Klappe hoeher als acht Eintraege, waere Days kuerzer als die anderen beiden.
const laeuftUeber = await seite.evaluate(() => {
  const l = document.querySelector('#lz-liste-tage');
  document.querySelector('#lz-tage').click();
  const r = l.scrollHeight > l.clientHeight;
  document.querySelector('#lz-tage').click();
  return r;
});
pruefe('Auch die kürzeste Liste (Days) läuft über und rollt',
  laeuftUeber, laeuftUeber ? 'ja' : 'nein');

// ---------------------------------------------------------------------------
console.log('\nKein Ring beim Anklicken\n');
//
// Der Anlass der Umstellung. Gemessen wird die WIRKUNG (kein Umriss nach einem
// Mausklick) und nicht die Bauform – wer es anders loest, soll nicht an einer
// Formalie scheitern.
await seite.mouse.move(0, 0);
await seite.click('#lz-tage');
const nachKlick = await seite.evaluate(() => {
  const c = getComputedStyle(document.querySelector('#lz-tage'));
  return { umriss: `${c.outlineStyle} ${c.outlineWidth}`,
           schatten: c.boxShadow,
           tastatur: document.documentElement.hasAttribute('data-tastatur') };
});
await seite.keyboard.press('Escape');
pruefe('Nach einem Mausklick liegt kein Umriss um das Feld',
  /none/.test(nachKlick.umriss) || /^0px/.test(nachKlick.umriss.split(' ')[1] ?? ''),
  nachKlick.umriss);
pruefe('Und auch kein Schein', nachKlick.schatten === 'none', nachKlick.schatten);
// Gegenprobe: Mit der Tastatur MUSS er da sein, sonst waere die Seite
// unbedienbar – "outline: none" ohne Ersatz ist der eigentliche Fehler.
await seite.keyboard.press('Tab');
const nachTab = await seite.evaluate(() => {
  document.documentElement.setAttribute('data-tastatur', '');
  document.querySelector('#lz-tage').focus();
  const c = getComputedStyle(document.querySelector('#lz-tage'));
  return `${c.outlineStyle} ${c.outlineWidth}`;
});
pruefe('Mit der Tastatur ist er da – sonst wäre die Seite blind bedienbar',
  !/none/.test(nachTab), nachTab);
await seite.evaluate(() => document.documentElement.removeAttribute('data-tastatur'));

// Gerechnet wird in Minuten, und die drei Felder muessen sich addieren – nicht
// eines das andere ueberschreiben.
const proben = [
  [{ tage: 0, stunden: 0, minuten: 5 }, 5],
  [{ tage: 0, stunden: 1, minuten: 0 }, 60],
  [{ tage: 0, stunden: 2, minuten: 30 }, 150],
  [{ tage: 1, stunden: 0, minuten: 0 }, 1440],
  [{ tage: 3, stunden: 12, minuten: 0 }, 3 * 1440 + 720],
  [{ tage: 6, stunden: 23, minuten: 59 }, 6 * 1440 + 23 * 60 + 59],
];
for (const [w, erwartet] of proben) {
  const r = await seite.evaluate((w) => {
    window.setzeLaufzeit(w);
    return window.gewaehlteFristMinuten();
  }, w);
  pruefe(`${w.tage}d ${w.stunden}h ${w.minuten}m sind ${erwartet} Minuten`,
    r === erwartet, String(r));
}

// ---------------------------------------------------------------------------
console.log('\nAlles auf null heisst kein Ende\n');

// Der Zustand hing vorher als Sonderfall unter der kuerzesten Laufzeit, weil er
// in einer Reihe irgendwo hin musste. Mit drei Feldern IST keine Dauer keine
// Frist – und genau das wird hier geprueft, nicht die Stelle in einer Liste.
await seite.evaluate(() => window.setzeLaufzeit({ tage: 0, stunden: 0, minuten: 0 }));
const null3 = await stand();
pruefe('0d 0h 0m sind 0 Minuten', null3.gesamt === 0, String(null3.gesamt));
// Und niemand soll das nur erraten muessen.
pruefe('Und es steht ein Satz dabei', /no end/i.test(null3.hinweis ?? ''),
  null3.hinweis ?? '(nichts)');

await seite.evaluate(() => window.setzeLaufzeit({ tage: 0, stunden: 0, minuten: 1 }));
const eineMinute = await stand();
pruefe('Eine Minute ist schon eine Frist', eineMinute.gesamt === 1);
pruefe('Und der Satz ist dann weg', eineMinute.hinweis === null,
  eineMinute.hinweis ?? '(nichts)');

// ---------------------------------------------------------------------------
console.log('\nDie Woche als Obergrenze\n');

// Sieben Tage waren schon vorher das Maximum. Neu ist, dass die Grenze aus
// DREI Feldern zusammen entsteht – 7 Tage plus 6 Stunden waeren zu viel.
//
// Eine Regel, dreimal angewendet: Ein Eintrag ist abgeschaltet, wenn er
// zusammen mit den anderen beiden ueber eine Woche kaeme. Die Liste bleibt
// dabei VOLLSTAENDIG – so ist zu sehen, dass die Grenze eine Grenze ist und
// nicht ein Loch in der Liste.
await seite.evaluate(() => window.setzeLaufzeit({ tage: 0, stunden: 0, minuten: 0 }));
const beiSieben = await stelle('tage', 7);
pruefe('Sieben Tage lassen sich einstellen',
  beiSieben.gesamt === 7 * 1440, `${beiSieben.gesamt} Minuten`);
pruefe('Die Stundenliste bleibt trotzdem vollständig',
  beiSieben.auswahl.stunden === 24, String(beiSieben.auswahl.stunden));
pruefe('Aber nur die Null ist dort noch wählbar',
  beiSieben.waehlbar.stunden === 1, String(beiSieben.waehlbar.stunden));
pruefe('Bei den Minuten genauso',
  beiSieben.auswahl.minuten === 60 && beiSieben.waehlbar.minuten === 1,
  `${beiSieben.auswahl.minuten} Einträge, ${beiSieben.waehlbar.minuten} wählbar`);

// Ein abgeschalteter Eintrag muss auch wirklich nichts tun. Ohne diese
// Pruefung koennte er grau dastehen und trotzdem greifen.
//
// dispatchEvent statt click(): Playwright weigert sich, auf etwas mit
// aria-disabled zu klicken – und das ist selbst schon eine Auskunft. Ein
// Mensch KANN aber daraufdruecken, also wird das Ereignis hier von Hand
// geschickt, damit auch der Code danebensteht und nicht nur die Bibliothek.
await seite.click('#lz-stunden');
await seite.locator('#lz-liste-stunden [data-wert="6"]').dispatchEvent('click');
const nachKlickAufGrau = await stand();
pruefe('Ein Klick auf einen grauen Eintrag ändert nichts',
  nachKlickAufGrau.gesamt === 7 * 1440, `${nachKlickAufGrau.gesamt} Minuten`);
await seite.keyboard.press('Escape');

// Der Rueckweg. Ohne ihn waeren sieben Tage eine Sackgasse.
const zurueck = await stelle('tage', 3);
pruefe('Zurück unter sieben Tagen ist wieder alles wählbar',
  zurueck.waehlbar.stunden === 24 && zurueck.waehlbar.minuten === 60,
  `${zurueck.waehlbar.stunden} / ${zurueck.waehlbar.minuten}`);

// Und die Regel wirkt in JEDE Richtung – das ist der eigentliche Gewinn.
// Steht schon eine Stunde drin, ist die 7 bei den Tagen grau, und niemand muss
// hinterher eine Zahl korrigieren, die sich von selbst geaendert hat.
await seite.evaluate(() => window.setzeLaufzeit({ tage: 0, stunden: 6, minuten: 0 }));
const mitStunden = await stand();
pruefe('Mit sechs Stunden im Feld ist die 7 bei den Tagen nicht mehr wählbar',
  mitStunden.waehlbar.tage === 7, `${mitStunden.waehlbar.tage} von ${mitStunden.auswahl.tage}`);
// Und die Grenze gilt auch unter der Oberflaeche. Das ist keine Doppelung aus
// Vorsicht, sondern eine Frage der Zustaendigkeit: "Eine Abstimmung laeuft
// hoechstens eine Woche" ist eine Aussage ueber die Laufzeit, nicht ueber die
// Bedienung. Stuende sie nur in den Klappen, waere sie beim naechsten zweiten
// Aufrufer von setzeLaufzeit() still weg.
const ueberzogen = await seite.evaluate(() => {
  const aus = [];
  for (const w of [{ tage: 7, stunden: 23, minuten: 59 },
                   { tage: 9, stunden: 0, minuten: 0 },
                   { tage: 6, stunden: 30, minuten: 0 }]) {
    window.setzeLaufzeit(w);
    aus.push([`${w.tage}d ${w.stunden}h ${w.minuten}m`, window.gewaehlteFristMinuten()]);
  }
  return aus;
});
for (const [wunsch, ist] of ueberzogen) {
  pruefe(`${wunsch} wird auf höchstens eine Woche gekürzt`, ist <= 7 * 1440,
    `${ist} von höchstens ${7 * 1440} Minuten`);
}
// Gekuerzt wird von unten: Wer sieben Tage angibt, meint die sieben Tage.
pruefe('Und die grösste Einheit bleibt dabei stehen',
  ueberzogen[0][1] === 7 * 1440, `${ueberzogen[0][1]} Minuten`);

// ---------------------------------------------------------------------------
console.log('\nDie Tastatur\n');
//
// Ein <select> bringt Pfeile, Pos1/Ende, Enter und Escape geschenkt mit. Diese
// Klappe ist selbst gebaut, also steht das alles in app.js – und halb gebaut
// waere schlimmer als gar nicht: Wer eine Klappe aufmacht und dann mit den
// Pfeilen ins Leere greift, sitzt fest.
await seite.evaluate(() => window.setzeLaufzeit({ tage: 2, stunden: 0, minuten: 0 }));
const taste = async (...tasten) => {
  for (const t of tasten) { await seite.keyboard.press(t); await seite.waitForTimeout(40); }
  return seite.evaluate(() => ({
    offen: document.querySelector('#lz-tage').getAttribute('aria-expanded') === 'true',
    marke: document.querySelector('#lz-liste-tage .ist-marke')?.dataset.wert ?? null,
    wert: document.querySelector('#lz-tage').dataset.wert,
  }));
};
await seite.evaluate(() => document.querySelector('#lz-tage').focus());
const abwaerts = await taste('ArrowDown');
pruefe('Pfeil ab öffnet die Klappe', abwaerts.offen);
pruefe('Und die Marke steht auf dem gewählten Wert', abwaerts.marke === '2', abwaerts.marke);
const zweiWeiter = await taste('ArrowDown', 'ArrowDown');
pruefe('Zwei weitere Pfeile bewegen die Marke um zwei', zweiWeiter.marke === '4',
  zweiWeiter.marke);
pruefe('Der Wert selbst ändert sich dabei noch nicht', zweiWeiter.wert === '2',
  zweiWeiter.wert);
const gewaehlt = await taste('Enter');
pruefe('Enter übernimmt die Marke', gewaehlt.wert === '4', gewaehlt.wert);
pruefe('Und schliesst die Klappe', !gewaehlt.offen);
const anfangEnde = await taste('ArrowDown', 'Home');
pruefe('Pos1 springt auf den ersten Eintrag', anfangEnde.marke === '0', anfangEnde.marke);
const ende = await taste('End');
pruefe('Ende auf den letzten wählbaren', ende.marke === '7', ende.marke);
const weg = await taste('Escape');
pruefe('Escape schliesst, ohne zu übernehmen',
  !weg.offen && weg.wert === '4', `offen=${weg.offen}, Wert=${weg.wert}`);

// Abgeschaltete Eintraege werden UEBERSPRUNGEN, nicht angesteuert. Auf einem
// zu landen, den Enter dann nicht annimmt, waere eine Sackgasse mitten in der
// Liste – man drueckt und nichts passiert.
await seite.evaluate(() => window.setzeLaufzeit({ tage: 0, stunden: 6, minuten: 0 }));
await seite.evaluate(() => document.querySelector('#lz-tage').focus());
const bisAnsEnde = await taste('ArrowDown', 'End');
pruefe('Ende überspringt die abgeschaltete 7', bisAnsEnde.marke === '6', bisAnsEnde.marke);
await seite.keyboard.press('Escape');

// ---------------------------------------------------------------------------
console.log('\nDas Formular bleibt ruhig\n');

// Die drei Kaesten duerfen beim Stellen nicht atmen: "1" ist schmaler als "23",
// und ein Kasten, der bei jeder Wahl seine Breite aendert, schiebt die beiden
// daneben mit.
const breiten = await seite.evaluate(() => {
  const aus = [];
  for (const w of [{ tage: 0, stunden: 0, minuten: 0 }, { tage: 1, stunden: 0, minuten: 0 },
                   { tage: 7, stunden: 0, minuten: 0 }, { tage: 3, stunden: 23, minuten: 59 }]) {
    window.setzeLaufzeit(w);
    aus.push([...document.querySelectorAll('.lz-feld')]
      .map((e) => Math.round(e.getBoundingClientRect().width)).join('/'));
  }
  window.setzeLaufzeit();
  return aus;
});
pruefe('Die drei Kästen behalten ihre Breite über alle Werte',
  new Set(breiten).size === 1, [...new Set(breiten)].join('  |  '));

// Der Hinweis taucht auf und verschwindet – und darf dabei den Kasten nicht
// wachsen lassen, sonst sprängen "Start poll" und die Liste darunter bei jeder
// Wahl. Er ist die einzige Stelle im Formular, die kommt und geht.
const hoehen = await seite.evaluate(() => {
  const kasten = document.querySelector('#poll-admin');
  const aus = {};
  window.setzeLaufzeit({ tage: 1, stunden: 0, minuten: 0 });
  aus.mit = Math.round(kasten.getBoundingClientRect().height);
  window.setzeLaufzeit({ tage: 0, stunden: 0, minuten: 0 });
  aus.ohne = Math.round(kasten.getBoundingClientRect().height);
  window.setzeLaufzeit();
  return aus;
});
console.log(`     mit Frist ${hoehen.mit} px, ohne Frist ${hoehen.ohne} px`);
// Der Kasten WAECHST hier bewusst um die Zeile des Hinweises. Das ist der
// Tausch: Lieber eine Zeile mehr als ein Formular, das stumm eine Abstimmung
// ohne Ende anlegt. Was nicht passieren darf, ist ein Sprung in der
// Groessenordnung eines ganzen Feldes.
pruefe('Der Hinweis kostet höchstens eine Zeile',
  hoehen.ohne - hoehen.mit > 0 && hoehen.ohne - hoehen.mit <= 30,
  `${hoehen.ohne - hoehen.mit} px`);

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
