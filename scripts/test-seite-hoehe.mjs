// ============================================================================
// Die Seite selbst scrollt nicht. Gescrollt wird INNERHALB der Listen.
//
// ----------------------------------------------------------------------------
// Der Fehler, der diesen Test ausgelöst hat
//
// Es gibt auf der Seite Text, der nur für die Vorlesestimme da ist und für das
// Auge versteckt wird – Ansems drei Zeichen unter seinem Profilbild, das
// " — your vote" hinter einer Antwort. Alle liegen unter derselben Regel:
//
//   position: absolute; width: 1px; height: 1px;
//   overflow: hidden; clip-path: inset(50%);
//
// Das ist die übliche Fassung dafür, und sie hat eine Bedingung, die nirgends
// dabeisteht: Das Elternelement muss positioniert sein. Sonst sucht sich
// position: absolute das ganze Dokument als Bezug – und das Element steht dann
// nicht "1 px in der Liste", sondern 1 px an der Stelle, an der es im
// UNGESCROLLTEN Verlauf läge. Bei vierzig Einträgen sind das über tausend
// Pixel unterhalb des Fensters, und das Dokument wächst genau so weit mit.
//
// Sichtbar war das nicht als verschobenes Element – man sieht diese Spans ja
// nie –, sondern als: "Wenn ich scrolle, scrollt die ganze Seite nach oben."
// Das Rad rutschte am Ende der Liste auf das Dokument durch und schob die
// ganze App aus dem Bild. Gemessen: 1493 px Dokument in einem 738 px hohen
// Fenster. Aufgetreten ist es damals im Chat; der ist inzwischen raus, die
// Regel und ihre Falle stehen weiter.
//
// ----------------------------------------------------------------------------
// Warum dieser Test die DOKUMENTHÖHE misst und nicht die Regel
//
// Man könnte prüfen, dass .opt-label position: relative trägt. Das fängt
// genau diesen einen Fall und keinen anderen. Die Aussage, um die es geht,
// ist aber eine über die ganze Seite: Sie ist so hoch wie das Fenster, nie
// höher. Alles, was sie höher macht – ein absolut gesetztes Element ohne
// Bezug, ein zu breites Bild, ein Rand, der nach unten übersteht –, fällt
// hier auf, egal wodurch es entstanden ist.
//
// Geprüft wird mit der ECHTEN index.html und dem echten Blatt, in beiden Tabs,
// mit vollen Listen und einmal auf Handybreite.
//
//   node scripts/test-seite-hoehe.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oeffentlich = path.join(root, 'public');

// Ein echter kleiner Dateiserver statt einer zusammengebauten Seite: Die Frage
// haengt an der Hoehe des ganzen Dokuments, und die bekommt man nur richtig,
// wenn index.html, styles.css und die Bilder so geladen werden wie im Betrieb.
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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

// Die Listen werden mit Markup gefuellt, das der echten Form entspricht –
// inklusive der versteckten Kuerzel, denn genau die waren das Problem. Wichtig
// ist die MENGE: Mit fuenf Zeilen faellt nichts auf, weil der ungescrollte
// Verlauf dann kaum laenger ist als das Fenster.
const AUFBAU = {
  Polls: (n) => `document.querySelector('#pane-polls').hidden = false;
    document.querySelector('#poll-list').innerHTML = Array.from({ length: ${n} }, (_, i) =>
      \`<article class="poll"><div class="poll-head"><h4>Frage \${i}</h4></div>
        <div class="poll-meta">120 votes</div>
        <div class="opt mine"><div class="opt-bar"><div class="opt-fill" style="width:60%"></div>
          <div class="opt-text"><span class="opt-label">Antwort
            <span class="nur-vorlesen"> — your vote</span></span>
            <span class="opt-num"><span class="held">$1</span>
            <span class="votes">1 vote</span></span></div></div></div>
      </article>\`).join('');
    document.querySelector('#poll-list').scrollTop = 1e6;`,

  DMs: (n) => `document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-thread').innerHTML = Array.from({ length: ${n} }, (_, i) =>
      \`<div class="dm-row \${i % 2 ? 'mine' : ''}"><div class="dm-block">
        <div class="msg dm \${i % 2 ? 'mine' : ''}"><span class="body">nachricht \${i}</span>
        <span class="meta"><span class="time">19:0\${i % 10}</span></span></div>
      </div></div>\`).join('');
    document.querySelector('#dm-thread').scrollTop = 1e6;`,
};

const messen = async (tab, breite, hoehe, anzahl) => {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(300);
  const r = await seite.evaluate((bau) => {
    // Das Skript entscheidet im Betrieb, was gezeigt wird; hier wird es von
    // Hand gesetzt, weil ohne Anmeldung nichts sichtbar waere.
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    // eslint-disable-next-line no-eval
    eval(bau);
    const d = document.documentElement;
    // Und gleich mitliefern, WER zu weit unten steht – ohne das sucht man
    // beim naechsten Mal wieder eine Stunde nach einem unsichtbaren Element.
    const taeter = [...document.querySelectorAll('*')]
      .map((e) => ({ e, u: e.getBoundingClientRect().bottom }))
      .filter((x) => x.u > d.clientHeight + 2)
      .sort((a, b) => b.u - a.u).slice(0, 3)
      .map((x) => `${x.e.tagName.toLowerCase()}.${String(x.e.className).split(' ')[0]} bei ${Math.round(x.u)}`);
    return { scrollH: d.scrollHeight, clientH: d.clientHeight, taeter };
  }, AUFBAU[tab](anzahl));
  await seite.close();
  return r;
};

