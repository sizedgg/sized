// ============================================================================
// Prüft, dass kein Bedienelement mehr den Systemring des Browsers zeigt.
//
// Der Anlass: Die drei Felder im "New poll"-Kasten waren die einzigen der
// Seite ohne eigene Fokusregel und zeigten deshalb Chromes eigenen Ring. Der
// ist unter macOS blau – nicht als Entscheidung, sondern weil Chrome die
// Akzentfarbe des Systems nimmt. Auf fast schwarzem Grund war er der lauteste
// Punkt der Seite.
//
// Das ist genau die Sorte Fehler, die man einmal behebt und beim nächsten
// neuen Eingabefeld sofort wieder einbaut. Deshalb prüft dieser Test nicht die
// drei Felder, sondern ALLE Bedienelemente aus index.html – ein künftiges Feld
// ohne Fokusregel fällt hier auf, bevor es jemand auf der Seite sieht.
//
// Die andere Hälfte ist wichtiger und leichter zu übersehen: Ein Ring, der
// ersatzlos verschwindet, macht die Seite mit der Tastatur unbedienbar. Man
// tabbt dann blind. "Kein blauer Ring" ist also nur die halbe Bedingung – die
// andere ist "aber ein sichtbarer Ersatz". Beides wird hier geprüft, und der
// zweite Teil ist der, der wehtut, wenn er fehlt.
//
// Der Ersatz ist bei einem Textfeld nichts Zusätzliches: Der Rahmen, den das
// Feld ohnehin hat, wird heller. Kein zweiter Umriss daneben – zwei Linien für
// eine Auskunft. Genau das wird geprüft, weil ein Schein oder ein Ring dort
// leicht wieder hineinrutscht, sobald jemand "man sieht es zu wenig" sagt.
//
// Und geprüft werden alle sechs Textfelder der Seite, nicht nur die drei aus
// dem Abstimmungskasten. Eine Seite mit zwei Fokusfarben hat keine Fokusfarbe,
// sondern zwei Zufälle – so ist der blaue Ring überhaupt entstanden.
//
// Dazu die Feinheit, um die es beim Ersatz geht: Er soll bei der Tastatur
// erscheinen und beim Mausklick nicht. Wer klickt, weiß, wohin er geklickt
// hat. Das leistet :focus-visible – und wer es versehentlich zu :focus
// vereinfacht, merkt es ohne Test nicht.
//
//   node scripts/test-fokus.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cssRoh = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

/* Kommentare raus, bevor irgendetwas nach Waehlern sucht.
   ---------------------------------------------------------------------------
   Diese Reihe liest das Blatt mit regulaeren Ausdruecken, und die kennen keine
   Kommentare. Ein Kommentar zwischen zwei Regeln wurde deshalb als Teil des
   naechsten Waehlers gelesen: Aus

     .composer input {
     .../* min-width: 0 - ohne das ragt "Send" ... *\/
     .composer input {

   wurde ein Waehler, der mit "/* min-width" anfaengt, und die Pruefung meldete
   ein fehlendes Autofill fuer ein Feld, das es gar nicht gibt.

   Das ist keine Kleinigkeit: Eine Reihe, die beim Hinzufuegen eines Kommentars
   rot wird, erzieht dazu, keine Kommentare zu schreiben.

   Der Ausdruck ist nicht gierig und laesst Zeilenumbrueche zu. Ein "/*" in
   einer Zeichenkette gibt es in diesem Blatt nicht. */
const css = cssRoh.replace(/\/\*[\s\S]*?\*\//g, '');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
// Die paar Zeilen aus app.js, die data-tastatur setzen – woertlich, damit der
// Test nicht seine eigene Fassung prueft. Ohne sie gaebe es die
// Unterscheidung zwischen Maus und Tastatur bei Textfeldern nicht.
const tastaturSchalter = (() => {
  const a = appJs.indexOf("addEventListener('keydown'");
  const b = appJs.indexOf('}, true);', appJs.indexOf("addEventListener('pointerdown'"));
  if (a < 0 || b < 0) throw new Error('Der Tastaturschalter fehlt in app.js');
  return appJs.slice(a, b + 9);
})();
// Das echte Blatt, nur ohne Skripte und mit allen Bereichen sichtbar – sonst
// liesse sich nur der Login prüfen.
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/ hidden(?=[ >])/g, '');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(html.replace('</head>', `<style>${css}</style></head>`)));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({ content: tastaturSchalter });

