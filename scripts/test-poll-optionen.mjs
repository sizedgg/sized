// ============================================================================
// Prüft die Antwortfelder im "New poll"-Kasten.
//
// Es gab hier zwei Knöpfe, "+ Option" und "− Option". Der zweite ist weg, und
// an seine Stelle tritt ein Wort im Platzhalter: Ab der dritten Antwort steht
// dort "Option 3 [optional]".
//
// Eckige Klammern und keine runden, und das ist keine Geschmacksfrage: In der
// Schreibmaschinenschrift belegt jedes Zeichen dieselbe Zelle. Eine runde
// Klammer ist ein schmales Zeichen darin – gemessen 4 px Glyphe in 9 px Zelle
// –, und "(optional)" sieht deshalb aus wie "( optional )", obwohl im Text kein
// Leerzeichen steht. Die eckige füllt ihre Zelle fast ganz aus.
//
// Der Grund gehört in diesen Test, weil er die Hälfte der Prüfungen erklärt:
// Ein leeres Feld war noch nie eine Antwort – beim Anlegen fällt es durch den
// filter(Boolean) heraus, ob es nun dasteht oder nicht. Der Minusknopf räumte
// also etwas auf, das ohnehin folgenlos war, und sah dabei aus, als müsste man
// aufräumen. Das Wort sagt stattdessen etwas, das der Knopf nie gesagt hat:
// dass die ersten beiden Felder NICHT optional sind.
//
// Dazu kommt seit neuestem die Zeichengrenze mit ihrem Zähler rechts im Feld.
// Warum sie bei 100 und 60 liegt, steht nicht hier, sondern in
// test-poll-bild.mjs: Die Zahlen sind an der Karte gemessen, die nach draußen
// geht. Hier wird nur geprüft, dass sie im Formular gilt und dass man sie
// kommen sieht – maxlength allein ist eine Tastatur, die irgendwann stumm
// nicht mehr reagiert, und die hält man für kaputt, bevor man an eine Grenze
// denkt.
//
// Was bleibt, sind die Ränder:
//
//   * Bei MAX_OPTIONEN Feldern darf es kein Plus mehr geben. Die Zahl steht
//     nicht in diesem Test, sondern wird aus app.js gelesen – warum sie 4 ist,
//     steht dort und in der Migration: Bis vier Antworten bleibt das gepostete
//     Bild in 16:9 und wird von X nicht beschnitten, ab fünf nicht mehr.
//     Und das Plus muss VERSCHWINDEN, nicht nur wirkungslos sein: Ein Knopf,
//     der dasteht und nichts tut, lässt einen an der Seite zweifeln, nicht am
//     eigenen Klick.
//   * Der Platzhalter muss ab dem dritten Feld gelten, und zwar an allen drei
//     Stellen, an denen so ein Feld entsteht: im Blatt, beim Hinzufügen und
//     beim Zurücksetzen nach dem Anlegen.
//
//   node scripts/test-poll-optionen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Wörtlich aus app.js – eine nachgebaute Kopie würde den Test bestehen,
// während die echte Fassung kaputt ist.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const knoepfe = schneide('const MIN_OPTIONEN =', '\n/**\n * Der Anlegekasten');
const esc = schneide('const esc =', '\n\n');

// Der Kasten aus dem echten Blatt, nicht nachgebaut: So faellt auf, wenn dort
// ein Knopf umbenannt oder verschoben wird.
const kasten = /<div id="poll-admin"[\s\S]*?\n {4}<\/div>/.exec(html);
if (!kasten) throw new Error('poll-admin nicht in index.html gefunden');

/**
 * Den Kasten aufgeklappt ausliefern.
 *
 * Er ist seit der Aufraeumaktion im Polls-Tab standardmaessig ZU – eine Zeile
 * statt fuenf, weil Ansem ihn sonst immer vor der Liste haette. Hier geht es
 * aber um die Knoepfe darin, also um den offenen Zustand; zugeklappt sind sie
 * unsichtbar, und Playwright wartet dann bis zur Zeitgrenze auf einen Klick,
 * der nie ankommt.
 *
 * Beide Stellen muessen umgestellt werden – die Klasse am Kasten steuert das
 * Blatt, das hidden am Feldblock den Inhalt.
 */
