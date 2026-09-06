// ============================================================================
// Prüft das Aussehen des Polls-Tabs: wenige Flächen, und ein Anlegekasten,
// der nur dasteht, wenn er gebraucht wird.
//
// ----------------------------------------------------------------------------
// Warum hier FLÄCHEN GEZÄHLT werden und nicht Farben verglichen
//
// Der Tab hatte vier Flächen übereinander – Seitengrund, Karte, Antwortzeile,
// Rand – mit Schritten von 1,05 / 1,09 / 1,14:1. Das Problem waren nie die
// Töne selbst, sondern ihre Zahl bei zu kleinen Abständen: Man sieht, dass
// sich etwas ändert, aber nicht, dass es etwas bedeutet.
//
// Ein Test, der die Hexwerte festnagelt, würde davon nichts merken – man kann
// vier neue Grautöne einsetzen und dasselbe Problem behalten. Deshalb misst
// dieser Test das, worum es geht: wie viele UNTERSCHEIDBARE graue Flächen im
// gerenderten Tab tatsächlich vorkommen, und wie weit jede von dem Grund
// absteht, auf dem sie liegt. Gemessen an den echten Elementen im Browser,
// nicht am Blatt – eine Regel, die von einer späteren überschrieben wird,
// zählt sonst weiter mit.
//
// Das Blau der führenden Antwort zählt dabei NICHT als weitere Fläche. Es ist
// keine Ebene im Aufbau, sondern ein Signal mit genau einer Aussage; die Regel
// oben richtet sich gegen fast gleiche Grautöne, und eine Farbe ist das
// Gegenteil davon.
//
// ----------------------------------------------------------------------------
// Und warum die Lesbarkeit hier noch einmal geprüft wird
//
// Die Balkenfüllung ist von X abgemessen, deckend, und es sind zwei: Grau für
// die normalen Antworten, Blau für die führende. Das ist die Sorte Änderung,
// die nebenan etwas verschiebt, ohne dass jemand daran gedacht hätte: Auf der
// Füllung stehen der Antworttext und die Stimmenzahl. Die Stimmenzahl stand
// hier schon einmal bei 1,3:1 und war unsichtbar – und beim Wechsel auf Xs
// Farben wäre sie auf dem Blau bei 3,99:1 gelandet, wenn hier nicht gemessen
// worden wäre.
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
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
// Achtung: Dieser Ausschnitt endet erst vor FRIST_VORGABE und enthaelt damit
// die Anmeldung des Klicks am Knopf gleich mit. Er wird hier bewusst so weit
// geschnitten – der Test soll den ECHTEN Weg vom Klick bis zum Zustand pruefen
// und nicht einen nachgebauten. Wer hier zusaetzlich selbst einen Zuhoerer
// anmeldet, schaltet bei jedem Klick zweimal um und misst am Ende gar nichts.
const schalter = schneide('function pollFormularLeeren()', '\n/**\n * Wie hoch der Anlegekasten');
// Die Felder samt Zaehlern und dem Knopf "+ Option" – und die Laufzeit.
//
// Beide hingen frueher nicht mit drin, weil pollFormular() sie nicht brauchte.
// Seit das Zuklappen ein Abbruch ist, ruft es setzeLaufzeit() und raeumt die
// Antwortfelder ab; ohne diese beiden Ausschnitte liefe der Test in einen
// Fehler statt in eine Pruefung.
const felder = schneide('const MIN_OPTIONEN =', '\n/**\n * Setzt den Anlegekasten');
const laufzeit = schneide('const LZ_MAX_MINUTEN =', "\n$('#btn-create-poll')");
// Der Beobachter, der die Kopfhoehe pflegt – woertlich, weil die Lage des
// leeren Hinweises daran haengt.
const beobachter = schneide('function beobachteKopfHoehe()', '\n/**\n * Die Laufzeit im Anlegeformular');
// Der Satz selbst aus app.js, nicht abgetippt.
const leerText = /list\.innerHTML = '(<div class="empty">[^']*<\/div>)'/.exec(appJs)?.[1];
if (!leerText) throw new Error('Der Hinweis auf die leere Liste sieht anders aus als erwartet');

// Der Kasten aus dem echten Blatt, nicht nachgebaut.
const kasten = /<div id="poll-admin"[\s\S]*?\n    <\/div>/.exec(html);
if (!kasten) throw new Error('Das Anlegeformular fehlt in index.html');

// Und die Liste ebenso. Sie stand hier als abgetippte Zeile, und als sie im
// Blatt einen Rahmen bekam, hatte die Kopie im Test weiter keinen – der Test
// mass eine Liste, die es so nicht gibt.
const liste = /<div id="poll-list"[^>]*><\/div>/.exec(html);
if (!liste) throw new Error('Die Abstimmungsliste fehlt in index.html');


const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8">
       <!-- Die viewport-Zeile ist hier kein Beiwerk, sondern Voraussetzung.
            Ohne sie rechnet ein Browser im Handy-Modus intern mit rund 980 px
            und skaliert das Ergebnis herunter: @media (max-width: 760px)
            greift dann NICHT. Eine Pruefung bei 375 px maesse in dem Fall
            stillschweigend den Schreibtisch-Aufbau und waere immer gruen.
            Das echte Blatt hat die Zeile ebenfalls – hier fehlte sie nur,
            weil bis dahin nichts am Handy gemessen wurde. -->
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <style>${css}</style>
       <body style="margin:0">
       <!-- Die Hoehe muss von aussen kommen wie in der echten Seite: .pane ist
            flex:1 und hat ohne eine Spalte mit fester Hoehe darum keinen Platz,
            in dem sich etwas zentrieren koennte. Ohne das misst man weiter
            unten die Mitte einer Flaeche, die es gar nicht gibt. -->
       <div style="display:flex;flex-direction:column;height:100vh;background:var(--bg)">
       <main class="pane" id="pane-polls" style="background:var(--bg);padding:14px">
       ${kasten[0].replace('class="poll-admin" hidden', 'class="poll-admin"')}
       ${liste[0]}</main></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 820, height: 900 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: true }, polls: [] };
    const toast = () => {};
    ${escFn}
    ${formate}
    ${symbole}
    ${zeit}
    ${zeile}
    ${fuehrend}
    ${markup}
    ${felder}
    ${schalter}
    ${laufzeit}
    window.pollFormular = pollFormular;
    window.gewaehlteFristMinuten = gewaehlteFristMinuten;
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
    // Aufgehoben, damit die Liste weiter unten noch einmal als Nutzer statt als
    // Ansem gebaut werden kann – dort haengt die Zeigerregel dran.
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
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const leucht = (rgb) => { const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b); };
const kon = (a, b) => { const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05); };
const zahlen = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

// ---------------------------------------------------------------------------
console.log('\nDie Flächen im Tab\n');

