// ============================================================================
// Die Reiter in der Kopfzeile stehen still.
//
// ----------------------------------------------------------------------------
// Der Fehler, der diesen Test ausgelöst hat
//
// Die Kopfzeile war eine Flex-Zeile, und .tabs hatte margin-inline: auto. Das
// zentriert einen Flex-Eintrag aber nicht im Kasten, sondern im RESTPLATZ
// zwischen seinen Nachbarn. Die Reiter sassen damit auf der Mitte zwischen der
// Marke links und dem Block rechts – und die wandert, sobald einer der beiden
// breiter wird.
//
// Aufgefallen ist es beim Wechsel zwischen Ansem und einem normalen Nutzer:
// Profilbild und "$12.4M" gegen drei Zeichen und "$153" sind zwei verschiedene
// Breiten rechts. Gemessen lagen die Reiter 11 px auseinander.
//
// Der Unterschied ist inzwischen viel groesser geworden, und damit auch der
// Wert dieser Pruefung: Bei allen ausser Ansem steht oben rechts nicht mehr
// das Kuerzel, sondern die eigene Adresse als "EMwU…QLxP" – neun Zeichen statt
// drei. Ansem hat dort weiter sein Bild. Zwischen den beiden Rollen liegen
// jetzt rund 50 px Breite.
//
// Der schlimmere Fall stand daneben und ist niemandem aufgefallen: Der Betrag
// rechts wird jede Minute nachgezogen. Aus "$153" wird "$1.2K", und die Reiter
// rutschten um 4,5 px – ohne dass jemand etwas angefasst hätte. Ein Knopf, der
// unter dem Finger wegwandert, weil sich anderswo eine Zahl geändert hat.
//
// ----------------------------------------------------------------------------
// Was hier geprüft wird
//
// Nicht "display: grid steht im Blatt", sondern die Aussage dahinter: Die
// Reiter liegen auf der Mitte der Kopfzeile, und zwar unabhängig davon, wer
// angemeldet ist und wie breit sein Bestand gerade ist. Das hält auch dann
// noch, wenn jemand den Weg dorthin anders löst.
//
// Auf dem Handy gilt etwas anderes und wird deshalb auch anders geprüft: Dort
// bricht die Kopfzeile um, die Reiter liegen als eigene Zeile darunter und
// nehmen die volle Breite. "Mittig" ist dort keine sinnvolle Frage – "gleich
// breit und an derselben Stelle" schon.
//
//   node scripts/test-kopfzeile.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oeffentlich = path.join(root, 'public');
const appJs = fs.readFileSync(path.join(oeffentlich, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(oeffentlich, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(oeffentlich, 'styles.css'), 'utf8');

// Name und Farbton woertlich aus app.js. Ein Nachbau hier wuerde die eigene
// Fassung pruefen – und der Farbton haengt an einer Streuwertrechnung ueber
// die volle Adresse, die man nicht zweimal richtig hinschreibt.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b + bis.length);
};
const kennungCode = schneide('const HANDLE_TONES', '\n')
  + schneide('const handleOf =', '\n')
  + schneide('function toneOf(wallet) {', '\n}');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(oeffentlich, pfad);
  if (!datei.startsWith(oeffentlich) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) {
    return res.writeHead(404).end('');
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

// Die Kopfzeile wird von Hand in den Zustand gesetzt, den renderMe() im
// Betrieb herstellt – ohne Anmeldung gibt es sie sonst gar nicht zu sehen.
// Wichtig ist, dass die BREITEN stimmen: das Profilbild gegen drei Zeichen und
// ein langer Betrag gegen einen kurzen. Genau die haben die Reiter verschoben.
// Eine Adresse, die so lang ist wie eine echte: Der Farbton wird ueber die
// VOLLE Adresse gerechnet, nicht ueber die drei Zeichen. Mit einem kurzen
// Platzhalter misst man einen Ton, den es im Betrieb nicht gaebe.
const ADRESSE = 'EMwUZ7s9Kk3zR2xTvN8aQ1cLmP4dHjYbXfGwQLxP';

const messen = async (rolle, betrag, breite, adresse = ADRESSE) => {
  const seite = await browser.newPage({ viewport: { width: breite, height: 200 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({ content: `${kennungCode}\nwindow.handleOf = handleOf; window.toneOf = toneOf;` });
  await seite.waitForTimeout(250);
  const r = await seite.evaluate(([istAnsem, geld, adresse]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    // Genau die beiden Formen, die renderMe() baut. Das ganze Element wird
    // getauscht und nicht nur sein Inhalt: Ansem bekommt sein Bild, alle
    // anderen ihre drei Zeichen in ihrer eigenen Farbe.
    document.querySelector('#me-handle').outerHTML = istAnsem
      ? '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
        + '<span class="kuerzel">4bo</span></span>'
      : `<span id="me-handle" class="handle h t${window.toneOf(adresse)}"`
        + `>${window.handleOf(adresse)}</span>`;
    // Genau wie renderMe(): Bei Ansem steht oben rechts kein Betrag.
    const h = document.querySelector('#me-holdings');
    h.hidden = istAnsem;
    if (!istAnsem) h.textContent = geld;
    document.querySelector('[data-tab="dms"]').classList.toggle('zeigt-s', istAnsem);
    const kopf = document.querySelector('.topbar').getBoundingClientRect();
    const tabs = document.querySelector('.tabs').getBoundingClientRect();
    const erster = document.querySelector('[data-tab="polls"]').getBoundingClientRect();
    const kennung = document.querySelector('#me-handle');
    return {
      kopfMitte: kopf.left + kopf.width / 2,
      tabsMitte: tabs.left + tabs.width / 2,
      tabsOben: Math.round(tabs.top),
      ersterLinks: Math.round(erster.left * 10) / 10,
      tabsBreite: Math.round(tabs.width),
      kennungText: kennung.textContent,
      kennungFarbe: getComputedStyle(kennung).color,
      betragFarbe: getComputedStyle(document.querySelector('#me-holdings')).color,
      betragDa: !document.querySelector('#me-holdings').hidden,
      kennungTag: kennung.tagName.toLowerCase(),
      rechtsBreite: Math.round(document.querySelector('.me').getBoundingClientRect().width),
    };
  }, [rolle === 'ansem', betrag, adresse]);
  await seite.close();
  return r;
};

console.log('\nAm Rechner: die Reiter liegen auf der Mitte\n');

const faelle = [
  ['ansem', '$12.4M'],
  ['nutzer', '$153'],
  ['nutzer', '$1.2K'],
  ['nutzer', '<$1'],
];
const gemessen = [];
for (const [rolle, betrag] of faelle) {
  const r = await messen(rolle, betrag, 1000);
  gemessen.push({ rolle, betrag, ...r });
  const ab = Math.abs(r.tabsMitte - r.kopfMitte);
  pruefe(`${rolle} mit ${betrag}`, ab <= 1,
    `Mitte der Reiter ${r.tabsMitte.toFixed(1)}, Mitte der Kopfzeile ${r.kopfMitte.toFixed(1)}`);
}

// Und die Aussage, um die es eigentlich geht: zwischen den Faellen bewegt sich
// nichts. Die Einzelpruefungen oben koennten alle "mittig" melden und die
// Reiter trotzdem verschieden breit sein – gleich waere dann die Mitte, nicht
// die Lage.
const mitten = gemessen.map((g) => g.tabsMitte);
pruefe('Die Mitte ist in allen Fällen dieselbe',
  Math.max(...mitten) - Math.min(...mitten) <= 1,
  mitten.map((m) => m.toFixed(1)).join(' / '));

// Fuer denselben Nutzer darf sich gar nichts bewegen, auch nicht die linke
// Kante: Sein Bestand aendert sich jede Minute von selbst.
const nurNutzer = gemessen.filter((g) => g.rolle === 'nutzer');
const kanten = nurNutzer.map((g) => g.ersterLinks);
pruefe('Für denselben Nutzer bewegt sich auch die linke Kante nicht',
  Math.max(...kanten) - Math.min(...kanten) <= 0.5,
  kanten.join(' / ') + ' px');

// Zwischen Ansem und einem Nutzer wird die Gruppe SCHMALER – und bleibt dabei
// mittig.
//
// Hier stand das Gegenteil: "auch nicht um die Breite des s". Das "s" war
// deshalb nur unsichtbar gemacht, sein Platz blieb stehen. Der Preis dafuer
// war ein Fehler, der bei jedem Nutzer in jedem Moment sichtbar ist, in dem
// der Reiter ausgewaehlt ist: Rahmen und Flaeche waren fuer "DMs" bemessen,
// die Schrift darin hiess "DM" – eine Zellenbreite Luft rechts, keine links.
//
// Getauscht wurde also ein Fehler, den JEDER sieht, gegen einen, den NIEMAND
// sieht: Der Versatz faellt nur auf, wenn man zwei Bildschirme nebeneinander
// legt, denn keine Person sieht beide Rollen.
//
// Was dabei NICHT verhandelbar war und deshalb weiter oben schon geprueft
// wird: Die Mitte der Gruppe muss in allen Faellen dieselbe bleiben. Sie tut
// es, weil die Kopfzeile ein Raster ist (1fr auto 1fr) – die Gruppe wird
// schmaler, statt zu wandern.
const ansem = gemessen.find((g) => g.rolle === 'ansem');
const schmaler = ansem.tabsBreite - nurNutzer[0].tabsBreite;
pruefe('Ohne das "s" ist die Reitergruppe schmaler',
  schmaler > 0, `${ansem.tabsBreite} px / ${nurNutzer[0].tabsBreite} px`);
// Und zwar um GENAU ein Zeichen. Mehr hiesse, dass noch etwas anderes
// mitgegangen ist – ein Innenabstand, ein Zwischenraum.
{
  const zelle = await (async () => {
    const seite = await browser.newPage({ viewport: { width: 1000, height: 200 } });
    await seite.goto(`http://127.0.0.1:${server.address().port}/`);
    const b = await seite.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute; font-family: var(--mono); font-size: 1rem;';
      probe.textContent = 's'.repeat(20);
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 20;
      probe.remove();
      return w;
    });
    await seite.close();
    return b;
  })();
  pruefe('Und zwar um genau eine Zeichenbreite',
    Math.abs(schmaler - zelle) <= 1.5,
    `${schmaler} px Unterschied, eine Zelle ist ${zelle.toFixed(1)} px`);
}
// Die eigentliche Aussage: Das "s" ist WEG und nicht nur unsichtbar. Ein
// visibility: hidden saehe im Bild genauso aus und liesse den Platz stehen –
// also genau den Fehler, um den es hier geht.
pruefe('Das "s" nimmt seinen Platz mit, statt nur unsichtbar zu sein',
  /\.dm-s \{ display: none; \}/.test(css)
  && !/\.dm-s \{ visibility: hidden; \}/.test(css));

console.log('\nGegenprobe: Der Test sieht den alten Fehler auch\n');
{
  const seite = await browser.newPage({ viewport: { width: 1000, height: 200 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({ content: `${kennungCode}\nwindow.handleOf = handleOf; window.toneOf = toneOf;` });
  // Genau der alte Aufbau: Flex-Zeile, Reiter über margin-inline zentriert.
  await seite.addStyleTag({ content: '.topbar { display: flex; } .tabs { margin-inline: auto; }' });
  const lage = async (istAnsem, geld) => seite.evaluate(([a, g, adresse]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    document.querySelector('#me-handle').outerHTML = a
      ? '<span id="me-handle" class="handle h admin-name">'
        + '<span class="kuerzel">4bo</span></span>'
      : `<span id="me-handle" class="handle h t${window.toneOf(adresse)}"`
        + `>${window.handleOf(adresse)}</span>`;
    const h = document.querySelector('#me-holdings');
    h.hidden = a;
    if (!a) h.textContent = g;
    document.querySelector('[data-tab="dms"]').classList.toggle('zeigt-s', a);
    const t = document.querySelector('.tabs').getBoundingClientRect();
    return t.left + t.width / 2;
  }, [istAnsem, geld, ADRESSE]);
  const a1 = await lage(true, '$12.4M');
  const n1 = await lage(false, '$153');
  const n2 = await lage(false, '$1.2K');
  await seite.close();
  pruefe('Ohne das Raster wandern die Reiter – der Test würde anschlagen',
    Math.abs(a1 - n1) > 1 || Math.abs(n1 - n2) > 1,
    `Ansem ${a1.toFixed(1)}, Nutzer ${n1.toFixed(1)}, derselbe Nutzer eine Minute später ${n2.toFixed(1)}`);
}

console.log('\nWas oben rechts steht\n');
//
// Zwei verschiedene Auskuenfte, und der Unterschied ist nicht Geschmack:
//
//   Die drei Zeichen sind der NAME, unter dem jemand hier auftritt. Sie stehen
//   neben seinen Nachrichten, im Zitat und im Posteingang – ueberall dieselben
//   drei Zeichen in derselben Farbe.
//
// Hier stand eine Runde lang die gekuerzte Adresse (EMwU…QLxP) mit dem
// Argument: Oben rechts sei die Frage nicht "wer bin ich", sondern "mit
// welcher Wallet bin ich hier". Das Argument stimmt und reicht trotzdem nicht:
// Wer sich selbst oben rechts unter einem anderen Namen sieht als neben seinen
// eigenen Nachrichten, sieht sich unter zwei Namen.
//
// Die Farbe traegt die Auskunft mit. Sie wird aus der VOLLEN Adresse
// gerechnet, ist also fuer jede Wallet eine andere – auch fuer zwei mit
// denselben drei Zeichen. Genau dafuer gibt es sie.
{
  const nutzer = gemessen.find((g) => g.rolle === 'nutzer');
  pruefe('Bei einem Nutzer stehen dort seine drei Zeichen',
    nutzer.kennungText === ADRESSE.slice(0, 3), nutzer.kennungText);

  // Dieselbe Farbe wie ueberall sonst, und geprueft wird das gegen die Liste
  // der vier Toene aus dem Blatt – nicht gegen einen hier abgeschriebenen
  // Wert. Wer die Toene aendert, soll hier nichts anfassen muessen.
  const toene = [...css.matchAll(/\.h\.t\d \{ color: (#[0-9a-f]{6}); \}/gi)]
    .map((m) => m[1]);
  pruefe('Das Blatt kennt vier Namensfarben', toene.length === 4, toene.join(' '));
  const alsRgb = (hex) => 'rgb(' + (hex.replace('#', '').match(/../g) || [])
    .map((h) => parseInt(h, 16)).join(', ') + ')';
  pruefe('Und die Kennung traegt eine davon',
    toene.map(alsRgb).includes(nutzer.kennungFarbe),
    `${nutzer.kennungFarbe} gegen ${toene.map(alsRgb).join(' / ')}`);

  // NICHT die Farbe des Betrags daneben – das war die alte Regel, und sie ist
  // ausdruecklich weg. Zwei Auskuenfte, zwei Farben: wer ich bin, und wieviel
  // ich halte.
  pruefe('Und nicht die Farbe des Betrags daneben',
    nutzer.kennungFarbe !== nutzer.betragFarbe,
    `Kennung ${nutzer.kennungFarbe}, Betrag ${nutzer.betragFarbe}`);

  // --- Und wer den Betrag ueberhaupt sieht ---------------------------------
  //
  // Nur die Nutzer. Fuer sie ist es die Zahl, an der alles haengt: Sie
  // entscheidet, ob sie schreiben duerfen, und sie steht neben jeder ihrer
  // Nachrichten.
  //
  // Bei Ansem beantwortet sie keine Frage. Er kommt an keiner Schwelle
  // vorbei, und sie stuende ausgerechnet ueber einem Posteingang, in dem jede
  // Zeile einen Betrag traegt – dort ist eine weitere Zahl keine Auskunft
  // mehr, sondern eine, die man mitliest und wieder verwirft.
  //
  // Geprueft wird beides, denn nur zusammen ist es eine Regel und nicht bloss
  // ein fehlendes Element.
  pruefe('Ein Nutzer sieht seinen Bestand', nutzer.betragDa);
  pruefe('Ansem nicht', !ansem.betragDa);
  // Und renderMe() macht es wirklich an der Rolle fest. Ohne das koennte das
  // Blatt oben von sich aus verstecken und die Pruefungen saehen gleich aus.
  pruefe('Und renderMe() entscheidet das an der Rolle',
    /holdings\.hidden = Boolean\(state\.me\.isAdmin\)/.test(appJs));
  // Die Reiter bleiben trotzdem mittig – das steht schon ganz oben, aber es
  // haengt jetzt daran: Faellt rechts ein Element weg, wandert die Gruppe,
  // sobald die Kopfzeile kein Raster mehr ist.

  // Der Ton haengt an der vollen Adresse und nicht an den drei Zeichen. Sonst
  // bekaemen ausgerechnet die Doppelgaenger dieselbe Farbe – also genau die,
  // fuer die es die Farbe gibt.
  const gleicherAnfang = ADRESSE.slice(0, 3) + 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
  const andersRum = await messen('nutzer', '$5,208', 1000, gleicherAnfang);
  pruefe('Zwei Wallets mit denselben drei Zeichen bekommen verschiedene Farben',
    andersRum.kennungFarbe !== nutzer.kennungFarbe,
    `${nutzer.kennungFarbe} gegen ${andersRum.kennungFarbe}`);
  pruefe('Und tragen trotzdem denselben Namen',
    andersRum.kennungText === nutzer.kennungText,
    `${nutzer.kennungText} / ${andersRum.kennungText}`);

  // Und bei keinem von beiden ein Knopf: Hier gibt es nichts zu druecken. Der
  // Hinweis neben Ansems Bild kommt mit dem Zeiger und geht mit ihm – dafuer
  // braucht es kein Bedienelement, und ein Knopf, der auf einen Klick nichts
  // tut, liest sich als Defekt.
  pruefe('Bei beiden ist es kein Knopf',
    nutzer.kennungTag === 'span' && ansem.kennungTag === 'span',
    `${nutzer.kennungTag} / ${ansem.kennungTag}`);
  pruefe('Und in app.js steht auch keiner',
    !/<button[^`]*id="me-handle"/.test(appJs),
    (appJs.match(/<\w+ id="me-handle"/g) || []).join(' , '));
}

console.log('\nDer Hinweis neben Ansems Profilbild\n');
//
// Bei ihm steht oben rechts ein Bild und keine Adresse – und ein Bild sagt
// nicht, mit welchem Konto man hier ist. Der Hinweis holt die Auskunft nach,
// die alle anderen ablesen koennen, ohne etwas zu tun.
//
// Und genau deshalb kommt er beim ZEIGER und nicht erst beim Klick: Er ist
// eine Erklaerung, keine Bedienung. Wer erst druecken muss, um zu erfahren,
// was da steht, hat schon geraten.
//
// Auf einem Telefon gibt es keinen Zeiger, dort uebernimmt der Tipp. Beides
// wird hier geprueft, in zwei Fenstern mit verschiedenen Faehigkeiten – und
// das ist keine Formalie: :hover bleibt auf manchen Telefonen nach einem Tipp
// haengen, weshalb die Regel im Blatt ausdruecklich in @media (hover: hover)
// steht.
{
  // MIT app.js, anders als die Messungen oben: Hier geht es um das Verhalten,
  // und das steht dort. Ohne Anmeldung kommt der Start nicht durch, die
  // Zuhoerer sind aber angemeldet, sobald das Modul geladen ist.
  const seite = await browser.newPage({ viewport: { width: 1100, height: 220 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(350);
  await seite.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<button type="button" id="me-handle" class="handle h admin-name"'
      + ' aria-haspopup="true" aria-expanded="false" aria-controls="me-info">'
      + '<span class="kuerzel">4bo</span></button>';
    document.querySelector('#me-holdings').hidden = true;
  });
  pruefe('Der Hinweis steht im Blatt', /id="me-info"/.test(html));
  pruefe('Und sagt, mit welchem Konto man hier ist',
    /You are logged in as Ansem/i.test(html));
  // Er haengt als Beschreibung am Knopf. So bekommt eine Vorlesestimme den Satz
  // auch dann, wenn er gerade nicht zu sehen ist – ein Hinweis, den nur der
  // Zeiger hervorholt, waere fuer sie sonst gar nicht da.
  pruefe('Und haengt als Beschreibung am Bild',
    /aria-describedby="me-info"/.test(appJs), 'aria-describedby in renderMe');

  const sichtbar = () => seite.evaluate(() =>
    getComputedStyle(document.querySelector('#me-info')).display !== 'none');
  await seite.mouse.move(5, 190);
  await seite.waitForTimeout(120);
  pruefe('Ohne Zeiger und ohne Tipp ist er nicht da', !(await sichtbar()));

  // Der Kasten liegt LINKS neben dem Bild, nicht darunter und nicht links
  // neben der ganzen Gruppe aus Bild, Betrag und Abmeldeknopf.
  //
  // Gemessen wird ueber den ECHTEN Weg, also mit dem Zeiger auf dem Bild. Beim
  // Umbau stand hier einmal eine Klasse, die es nicht mehr gab: Der Kasten
  // blieb auf display: none, alle Masse kamen als null zurueck, und zwei der
  // drei Pruefungen meldeten trotzdem "ok" – null ist nun einmal kleiner als
  // alles. Eine Messung an etwas Unsichtbarem sagt nichts, meldet aber gern.
  await seite.hover('#me-handle');
  await seite.waitForTimeout(150);
  const lage2 = await seite.evaluate(() => {
    const p = document.querySelector('#me-info').getBoundingClientRect();
    const bild = document.querySelector('#me-handle').getBoundingClientRect();
    return { rechts: Math.round(p.right), bildLinks: Math.round(bild.left),
             links: Math.round(p.left),
             mitte: Math.round(p.top + p.height / 2),
             bildMitte: Math.round(bild.top + bild.height / 2) };
  });
  pruefe('Beim Messen war er überhaupt zu sehen',
    lage2.rechts > 0 && lage2.links > 0, `${lage2.links} bis ${lage2.rechts}`);
  pruefe('Er steht links neben dem Bild', lage2.rechts <= lage2.bildLinks,
    `Hinweis endet bei ${lage2.rechts}, Bild beginnt bei ${lage2.bildLinks}`);
  // Hier stand eine dritte Pruefung: dass der Hinweis nicht erst links neben
  // dem BETRAG endet. Sie ist weg, weil der Betrag bei Ansem weg ist – und
  // eine Messung an einem versteckten Element haette gemeldet, was sie
  // wollte. Genau davor warnt der Absatz darueber.
  pruefe('Auf derselben Höhe wie das Bild',
    Math.abs(lage2.mitte - lage2.bildMitte) <= 1,
    `${lage2.mitte} gegen ${lage2.bildMitte}`);
  pruefe('Und bleibt im Bild', lage2.links >= 0, `linke Kante bei ${lage2.links}`);

  // --- Der Zeiger, und sonst nichts ----------------------------------------
  pruefe('Das Fenster kann überhaupt schweben',
    await seite.evaluate(() => matchMedia('(hover: hover)').matches));
  await seite.hover('#me-handle');
  await seite.waitForTimeout(150);
  pruefe('Der Zeiger allein holt ihn hervor', await sichtbar());
  await seite.mouse.move(5, 190);
  await seite.waitForTimeout(150);
  pruefe('Und er geht wieder, sobald der Zeiger herunterfährt', !(await sichtbar()));

  // Ein Klick soll NICHTS tun – weder aufklappen noch festhalten. Geprueft
  // wird deshalb, dass er den Zustand nicht veraendert: Waehrend des Klicks
  // steht der Zeiger noch auf dem Bild, der Hinweis ist also da; sobald der
  // Zeiger herunterfaehrt, muss er weg sein. Bliebe er stehen, haette der
  // Klick etwas festgehalten.
  await seite.click('#me-handle');
  await seite.waitForTimeout(150);
  pruefe('Beim Klicken bleibt er, weil der Zeiger noch daraufsteht',
    await sichtbar());
  await seite.mouse.move(5, 190);
  await seite.waitForTimeout(150);
  pruefe('Und ist danach weg – der Klick hat nichts festgehalten',
    !(await sichtbar()));

  // Und bei einem normalen Nutzer holt der Zeiger nichts hervor. Der Kasten
  // steht fuer alle im Blatt; haengt die Regel am falschen Element, liest der
  // Nutzer "You are logged in as Ansem" ueber seiner eigenen Kennung.
  await seite.evaluate(() => {
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h t1">EMw</span>';
  });
  await seite.hover('#me-handle');
  await seite.waitForTimeout(150);
  pruefe('Bei einem Nutzer holt der Zeiger nichts hervor', !(await sichtbar()));
  await seite.close();
}

// --- Ohne Zeiger gibt es ihn nicht ----------------------------------------
//
// Auf einem Telefon ist der Hinweis nicht zu sehen, und das ist die
// Entscheidung: Ein Kasten, der sich per Beruehrung aufklappt, braucht einen
// Knopf, ein Aussenklick-Handler und die Escape-Taste – Bedienung fuer eine
// Erklaerung. Was bleibt, ist aria-describedby: Eine Vorlesestimme bekommt den
// Satz auch dort.
//
// Geprueft wird das ausdruecklich, damit :hover nicht doch durchrutscht: In
// manchen Browsern bleibt es nach einer Beruehrung haengen, und der Kasten
// stuende dann bis zur naechsten Beruehrung irgendwo anders auf dem
// Bildschirm.
{
  const kontext = await browser.newContext({
    viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true,
  });
  const seite = await kontext.newPage();
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(300);
  await seite.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
      + '<span class="kuerzel">4bo</span></span>';
    document.querySelector('#me-holdings').hidden = true;
  });
  const sichtbar = () => seite.evaluate(() =>
    getComputedStyle(document.querySelector('#me-info')).display !== 'none');
  pruefe('Das Fenster kann nicht schweben',
    !(await seite.evaluate(() => matchMedia('(hover: hover)').matches)));
  pruefe('Am Anfang ist er nicht da', !(await sichtbar()));
  await seite.tap('#me-handle');
  await seite.waitForTimeout(150);
  pruefe('Und eine Berührung holt ihn auch nicht hervor', !(await sichtbar()));
  await kontext.close();
}

console.log('\nAuf dem Handy: eine eigene Zeile, volle Breite\n');
{
  const a = await messen('ansem', '$12.4M', 390);
  const n = await messen('nutzer', '$153', 390);
  // Dort sind die Reiter eine eigene Zeile unter der Kennung – "mittig" ist
  // keine sinnvolle Frage mehr, "an derselben Stelle" schon.
  pruefe('Die Reiter stehen unter der Kennung', a.tabsOben > 20 && n.tabsOben > 20,
    `${a.tabsOben} px / ${n.tabsOben} px`);
  pruefe('Und sind bei beiden gleich breit und gleich hoch',
    Math.abs(a.tabsBreite - n.tabsBreite) <= 1 && a.tabsOben === n.tabsOben,
    `${a.tabsBreite} px / ${n.tabsBreite} px`);
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