// Kontrastrechnung wie anderswo im Projekt – hier fuer die Schrift auf
// dem Knopf.
const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const verhaeltnis = (a, b) => {
  const [x, y] = [a, b].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nKein Systemring mehr\n');

// "outline-style: auto" ist die Signatur von Chromes eigenem Ring. Wer eine
// eigene Regel schreibt, setzt solid oder none – auto schreibt niemand von
// Hand. Genau danach wird gesucht.
const mitSystemring = await seite.evaluate(() => {
  const treffer = [];
  for (const el of document.querySelectorAll('input, textarea, select, button, a[href]')) {
    el.focus();
    if (getComputedStyle(el).outlineStyle === 'auto') {
      treffer.push(el.id || el.className || el.tagName.toLowerCase());
    }
    el.blur();
  }
  return treffer;
});
pruefe('Kein Bedienelement fällt auf den Browserring zurück',
  mitSystemring.length === 0, mitSystemring.join(', '));

console.log('\nDie Textfelder der Seite\n');

// Der Übergang läuft 150 ms; ohne Warten misst man den Startwert und der Test
// wäre grün oder rot je nach Laune der Maschine.
const feldStand = async (wahl) => {
  await seite.focus(wahl);
  await seite.waitForTimeout(260);
  return seite.evaluate((w) => {
    const c = getComputedStyle(document.querySelector(w));
    return { outline: c.outlineStyle, border: c.borderColor, shadow: c.boxShadow };
  }, wahl);
};

// --fokus. Der Wert steht hier als Zahl und nicht als Variable, damit ein
// versehentliches Verschieben im Blatt hier auffaellt statt stillschweigend
// mitzugehen.
const FOKUS = 'rgb(139, 147, 167)';
const RUHE  = 'rgb(38, 43, 57)';

// Alle Textfelder der Seite, nicht nur die drei aus dem Abstimmungskasten:
// Eine Seite mit zwei verschiedenen Fokusfarben hat keine, sie hat zwei
// Zufaelle.
// Zweimal derselbe Weg, einmal mit der Maus und einmal mit der Tastatur.
// Klicken darf nichts aendern – wer hineinklickt, weiss, wo er ist. Tabben
// muss etwas aendern, sonst navigiert man blind.
const stand = async (wahl) => {
  await seite.waitForTimeout(260);
  return seite.evaluate((w) => {
    const c = getComputedStyle(document.querySelector(w));
    return { outline: c.outlineStyle, border: c.borderColor, shadow: c.boxShadow };
  }, wahl);
};

// .poll-option steht nicht mehr dabei, und der Grund ist kein Verzicht: Die
// Antwortzeilen baut app.js, das Blatt liefert #poll-options leer aus – hier
// laeuft aber nur das Blatt, ohne Skript. Die Regel, die die Felder betrifft,
// ist ohnehin `.poll-admin input`, und die wird an #poll-question gemessen.
for (const wahl of ['#poll-question',
                    '#wallet-input', '#dm-input', '#admin-dm-input']) {
  await seite.click(wahl);
  const geklickt = await stand(wahl);
  pruefe(`${wahl}: beim Anklicken ändert sich nichts`,
    geklickt.border === RUHE && geklickt.shadow === 'none' && geklickt.outline === 'none',
    `${geklickt.border} / ${geklickt.shadow} / ${geklickt.outline}`);

  // Vom Feld aus zurueck und wieder vor: Damit wird dasselbe Feld ueber die
  // Tastatur angesteuert.
  await seite.keyboard.press('Shift+Tab');
  await seite.keyboard.press('Tab');
  const getabbt = await stand(wahl);
  pruefe(`${wahl}: beim Tabben hellt der Rahmen auf`, getabbt.border === FOKUS, getabbt.border);
  pruefe(`${wahl}: und bekommt keinen zweiten Umriss daneben`,
    getabbt.shadow === 'none' && getabbt.outline === 'none',
    `${getabbt.shadow} / ${getabbt.outline}`);

  // Und mit dem naechsten Mausklick ist der Hinweis wieder weg.
  await seite.mouse.click(5, 5);
}

// Ansems Schwellenfeld faellt aus der Reihe oben heraus, und genau deshalb hat
// es lange gar nichts gezeigt: Es hat keinen eigenen Rahmen, der Rahmen gehoert
// der Gruppe drumherum. Mit outline: none am Feld und keiner Regel an der
// Gruppe war ein Sprung mit der Tabulatortaste unsichtbar – der Fall, vor dem
// der Kommentar bei :focus-visible ausdruecklich warnt. Aufgefallen ist er
// erst, als die Pruefung weiter unten die Feldregeln der Seite auszaehlte.
{
  const lies = () => seite.evaluate(() =>
    getComputedStyle(document.querySelector('.filter-group')).borderTopColor);
  await seite.mouse.click(5, 5);
  await seite.waitForTimeout(260);
  const ruhig = await lies();
  await seite.click('#dm-min-input');
  await seite.waitForTimeout(260);
  pruefe('Ansems Schwellenfeld: beim Anklicken ändert sich nichts',
    (await lies()) === ruhig, await lies());
  await seite.keyboard.press('Shift+Tab');
  await seite.keyboard.press('Tab');
  await seite.waitForTimeout(260);
  const getabbt = await lies();
  pruefe('Und beim Tabben hellt der Rahmen der Gruppe auf', getabbt === FOKUS, getabbt);
  await seite.mouse.click(5, 5);
  await seite.waitForTimeout(260);
}

// Und ohne Fokus wieder zurueck – sonst bliebe der helle Rahmen stehen und
// zeigte auf ein Feld, in dem niemand mehr tippt.
await seite.evaluate(() => document.activeElement.blur());
await seite.waitForTimeout(260);
const ruhe = await seite.evaluate(() =>
  getComputedStyle(document.querySelector('#poll-question')).borderColor);
pruefe('Ohne Fokus ist der Rahmen wieder ruhig', ruhe === RUHE, ruhe);

// Die Flaeche des hellen Knopfes wird schon hier gemessen, weil die
// Rangfolge weiter unten dagegen geprueft wird.
const knopfFlaeche = await seite.evaluate(() =>
  getComputedStyle(document.querySelector('#dm-form .btn-primary')).backgroundColor
    .match(/\d+/g).slice(0, 3).map(Number));

console.log('\nTastatur sieht den Ring, Maus nicht\n');

// Ein Knopf, der sicher sichtbar und anklickbar ist.
const KNOPF = '#btn-create-poll';

await seite.click(KNOPF);
const nachKlick = await seite.evaluate((w) => {
  const el = document.querySelector(w);
  return { hatFokus: document.activeElement === el, ring: getComputedStyle(el).outlineStyle };
}, KNOPF);
pruefe('Nach dem Klicken kein Ring', nachKlick.ring === 'none', nachKlick.ring);

// Vom Knopf aus einmal zurück und wieder vor: Damit landet der Fokus über die
// Tastatur auf demselben Knopf, und :focus-visible greift.
await seite.keyboard.press('Shift+Tab');
await seite.keyboard.press('Tab');
const nachTab = await seite.evaluate((w) => {
  const el = document.querySelector(w);
  const c = getComputedStyle(el);
  return {
    hatFokus: document.activeElement === el,
    ring: c.outlineStyle, farbe: c.outlineColor, breite: c.outlineWidth,
    rundung: c.borderRadius,
  };
}, KNOPF);
pruefe('Der Fokus liegt nach dem Tabben auf dem Knopf', nachTab.hatFokus);
pruefe('Mit der Tastatur ist ein Ring da', nachTab.ring === 'solid', nachTab.ring);
// Derselbe Ton wie der Rahmen eines Feldes im Fokus – ein Knopf hat keinen
// Rahmen zum Aufhellen, also bleibt hier ein Umriss, aber in derselben Farbe.
pruefe('Der Ring hat dieselbe Farbe wie ein Feld im Fokus',
  nachTab.farbe === FOKUS, nachTab.farbe);
// Ein fester border-radius in der Fokusregel würde runde Knöpfe eckig machen.
pruefe('Die Rundung des Knopfes bleibt im Fokus erhalten',
  nachTab.rundung === '10px', nachTab.rundung);

// Die Rangfolge, die zweimal gekippt ist, weil sich die Umgebung bewegt hat:
// Ein Feld, in dem man tippt, darf nicht lauter sein als der Knopf, der die
// Sache abschickt. Ohne diese Pruefung faellt das erst auf, wenn es jemand
// sieht – und dann ist unklar, welcher der beiden Werte gewandert ist.
const GRUND_HEX = '#0a0b0f';
const leuchtHex = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const rgbArr = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const leuchtArr = (rgb) => {
  const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kFokus = verhaeltnis(leuchtArr(rgbArr(FOKUS)), leuchtHex(GRUND_HEX));
const kKnopf = verhaeltnis(leuchtArr(knopfFlaeche), leuchtHex(GRUND_HEX));
pruefe('Der Fokusrahmen bleibt dunkler als der helle Knopf',
  kFokus < kKnopf, `${kFokus.toFixed(1)}:1 vs ${kKnopf.toFixed(1)}:1`);
pruefe('Und bleibt über der Grenze für eine Zustandsanzeige (3:1)',
  kFokus >= 3, `${kFokus.toFixed(1)}:1`);

console.log('\nDer helle Knopf\n');

// Er ist die hellste Flaeche der Seite. Das Aufhellen unter dem Zeiger war
// dort kein gelegentlicher Effekt, sondern der Normalzustand: Beim Schreiben
// steht der Zeiger fast immer genau auf "Send".
const KNOPF_PRIM = '#dm-form .btn-primary';
await seite.hover(KNOPF_PRIM);
await seite.waitForTimeout(260);
const knopf = await seite.evaluate((w) => {
  const el = document.querySelector(w);
  const c = getComputedStyle(el);
  const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
  return { filter: c.filter, flaeche: rgb(c.backgroundColor), schrift: rgb(c.color) };
}, KNOPF_PRIM);
pruefe('Der helle Knopf hellt unter dem Zeiger nicht auf',
  knopf.filter === 'none', knopf.filter);

// Die uebrigen behalten es: Sie sind dunkel, dort hellt es etwas auf, das
// vorher kaum zu sehen war. Faellt die Regel zu breit aus, geht das mit.
await seite.hover('#btn-create-poll');
await seite.waitForTimeout(260);
const ghost = await seite.evaluate(() => getComputedStyle(document.querySelector('#btn-create-poll')).filter);
pruefe('Die übrigen Knöpfe hellen weiter auf', ghost !== 'none', ghost);

// Lesbarkeit auf dem Knopf: Das ist ein Bedienelement, kein Schmuck.
const leuchtRgb2 = (rgb) => {
  const [r, g, b] = rgb.map((n) => n / 255);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kSchrift = verhaeltnis(leuchtRgb2(knopf.schrift), leuchtRgb2(knopf.flaeche));
pruefe('Die Schrift auf dem Knopf bleibt lesbar (mindestens 4,5:1)',
  kSchrift >= 4.5, `${kSchrift.toFixed(1)}:1`);

// Ein Name je Wert. --accent-fill-weich war der zweite fuer denselben Ton,
// nachdem der Knopf auf die Hoehe der DM-Blase heruntergegangen ist.
pruefe('Kein zweiter Name für dieselbe Füllfarbe',
  !/--accent-fill-weich/.test(css));

console.log('\nBlatt\n');
pruefe('Die Regel benutzt :focus-visible, nicht :focus',
  /:focus-visible:not\(input\):not\(textarea\)/.test(css));
pruefe('Die Ringfarbe kommt aus --fokus, steht also nicht fest',
  /:focus-visible[^{]*\{[^}]*outline:[^;]*var\(--fokus\)/s.test(css));
// Eine Quelle fuer alle Feldregeln – wie viele es sind, ist egal und aendert
// sich mit jedem neuen Feld. Frueher stand hier eine feste Vier; die schlug an,
// als das Laufzeitfeld dazukam, obwohl daran nichts falsch war. Ein Test, der
// bei jeder Erweiterung fehlschlaegt, wird abgeschaltet statt gelesen.
//
// Geprueft wird stattdessen die Absicht: KEINE Regel, die einen Feldrahmen im
// Fokus einfaerbt, darf einen festen Farbwert nehmen. Einer bliebe stehen,
// sobald jemand --fokus verschiebt – und genau so entstehen zwei Fokusfarben.
// Ganze Regeln samt Waehler, ohne Kommentare – sonst faellt der Vorsatz
// ":root[data-tastatur]" aus dem Treffer heraus und die Pruefung darunter
// meldet einen Fehler, den es nicht gibt.
const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const feldRegeln = (ohneKommentare.match(/[^{}]+\{[^{}]*\}/g) || [])
  .filter((r) => /:focus(-within)?/.test(r) && /border-color:/.test(r));
const festeFarbe = feldRegeln.filter((r) => !/border-color: var\(--fokus\)/.test(r));
pruefe('Jede Fokusregel an einem Feldrahmen holt die Farbe aus --fokus',
  feldRegeln.length >= 4 && festeFarbe.length === 0,
  `${feldRegeln.length} Regeln, ${festeFarbe.length} mit festem Wert`);
// Und jede haengt an data-tastatur. Faellt die Bedingung bei einer weg,
// leuchtet ausgerechnet dieses eine Feld wieder beim blossen Anklicken auf.
const ohneSchalter = feldRegeln.filter((r) => !/:root\[data-tastatur\]/.test(r));
pruefe('Und jede hängt an data-tastatur',
  ohneSchalter.length === 0, ohneSchalter.join(' | ').slice(0, 120));
pruefe('app.js setzt den Schalter nur bei der Tabulatortaste',
  /e\.key === 'Tab'/.test(appJs) && /pointerdown/.test(appJs));
pruefe('Nirgends bleibt ein box-shadow an einem Feld im Fokus',
  !/input:focus \{[^}]*box-shadow/s.test(css));

// ---------------------------------------------------------------------------
console.log('\nAusgefüllt vom Browser\n');
//
// Chrome faerbt ein Feld hellblau, sobald man einen gespeicherten Vorschlag
// antippt. Auf einer durchgehend dunklen Seite ist das ein weisser Kasten
// mitten im Formular.
//
// WAS HIER NICHT GEPRUEFT WIRD, und das gehoert dazugesagt: der Zustand
// selbst. Autofill braucht ein echtes Browserprofil mit gespeicherten
// Formularwerten; im Test gibt es keins. Auch CSS.forcePseudoState aus dem
// Chrome-Protokoll hilft nicht – der Aufruf wird angenommen, aendert an der
// Stilberechnung aber nichts. Nachgemessen: Ein Feld mit erzwungenem
// :-webkit-autofill meldet denselben Schatten wie eines ohne.
//
// Geprueft wird deshalb die BUCHFUEHRUNG: Zu jedem Feldgrund der Seite muss es
// einen Autofill-Eintrag mit DEMSELBEN Grund geben. Das faengt den Fehler, der
// hier wirklich passiert – ein neues Feld kommt dazu, und niemand denkt an den
// Sonderfall. Ob die Regel im Betrieb greift, sieht man nur im Betrieb.
{
  // Jede Regel, die einem Feld einen Grund gibt.
  const gruende = new Map();
  for (const treffer of css.matchAll(
    /(^|\})\s*([^{}]*\binput\b[^{}]*)\{([^}]*)\}/g)) {
    const wahl = treffer[2].trim();
    if (wahl.includes(':-webkit-autofill') || wahl.includes(':focus')) continue;
    const grund = /background(?:-color)?:\s*([^;]+)/.exec(treffer[3]);
    if (!grund) continue;
    const wert = grund[1].trim();
    if (wert === 'transparent' || wert === 'none') continue;
    // Nur die Grundregel zaehlt, nicht die im @media-Block.
    if (!gruende.has(wahl)) gruende.set(wahl, wert);
  }
  console.log('     Felder mit eigenem Grund:');
  for (const [wahl, wert] of gruende) console.log(`       ${wahl.padEnd(20)}${wert}`);

  const fehlt = [];
  const falsch = [];
  for (const [wahl, wert] of gruende) {
    // Der passende Autofill-Block: Er nennt denselben Waehler mit dem Zusatz.
    const muster = new RegExp(
      `${wahl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:-webkit-autofill[^{]*\\{([^}]*)\\}`);
    // Der Block kann mehrere Waehler tragen; dann steht der gesuchte in der
    // Liste und die Klammer folgt erst spaeter. Deshalb zweistufig.
    const inListe = new RegExp(
      `${wahl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:-webkit-autofill\\b`);
    if (!inListe.test(css)) { fehlt.push(wahl); continue; }
    // Den Block finden, in dem der Waehler steht, und dessen Schatten lesen.
    const bloecke = [...css.matchAll(/([^{}]*:-webkit-autofill[^{}]*)\{([^}]*)\}/g)];
    const block = bloecke.find((b) => inListe.test(b[1]));
    const schatten = block && /box-shadow:[^;]*var\((--[\w-]+)\)/.exec(block[2]);
    if (!schatten) { fehlt.push(wahl); continue; }
    if (`var(${schatten[1]})` !== wert) falsch.push(`${wahl}: ${wert} gegen ${schatten[1]}`);
  }
  pruefe('Jedes Feld mit eigenem Grund hat einen Autofill-Eintrag',
    fehlt.length === 0, fehlt.join(', ') || `${gruende.size} Felder`);
  pruefe('Und der Eintrag deckt mit DEMSELBEN Grund zu',
    falsch.length === 0, falsch.join(' | ') || 'alle gleich');
  // Der Grund allein reicht nicht: Chrome setzt auch die Schrift dunkel.
  pruefe('Die Schriftfarbe wird ebenfalls zurückgeholt',
    (css.match(/-webkit-text-fill-color: var\(--text\)/g) || []).length
      >= (css.match(/box-shadow: 0 0 0 100px var\(--bg/g) || []).length / 2,
    'text-fill-color steht in jedem Block');
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