// Gemessen wird an den echten Elementen. Durchsichtige Flaechen zaehlen als
// das, was durch sie hindurch zu sehen ist – genau so sieht es das Auge auch.
const gemessen = await seite.evaluate(() => {
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
  // Die Fuellung. Sie war einmal durchscheinend und musste mit dem, was
  // darunter liegt, verrechnet werden; seit sie Xs Werte hat, ist sie deckend
  // – und es sind zwei: die fuehrende Antwort ist blau.
  const fuellungVon = (sel) => {
    const f = getComputedStyle(document.querySelector(sel)).backgroundColor;
    const [fr, fg, fb, fa] = (f.match(/[\d.]+/g) || []).map(Number);
    if (fa === undefined || fa > 0.99) return `rgb(${fr}, ${fg}, ${fb})`;
    const unter = (aus.Antwortzeile.match(/\d+/g) || []).map(Number);
    return 'rgb(' + [fr, fg, fb].map((c, i) =>
      Math.round(fa * c + (1 - fa) * unter[i])).join(', ') + ')';
  };
  aus.Fuellung = fuellungVon('.opt:not(.leads) .opt-fill');
  aus.FuellungSpitze = fuellungVon('.opt.leads .opt-fill');
  return aus;
});

for (const [n, w] of Object.entries(gemessen)) console.log(`     ${n.padEnd(16)}${w}`);

const flaechen = ['Seite', 'Karte', 'Anlegekasten', 'Antwortzeile'].map((n) => gemessen[n]);
const eindeutig = [...new Set([...flaechen, gemessen.Rand, gemessen.Fuellung])]
  .map(zahlen).sort((a, b) => leucht(a) - leucht(b));

// Die Karte hat wieder eine Flaeche – dieselbe wie das Bild zum Herunterladen.
// Der Anlegekasten und die Antwortzeile haben weiter keine: Der Kasten liegt
// auf dem Seitengrund, die Zeile auf der Karte.
pruefe('Die Karte hat eine eigene Fläche, der Anlegekasten nicht',
  gemessen.Karte !== gemessen.Seite && gemessen.Anlegekasten === gemessen.Seite,
  `Karte ${gemessen.Karte}, Kasten ${gemessen.Anlegekasten}`);
pruefe('Und die Antwortzeile auch nicht – sie liegt auf der Karte',
  gemessen.Antwortzeile === gemessen.Karte,
  `${gemessen.Antwortzeile} auf ${gemessen.Karte}`);

// Vier statt vorher drei, und das ist der Punkt, an dem man aufpassen muss:
// Bei fuenf war der Tab schon einmal unlesbar. Die vierte ist ausdruecklich
// zurueckgeholt worden, weil Seite und Download-Bild sonst zwei verschiedene
// Dinge zeigen – nicht, weil eine Ebene gefehlt haette.
pruefe('Höchstens vier unterscheidbare graue Flächen im Tab', eindeutig.length <= 4,
  `${eindeutig.length}`);

// Der eigentliche Punkt dieses Abschnitts, und der Grund, warum die Schritte
// EINZELN geprueft werden und nicht als Kette:
//
// Die Kette hat frueher gereicht, weil alle Toene uebereinander lagen. Seit
// die Fuellung Xs Grau ist, stimmt das nicht mehr. --line und die Fuellung
// liegen 1,17:1 auseinander, also praktisch gleich hell – die Kette wuerde das
// als Fehler melden, und sie haette unrecht. Die beiden liegen naemlich nicht
// uebereinander, sondern NEBENEINANDER:
//
//   auf dem gefuellten Teil  verschwindet der Rand in der Fuellung
//                            → der Balken sieht randlos aus, so wie bei X
//   auf dem leeren Teil      steht er gegen den Seitengrund
//
// Beides ist gewollt. Geprueft wird deshalb, was ein Mensch wirklich sieht:
// jede Flaeche gegen den Grund, auf dem sie tatsaechlich liegt.
const gegen = (was, grund) => kon(zahlen(gemessen[was]), zahlen(gemessen[grund]));
pruefe('Der Rand hebt sich vom Seitengrund ab', gegen('Rand', 'Seite') >= 1.25,
  `${gegen('Rand', 'Seite').toFixed(2)}:1`);
// Und von der Karte, auf der er innen aufliegt – sonst traegt er die Form der
// Antwortzeile nur nach aussen und nicht nach innen.
pruefe('Und von der Karte', gegen('Rand', 'Karte') >= 1.25,
  `${gegen('Rand', 'Karte').toFixed(2)}:1`);

// Die Karte selbst hebt sich fast NICHT ab – 1,05:1 gegen den Seitengrund. Das
// ist kein Versehen und auch kein Verstoss gegen die Regel oben: Getragen wird
// die Grenze vom Rand, nicht von der Flaeche. Genau so macht es das Bild zum
// Herunterladen auch, und dort hat es nie jemand vermisst.
//
// Geprueft wird deshalb die ODER-Bedingung und nicht die Flaeche allein: Eine
// Flaeche muss sich entweder selbst absetzen oder von einem Rand eingefasst
// sein, der es tut. Wer der Karte eines Tages den Rand nimmt, faellt hier auf.
const karteAllein = gegen('Karte', 'Seite');
pruefe('Die Karte setzt sich ab – notfalls über ihren Rand',
  karteAllein >= 1.25 || gegen('Rand', 'Seite') >= 1.25,
  `Fläche ${karteAllein.toFixed(2)}:1, Rand ${gegen('Rand', 'Seite').toFixed(2)}:1`);

// Die Kante, an der der Anteil endet, muss sichtbar bleiben – sonst erzaehlt
// der Balken nichts mehr. Gemessen gegen die KARTE, denn dort liegt die
// Fuellung, seit die Karte wieder eine Flaeche hat.
//
// Die Schwelle ist zweimal gesenkt worden, beide Male mit Grund:
//   1,90  → alte, durchscheinende Fuellung, gemessene 1,95:1
//   1,55  → Xs Grau auf dem Seitengrund, 1,62:1
//   1,50  → dasselbe Grau auf der helleren Karte, 1,54:1
// Der letzte Schritt ist der Preis dafuer, dass Seite und Download-Bild jetzt
// dasselbe zeigen: Es ist exakt der Wert, den das Bild schon immer hatte.
pruefe('Die Kante der Füllung bleibt sichtbar', gegen('Fuellung', 'Karte') >= 1.5,
  `${gegen('Fuellung', 'Karte').toFixed(2)}:1`);
pruefe('Die der führenden erst recht', gegen('FuellungSpitze', 'Karte') >= 1.5,
  `${gegen('FuellungSpitze', 'Karte').toFixed(2)}:1`);

// Und das Blau muss ein Blau sein. Ueber die Helligkeit allein sagt es fast
// nichts (die beiden Fuellungen liegen 1,67:1 auseinander) – die Aussage
// "diese liegt vorn" traegt der Farbton. Ein Blau, das zu einem weiteren Grau
// entsaettigt wird, faellt hier auf, ein Helligkeitsvergleich wuerde es
// durchlassen.
const [gr, gg, gb] = zahlen(gemessen.Fuellung);
const [br, bg2, bb] = zahlen(gemessen.FuellungSpitze);
const spreizung = (rgb) => Math.max(...rgb) - Math.min(...rgb);
pruefe('Die führende Füllung ist eine Farbe und kein weiteres Grau',
  spreizung([br, bg2, bb]) - spreizung([gr, gg, gb]) >= 25,
  `Spreizung ${spreizung([br, bg2, bb])} gegen ${spreizung([gr, gg, gb])}`);