const aufgeklappt = (s) => s
  .replace('class="poll-admin" hidden', 'class="poll-admin offen"')
  .replace('id="poll-admin-felder" hidden', 'id="poll-admin-felder"');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
           <body><div class="pane">${aufgeklappt(kasten[0])}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

await seite.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    // esc() steht weiter oben in app.js, bei den Formatierern. Ohne sie wirft
    // optionFeld(), der Klick tut nichts, und der Test meldet "kein Feld
    // dazugekommen" – ein Befund ueber sich selbst statt ueber die Seite.
    ${esc}
    ${knoepfe}
    window.renderOptionKnoepfe = renderOptionKnoepfe;
    window.optionPlatzhalter = optionPlatzhalter;
    window.anzahl = () => document.querySelectorAll('.poll-option').length;
    window.sichtbar = (id) => !document.querySelector(id).hidden;
  `,
});

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

const stand = () => seite.evaluate(() => ({
  n: window.anzahl(),
  plus: window.sichtbar('#btn-add-option'),
  platzhalter: [...document.querySelectorAll('.poll-option')].map((i) => i.placeholder),
}));
/** Ab dem dritten Feld muss "(optional)" dranstehen, davor nicht. */
const platzhalterStimmen = (liste) =>
  liste.every((t, i) => (i < 2 ? t === `Option ${i + 1}` : t === `Option ${i + 1} [optional]`));

console.log('\nAntwortfelder im "New poll"-Kasten\n');

// --- 1. Ausgangslage -------------------------------------------------------
let s = await stand();
pruefe('Startet mit zwei Feldern', s.n === 2, String(s.n));
pruefe('Bei zwei Feldern gibt es ein Plus', s.plus);
// Die beiden Pflichtfelder tragen KEIN "(optional)" – sonst hiesse es, man
// koenne eine Abstimmung mit null Antworten anlegen.
pruefe('Die ersten beiden sind nicht als optional beschriftet',
  platzhalterStimmen(s.platzhalter), s.platzhalter.join(' | '));

// --- 2. Eine dritte Antwort ------------------------------------------------
await seite.click('#btn-add-option');
s = await stand();
pruefe('Plus legt ein Feld an', s.n === 3, String(s.n));
pruefe('Und das dritte ist als optional beschriftet',
  platzhalterStimmen(s.platzhalter), s.platzhalter.join(' | '));

// --- 3. Kein Gegenknopf mehr ----------------------------------------------
// Ausdruecklich geprueft und nicht nur weggelassen: Wer ihn wieder einbaut,
// soll hier darueber stolpern und den Grund im Kopf dieses Tests finden.
pruefe('Es gibt keinen "− Option"-Knopf mehr',
  !/id="btn-remove-option"/.test(html) && !/btn-remove-option/.test(appJs));

// --- 4. Ein leeres Feld ist keine Antwort ----------------------------------
// Das ist der eigentliche Grund, warum der Minusknopf entbehrlich war. Geprueft
// wird die Zeile, die es entscheidet – nicht ihre Wirkung im Browser, denn dort
// haengt sie an der Datenbank.
pruefe('Leere Felder fallen beim Anlegen heraus',
  /\$\$\('\.poll-option'\)\.map\(\(i\) => i\.value\.trim\(\)\)\.filter\(Boolean\)/.test(appJs));
// Und die Untergrenze steht an EINER Stelle, nicht als 2 daneben.
pruefe('Die Untergrenze kommt aus MIN_OPTIONEN',
  /options\.length < MIN_OPTIONEN/.test(appJs));

// --- 5. Die Obergrenze -----------------------------------------------------
// Die Zahl kommt aus app.js und steht nicht doppelt hier: Sonst prueft der Test
// seine eigene Kopie und bleibt gruen, wenn jemand die Grenze verschiebt.
const MAX_OPTIONEN = (() => {
  const m = /const MAX_OPTIONEN = (\d+);/.exec(appJs);
  if (!m) throw new Error('MAX_OPTIONEN nicht in app.js gefunden');
  return Number(m[1]);
})();
// Wo "Start poll" steht, SOLANGE das Plus noch da ist.
const rechterRand = () => seite.evaluate(() =>
  document.querySelector('#btn-create-poll').getBoundingClientRect().right);
const startVorher = await rechterRand();

// Solange klicken, wie das Plus da ist – ein paar Mal mehr als noetig, damit
// ein kaputter Zaehler den Test nicht ewig laufen laesst.
for (let i = 0; i < MAX_OPTIONEN + 4; i++) {
  if (!(await seite.evaluate(() => window.sichtbar('#btn-add-option')))) break;
  await seite.click('#btn-add-option');
}
s = await stand();
const startNachher = await rechterRand();
pruefe(`Mehr als ${MAX_OPTIONEN} Felder gibt es nicht`, s.n === MAX_OPTIONEN, String(s.n));
pruefe(`Bei ${MAX_OPTIONEN} Feldern verschwindet das Plus`, !s.plus);
pruefe('Und alle zusätzlichen sind als optional beschriftet',
  platzhalterStimmen(s.platzhalter), s.platzhalter.slice(-2).join(' | '));
// "Start poll" darf dabei NICHT wandern.
//
// Das ist kein Schoenheitsfehler, sondern der unangenehmste Zeitpunkt fuer eine
// Bewegung: Beim Anlegen der letzten erlaubten Antwort verschwindet das Plus –
// und genau dann greift man nach "Start poll". Springt der Knopf in diesem
// Moment quer durch die Zeile, klickt man ins Leere.
//
// Verursacht haette es justify-content: space-between: Mit nur noch einem Kind
// steht das eine Kind links. Gemessen wird deshalb die POSITION vor und nach
// dem Verschwinden, nicht die CSS-Regel – jede andere Ursache faellt damit
// genauso auf.
pruefe('"Start poll" steht am rechten Rand, auch wenn das Plus verschwindet',
  Math.abs(startVorher - startNachher) < 1,
  `${Math.round(startVorher)} px → ${Math.round(startNachher)} px`);
// Gegenprobe: Ohne die Regel waere der Knopf gewandert. Sonst koennte hier eine
// Messung stehen, die gar nichts sieht.
{
  const gewandert = await seite.evaluate(() => {
    const reihe = document.querySelector('.row');
    const knopf = document.querySelector('#btn-create-poll');
    const vorher = knopf.getBoundingClientRect().right;
    // Den Zustand nachstellen, den die Regel verhindert.
    knopf.style.marginLeft = '0';
    reihe.style.justifyContent = 'space-between';
    const nachher = knopf.getBoundingClientRect().right;
    knopf.style.marginLeft = '';
    reihe.style.justifyContent = '';
    return Math.abs(vorher - nachher);
  });
  pruefe('Gegenprobe: ohne die Regel wandert er wirklich',
    gewandert > 50, `${Math.round(gewandert)} px Unterschied`);
}

// Und die Datenbank muss dieselbe Zahl durchsetzen – das Formular ist der
// Browser, und der Browser ist der Teil, den man umgehen kann.
const anzahlMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830020000_antwortzahl.sql'), 'utf8');
pruefe('Dieselbe Grenze steht als Trigger in der Datenbank',
  new RegExp(`having count\\(\\*\\) > ${MAX_OPTIONEN}`).test(anzahlMigration)
  && /create or replace trigger trg_poll_options_anzahl/.test(anzahlMigration));

// --- 6. Nach dem Anlegen einer Abstimmung ----------------------------------
// Der Kasten wird zurueckgesetzt: Werte leeren, zusaetzliche Felder entfernen.
// Genau die Zeilen aus btn-create-poll, nachgestellt.
//
// Die Stelle ist heikler als sie aussieht: Bleibt hier ein Feld stehen, das
// einmal "Option 5 (optional)" hiess, steht "(optional)" hinterher an einem
// der beiden Pflichtfelder.
await seite.evaluate(() => {
  document.querySelectorAll('#poll-options > .zaehl-feld').forEach((kasten, idx) => {
    const feld = kasten.querySelector('.poll-option');
    if (idx >= 2) { kasten.remove(); return; }
    feld.value = '';
    feld.dispatchEvent(new Event('input'));
  });
  document.querySelector('#poll-question').value = '';
  document.querySelector('#poll-question').dispatchEvent(new Event('input'));
  window.renderOptionKnoepfe();
});
s = await stand();
pruefe('Nach dem Zuruecksetzen stehen wieder zwei Felder', s.n === 2, String(s.n));
pruefe('Das Plus ist da', s.plus);
pruefe('Und die Platzhalter stehen wieder richtig',
  platzhalterStimmen(s.platzhalter), s.platzhalter.join(' | '));
// Entfernt wird der KASTEN, nicht nur das Feld darin – sonst bliebe ein
// "0 / 60" ohne Feld darunter stehen.
pruefe('Und es bleibt kein Zähler ohne Feld zurück',
  await seite.evaluate(() =>
    document.querySelectorAll('.zaehler').length
      === document.querySelectorAll('.zaehl-feld > input').length));

// --- 7. Die Klammern ------------------------------------------------------
//
// Hier standen fuenf Pruefungen ueber eine zweite Beschriftung, die ueber dem
// Feld lag und in der die runden Klammern eine eigene, schmalere Zelle bekamen.
// Sie ist wieder raus: Ein Zeichen zu tauschen tut dasselbe und kostet nichts.
//
// Geprueft wird deshalb nur noch das Zeichen selbst – und zwar, weil es leicht
// als Geschmacksfrage zurueckgedreht wird. Es ist keine.
// Gesucht wird die Zeichenkette, die WIRKLICH ins Feld geht – nicht irgendein
// "(optional)" irgendwo in der Datei. Der Kommentar direkt darueber erklaert,
// warum es die runden nicht sind, und enthaelt sie deshalb selbst; ein Test,
// der die ganze Datei absucht, schlaegt daran an und meldet einen Fehler, den
// es nicht gibt.
const gesetzt = (appJs.match(/`Option \$\{nr\}[^`]*`/g) || []);
pruefe('Es sind eckige Klammern, keine runden',
  gesetzt.some((t) => t.includes('[optional]'))
  && !gesetzt.some((t) => t.includes('(optional)')),
  gesetzt.join(' , ') || 'nichts gefunden');

