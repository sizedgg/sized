// ============================================================================
// Prüft den Bild-Knopf – und legt das erzeugte Bild zum Ansehen ab.
//
// Ein gezeichnetes Bild kann auf zwei Arten falsch sein: Es kann gar nicht
// entstehen (dann meldet sich der Fehler von selbst), oder es kann entstehen
// und schlecht aussehen – Text, der aus einem Balken läuft, Zahlen, die sich
// überlappen, eine abgeschnittene Frage. Das Zweite sieht man nur, wenn man
// hinsieht. Deshalb schreibt dieses Skript die fertigen PNGs nach preview/.
//
// Geprüft werden die unangenehmen Fälle: sehr lange Frage, sehr lange Antwort,
// riesige Zahlen, zehn Antworten, eine geschlossene Abstimmung, und eine, bei
// der noch niemand abgestimmt hat.
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

// Wörtlich aus app.js herausgeschnitten – eine nachgebaute Kopie würde den
// Test bestehen, während die echte Fassung kaputt ist.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeichner = schneide('const cssWert =', 'async function ladePollBild');

// Die Fassungsnummer steht an ZWEI Stellen: in app.js wird das Bild
// geschrieben, in der Edge Function wird es gesucht. Laufen sie auseinander,
// zeigt jeder geteilte Link die Ersatzkarte – und zwar lautlos, weil beide
// Seiten fuer sich genommen richtig aussehen. Genau dafuer ist diese Pruefung
// da.
const ogTs = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'og', 'index.ts'), 'utf8');
const versionAus = (text, wo) => {
  const m = /const KARTEN_VERSION = (\d+);/.exec(text);
  if (!m) throw new Error(`KARTEN_VERSION nicht gefunden in ${wo}`);
  return Number(m[1]);
};
const vApp = versionAus(appJs, 'public/app.js');
const vOg = versionAus(ogTs, 'supabase/functions/og/index.ts');
// Die Zahlenformate stehen weiter oben bei den anderen Formatierern – auch sie
// woertlich, damit der Test nicht seine eigene Fassung prueft.
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');
const lader = schneide('async function ladePollBild', '\nfunction pollHtml');
const CHECK_SVG = schneide('const CHECK_SVG =', 'const DOWNLOAD_SVG =');
const DOWNLOAD_SVG = schneide('const DOWNLOAD_SVG =', '\n/* Ein Papierkorb');
const TRASH_SVG = schneide('const TRASH_SVG =', '\n// ------');
// Der Zustand der Knoepfe. ladePollBild sperrt darueber seinen eigenen Knopf
// und setzt danach den Haken – beides lag frueher als btn.disabled und
// btn.innerHTML am Knoten selbst und ueberlebte keinen Neubau der Liste.
const knopfStand = schneide('const KNOPF_ROLLEN = {', '\n/**\n * Die Adresse einer einzelnen');

const seiteHtml = `<!doctype html><meta charset="utf-8"><style>${css}</style><body>`;
const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' }).end(seiteHtml));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