// ---------------------------------------------------------------------------
console.log('\nWas auf der Füllung steht\n');

const schrift = await seite.evaluate(() => ({
  label: getComputedStyle(document.querySelector('.opt-label')).color,
  // Der Betrag steht rechts und wird vom Balken der fuehrenden Antwort
  // erreicht – er ist damit die zweite Schrift, die auf der Fuellung liegt.
  betrag: getComputedStyle(document.querySelector('.opt-num .held')).color,
  // Was in dieser Spalte sonst noch steht – frueher eine Stimmenzahl, dann
  // ein Prozentsatz, beides klein und damit der strengere Fall. Zurzeit
  // nichts; die Pruefung darunter faellt dann weg statt lautlos zu bestehen.
  zweite: (() => {
    const el = document.querySelector('.opt-num > :not(.held)');
    return el ? getComputedStyle(el).color : null;
  })(),
}));
// Beide Fuellungen, und der schlechtere Fall zaehlt. Das Blau ist heller als
// das Grau, die Schrift steht darauf also enger – und ausgerechnet dort laeuft
// der Balken am weitesten nach rechts, bis unter die Zahlen.
const aufFuellung = (farbe) => Math.min(
  kon(zahlen(farbe), zahlen(gemessen.Fuellung)),
  kon(zahlen(farbe), zahlen(gemessen.FuellungSpitze)));
const beide = (farbe) => `Grau ${kon(zahlen(farbe), zahlen(gemessen.Fuellung)).toFixed(1)}:1, `
  + `Blau ${kon(zahlen(farbe), zahlen(gemessen.FuellungSpitze)).toFixed(1)}:1`;
pruefe('Der Antworttext bleibt auf beiden Füllungen lesbar (mindestens 4,5:1)',
  aufFuellung(schrift.label) >= 4.5, beide(schrift.label));
// Hier stand die Stimmenzahl, mit einer eigenen, niedrigeren Grenze – sie war
// die Nebenauskunft und durfte blasser sein. Sie ist ersatzlos weg: Wer 100k
// auf zehn Wallets verteilt, aendert am Betrag nichts, macht aus einer Stimme
// aber zehn. Uebrig bleibt der Betrag, und der ist keine Nebenauskunft mehr,
// sondern das Ergebnis – also gilt fuer ihn dieselbe Grenze wie fuer den Text.
pruefe('Der Betrag auch', aufFuellung(schrift.betrag) >= 4.5, beide(schrift.betrag));
// Steht dort wieder etwas – ein Prozentsatz zum Beispiel –, gilt fuer es
// dieselbe Grenze, und zwar strenger, weil es kleiner gesetzt ist. Steht dort
// nichts, wird das gesagt und nicht stillschweigend uebergangen: Eine
// Pruefung, die auf ein fehlendes Element trifft und "ok" meldet, ist genau
// die Sorte, die spaeter nichts mehr merkt.
if (schrift.zweite) {
  pruefe('Was daneben steht auch', aufFuellung(schrift.zweite) >= 4.5,
    beide(schrift.zweite));
} else {
  console.log('  –  Neben dem Betrag steht nichts, nichts zu prüfen');
}
// Was hier NICHT wieder auftauchen darf, ist die Stimmenzahl. Nicht wegen der
// Farbe: Wer 100k auf zehn Wallets verteilt, aendert am Betrag nichts, macht
// aus einer Stimme aber zehn.
pruefe('Und es ist jedenfalls keine Stimmenzahl',
  !/class="votes"|>\s*\$\{[^}]*votes/.test(appJs));

// ---------------------------------------------------------------------------
console.log('\nBlau erst nach dem Schliessen\n');
//
// Die Liste enthaelt beides: Abstimmung 1 laeuft, Abstimmung 2 ist zu. Beide
// haben eine deutlich fuehrende Antwort. Solange eine laeuft, darf sie keine
// markierte Antwort haben – die Balkenlaengen sagen schon, wo es steht, und
// eine Farbe darueber macht daraus eine Aufforderung an den naechsten Waehler.
const markierung = await seite.evaluate(() => {
  const karten = [...document.querySelectorAll('.poll')];
  return karten.map((k) => ({
    id: k.id,
    zu: Boolean(k.querySelector('.closed-tag')),
    markiert: k.querySelectorAll('.opt.leads').length,
    // Auch die zweite Auszeichnung haengt an derselben Klasse: die fettere
    // Antwort. Gemessen statt aus dem Markup geschlossen.
    fett: [...k.querySelectorAll('.opt-label')]
      .map((e) => Number(getComputedStyle(e).fontWeight)),
  }));
});
for (const k of markierung) {
  console.log(`     ${k.id.padEnd(8)} ${k.zu ? 'zu    ' : 'laeuft'} `
    + `markiert: ${k.markiert}, Schriftschnitte: ${k.fett.join('/')}`);
}
const laufend = markierung.find((k) => !k.zu);
const beendet = markierung.find((k) => k.zu);
pruefe('Vorprobe: die Liste enthält eine laufende und eine geschlossene',
  Boolean(laufend && beendet));
pruefe('Die laufende hat keine markierte Antwort',
  laufend.markiert === 0, `${laufend.markiert} markiert`);
pruefe('Und auch keine fettere – die hängt an derselben Klasse',
  new Set(laufend.fett).size === 1, laufend.fett.join('/'));
// Ohne diese Gegenprobe waere alles darueber auch dann gruen, wenn die
// Markierung ueberhaupt nicht mehr vergeben wuerde.
pruefe('Die geschlossene hat genau eine',
  beendet.markiert === 1, `${beendet.markiert} markiert`);
pruefe('Und die steht dort fetter als ihre Nachbarin',
  Math.max(...beendet.fett) > Math.min(...beendet.fett), beendet.fett.join('/'));

// ---------------------------------------------------------------------------
console.log('\nZeiger und eigene Stimme\n');
//
// Zwei Zeichen, die frueher beide der RAND waren: aufleuchtend unter dem
// Zeiger, weiss an der Antwort, fuer die man gestimmt hat. Der Rand zeichnet
// aber schon die Form der Zeile – ein Zeichen fuer drei Aussagen sagt keine
// davon. Jetzt traegt der Zeiger die Flaeche und die eigene Stimme ein Haken
// im Text.
//
// Die Liste wird dafuer noch einmal als NUTZER gebaut. Als Ansem bekommt jede
// Antwort .locked, und die Zeigerregel greift gar nicht – man wuerde messen,
// dass sich nichts aendert, und es fuer bestanden halten.
await seite.evaluate(() => {
  state.me.isAdmin = false;
  document.querySelector('#poll-list').innerHTML =
    window.__pollDaten.map(window.__pollHtml).join('');
});