// --- 8. Die Zeichengrenze ---------------------------------------------------
//
// Warum die Zahlen 100 und 60 sind, steht in test-poll-bild.mjs: Sie sind an
// der Karte gemessen, die nach draussen geht. Hier geht es nur um das
// Formular – darum, dass die Grenze DA ist und dass man sie kommen sieht.
//
// Der Zaehler ist der eigentliche Punkt. maxlength allein ist eine Tastatur,
// die irgendwann stumm nicht mehr reagiert; man haelt sie fuer kaputt, bevor
// man an eine Grenze denkt.
console.log('\nDie Zeichengrenze in den Feldern\n');

const grenzeAus = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(appJs);
  if (!m) throw new Error(`${name} nicht in app.js gefunden`);
  return Number(m[1]);
};
const MAX_FRAGE = grenzeAus('MAX_FRAGE');
const MAX_ANTWORT = grenzeAus('MAX_ANTWORT');

const feldStand = (wahl) => seite.evaluate((w) => {
  const feld = document.querySelector(w);
  const kasten = feld.closest('.zaehl-feld');
  const zaehler = kasten.querySelector('.zaehler');
  return {
    max: feld.maxLength,
    text: zaehler.textContent,
    knapp: kasten.classList.contains('ist-knapp'),
    voll: kasten.classList.contains('ist-voll'),
    sichtbar: getComputedStyle(zaehler).visibility === 'visible',
    farbe: getComputedStyle(zaehler).color,
    // Der Platz rechts muss IMMER frei sein, auch wenn die Zahl gerade nicht
    // dasteht. Sonst spraenge der Text unter dem Zeiger weg, sobald man das
    // Feld betritt.
    platzRechts: parseFloat(getComputedStyle(feld).paddingRight),
  };
}, wahl);