await seite.addScriptTag({
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
    ${knopfStand}
    ${zeichner}
    ${lader}
    window.zeichnePoll = zeichnePoll;
    window.umbrechen = umbrechen;
    window.ladePollBild = ladePollBild;
    window.state = state;
  `,
});

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });

const FAELLE = {
  'normal': {
    id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
    question: 'Should we open the token gate to smaller holders?',
    options: [
      opt('Ship it this week', 128, 482900, 4829 / 7814.2),
      opt('Wait for the audit', 44, 210400, 2104 / 7814.2),
      opt('Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
    ],
  },
  'lang': {
    id: 2, closed: false, totalVotes: 3, totalUsd: 12,
    question: 'If we were to change the minimum holding required to message Ansem, '
      + 'which of these thresholds would you personally consider fair for the community?',
    options: [
      opt('Donaudampfschifffahrtsgesellschaftskapitaenswitwe and then some more words that will not fit', 2, 8, 8 / 12),
      opt('No', 1, 4, 4 / 12),
    ],
  },
  'gross': {
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
    // Die Anteile werden aus den Betraegen gerechnet, genau wie in loadPolls().
    // Sie muessen sich deshalb auf 1 addieren – sonst prueft der Test nur die
    // eigene Erfindung statt das, was die App tut.
    options: (() => {
      const usd = Array.from({ length: 10 }, (_, i) => 400000 - i * 30000);
      const gesamt = usd.reduce((a, b) => a + b, 0);
      return usd.map((u, i) => opt(`Guest number ${i + 1}`, 55 - i * 4, u, u / gesamt));
    })(),
  },
  'geschlossen': {
    id: 5, closed: true, totalVotes: 77, totalUsd: 310000,
    question: 'Next AMA time?',
    options: [opt('Friday 8pm ET', 55, 220100, 2201 / 3100), opt('Sunday 2pm ET', 22, 89900, 899 / 3100)],
  },
  'leer': {
    id: 6, closed: false, totalVotes: 0, totalUsd: 0,
    question: 'Nobody has voted yet',
    options: [opt('Option A', 0, 0, 0), opt('Option B', 0, 0, 0)],
  },
};

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nBild einer Abstimmung\n');

pruefe('KARTEN_VERSION stimmt in app.js und in der Edge Function ueberein',
  vApp === vOg, `app.js: ${vApp}, og/index.ts: ${vOg}`);

// --- Wie schnell die Karte beim Teilen erscheint --------------------------
//
// Xs Crawler wartet nicht lange. Erscheint die Antwort nicht in seinem
// Fenster, steht im Beitrag der nackte Link. Geprueft wird deshalb der
// kritische Weg der Edge Function – nicht, weil die Zahlen hier gemessen
// waeren, sondern weil jede dieser drei Eigenschaften beim naechsten Umbau
// lautlos verloren gehen kann.
pruefe('Die Zahlen haengen nicht mehr an der ersten Abfrage',
  /poll_results'\)[\s\S]{0,60}\.eq\('poll_id'/.test(ogTs),
  'poll_results wird ueber poll_id geholt, nicht ueber die Options-Nummern');
pruefe('Und alle drei Abfragen laufen gleichzeitig',
  /await Promise\.all\(\[[\s\S]{0,400}poll_results/.test(ogTs));
// Die Bildpruefung ist eine Hoeflichkeit gegenueber alten Abstimmungen. Ohne
// Deckel wird sie zur Bremse fuer alle: Der Crawler haengt dann an einer
// Frage, deren Antwort fast immer "ja" lautet.
pruefe('Die Bildpruefung kann die Antwort nicht aufhalten',
  /Promise\.race\(\[[\s\S]{0,160}setTimeout/.test(ogTs));

// Das Bild aendert sich unter seinem Namen nie – der Name traegt die
// Fassungsnummer. Eine kurze Aufbewahrung waere hier reine Wartezeit.
pruefe('Die Karte wird lange zwischengespeichert',
  /cacheControl: '31536000, immutable'/.test(appJs));

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

for (const [name, poll] of Object.entries(FAELLE)) {
  const ergebnis = await seite.evaluate(async (p) => {
    const c = await window.zeichnePoll(p);
    const karte = await window.zeichnePoll(p, { fuerKarte: true });
    const ctx = c.getContext('2d');
    return {
      w: c.width, h: c.height, data: c.toDataURL('image/png'),
      ecke: [...ctx.getImageData(1, 1, 1, 1).data],
      mitte: [...ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data],
      grund: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      geometrie: c.geometrie,
      karte: {
        w: karte.width, h: karte.height, geo: karte.geometrie,
        data: karte.toDataURL('image/png'),
      },
    };
  }, poll);

  const datei = path.join(root, 'preview', `poll-bild-${name}.png`);
  fs.writeFileSync(datei, Buffer.from(ergebnis.data.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(root, 'preview', `poll-karte-${name}.png`),
    Buffer.from(ergebnis.karte.data.split(',')[1], 'base64'));

  // 3200 = 1600 Punkte bei doppelter Auflösung. Steht das nicht, ist die
  // Skalierung verrutscht und das Bild wäre auf dem Telefon unscharf.
  pruefe(`${name}: 3200 px breit`, ergebnis.w === 3200, String(ergebnis.w));

  // Das eigentliche Maß für X: Breiter als 16:9 wird in der Zeitleiste
  // vollständig gezeigt, höher als 4:5 oben und unten abgeschnitten.
  const v = ergebnis.w / ergebnis.h;
  pruefe(`${name}: Seitenverhältnis zwischen 4:5 und 16:9`,
    v >= 0.795 && v <= 1.782, `${v.toFixed(2)}:1`);

  pruefe(`${name}: PNG ist nicht leer`, fs.statSync(datei).size > 5000,
    `${Math.round(fs.statSync(datei).size / 1024)} KB`);

  // Das Kartenbild fuer X hat ein anderes, FESTES Format: 1,91:1. Genau darauf
  // schneidet X eine Linkkarte zu – ein hoeheres Bild verlaere oben und unten
  // je einen Streifen, und als Erstes fiele der Rahmen weg.
  const kv = ergebnis.karte.w / ergebnis.karte.h;
  pruefe(`${name}: Kartenbild ist 1,91:1`, Math.abs(kv - 1.91) < .01, `${kv.toFixed(3)}:1`);
  // Einfache Aufloesung, nicht doppelte: PNG rastert den Lichtschein im Grund
  // mit einem Rauschen, das sich bei doppelter Aufloesung vervierfacht. Die
  // Datei wuerde ein Vielfaches wiegen, ohne dass man etwas sieht – und X zeigt
  // eine Kachel ohnehin rund 600 px breit.
  pruefe(`${name}: Kartenbild ist 1600 px breit`, ergebnis.karte.w === 1600,
    String(ergebnis.karte.w));
  const kb = Math.round(ergebnis.karte.data.length * 0.75 / 1024);
  pruefe(`${name}: Kartenbild bleibt unter 2 MB`, kb < 2048, `${kb} KB`);
  // Passen nicht alle Antworten hinein, muessen die uebrigen GENANNT werden.
  // Eine Karte, die stillschweigend die Haelfte zeigt, behauptet etwas ueber
  // das Ergebnis.
  const g = ergebnis.karte.geo;
  pruefe(`${name}: Karte zeigt entweder alle Antworten oder nennt die fehlenden`,
    g.gezeigt + g.ausgelassen === poll.options.length,
    `${g.gezeigt} gezeigt, ${g.ausgelassen} genannt, ${poll.options.length} gesamt`);

  // Die Ecken tragen die Grundfarbe der Seite und sind DECKEND. Durchsichtig
  // wäre die sauberere Datei, aber X rechnet PNGs oft in JPEG um – und dann
  // würden aus durchsichtigen Ecken schwarze.
  const [er, eg, eb, ea] = ergebnis.ecke;
  const soll = ergebnis.grund.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  pruefe(`${name}: Ecken sind deckend`, ea === 255, `Alpha oben links: ${ea}`);
  pruefe(`${name}: Ecken tragen die Grundfarbe der Seite`,
    er === soll[0] && eg === soll[1] && eb === soll[2],
    `rgb(${er}, ${eg}, ${eb}) statt rgb(${soll.join(', ')})`);
  // Und die Karte selbst hebt sich davon ab – sonst wäre die Rundung unsichtbar.
  const [mr, mg, mb] = ergebnis.mitte;
  pruefe(`${name}: die Karte hebt sich vom Rand ab`,
    Math.abs(mr - er) + Math.abs(mg - eg) + Math.abs(mb - eb) > 8,
    `Karte rgb(${mr}, ${mg}, ${mb})`);

  // Der Kern: Die gefüllten Stücke aneinandergelegt müssen genau einen vollen
  // Balken ergeben. Sonst behauptet das Bild etwas über die Verteilung, das
  // nicht stimmt – und bei einer Abstimmung über Geld ist das kein Schönheits-
  // fehler. Toleranz ist ein halbes Pixel für die Rundung beim Zeichnen.
  if (poll.totalVotes > 0) {
    const summe = poll.options.reduce((a, o) => a + o.share, 0);
    pruefe(`${name}: die Anteile ergeben zusammen genau eins`,
      Math.abs(summe - 1) < 1e-9, summe.toFixed(12));

    // Nicht nachgerechnet, sondern abgelesen: Die Breiten kommen aus dem
    // fertigen Bild. Eine eigene Rechnung hier würde nur die eigene Rechnung
    // prüfen – sie ist schon einmal grün geblieben, nachdem sich der
    // Seitenrand geändert hatte.
    const { inhalt, fuellungen } = ergebnis.geometrie;
    const breiten = fuellungen.reduce((a, b) => a + b, 0);
    pruefe(`${name}: die gefüllten Stücke ergeben genau die volle Breite`,
      Math.abs(breiten - inhalt) < .5, `${breiten.toFixed(2)} von ${inhalt} px`);
  }
}

// Kein Absturz bei fehlenden Angaben: Eine Abstimmung ohne Antworten kommt
// zwar nicht vor, darf aber kein Bild mit kaputter Höhe erzeugen.
const ohne = await seite.evaluate(async () => {
  try {
    const c = await window.zeichnePoll(
      { id: 9, question: 'x', closed: false, totalVotes: 0, totalUsd: 0, options: [] });
    return { ok: true, h: c.height };
  } catch (e) { return { ok: false, fehler: e.message }; }
});
pruefe('Abstimmung ohne Antworten stürzt nicht ab', ohne.ok && ohne.h > 0,
  ohne.ok ? `${ohne.h} px hoch` : ohne.fehler);

// --- Der Knopf selbst ------------------------------------------------------
// Bis hierher wurde nur gezeichnet. Ob am Ende wirklich eine Datei beim Nutzer
// ankommt, hängt an einem a[download] auf eine blob-Adresse – und genau das
// ist der Teil, der still scheitern kann.
await seite.evaluate((p) => {
  window.state.polls = [p];
  const b = document.createElement('button');
  b.id = 'knopf';
  b.className = 'icon-btn poll-image';
  // MIT data-image, wie im echten Blatt: Daran erkennt knoepfeMalen(), zu
  // welcher Abstimmung der Knopf gehoert. Ohne das Merkmal wuerde der Haken
  // hier nie erscheinen – und der Test haette einen Knopf geprueft, den es so
  // nicht gibt.
  b.dataset.image = String(p.id);
  b.innerHTML = DOWNLOAD_SVG;
  b.addEventListener('click', () => ladePollBild(p.id));
  document.body.appendChild(b);
}, FAELLE.normal);

const wartenAufDatei = seite.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await seite.click('#knopf');
const datei = await wartenAufDatei;
pruefe('Klick liefert wirklich eine Datei aus', Boolean(datei),
  datei ? datei.suggestedFilename() : 'kein Download ausgelöst');
if (datei) {
  pruefe('Dateiname nennt die Abstimmung',
    datei.suggestedFilename() === 'sized-poll-1.png', datei.suggestedFilename());
  const pfad = await datei.path();
  const gross = pfad ? fs.statSync(pfad).size : 0;
  pruefe('Die ausgelieferte Datei ist ein volles PNG', gross > 5000,
    `${Math.round(gross / 1024)} KB`);
}

await seite.waitForTimeout(120);
const haken = await seite.evaluate(() =>
  document.querySelector('#knopf').classList.contains('is-copied'));
pruefe('Knopf bestätigt mit dem Haken', haken);

// Eine Nummer, die es nicht gibt: Der Knopf darf nicht still nichts tun.
const fehltMeldung = await seite.evaluate(async () => {
  window.tosts = [];
  const b = document.querySelector('#knopf');
  await ladePollBild(999, b);
  return { tosts: window.tosts, wiederFrei: !b.disabled };
});
pruefe('Unbekannte Abstimmung wird gemeldet',
  fehltMeldung.tosts.some((t) => t.err), fehltMeldung.tosts.map((t) => t.m).join(' | '));
pruefe('Knopf ist danach wieder bedienbar', fehltMeldung.wiederFrei);

// --- Blau erst nach dem Schliessen -----------------------------------------
//
// Solange eine Abstimmung laeuft, sagen die Balkenlaengen schon, wo es steht.
// Eine blaue Flaeche darueber macht daraus eine ANSAGE, und eine Ansage ueber
// einen Zwischenstand ist eine Aufforderung: Wer unentschieden hereinkommt und
// sieht, dass eine Antwort "die" Antwort ist, stimmt eher dafuer. Der Rang
// kann sich bis zur letzten Minute drehen, hier besonders – ein einziger
// grosser Halter dreht ihn.
//
// Geprueft wird an den PIXELN der fertigen Leinwand und nicht an der Rechnung
// dahinter. Die Rechnung koennte richtig sein und der Pinsel trotzdem blau.
console.log('\nDas Blau kommt erst zum Schluss\n');

const blauImBild = (poll) => seite.evaluate(async (p) => {
  const c = await window.zeichnePoll(p, { fuerKarte: true });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  // Blau heisst hier: deutlich mehr Blau als Rot. Die Graustufen der Seite
  // liegen alle dicht beieinander, --fuellung-spitze (#2b5988) nicht.
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 2] - d[i] > 30) n++;
  return n;
}, poll);

const offenBlau = await blauImBild(FAELLE.normal);
const zuBlau = await blauImBild(FAELLE.geschlossen);
pruefe('Eine laufende Abstimmung hat kein Blau auf der Karte',
  offenBlau === 0, `${offenBlau} blaue Punkte`);
// Die Gegenprobe gehoert dazu: Ohne sie waere die Pruefung darueber auch dann
// gruen, wenn das Blau ueberhaupt nicht mehr gezeichnet wuerde.
pruefe('Eine geschlossene sehr wohl – und zwar flächig',
  zuBlau > 10000, `${zuBlau} blaue Punkte`);

// Und dasselbe eine Ebene tiefer: Es haengt am Schliessen und nicht daran,
// dass die eine Abstimmung zufaellig andere Zahlen hat.
const gedreht = await blauImBild({ ...FAELLE.normal, closed: true });
pruefe('Dieselbe Abstimmung, nur geschlossen, bekommt ihr Blau',
  gedreht > 10000, `${gedreht} blaue Punkte`);

// Die Rechnung steht an EINER Stelle, weil Liste und Karte sonst
// auseinanderlaufen: Ein geteiltes Bild zeigte dann einen Gewinner, den die
// Seite daneben nicht kennt – und beide saehen fuer sich richtig aus.
pruefe('Karte und Liste holen sich denselben Wert',
  (appJs.match(/fuehrenderAnteil\(p\)/g) || []).length === 2);
pruefe('Und niemand rechnet daneben noch selbst den Groessten aus',
  (appJs.match(/Math\.max\(\.\.\.p\.options\.map/g) || []).length === 1);

// --- Der Betrag steht allein in der rechten Spalte -------------------------
//
// In dieser Spalte standen nacheinander drei Dinge: der Betrag mit der
// Stimmenzahl darunter, dann der Betrag allein, dann der Betrag mit dem
// Prozentsatz darunter, jetzt wieder der Betrag allein.
//
// Solange dort zwei Zeilen standen, prueften diese Zeilen den Abstand
// zwischen ihnen. Jetzt gibt es nur noch eine, und die Anforderung ist eine
// andere: Sie muss MITTIG in der Zeile sitzen. Das war frueher der Teil, den
// man beim Verschieben vergass – wer nur die obere Zeile tiefer setzte,
// kippte das Paar nach unten.
//
// Geprueft wird die Mittigkeit nicht als "der Wert ist 13", sondern gegen die
// wirklich gemessene Versalhoehe der Schrift. Eine Pruefung auf die Zahl
// selbst wuerde nur nachsprechen, was in app.js steht.
console.log('\nDer Betrag in der Zeile\n');

const versatz = (() => {
  const m = /vollUsd\(o\.usd\), B - rand - 26, mitte \+ (-?\d+)\)/.exec(appJs);
  if (!m) throw new Error('Die Zeile, die den Betrag zeichnet, steht nicht mehr so in app.js');
  return Number(m[1]);
})();

// Die Versalhoehe der 36px-Schrift, in genau dem Browser gemessen, der auch
// das Bild zeichnet – nicht aus einer Tabelle abgeschrieben.
const versalHoehe = await seite.evaluate(() => {
  const mono = getComputedStyle(document.documentElement)
    .getPropertyValue('--mono').trim() || 'monospace';
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `700 36px ${mono}`;
  const m = ctx.measureText('$1,234,567');
  return m.actualBoundingBoxAscent;
});
// Mittig heisst: Die Grundlinie liegt um die halbe Versalhoehe unter der
// Mitte, dann steht die Zahl mit gleich viel Luft darueber wie darunter.
const soll = versalHoehe / 2;
pruefe('Der Betrag sitzt mittig in seiner Zeile',
  Math.abs(versatz - soll) <= 2,
  `Versatz ${versatz} px, halbe Versalhöhe ${soll.toFixed(1)} px`);

// Und er ist wirklich das Einzige, was rechts steht. Beide frueheren
// Nebenzeilen holten ihre Lage aus derselben Mitte – waere eine davon
// zurueckgekommen, ohne dass der Versatz angepasst wird, saehe das Paar
// schief aus, ohne dass irgendetwas anderes hier ausschlaegt.
const zeichnerText = schneide('async function zeichnePoll', '\nasync function ladePollBild');
pruefe('Neben dem Betrag steht keine zweite Zeile',
  (zeichnerText.match(/B - rand - 26, mitte/g) || []).length === 1);
// Der Prozentsatz darf zurueckkommen, wenn er gefaellt – das ist Geschmack.
pruefe('Kein Prozentsatz mehr auf der Karte',
  !/o\.share \* 100/.test(zeichnerText));
// Die STIMMENZAHL darf nicht zurueckkommen, und das ist kein Geschmack: Wer
// sein Guthaben kurz vor Schluss auf zehn Wallets verteilt, aendert am Betrag
// nichts, macht aus einer Stimme aber zehn. Der Betrag laesst sich so nicht
// aufblasen. Diese Zeile steht hier als Sperre, nicht als Beschreibung.
pruefe('Und keine Stimmenzahl – die liesse sich durch Verteilen aufblasen',
  !/\bvotes\b/.test(zeichnerText));

// --- Der Betrag auf dem Balken --------------------------------------------
//
// Der Betrag steht in der rechten Spalte, und der Balken einer fuehrenden
// Antwort laeuft bis dorthin. Er ist damit die einzige Schrift im Bild, deren
// Untergrund sich aendern kann: mal der Zeilengrund, mal die Fuellung
// darueber.
//
// Die kleine Zeile darunter, die es zeitweise gab, stand auf --dimmer und kam
// dort auf gemessene 1,3:1 – nicht ein bisschen zu blass, sondern unsichtbar.
// Und zwar ausgerechnet bei der Antwort, die gewinnt, also in dem Fall, in dem
// die Karte am haeufigsten geteilt wird. Wer eine zweite Zeile zurueckholt,
// braucht wieder eine eigene Farbe dafuer.
//
// Geprueft wird gegen die Fuellung selbst und nicht gegen den Zeilengrund: Wer
// die Fuellung anfasst, macht die Zahl unlesbar, ohne ihre eigene Farbe zu
// aendern.
//
// Frueher stand hier eine Rechnung mit Deckkraft – die Fuellung war
// durchscheinendes Weiss ueber dem Zeilengrund, und der Test hat die Mischung
// nachgerechnet. Seit die Fuellung Xs Werte hat, ist sie DECKEND und es gibt
// ZWEI davon: Grau fuer die normalen Antworten, Blau fuer die fuehrende.
// Geprueft werden beide, und die fuehrende ist dabei der strengere Fall –
// genau die Zeile, deren Balken bis in die rechte Spalte laeuft.
console.log('\nDer Betrag auf dem Balken\n');

const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const alsZahlen = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
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
// Die Fuellung wird nicht mehr gemischt, sie steht als Wert im Blatt.
const grau = alsZahlen(wert('--fuellung'));
const blau = alsZahlen(wert('--fuellung-spitze'));
const betrag = alsZahlen(wert('--text'));
const leer = alsZahlen(wert('--bg-1'));   // der Kartengrund neben dem Balken

// Der schlechtere der beiden Faelle zaehlt. Blau ist heller als Grau, die
// Schrift steht also darauf enger – und ausgerechnet dort laeuft der Balken am
// weitesten nach rechts, bis unter die Zahlen.
pruefe('Der Betrag bleibt auf beiden Füllungen lesbar (mindestens 4,5:1)',
  Math.min(kon(betrag, grau), kon(betrag, blau)) >= 4.5,
  `Grau ${kon(betrag, grau).toFixed(1)}:1, Blau ${kon(betrag, blau).toFixed(1)}:1`);
pruefe('Und auf dem leeren Teil erst recht',
  kon(betrag, leer) >= 4.5,
  `${kon(betrag, leer).toFixed(1)}:1`);
// Die fuehrende Antwort wird heller gesetzt als die anderen. Auch diese Farbe
// steht auf der blauen Fuellung – und zwar immer, denn ihr Balken ist der
// laengste.
const spitzeFarbe = alsZahlen(wert('--accent'));
pruefe('Auch der Betrag der führenden Antwort bleibt auf dem Blau lesbar',
  kon(spitzeFarbe, blau) >= 4.5, `${kon(spitzeFarbe, blau).toFixed(1)}:1`);
// Und die beiden Fuellungen muessen unterscheidbar bleiben – sonst sagt das
// Blau nichts mehr. Ueber die Helligkeit allein tut es das kaum (1,67:1); die
// Aussage traegt der Farbton. Deshalb wird hier BEIDES geprueft: dass sie sich
// im Ton wirklich unterscheiden und nicht nur zwei Grautoene sind.
const tonAbstand = Math.max(...[0, 1, 2].map((i) => Math.abs(blau[i] - grau[i])))
  - Math.min(...[0, 1, 2].map((i) => Math.abs(blau[i] - grau[i])));
pruefe('Die führende Füllung ist eine Farbe und kein weiteres Grau',
  tonAbstand >= 25, `${tonAbstand} Stufen Abstand zwischen den Kanälen`);
// Und die Leinwand muss die Variablen auch wirklich lesen, statt eigene Werte
// mitzubringen – sonst laeuft das Bild irgendwann neben der Seite her.
//
// Hier standen nacheinander --votes und --anteil. Beide gab es nur fuer die
// kleine Zeile unter dem Betrag, und mit ihr sind beide aus dem Blatt
// verschwunden.
pruefe('Keine Farbe mehr für eine zweite Zeile, weil es keine gibt',
  !/--anteil/.test(appJs) && !/--votes/.test(appJs));
pruefe('Beide Füllungen kommen aus dem Blatt',
  /cssWert\('--fuellung'\)/.test(appJs) && /cssWert\('--fuellung-spitze'\)/.test(appJs));
pruefe('Die führende Antwort wird auf der Karte blau gefüllt',
  /ctx\.fillStyle = spitze \? farbe\.fuellungSpitze : farbe\.fuellung;/.test(appJs));
// Der zweite, hellere Rahmen um den fuehrenden Balken ist weg – das Blau sagt
// es schon. Zwei Zeichen fuer dieselbe Aussage lesen sich als zwei Aussagen.
pruefe('Und bekommt keinen zweiten Rahmen obendrauf',
  !/lineWidth = spitze \? 2 : 1/.test(appJs));

// ---------------------------------------------------------------------------
// Die Zeichengrenzen des Formulars gegen das, was die Karte zeigt
//
// MAX_FRAGE und MAX_ANTWORT stehen in app.js, wirken aber im Formular. Ihre
// Begruendung liegt HIER: Die Karte ist die Fassung, die nach draussen geht.
//
// Zwei verschiedene Zusagen, und sie duerfen nicht verwechselt werden:
//
//   1. Es geht NICHTS verloren. Das ist eine Zusage der Karte selbst, nicht der
//      Grenze: zeichnePoll() verkleinert die Frage, bis sie in drei Zeilen
//      passt. Vorher stand dort nur .slice(0, 3), und die vierte Zeile fiel
//      lautlos weg – im Formular stand die Frage vollstaendig da, auf dem
//      geposteten Bild hoerte sie mitten im Satz auf.
//
//   2. Sie steht in voller Groesse da. DAS ist die Zusage der Grenze. Eine
//      Frage, die die Karte auf 44 px druecken wuerde, ist in der Zeitleiste
//      keine Ueberschrift mehr.
//
// Geprueft wird nicht nachgerechnet, sondern GEZEICHNET: zeichnePoll haengt die
// Zahlen an die Leinwand. Eine nachgebaute Formel waere wieder nur eine zweite
// Meinung; sie ist hier schon einmal gruen geblieben, nachdem sich der
// Seitenrand geaendert hatte.
//
// Und mit vielen Saetzen statt einem, weil der Umbruch nicht an der Laenge
// haengt, sondern an den Wortgrenzen: Ein langes Wort am Zeilenende laesst eine
// halbe Zeile leer. Die Wortlaengen hier gehen bis 16 – laenger als englische
// Prosa, absichtlich.
// ---------------------------------------------------------------------------
console.log('\nDie Zeichengrenzen des Formulars passen zur Karte\n');

const grenzeAus = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(appJs);
  if (!m) throw new Error(`${name} nicht in app.js gefunden`);
  return Number(m[1]);
};
const MAX_FRAGE = grenzeAus('MAX_FRAGE');
const MAX_ANTWORT = grenzeAus('MAX_ANTWORT');

/** Ein Satz aus Woertern von 2 bis maxW Zeichen, genau n Zeichen lang. */
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

const zeichneGeometrie = (fall) => seite.evaluate(async (p) =>
  (await window.zeichnePoll(p)).geometrie, fall);
const mitFrage = (frage) => ({
  id: 91, closed: false, totalVotes: 3, totalUsd: 12,
  question: frage, options: [opt('A', 2, 8, 2 / 3), opt('B', 1, 4, 1 / 3)],
});

// Der teuerste Fall fuer die Antworten: der breiteste Betrag, den es je geben
// kann, denn er nimmt der Antwort die Breite weg. Und die fuehrende Antwort,
// weil sie in der fetteren Schnittstaerke gesetzt wird.
const langeAntwort = 'M'.repeat(MAX_ANTWORT);
const gAntwort = await zeichneGeometrie({
  id: 90, closed: false, totalVotes: 41822, totalUsd: 12_345_678,
  question: 'Kurz',
  options: [opt(langeAntwort, 41_000, 12_345_678, .97), opt(langeAntwort, 822, 300_000, .03)],
});
pruefe(`Eine Antwort mit ${MAX_ANTWORT} Zeichen bekommt neben $12.345.678 keine Auslassungspunkte`,
  gAntwort.antwortenGekuerzt === 0, `${gAntwort.antwortenGekuerzt} von 2 gekürzt`);

// Die Zusage der GRENZE: volle Groesse. Wortlaengen bis 16 – laenger als
// englische Prosa, absichtlich.
let kleinste = 54;
let schlimmste = '';
for (let i = 0; i < 300; i++) {
  const frage = satz(MAX_FRAGE, 16);
  const g = await zeichneGeometrie(mitFrage(frage));
  if (g.frageGroesse < kleinste) { kleinste = g.frageGroesse; schlimmste = frage; }
}
pruefe(`Eine Frage mit ${MAX_FRAGE} Zeichen bleibt in voller Größe (54 px)`,
  kleinste === 54, `kleinste von 300 Sätzen: ${kleinste} px`
    + (schlimmste ? ` – "${schlimmste}"` : ''));

// Die Zusage der KARTE: es geht nichts verloren. Hier mit Woertern bis 20
// Zeichen, also genau dem Fall, in dem die Annahme hinter der Grenze bricht.
// Sie darf brechen – dann wird die Schrift kleiner, und der Satz steht
// trotzdem ganz da.
let meisteZeilen = 0;
for (let i = 0; i < 300; i++) {
  const g = await zeichneGeometrie(mitFrage(satz(MAX_FRAGE, 20)));
  meisteZeilen = Math.max(meisteZeilen, g.frageZeilenRoh);
}
pruefe('Auch mit sehr langen Wörtern fällt keine Zeile weg',
  meisteZeilen <= 3, `schlimmster von 300 Sätzen: ${meisteZeilen} Zeilen`);

// Gegenproben. Ohne sie stuenden hier Messungen, von denen niemand weiss, ob
// sie ueberhaupt etwas sehen koennen.
//
// 140 Zeichen sind mehr, als die Grenze zulaesst – die Karte zeichnet aber
// auch Abstimmungen von vor dieser Migration. Bei 54 px braeuchten sie eine
// vierte Zeile; frueher waere sie stillschweigend abgeschnitten worden.
let gGross = null;
for (let i = 0; i < 40 && !gGross; i++) {
  const g = await zeichneGeometrie(mitFrage(satz(140, 12)));
  if (g.frageGroesse < 54) gGross = g;
}
pruefe('Gegenprobe: bei 140 Zeichen greift die Verkleinerung wirklich',
  Boolean(gGross), gGross ? `${gGross.frageGroesse} px statt 54` : 'nie ausgelöst');
pruefe('Und rettet dabei die Zeile, die früher wegfiel',
  gGross ? gGross.frageZeilenRoh <= 3 : false,
  gGross ? `${gGross.frageZeilenRoh} Zeilen` : '');
// Ein Text OHNE Leerzeichen. Das ist der Fall, an dem es tatsaechlich gerissen
// ist, und er ist deshalb bemerkenswert, weil alle Messungen darueber, wie viele
// Zeichen in drei Zeilen passen, ihn nicht sehen konnten: Sie arbeiteten mit
// Zufalls-SAETZEN, und ein Satz hat Leerzeichen.
//
// umbrechen() brach nur an Leerzeichen. Eine Frage aus einem einzigen 100
// Zeichen langen Wort war fuer sie EINE Zeile – zu breit, aber eben nur eine.
// Die Verkleinerung greift ab der vierten Zeile, das Auslassungszeichen auch;
// beide sahen nichts. Uebrig blieb kuerzen() beim Zeichnen, und das warf zwei
// Drittel des Textes weg. Erlaubt hatte ihn das Formular ausdruecklich.
{
  const wort = 'abshridmaj'.repeat(MAX_FRAGE / 10);
  const g = await zeichneGeometrie(mitFrage(wort));
  pruefe(`Eine Frage aus EINEM Wort mit ${MAX_FRAGE} Zeichen wird umbrochen, nicht abgeschnitten`,
    g.frageZeilenRoh <= 3 && !g.frageGekuerzt,
    `${g.frageZeilenRoh} Zeilen, gekürzt: ${g.frageGekuerzt}`);

  const langAntwort = 'abshridmaj'.repeat(MAX_ANTWORT / 10);
  const gA = await zeichneGeometrie({
    id: 94, closed: false, totalVotes: 0, totalUsd: 0, question: 'Kurz',
    options: [{ id: 1, label: langAntwort, votes: 0, usd: 12_345_678, share: 1 }],
  });
  pruefe(`Eine Antwort aus EINEM Wort mit ${MAX_ANTWORT} Zeichen steht ganz da`,
    gA.antwortenGekuerzt === 0, `${gA.antwortenGekuerzt} gekürzt bei ${gA.optGroesse} px`);

  // Gegenprobe: Ohne den Zeichenumbruch in umbrechen() waere das eine Zeile.
  // Geprueft wird die Stelle selbst, denn sie ist genau die, die vorher fehlte
  // – hier stand `|| !zeile`, und das hiess "zu breit ist auch in Ordnung".
  pruefe('Gegenprobe: umbrechen() zerlegt zu breite Wörter wirklich',
    !/<= maxW \|\| !zeile/.test(appJs) && /rest\.slice\(n\)/.test(appJs));
  const gGegenWort = await seite.evaluate(([w, breite]) => {
    // Dieselbe Funktion, derselbe Text – nur eine Breite, in die das Wort
    // wirklich nicht passt. Kaeme hier 1 heraus, braeche sie gar nicht.
    const c = document.createElement('canvas').getContext('2d');
    c.font = '700 54px monospace';
    return window.umbrechen(c, w, breite).length;
  }, [wort, 300]);
  pruefe('Und zwar in so viele Zeilen, wie die Breite hergibt',
    gGegenWort > 3, `${gGegenWort} Zeilen bei 300 px`);
}

// Und der Notausgang: Reicht selbst die kleinste Schrift nicht, steht ein
// Auslassungszeichen da. Ein Satz, der mitten im Wort aufhoert, sieht aus wie
// ein Tippfehler; drei Punkte sagen, dass gekuerzt wurde. Der Fall kommt durch
// Formular und Datenbank nicht mehr herein – die Karte zeichnet aber auch, was
// schon in der Ablage liegt.
const gRiesig = await zeichneGeometrie(mitFrage(satz(400, 20)));
pruefe('Reicht selbst 44 px nicht, wird die Frage sichtbar gekürzt',
  gRiesig.frageGekuerzt === true, `${gRiesig.frageZeilenRoh} Zeilen bei ${gRiesig.frageGroesse} px`);
pruefe('Und app.js hängt dafür ein Auslassungszeichen an',
  /frageZeilen\[2\] = `\$\{frageZeilen\[2\]\}…`/.test(appJs));

const gGegen = await zeichneGeometrie({
  id: 93, closed: false, totalVotes: 3, totalUsd: 12_345_678,
  question: 'Kurz', options: [opt('M'.repeat(100), 2, 12_345_678, 1)],
});
pruefe('Gegenprobe: eine Antwort mit 100 Zeichen wird gekürzt',
  gGegen.antwortenGekuerzt === 1, `${gGegen.antwortenGekuerzt} gekürzt`);

// Und die Datenbank muss dieselben Zahlen kennen. Das Formular ist der
// Browser, und der Browser ist der Teil, den man umgehen kann.
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830010000_laengen.sql'), 'utf8');
pruefe('Die Datenbank kennt dieselbe Grenze für die Frage',
  new RegExp(`btrim\\(question\\)\\) between 1 and ${MAX_FRAGE}`).test(migration));
pruefe('Und dieselbe für die Antworten',
  new RegExp(`btrim\\(label\\)\\) between 1 and ${MAX_ANTWORT}`).test(migration));

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden. Bilder in preview/poll-bild-*.png\n`);
process.exit(durch.length ? 1 : 0);