const optZeile = async (sel) => seite.evaluate((s) => {
  const bar = document.querySelector(`${s} .opt-bar`);
  const st = getComputedStyle(bar);
  // Im Ruhezustand hat die Zeile gar keine eigene Flaeche – gemeldet wird dann
  // rgba(0, 0, 0, 0). Wer das als Farbe nimmt, vergleicht gegen SCHWARZ und
  // bekommt einen Sprung von 1,31:1 gemeldet, wo in Wahrheit 1,17:1 stehen.
  // Durchsichtig zaehlt hier als das, was durch die Zeile hindurch zu sehen
  // ist – so sieht es das Auge auch.
  const sichtbar = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const f = getComputedStyle(e).backgroundColor;
      const [r, g, b, a] = (f.match(/[\d.]+/g) || []).map(Number);
      if (a === undefined || a > .9) return `rgb(${r}, ${g}, ${b})`;
    }
    return 'rgb(0, 0, 0)';
  };
  return { grund: sichtbar(bar), rand: st.borderTopColor,
    fuellung: getComputedStyle(document.querySelector(`${s} .opt-fill`)).backgroundColor };
}, sel);

const ruhe = await optZeile('.opt:not(.mine)');
await seite.hover('.opt:not(.mine) .opt-bar');
await seite.waitForTimeout(300);
const unterZeiger2 = await optZeile('.opt:not(.mine)');
await seite.mouse.move(0, 0);
await seite.waitForTimeout(300);

// Nicht nur "heller", sondern messbar heller. Die Zahl ist gefallen, als die
// Karte ihre Flaeche zurueckbekam: Der Zeigergrund (--bg-3) steht jetzt gegen
// die Karte statt gegen den Seitengrund, also 1,17:1 statt 1,22:1. Wenn das
// eines Tages zu leise wird, ist die naechste Stufe --line (1,33:1) – dann
// verschwindet allerdings der Rand der Zeile im Zeigergrund.
const zeigerSprung = kon(zahlen(unterZeiger2.grund), zahlen(ruhe.grund));
pruefe('Unter dem Zeiger wird der Grund der Zeile messbar heller',
  leucht(zahlen(unterZeiger2.grund)) > leucht(zahlen(ruhe.grund)) && zeigerSprung >= 1.15,
  `${ruhe.grund} → ${unterZeiger2.grund}, ${zeigerSprung.toFixed(2)}:1`);
// Der eigentliche Punkt: Der Rand bleibt, wie er ist.
pruefe('Und der Rand leuchtet dabei nicht auf',
  unterZeiger2.rand === ruhe.rand, `${ruhe.rand} → ${unterZeiger2.rand}`);
// Und die Fuellung auch nicht – das ist die gemessene Entscheidung aus dem
// Blatt: Sie aufzuhellen druecken die Stimmenzahl auf dem Blau unter 4,5:1.
pruefe('Die Füllung bleibt unangetastet',
  unterZeiger2.fuellung === ruhe.fuellung, `${ruhe.fuellung} → ${unterZeiger2.fuellung}`);

const eigene = await optZeile('.opt.mine');
pruefe('Die eigene Stimme bekommt keinen eigenen Rahmen mehr',
  eigene.rand === ruhe.rand, `${eigene.rand} gegen ${ruhe.rand}`);

const haken = await seite.evaluate(() => {
  const m = document.querySelector('.opt.mine .opt-haken');
  const andere = document.querySelector('.opt:not(.mine) .opt-haken');
  if (!m) return { da: false };
  return {
    da: true, beiAnderen: !!andere,
    versteckt: m.getAttribute('aria-hidden') === 'true',
    farbe: getComputedStyle(m).color,
    textfarbe: getComputedStyle(m.closest('.opt-label')).color,
    gesprochen: (document.querySelector('.opt.mine .nur-vorlesen')?.textContent ?? '').trim(),
    // Sichtbar heisst: hat wirklich eine Flaeche. Ein SVG ohne Groesse ist da
    // und trotzdem nicht zu sehen.
    breit: Math.round(m.getBoundingClientRect().width),
  };
});
pruefe('Die eigene Stimme trägt einen Haken', haken.da && haken.breit >= 10,
  `${haken.breit} px breit`);
pruefe('Und nur sie', haken.da && !haken.beiAnderen);
// currentColor statt eines eigenen Werts: So steht der Haken auf jeder
// Fuellung genauso gut da wie die Antwort daneben.
pruefe('Er nimmt seine Farbe vom Text daneben',
  haken.farbe === haken.textfarbe, `${haken.farbe} gegen ${haken.textfarbe}`);
// Ein Bild sagt der Vorlesestimme nichts, und ein vorgelesenes "Haken" sagt
// ihr das Falsche.
pruefe('Für das Auge ein Bild, für die Vorlesestimme ein Satz',
  haken.versteckt && /your vote/i.test(haken.gesprochen), haken.gesprochen);

// ---------------------------------------------------------------------------
console.log('\nDer Anlegekasten\n');

const stand = () => seite.evaluate(() => {
  const k = document.querySelector('#poll-admin');
  return {
    offen: k.classList.contains('offen'),
    felder: !document.querySelector('#poll-admin-felder').hidden,
    // Die Laufzeit stand einmal in der Kopfzeile und musste dort zugeklappt
    // eigens versteckt werden, ohne ihren Platz zu verlieren. Seit sie unten im
    // Kasten steht, faellt sie mit dem Rest weg – und genau das wird geprueft:
    // Sie haengt AM aufklappbaren Teil und nicht daneben.
    frist: (() => {
      const b = document.querySelector('.lz-block');
      return !!b && b.closest('#poll-admin-felder') !== null
        && b.getBoundingClientRect().height > 0;
    })(),
    sagt: document.querySelector('#btn-poll-neu').getAttribute('aria-expanded'),
    hoehe: Math.round(k.getBoundingClientRect().height),
    rahmen: getComputedStyle(k).borderTopColor,
    // Die Lage des Schalters selbst, auf zwei Nachkommastellen.
    knopf: (({ x, y }) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }))
      (document.querySelector('#btn-poll-neu').getBoundingClientRect()),
  };
});
// Durchsichtig heisst Alpha 0 – "transparent" meldet der Browser als
// rgba(0, 0, 0, 0), nicht als das Wort.
const durchsichtig = (f) => /rgba\([^)]*,\s*0\s*\)/.test(f);

const zu = await stand();
pruefe('Er ist von Anfang an zugeklappt', !zu.offen && !zu.felder, JSON.stringify(zu.offen));
pruefe('Die Laufzeit ist dann auch weg', !zu.frist);
pruefe('Und sie steckt im aufklappbaren Teil, nicht in der Kopfzeile',
  /<div class="lz-block"[\s\S]*?<\/div>/.test(
    /<div id="poll-admin-felder"[\s\S]*?\n {6}<\/div>/.exec(html)?.[0] ?? ''));