const tippe = (wahl, text) => seite.evaluate(([w, t]) => {
  const feld = document.querySelector(w);
  feld.value = t.slice(0, feld.maxLength);
  feld.dispatchEvent(new Event('input'));
}, [wahl, text]);

for (const [wahl, max, name] of [
  ['#poll-question', MAX_FRAGE, 'Die Frage'],
  ['.poll-option', MAX_ANTWORT, 'Eine Antwort'],
]) {
  let f = await feldStand(wahl);
  pruefe(`${name}: maxlength steht auf ${max}`, f.max === max, String(f.max));
  pruefe(`${name}: der Zähler steht auf 0 / ${max}`, f.text === `0 / ${max}`, f.text);
  // Leer und unberuehrt: still. Zehn Felder mit zehn Zahlen daneben waeren
  // Zahlensalat neben lauter leeren Feldern.
  pruefe(`${name}: im leeren Feld ist er unsichtbar`, !f.sichtbar);
  pruefe(`${name}: der Platz rechts ist trotzdem frei`,
    f.platzRechts > 60, `${f.platzRechts} px`);

  await tippe(wahl, 'x'.repeat(max - 20));
  f = await feldStand(wahl);
  pruefe(`${name}: bei ${max - 20} Zeichen ist noch nichts knapp`, !f.knapp && !f.voll);

  // Knapp heisst: die letzten zehn Zeichen. Und ab da ist die Zahl auch OHNE
  // Fokus zu sehen – wer einen langen Text hineinkopiert und wegklickt, soll
  // nicht noch einmal hineinklicken muessen, um es zu merken.
  await tippe(wahl, 'x'.repeat(max - 10));
  f = await feldStand(wahl);
  pruefe(`${name}: bei zehn übrigen Zeichen wird es knapp`, f.knapp && !f.voll);
  pruefe(`${name}: und der Zähler ist ab da auch ohne Fokus zu sehen`, f.sichtbar);

  const knappFarbe = f.farbe;
  await tippe(wahl, 'x'.repeat(max + 50));
  f = await feldStand(wahl);
  pruefe(`${name}: mehr als ${max} Zeichen gehen nicht hinein`,
    f.text === `${max} / ${max}`, f.text);
  pruefe(`${name}: und das Feld ist als voll gekennzeichnet`, f.voll);
  pruefe(`${name}: die Zahl wechselt dabei die Farbe`,
    f.farbe !== knappFarbe, `${knappFarbe} → ${f.farbe}`);

  await tippe(wahl, '');
}

// Gegenprobe: Der Zaehler haengt wirklich am Feld und ist nicht nur ein
// Stueck Markup, das zufaellig die richtige Zahl trug.
{
  await tippe('#poll-question', 'abc');
  const f = await feldStand('#poll-question');
  pruefe('Gegenprobe: der Zähler folgt dem Feld', f.text === `3 / ${MAX_FRAGE}`, f.text);
  await tippe('#poll-question', '');
}

// Und die Grenze muss auch in der Datenbank stehen. Der Browser ist der Teil,
// den man umgehen kann; PostgREST nimmt jeden insert an, der durch die
// Zeilenregeln kommt.
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830010000_laengen.sql'), 'utf8');
pruefe('Dieselbe Grenze steht in der Datenbank – für die Frage',
  new RegExp(`btrim\\(question\\)\\) between 1 and ${MAX_FRAGE}`).test(migration));
pruefe('Und für die Antworten',
  new RegExp(`btrim\\(label\\)\\) between 1 and ${MAX_ANTWORT}`).test(migration));

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
