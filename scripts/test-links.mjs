// ============================================================================
// Prüft die anklickbaren Links in den DMs.
//
// Hier wird aus Text HTML, und das ist die eine Stelle der Seite, an der ein
// Fehler nicht "sieht schlecht aus" heißt, sondern "fremder Code läuft in
// eurem Browser". Deshalb ist der halbe Test ein Angriffstest.
//
// Der gefährliche Weg wäre gewesen: erst maskieren, dann mit einem regulären
// Ausdruck über das maskierte Ergebnis laufen. Das Maskieren fügt selbst
// Zeichen ein (& wird &amp;), die der Ausdruck wieder auseinandernehmen
// müsste – und wer sich dabei verrechnet, lässt HTML durch. mitLinks() zerlegt
// stattdessen den ROHEN Text und maskiert jedes Stück einzeln. Der Test prüft
// nicht die Umsetzung, sondern das Ergebnis: Kommt irgendwo ein < durch, das
// nicht von uns stammt?
//
// Die zweite Hälfte ist die Frage, WO Links überhaupt anklickbar werden:
//
//   * In DMs bei beiden Seiten. Dort sind Links erlaubt, weil genau eine
//     Person Empfänger ist.
//   * Im Zitat über einer Antwort gar nicht: Das Zitat IST ein Knopf, und ein
//     Link in einem Knopf ist ungültiges HTML mit unvorhersehbarem Verhalten.
//   * In der Vorschauzeile des Posteingangs auch nicht – aus demselben Grund.
//
// Bis zum Entfernen des Chats stand hier eine dritte Regel: Dort waren Links
// nur bei Ansem anklickbar, als zweites Schloss neben dem der Datenbank. Sie
// ist mit ihm weggefallen.
//
//   node scripts/test-links.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// Wörtlich aus app.js – eine nachgebaute Kopie würde die eigene Fassung prüfen.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const linker = schneide('const esc =', 'function toast');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body><span class="msg"><span class="body" id="ziel"></span></span>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({ content: `${linker}\nwindow.mitLinks = mitLinks;` });

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// Der Text wird wirklich in die Seite gehaengt und danach der DOM befragt.
// Ein Test, der nur die Zeichenkette anschaut, uebersieht genau die Faelle,
// in denen der Browser etwas anders auslegt als erwartet.
const einsetzen = (text) => seite.evaluate((t) => {
  const el = document.querySelector('#ziel');
  el.innerHTML = window.mitLinks(t);
  return {
    html: el.innerHTML,
    text: el.textContent,
    links: [...el.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'), sichtbar: a.textContent,
      rel: a.getAttribute('rel'), ziel: a.getAttribute('target'),
      referrer: a.getAttribute('referrerpolicy'),
    })),
    fremd: [...el.querySelectorAll('*')].map((e) => e.tagName).filter((t2) => t2 !== 'A'),
  };
}, text);

console.log('\nNichts Fremdes kommt durch\n');

const ANGRIFFE = [
  ['<img src=x onerror=alert(1)>', 'ein Bild mit Fehler-Handler'],
  ['<script>alert(1)</script>', 'ein Skript-Element'],
  ['javascript:alert(1)', 'das javascript-Schema allein'],
  ['https://ok.com" onmouseover="alert(1)', 'Ausbruch aus dem href-Attribut'],
  ['https://ok.com<img src=x onerror=alert(1)>', 'Bild direkt hinter der Adresse'],
  ["https://ok.com' onfocus='alert(1)", 'Ausbruch mit einfachem Anfuehrungszeichen'],
  ['<a href="javascript:alert(1)">klick</a>', 'ein fertiger Link im Text'],
  ['data:text/html,<script>alert(1)</script>', 'das data-Schema'],
];