pruefe('Und er sagt es auch so', zu.sagt === 'false', String(zu.sagt));
// Zugeklappt darf kein Kasten zu SEHEN sein: Ein Rahmen um eine einzelne
// Zeile herum behauptet einen Inhalt, den es nicht gibt.
pruefe('Zugeklappt ist kein Rahmen zu sehen', durchsichtig(zu.rahmen), zu.rahmen);

await seite.click('#btn-poll-neu');
await seite.waitForTimeout(250);
const auf = await stand();
pruefe('Ein Tipp klappt ihn auf', auf.offen && auf.felder);
pruefe('Dann ist auch die Laufzeit da', auf.frist);
pruefe('Und er sagt es', auf.sagt === 'true', String(auf.sagt));
pruefe('Der Rahmen kommt zurück', !durchsichtig(auf.rahmen), auf.rahmen);

// Der eigentliche Punkt dieser Fassung: Der Schalter bleibt liegen, wo er ist.
// Naehme man zugeklappt Rahmen und Innenabstand heraus, spraenge "NEW POLL"
// beim Oeffnen nach rechts und nach unten – das Ding, auf das man gerade
// getippt hat, liefe unter dem Finger weg. Ein Pixel Toleranz fuer das
// Aufrunden von Teilpixeln, mehr nicht.
pruefe('Der Schalter steht auf und zu an derselben Stelle',
  Math.abs(zu.knopf.x - auf.knopf.x) <= 1 && Math.abs(zu.knopf.y - auf.knopf.y) <= 1,
  `zu (${zu.knopf.x}, ${zu.knopf.y}) → auf (${auf.knopf.x}, ${auf.knopf.y})`);
// Und er sitzt auf derselben senkrechten Linie wie die Fragen darunter.
//
// Das war eine Runde lang kaputt: Der Rahmen sass an der Liste allein, sein
// Innenabstand schob die Karten nach rechts, und der Schalter blieb stehen.
// Seit der Rahmen den ganzen Reiter umschliesst, sitzen Anlegekasten und
// Karten im selben Innenabstand und tragen beide 1.1rem – die Linie stimmt
// wieder, und zwar aus einem Grund statt aus Zufall.
const buendig = await seite.evaluate(() => {
  const a = document.querySelector('#btn-poll-neu').getBoundingClientRect().x;
  const b = document.querySelector('.poll h4').getBoundingClientRect().x;
  return Math.abs(a - b);
});
pruefe('Und auf einer Linie mit den Fragen in der Liste', buendig <= 1,
  `${buendig.toFixed(2)} px`);

pruefe('Der Sprung geht ins erste Feld',
  await seite.evaluate(() => document.activeElement?.id === 'poll-question'),
  await seite.evaluate(() => document.activeElement?.id));

// Der Gewinn, um den es geht – gemessen, nicht behauptet.
pruefe('Zugeklappt braucht er deutlich weniger Platz',
  zu.hoehe * 3 < auf.hoehe, `${zu.hoehe} px statt ${auf.hoehe} px`);

await seite.click('#btn-poll-neu');
await seite.waitForTimeout(250);
pruefe('Und ein zweiter Tipp klappt ihn wieder zu', !(await stand()).offen);

// ---------------------------------------------------------------------------
console.log('\nZuklappen ist ein Abbruch\n');
//
// Der Kasten hat keinen "Abbrechen"-Knopf – zuklappen IST das Abbrechen. Er
// muss deshalb beim naechsten Oeffnen so dastehen, wie er das allererste Mal
// dastand, und nicht wie ein halb ausgefuelltes Formular von vorgestern.
//
// Geprueft wird ueber den Knopf und nicht ueber pollFormular(false): Der Weg,
// den Ansem nimmt, ist der Klick. Ein direkter Aufruf wuerde denselben Zustand
// erzeugen und trotzdem nicht zeigen, dass der Knopf ihn ausloest.
const fuellen = async () => {
  // Aufmachen, wenn er zu ist – und nicht einfach umschalten: Der Knopf
  // schaltet um, und beim zweiten Aufruf wuerde er ihn zumachen.
  if (!(await stand()).offen) await seite.click('#btn-poll-neu');
  await seite.waitForTimeout(120);
  await seite.fill('#poll-question', 'Should the DM minimum go up again?');
  const felderJetzt = await seite.$$('.poll-option');
  await felderJetzt[0].fill('Yes');
  await felderJetzt[1].fill('No');
  // Bis zum Anschlag aufmachen: Die zusaetzlichen Felder sind der Teil, den
  // "die Texte loeschen" allein NICHT erwischt.
  await seite.click('#btn-add-option');
  await seite.click('#btn-add-option');
  await seite.waitForTimeout(60);
  await seite.evaluate(() => {
    const f = document.querySelectorAll('.poll-option');
    f[2].value = 'Maybe';
    f[2].dispatchEvent(new Event('input'));
    // Und eine Laufzeit, die nicht die Vorgabe ist.
    document.querySelector('#lz-stunden').dataset.wert = '6';
    document.querySelector('#lz-tage').dataset.wert = '3';
  });
};

await fuellen();
const voll = await seite.evaluate(() => ({
  frage: document.querySelector('#poll-question').value,
  felder: document.querySelectorAll('.poll-option').length,
  minuten: window.gewaehlteFristMinuten(),
}));
pruefe('Vorprobe: es steht wirklich etwas drin',
  voll.frage.length > 0 && voll.felder === 4 && voll.minuten === 3 * 1440 + 360,
  `${voll.felder} Felder, ${voll.minuten} Minuten`);

await seite.click('#btn-poll-neu');       // zu = Abbruch
await seite.waitForTimeout(150);
await seite.click('#btn-poll-neu');       // und wieder auf
await seite.waitForTimeout(250);

const neu = await seite.evaluate(() => ({
  frage: document.querySelector('#poll-question').value,
  antworten: Array.from(document.querySelectorAll('.poll-option')).map((f) => f.value),
  // Die Zaehler haengen an den Feldern und werden nur von einem input-Ereignis
  // nachgezogen. value zu setzen loest keins aus – bleibt es aus, steht neben
  // einem leeren Feld noch "37 / 60".
  zaehler: Array.from(document.querySelectorAll('#poll-options .zaehler'))
    .map((z) => z.textContent),
  frageZaehler: document.querySelector('.zaehl-feld:has(#poll-question) .zaehler')?.textContent,
  minuten: window.gewaehlteFristMinuten(),
  mehrDa: !document.querySelector('#btn-add-option').hidden,
  offen: document.querySelector('#poll-admin').classList.contains('offen'),
}));

pruefe('Es geht wieder auf', neu.offen);
pruefe('Die Frage ist weg', neu.frage === '', JSON.stringify(neu.frage));
pruefe('Es sind wieder genau zwei Antwortfelder',
  neu.antworten.length === 2, `${neu.antworten.length}`);
pruefe('Und beide sind leer', neu.antworten.every((v) => v === ''),
  JSON.stringify(neu.antworten));