console.log('\nDie Seite bleibt so hoch wie das Fenster\n');

for (const tab of ['Polls', 'DMs']) {
  const r = await messen(tab, 1300, 738, 40);
  pruefe(`${tab} am Rechner, volle Liste`, r.scrollH <= r.clientH,
    `${r.scrollH} px Dokument in ${r.clientH} px Fenster`
    + (r.taeter.length ? ` — zu weit unten: ${r.taeter.join(', ')}` : ''));
}

// Auf dem Handy ist es schlimmer, nicht besser: Dort ist das Fenster kuerzer,
// der ungescrollte Verlauf also im Verhaeltnis laenger – und ein Dokument, das
// mitscrollt, kostet dort die Adressleiste, die beim Scrollen ein- und
// ausfaehrt.
for (const tab of ['Polls', 'DMs']) {
  const r = await messen(tab, 390, 720, 40);
  pruefe(`${tab} auf 390 px`, r.scrollH <= r.clientH,
    `${r.scrollH} px Dokument in ${r.clientH} px Fenster`
    + (r.taeter.length ? ` — zu weit unten: ${r.taeter.join(', ')}` : ''));
}

// Die Gegenprobe: Der Test muss den Fehler auch WIRKLICH sehen. Ohne sie
// koennte hier eine Regel stehen, die nie ausloest – und niemand wuesste es.
//
// Sie stellt den Mechanismus nach und dreht nicht die Seite zurueck, und das
// hat einen Grund, der dazugehoert:
//
// Der Fehler trat im Chat auf, an Ansems verstecktem Kuerzel. Der Chat ist
// raus. Uebrig sind zwei Orte mit solchen Spans – das " — your vote" hinter
// einer Antwort und Ansems Kuerzel in der Kopfzeile –, und an BEIDEN laesst er
// sich nicht mehr ausloesen: .opt-bar ist positioniert (dort liegt der
// Fuellbalken), .poll-list ebenfalls (dort liegt der mittige "No polls
// yet"-Satz), und die Kopfzeile enthaelt genau ein solches Element statt
// vierzig. Die Regeln fuer .opt-label und .me .handle.admin-name stehen
// trotzdem weiter da: Sie sind das, was uebrig bleibt, wenn jemand einer der
// beiden anderen Flaechen ihre position wieder nimmt.
//
// Deshalb wird hier eine Liste ohne positionierten Vorfahren gebaut. Sie
// beweist nicht, dass die Seite den Fehler HAT – sie beweist, dass die Messung
// ihn saehe.
console.log('\nGegenprobe: Der Test sieht den Fehler auch\n');
{
  const seite = await browser.newPage({ viewport: { width: 1300, height: 738 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(300);
  const r = await seite.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    const pane = document.querySelector('#pane-polls');
    pane.hidden = false;
    // Bewusst ohne position am Kasten: genau der Zustand, den die Regeln im
    // Blatt verhindern.
    //
    // Und bewusst AUSSERHALB von .app, nicht darin.
    // -----------------------------------------------------------------------
    // Seit .app ein transform traegt (der Ausgleich fuer die Tastatur, siehe
    // --versatz), ist .app selbst ein Bezugspunkt fuer alles Absolute darin.
    // Ein Kasten IN .app konnte das Dokument damit gar nicht mehr aufblaehen –
    // die Gegenprobe war gruen, weil der Fehler sich nicht mehr herstellen
    // liess, und nicht, weil die Messung ihn saehe. Genau der Unterschied, um
    // den es hier geht.
    //
    // Das ist nebenbei eine echte zusaetzliche Absicherung fuer die App. Nur
    // darf eine Gegenprobe sich nicht darauf stuetzen: Sie soll zeigen, dass
    // die MESSUNG anschlaegt.
    const kasten = document.createElement('div');
    kasten.style.cssText = 'height: 300px; overflow-y: auto;';
    kasten.innerHTML = Array.from({ length: 40 }, (_, i) =>
      `<div style="padding: 12px">Zeile ${i}<span class="nur-vorlesen"> versteckt</span></div>`).join('');
    document.body.appendChild(kasten);
    kasten.scrollTop = 1e6;
    const d = document.documentElement;
    return { scrollH: d.scrollHeight, clientH: d.clientHeight };
  });
  await seite.close();
  pruefe('Versteckte Spans ohne Bezugspunkt blähen das Dokument auf – der Test würde anschlagen',
    r.scrollH > r.clientH, `${r.scrollH} px statt ${r.clientH} px`);
}

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