for (const [angriff, was] of ANGRIFFE) {
  const r = await einsetzen(angriff);
  pruefe(`Kein fremdes Element: ${was}`, r.fremd.length === 0, r.fremd.join(', '));
  const boese = r.links.some((l) => !/^https?:\/\//i.test(l.href));
  pruefe(`Kein Link ohne http/https: ${was}`, !boese,
    r.links.map((l) => l.href).join(' | '));
  // Der Text muss unveraendert lesbar bleiben – wer so etwas schreibt, soll
  // sehen, was er geschrieben hat.
  pruefe(`Der Text bleibt vollständig stehen: ${was}`,
    r.text === angriff, JSON.stringify(r.text));
}

console.log('\nWas ein Link ist und was nicht\n');

const FAELLE = [
  ['https://sized.gg', ['https://sized.gg'], 'volle Adresse'],
  ['www.sized.gg', ['https://www.sized.gg'], 'www ohne Schema bekommt https'],
  ['schau auf https://sized.gg.', ['https://sized.gg'], 'Punkt am Satzende bleibt draussen'],
  ['ende: https://sized.gg/p/12!', ['https://sized.gg/p/12'], 'Ausrufezeichen ebenso'],
  ['(https://en.wikipedia.org/wiki/Foo_(bar))', ['https://en.wikipedia.org/wiki/Foo_(bar)'],
   'Klammern werden gezaehlt, nicht geraten'],
  ['https://x.com/a?b=1&c=2', ['https://x.com/a?b=1&c=2'], 'kaufmaennisches Und im Parameter'],
  ['preis 1.25 und z.b nichts', [], 'Zahlen und Abkuerzungen werden nicht verlinkt'],
  ['sized.gg', [], 'die nackte Domain bleibt Text'],
  ['gm', [], 'gewoehnlicher Text'],
];

for (const [text, erwartet, was] of FAELLE) {
  const r = await einsetzen(text);
  const hrefs = r.links.map((l) => l.href);
  pruefe(`${was}`, JSON.stringify(hrefs) === JSON.stringify(erwartet),
    `${JSON.stringify(hrefs)} statt ${JSON.stringify(erwartet)}`);
}

// Die Adresse steht immer im Klartext da. Das ist der eigentliche Schutz
// gegen Betrug: Es gibt keine Moeglichkeit, "sized.gg" zu schreiben und
// woanders hinzufuehren, weil der Text keine Formatierung kennt.
const sicht = await einsetzen('https://böse-nachbau.example/login');
pruefe('Der sichtbare Text ist die Adresse selbst',
  sicht.links[0].sichtbar === 'https://böse-nachbau.example/login', sicht.links[0].sichtbar);

console.log('\nWie der Link geöffnet wird\n');

const eins = (await einsetzen('https://sized.gg')).links[0];
pruefe('Öffnet in einem neuen Tab', eins.ziel === '_blank', eins.ziel);
// Ohne noopener kann die geoeffnete Seite ueber window.opener diese hier
// umleiten, waehrend der Nutzer im anderen Tab liest.
pruefe('noopener ist gesetzt', /noopener/.test(eins.rel), eins.rel);
pruefe('noreferrer ist gesetzt', /noreferrer/.test(eins.rel), eins.rel);
pruefe('Die Zielseite erfährt nicht, woher der Klick kam',
  eins.referrer === 'no-referrer', eins.referrer);

console.log('\nWo Links anklickbar werden\n');

pruefe('In DMs bei beiden Seiten',
  /<span class="body">\$\{mitLinks\(row\.body\)\}<\/span>/.test(appJs));
// Ein <a> in einem <button> ist ungueltiges HTML; der Browser darf damit
// machen, was er will.
pruefe('Im Zitat über einer Antwort nicht',
  /<span class="quote-body">\$\{esc\(text\)\}<\/span>/.test(appJs));
pruefe('Und in der Vorschauzeile des Posteingangs auch nicht',
  /<span class="thread-prev">\$\{esc\(t\.preview\)\}<\/span>/.test(appJs));

console.log('\nLesbarkeit\n');

// Farbe allein traegt die Aussage "anklickbar" nicht – wer Farben schlecht
// unterscheidet, saehe sonst gar nichts.
pruefe('Links sind unterstrichen, nicht nur eingefärbt',
  /\.msg \.body a \{[^}]*text-decoration: underline/s.test(css));
// Diese Pruefung ist zweimal gekippt, und beide Male aus demselben Grund: Sie
// haengt daran, wie hell die eigene Sprechblase gerade ist.
//
//   fast weisse Blase  → Link brauchte eine eigene, dunkle Farbe
//   beide Blasen dunkel → Ausnahme weg, --worth reichte ueberall
//   blaue Blase (X)    → wieder eine eigene Farbe, diesmal weiss
//
// Deshalb steht hier jetzt nicht mehr "es gibt eine Ausnahme" oder "es gibt
// keine", sondern die Bedingung dahinter: Der Link muss sich auf dem Grund
// abheben, auf dem er tatsaechlich liegt. Hier bleibt die Regel, dass die
// Grundfarbe aus --worth kommt und die Blase nur davon abweicht, wenn sie es
// muss.
pruefe('Links holen ihre Grundfarbe aus --worth',
  /\.msg \.body a \{[^}]*color: var\(--worth\)/s.test(css));
pruefe('Auf der farbigen Blase weichen sie davon ab',
  /\.msg\.dm\.mine \.body a \{[^}]*color:/s.test(css));

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