pruefe('Die Zähler zählen auch wieder von vorn',
  neu.zaehler.every((t) => /^0 \//.test(t)) && /^0 \//.test(neu.frageZaehler ?? ''),
  `${neu.frageZaehler} | ${neu.zaehler.join(' | ')}`);
// Die Laufzeit ist die stillste der vier: Sie steht unten im Kasten, und eine
// vergessene Einstellung von vorgestern faellt beim Anlegen niemandem auf –
// bis die Abstimmung frueher zugeht als gedacht.
pruefe('Die Laufzeit steht wieder auf der Vorgabe',
  neu.minuten === 1440, `${neu.minuten} Minuten`);
pruefe('Und "+ Option" ist wieder da, weil wieder Platz ist', neu.mehrDa);

// Gegenprobe auf die Pruefung selbst: Waere das Leeren an den Knopf gehaengt
// statt an pollFormular(), ginge der zweite Weg zu – der nach dem Anlegen –
// leer aus. Deshalb hier derselbe Test ueber den direkten Aufruf.
await fuellen();
await seite.evaluate(() => { window.pollFormular(false); window.pollFormular(true); });
await seite.waitForTimeout(150);
const direkt = await seite.evaluate(() => ({
  frage: document.querySelector('#poll-question').value,
  felder: document.querySelectorAll('.poll-option').length,
  minuten: window.gewaehlteFristMinuten(),
}));
pruefe('Auch der Weg nach dem Anlegen räumt auf, nicht nur der Knopf',
  direkt.frage === '' && direkt.felder === 2 && direkt.minuten === 1440,
  `${direkt.felder} Felder, ${direkt.minuten} Minuten`);

await seite.evaluate(() => window.pollFormular(false));
await seite.waitForTimeout(150);

// Das Zeichen ist EIN Zeichen in zwei Lagen, nicht zwei Zeichen.
// Die Ueberblendung muss durch sein, sonst misst man den Startwert der
// Drehung und nicht ihr Ziel – der Vergleich ginge auf, ohne etwas zu zeigen.
const zeichenZu = await seite.evaluate(() =>
  getComputedStyle(document.querySelector('.poll-neu .zeichen')).transform);
await seite.evaluate(() => document.querySelector('#poll-admin').classList.add('offen'));
await seite.waitForTimeout(300);
const zeichen = await seite.evaluate(() => {
  const s = document.querySelector('.poll-neu .zeichen');
  const aufT = getComputedStyle(s).transform;
  document.querySelector('#poll-admin').classList.remove('offen');
  return { text: s.textContent.trim(), aufT };
}).then((r) => ({ ...r, zuT: zeichenZu }));
pruefe('Das Zeichen dreht sich, statt ausgetauscht zu werden',
  zeichen.text === '+' && zeichen.zuT !== zeichen.aufT, `${zeichen.zuT} → ${zeichen.aufT}`);
// Es ist Zierde – wer vorliest, soll nicht "Pluszeichen New poll" hoeren.
pruefe('Und es wird nicht mitgelesen', /class="zeichen" aria-hidden="true"/.test(html));

// ---------------------------------------------------------------------------
console.log('\nDie Knöpfe im Anlegeformular\n');
//
// "Start poll" war der einzige gefuellte Knopf im ganzen Tab – heller Grund,
// dunkle Schrift, fettes Gewicht. Neben einem Formular, das sonst nur aus
// Linien besteht, war das ein Fremdkoerper.
//
// Was hier geprueft wird, ist die REGEL und nicht der Wert: Alle drei
// Schalter im Kasten sind Text, kein Kasten. Kein eigener Grund, kein Rahmen,
// dieselbe gedaempfte Farbe – und der Grund erscheint erst unter dem Zeiger.
// Wer spaeter --dim aendert, aendert alle drei zusammen; wer einem von ihnen
// wieder eine Fuellung gibt, faellt hier auf.
//
// Eine Ungenauigkeit steht ausdruecklich so da: "+ Option" und "NEW POLL" sind
// UNTEREINANDER nicht gleich gross (15 px gegen 12,3 px, Gewicht 400 gegen
// 700, dazu Grossschreibung mit Sperrung). Gleich ist ihre FARBE. "Start poll"
// richtet sich deshalb in der Groesse nach seinem Nachbarn "+ Option" und in
// der Farbe nach beiden.
//
// Der Zeiger steht nach dem letzten Klick noch auf "NEW POLL" – ohne ihn
// wegzunehmen misst man dort die Farbe unter dem Zeiger und vergleicht sie mit
// den Ruhefarben der anderen drei.
await seite.mouse.move(0, 0);
await seite.waitForTimeout(300);
const knoepfe = await seite.evaluate(() => {
  document.querySelector('#poll-admin').classList.add('offen');
  document.querySelector('#poll-admin-felder').hidden = false;
  const lies = (sel) => {
    const el = document.querySelector(sel);
    const s = getComputedStyle(el);
    return {
      groesse: s.fontSize, gewicht: s.fontWeight, farbe: s.color,
      grund: s.backgroundColor, rand: s.borderTopColor, randBreit: s.borderTopWidth,
      polster: `${s.paddingTop} ${s.paddingLeft}`,
      hoehe: Math.round(el.getBoundingClientRect().height),
    };
  };
  return {
    neu: lies('#btn-poll-neu'),
    start: lies('#btn-create-poll'),
    mehr: lies('#btn-add-option'),
  };
});
for (const [n, w] of Object.entries(knoepfe)) {
  console.log(`     ${n.padEnd(9)}${w.groesse.padEnd(7)}w=${String(w.gewicht).padEnd(5)}`
    + `${w.farbe.padEnd(22)}Grund ${w.grund}`);
}

// Drei Schalter, eine Sorte: keine eigene Flaeche, kein Rahmen, dieselbe
// Farbe. Der Kasten soll nicht aussehen wie eine Knopfleiste.
//
// Es waren vier, solange es "− Option" gab. Der Knopf ist weg – ein leeres
// Feld war ohnehin nie eine Antwort, und statt seiner steht "(optional)" im
// Platzhalter ab dem dritten Feld.
const alleVier = Object.values(knoepfe);
pruefe('Keiner der drei hat einen eigenen Grund',
  alleVier.every((k) => durchsichtig(k.grund)),
  alleVier.map((k) => k.grund).join(' / '));
// Ueber die BREITE und nicht ueber die Farbe: Ein Element ohne Rahmen meldet
// als Farbe weiter currentColor, also die Schriftfarbe. Wer hier nur die Farbe
// prueft, meldet einen Rahmen, den es gar nicht gibt – genau das ist beim
// Umstellen passiert.
pruefe('Und keiner einen Rahmen',
  alleVier.every((k) => k.randBreit === '0px' || durchsichtig(k.rand)),
  alleVier.map((k) => `${k.randBreit} ${k.rand}`).join(' / '));
pruefe('Alle drei Schalter im Kasten haben dieselbe Farbe',
  new Set(alleVier.map((k) => k.farbe)).size === 1,
  alleVier.map((k) => k.farbe).join(' / '));
pruefe('"Start poll" ist so gross wie "+ Option"',
  knoepfe.start.groesse === knoepfe.mehr.groesse
  && knoepfe.start.gewicht === knoepfe.mehr.gewicht
  && knoepfe.start.polster === knoepfe.mehr.polster
  && Math.abs(knoepfe.start.hoehe - knoepfe.mehr.hoehe) <= 1,
  `${knoepfe.start.groesse}/${knoepfe.start.gewicht} gegen `
  + `${knoepfe.mehr.groesse}/${knoepfe.mehr.gewicht}`);

// Der Grund kommt erst unter dem Zeiger – und bei beiden derselbe, sonst
// sieht der eine Knopf nach etwas anderem aus als der andere.
const unterZeiger = async (sel) => {
  await seite.hover(sel);
  await seite.waitForTimeout(300);
  const w = await seite.evaluate((s) => {
    const st = getComputedStyle(document.querySelector(s));
    return { grund: st.backgroundColor, farbe: st.color };
  }, sel);
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(300);
  return w;
};
const zeigerMehr = await unterZeiger('#btn-add-option');
const zeigerStart = await unterZeiger('#btn-create-poll');
pruefe('Unter dem Zeiger erscheint bei "Start poll" ein Grund',
  !durchsichtig(zeigerStart.grund), zeigerStart.grund);
pruefe('Und zwar derselbe wie bei "+ Option"',
  zeigerStart.grund === zeigerMehr.grund && zeigerStart.farbe === zeigerMehr.farbe,
  `${zeigerStart.grund} gegen ${zeigerMehr.grund}`);
// Der Grund ist keine Zierde – auf ihm steht die Beschriftung.
const aufZeiger = kon(zahlen(zeigerStart.farbe), zahlen(zeigerStart.grund));
pruefe('Die Beschriftung bleibt auf diesem Grund lesbar (mindestens 4,5:1)',
  aufZeiger >= 4.5, `${aufZeiger.toFixed(1)}:1`);

await seite.evaluate(() => {
  document.querySelector('#poll-admin').classList.remove('offen');
  document.querySelector('#poll-admin-felder').hidden = true;
});

// ---------------------------------------------------------------------------
console.log('\nDer Hinweis auf die leere Liste\n');
//
// Er steht in der Mitte der SEITE und nicht in der Mitte der Liste. Der
// Unterschied faellt nur bei Ansem auf, dafuer dort staendig: Der Anlegekasten
// waechst beim Aufklappen um gut 200 px, die Liste wird entsprechend kuerzer,
// und ihre Mitte wandert um die Haelfte davon nach unten – gemessene 107 px,
// bevor das ausgeglichen wurde.
//
// Die Gegenprobe gehoert dazu: Auf einem kurzen Bildschirm laege die Mitte der
// Seite im Formular. Dort MUSS der Satz nachgeben, sonst stuende er im
// Eingabefeld. Lieber verschoben als ueberlappt.
const leerLage = async (breite, hoehe) => {
  const s = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  await s.goto(`http://127.0.0.1:${server.address().port}/`);
  await s.addScriptTag({ content: `const $ = (s, r = document) => r.querySelector(s);\n${beobachter}` });
  const r = await s.evaluate(async (inhalt) => {
    const warte = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const kasten = document.querySelector('#poll-admin');
    document.querySelector('#poll-list').innerHTML = inhalt;
    kasten.classList.remove('offen');
    document.querySelector('#poll-admin-felder').hidden = true;
    await warte();
    const mitte = () => {
      const e = document.querySelector('.empty').getBoundingClientRect();
      return { y: Math.round(e.top + e.height / 2), oben: Math.round(e.top) };
    };
    const zu = mitte();
    kasten.classList.add('offen');
    document.querySelector('#poll-admin-felder').hidden = false;
    await warte();
    const auf = mitte();
    return { zu, auf, formUnten: Math.round(kasten.getBoundingClientRect().bottom) };
  }, leerText);
  await s.close();
  return r;
};

// Der Ausgleich kann nur so weit gehen, wie unter dem Formular noch Platz
// ist. Reicht er nicht, faellt "safe center" auf den Anfang zurueck und der
// Satz rutscht – dafuer ist die Pruefung darunter da. 800 px reichen.
const weit = await leerLage(1000, 800);
pruefe('Auf einem normalen Bildschirm bleibt er beim Aufklappen liegen',
  Math.abs(weit.auf.y - weit.zu.y) <= 1, `${weit.zu.y} → ${weit.auf.y}`);

const knapp = await leerLage(390, 520);
pruefe('Auf einem kurzen Bildschirm weicht er dem Formular aus',
  knapp.auf.oben >= knapp.formUnten,
  `Text ab ${knapp.auf.oben}, Formular bis ${knapp.formUnten}`);

// Und ohne Anlegekasten – also fuer alle ausser Ansem – bleibt es schlicht die
// Mitte, ohne dass die Variable ueberhaupt gesetzt sein muss.
const ohneKasten = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await ohneKasten.goto(`http://127.0.0.1:${server.address().port}/`);
const nutzer = await ohneKasten.evaluate((inhalt) => {
  document.querySelector('#poll-admin').hidden = true;
  document.querySelector('#poll-list').innerHTML = inhalt;
  // Gemessen gegen das gesamte Rechteck der Liste und nicht gegen ihre
  // Inhaltsflaeche: Der Innenabstand von 1rem unten ist Platz, damit die
  // letzte Karte nicht am Rand klebt – bei LEERER Liste ist dort nichts, und
  // die Mitte, die ein Mensch sieht, ist die des sichtbaren Rechtecks.
  const l = document.querySelector('#poll-list').getBoundingClientRect();
  const e = document.querySelector('.empty').getBoundingClientRect();
  return Math.round(Math.abs((l.top + l.bottom) / 2 - (e.top + e.height / 2)));
}, leerText);
await ohneKasten.close();
pruefe('Ohne Anlegekasten steht er genau mittig', nutzer <= 1, `${nutzer} px daneben`);

console.log('\nDer Weg im Code\n');

// Ein Beobachter statt Aufrufe an fuenf Stellen: Aufklappen, Zuklappen, eine
// Antwort mehr, eine weniger, ein Umbruch beim Drehen – beim sechsten Weg
// vergisst man den Aufruf.
pruefe('Die Kopfhöhe wird beobachtet, nicht an jeder Stelle nachgetragen',
  /new ResizeObserver\(melde\)\.observe\(kasten\)/.test(appJs));
pruefe('Und der Rand nach unten zählt mit',
  /marginBottom/.test(appJs) && /--poll-kopf/.test(appJs));

pruefe('Nach dem Anlegen klappt er wieder zu',
  /toast\('Poll started'\)/.test(appJs) && /pollFormular\(false\);/.test(appJs));
// Das Leeren gehoert ins Zuklappen und nicht an den Knopf. Hier stand einmal
// beides nebeneinander: der Knopf klappte nur zu, und der Weg nach dem
// Anlegen raeumte selbst auf. Zwei Wege zu, einer davon raeumt – so entsteht
// ein Formular, das sich beim Abbrechen merkt, was man verwerfen wollte.
const zuklappen = schneide('function pollFormular(offen)', "\n$('#btn-poll-neu')");
pruefe('Und das Leeren hängt am Zuklappen, nicht am Knopf',
  /pollFormularLeeren\(\)/.test(zuklappen)
  && !/pollFormularLeeren\(\)/.test(schneide("$('#btn-poll-neu').addEventListener", '\n/**')));
// Die Laufzeitliste kann ueber dem Kasten stehen. Sie gehoert zum Formular.
pruefe('Die offene Laufzeitliste geht mit zu', /lzZu\(\);/.test(zuklappen));
// Ein zweiter Ort fuer "offen" waere ein zweiter Ort, der falsch sein kann.
pruefe('"Offen" steht nur an einer Stelle – als Klasse am Kasten',
  /kasten\.classList\.toggle\('offen', offen\)/.test(appJs)
  && !/let (pollOffen|formularOffen)/.test(appJs));
pruefe('Der Schalter meldet seinen Zustand an das Blatt weiter',
  /setAttribute\('aria-expanded', String\(offen\)\)/.test(appJs));

// ---------------------------------------------------------------------------
// Auf dem Handy dieselbe Zeile wie am Computer
// ---------------------------------------------------------------------------
//
// Hier gab es einmal einen eigenen Aufbau fuer schmale Bildschirme: Antwort
// oben, Betrag darunter. Die Begruendung war, ein langer Text und ein
// sechsstelliger Betrag passten nicht nebeneinander.
//
// Gemessen stimmte das nicht mehr, seit .opt-num auf flex: none steht – und
// es kostete etwas: Die Kante der Fuellung lief zusaetzlich durch den Betrag
// darunter. Jetzt gelten ueberall dieselben Regeln.
//
// Diese Pruefung haelt das fest. Sie misst am 375-px-Bildschirm dreierlei:
//   * der Betrag steht RECHTS neben der Antwort, nicht darunter
//   * keine Zahl wird zusammengedrueckt
//   * alle Betraege einer Abstimmung beginnen auf derselben Hoehe
//
// Der Pruefsatz ist bewusst der Grenzfall, den die Datenbank zulaesst:
// 60 Zeichen Antwort, achtstelliger Betrag. Mit "Ship it this week" wuerde
// hier alles gruen sein, was ohnehin nie Aerger macht.
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
  ${zeile}
  ${fuehrend}
  ${markup}
  $('#poll-list').innerHTML = [
    { id: 1, closed: false, myOptionId: 1, totalUsd: 42881420, closesAt: null,
      question: 'Should we open the token gate to smaller holders?',
      // Eine KURZE und eine LANGE Antwort, nicht zwei gleich lange.
      // Mit zwei gleich langen brechen beide gleich oft um, und dann kann die
      // Ausrichtung (oben oder mittig) gar keinen Unterschied machen – die
      // Pruefung darauf waere immer gruen. Genau das war sie hier zuerst.
      options: [
        { id: 1, label: 'Yes', usd: 28429000, share: .663 },
        { id: 2, label: 'Keep the current schedule exactly as it is written',
          usd: 12105400, share: .282 },
        // Ein einziges langes Wort. Text bricht normalerweise an Leerzeichen
        // um und draengt den Betrag deshalb gar nicht – ein Wort ohne
        // Trennstelle tut es doch. Genau dieser Fall zeigt, ob flex: none
        // wirklich etwas haelt, und die Datenbank laesst ihn zu (60 Zeichen,
        // beliebige).
        { id: 3, label: 'Supercalifragilisticexpialidociousandthensomemorewords',
          usd: 2347020, share: .055 },
      ] },
  ].map(pollHtml).join('');` });
await handy.waitForTimeout(200);

const handyZeile = await handy.evaluate(() => {
  const betraege = [...document.querySelectorAll('.opt-num')];
  const labels = [...document.querySelectorAll('.opt-label')];
  return {
    // Rechts daneben heisst: Der Betrag beginnt weiter rechts, als die
    // Antwort endet – und beide liegen auf derselben Hoehe.
    daneben: betraege.every((b, i) => {
      const bb = b.getBoundingClientRect(), lb = labels[i].getBoundingClientRect();
      return bb.left >= lb.right - 1 && bb.top < lb.bottom;
    }),
    // Und: Die Zahl darf nicht umbrechen. "$28,429,000" hat nach jedem Komma
    // eine Trennstelle – ohne flex: none kann der Betrag also in zwei Zeilen
    // zerfallen, statt sichtbar gequetscht zu werden. Zerrissen ist genauso
    // schlecht wie abgeschnitten.
    umgebrochen: betraege
      .map((b) => b.querySelector('.held'))
      .filter((h) => h.getClientRects().length > 1)
      .map((h) => h.textContent.trim()),
    gequetscht: betraege
      .map((b) => b.querySelector('.held'))
      .filter((h) => h.scrollWidth > Math.ceil(h.getBoundingClientRect().width) + 1)
      .map((h) => h.textContent.trim()),
    // Nicht gegen den Balken messen, sondern gegen die Antwort DANEBEN.
    //
    // Erst hier stand der Abstand zur Oberkante des Balkens – der ist aber
    // auch bei richtiger Ausrichtung verschieden, weil .opt-bar eine
    // Mindesthoehe hat und eine einzeilige Antwort darin mittig sitzt. Die
    // Pruefung schlug dadurch an, ohne dass etwas falsch war.
    //
    // Gemeint ist etwas anderes: Der Betrag soll auf der HOEHE der ersten
    // Zeile der Antwort stehen und nicht auf halber Hoehe eines umgebrochenen
    // Blocks. Also der Abstand zwischen beiden, Zeile fuer Zeile.
    versatz: betraege.map((b, i) => Math.round(
      b.getBoundingClientRect().top - labels[i].getBoundingClientRect().top)),
  };
});
await handy.close();

pruefe('Auf 375 px steht der Betrag rechts neben der Antwort, nicht darunter',
  handyZeile.daneben);
pruefe('Auch beim laengsten erlaubten Text wird keine Zahl gequetscht',
  handyZeile.gequetscht.length === 0, handyZeile.gequetscht.join(', '));
pruefe('Und keine Zahl in zwei Zeilen zerrissen',
  handyZeile.umgebrochen.length === 0, handyZeile.umgebrochen.join(', '));
// Ohne align-items: flex-start saesse der Betrag bei einer umgebrochenen
// Antwort auf halber Hoehe – und die Betraege einer Abstimmung stuenden dann
// nicht mehr auf einer Linie.
pruefe('Und jeder Betrag steht auf Hoehe der ersten Zeile seiner Antwort',
  handyZeile.versatz.every((v) => Math.abs(v) <= 2),
  handyZeile.versatz.join(' / ') + ' px Versatz');

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
