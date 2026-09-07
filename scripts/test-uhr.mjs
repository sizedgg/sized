// ============================================================================
// Die Uhr auf dem Zahlungsbildschirm zaehlt Sekunde fuer Sekunde
//
// Der gemeldete Fehler: "24:59 ... 24:52". Die Uhr wurde nur dann neu
// geschrieben, wenn eine Antwort vom Server zurueckkam, und der Abstand
// zwischen den Anfragen waechst (3s, 10s, 30s). Nach fuenf Minuten waeren es
// Spruenge von einer halben Minute gewesen.
//
// Warum das eine eigene Pruefung wert ist: In diesem Bildschirm hat jemand
// gerade Geld verschickt und wartet. Eine Uhr, die stockt, sieht kaputt aus –
// und Vertrauen ist in dem Moment das Einzige, was die Seite anzubieten hat.
//
// ----------------------------------------------------------------------------
// Wie hier gemessen wird
//
// Nicht in Echtzeit. Die Uhr wird woertlich aus app.js herausgeschnitten und
// gegen eine VIRTUELLE Zeit laufen gelassen: Date.now und setTimeout sind
// ersetzt, der Test bestimmt, wann ein Zeitgeber feuert und wie spaet es dann
// ist. Damit laufen sechzig Sekunden in Millisekunden ab, und – wichtiger –
// der Test kann einen Browser nachstellen, der jeden Zeitgeber ein paar
// Millisekunden ZU SPAET ausloest. Genau das tun echte Browser, und genau
// daran waere die naheliegende Loesung (setInterval alle 1000 ms) gescheitert:
// Die Verspaetung summiert sich, wandert gegen die Sekundengrenze, und
// irgendwann faellt eine Zahl aus.
//
//   node scripts/test-uhr.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Woertlich aus app.js. Eine nachgebaute Kopie wuerde diesen Test bestehen,
// waehrend die Seite weiter springt – und dann misst er nichts.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const uhrCode = schneide('const restText = (ms) =>', 'function startPolling(');

let fehler = 0;
const check = (name, ok, hinweis = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${hinweis ? ` — ${hinweis}` : ''}`);
  if (!ok) fehler += 1;
};

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage();
await page.setContent('<span id="pay-timer"></span>');

/**
 * Laesst die Uhr `sekunden` lang in virtueller Zeit laufen.
 *
 * `verspaetung` ist der Pfusch, den echte Browser einbauen: Ein Zeitgeber
 * feuert nie exakt, sondern immer ein paar Millisekunden zu spaet.
 * `quelle` ist der Uhrcode – so kann die Gegenprobe eine veraenderte Fassung
 * durchschicken.
 */
async function lauf({ sekunden, verspaetung, quelle = uhrCode }) {
  return page.evaluate(({ code, sekunden, verspaetung }) => {
    let jetzt = 1_000_000;                       // irgendein Startpunkt
    const deadline = jetzt + sekunden * 1000;
    const geschrieben = [];
    let offen = null;

    const echtesNow = Date.now;
    const echtesSetTimeout = globalThis.setTimeout;
    Date.now = () => jetzt;
    globalThis.setTimeout = (fn, ms) => { offen = { at: jetzt + ms, fn }; return 1; };

    // Statt des echten $ und state: aufschreiben, was die Uhr schreiben wuerde.
    const $ = () => ({ set textContent(v) { geschrieben.push({ t: jetzt, v }); } });
    const state = {};

    try {
      // eslint-disable-next-line no-eval
      const starteUhr = eval(`(() => { ${code} ; return starteUhr; })()`);
      starteUhr(deadline);

      let schutz = 0;
      while (offen && schutz++ < 100_000) {
        const jetztFaellig = offen;
        offen = null;
        jetzt = jetztFaellig.at + verspaetung;   // der Browser feuert zu spaet
        if (jetzt > deadline + 2000) break;
        jetztFaellig.fn();
      }
      return { geschrieben, schutz };
    } finally {
      Date.now = echtesNow;
      globalThis.setTimeout = echtesSetTimeout;
    }
  }, { code: quelle, sekunden, verspaetung });
}

/** Prueft eine Folge von Anzeigen auf Luecken und Wiederholungen. */
function pruefeFolge(geschrieben, sekunden) {
  const zahlen = geschrieben.map((g) => {
    const m = /^(\d+):(\d\d) left$/.exec(g.v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  });
  const ungueltig = zahlen.filter((z) => z === null).length;
  // Aufeinanderfolgende Wiederholungen sind unschaedlich (derselbe Text), aber
  // ein Sprung um mehr als eine Sekunde ist genau der gemeldete Fehler.
  const eindeutig = zahlen.filter((z, i) => i === 0 || z !== zahlen[i - 1]);
  const spruenge = [];
  for (let i = 1; i < eindeutig.length; i += 1) {
    const d = eindeutig[i - 1] - eindeutig[i];
    if (d !== 1) spruenge.push(`${eindeutig[i - 1]}→${eindeutig[i]}`);
  }
  const fehlend = [];
  for (let s = sekunden; s >= 0; s -= 1) if (!eindeutig.includes(s)) fehlend.push(s);
  return { ungueltig, eindeutig, spruenge, fehlend };
}

console.log('\n── Die Uhr auf dem Zahlungsbildschirm ──');

// 1. Der pingelige Fall: Der Browser feuert jeden Zeitgeber 8 ms zu spaet.
//    Genau hier faellt setInterval(1000) auseinander.
{
  const { geschrieben } = await lauf({ sekunden: 60, verspaetung: 8 });
  const { ungueltig, eindeutig, spruenge, fehlend } = pruefeFolge(geschrieben, 60);
  check('Jede Anzeige hat die Form "m:ss left"', ungueltig === 0, `${ungueltig} unlesbar`);
  check('Keine Sekunde wird uebersprungen (Browser 8 ms zu spaet)',
    spruenge.length === 0, spruenge.slice(0, 5).join(', ') || 'keine Spruenge');
  check('Alle 61 Sekunden von 60 bis 0 kommen vor',
    fehlend.length === 0, fehlend.length ? `fehlt: ${fehlend.join(', ')}` : `${eindeutig.length} Werte`);
  check('Die Uhr endet bei 0:00', eindeutig[eindeutig.length - 1] === 0,
    geschrieben[geschrieben.length - 1]?.v);
}

// 2. Ein grob ungenauer Browser: 40 ms Verspaetung pro Zeitgeber.
//    Ueber 60 Sekunden waeren das 2,4 Sekunden aufgelaufene Differenz, wenn
//    die Uhr hochzaehlen statt rechnen wuerde.
{
  const { geschrieben } = await lauf({ sekunden: 60, verspaetung: 40 });
  const { spruenge, fehlend } = pruefeFolge(geschrieben, 60);
  check('Auch bei 40 ms Verspaetung keine Luecke',
    spruenge.length === 0 && fehlend.length === 0,
    [...spruenge, ...fehlend.map((f) => `fehlt ${f}`)].slice(0, 5).join(', ') || 'sauber');
}

// 3. Gegenprobe A: die naheliegende Loesung, die nicht funktioniert.
//    Wird die Sekundengrenze durch ein starres 1000 ersetzt, MUSS der Test
//    rot werden – sonst misst er die Terminierung gar nicht.
{
  const naiv = uhrCode.replace('(left % 1000) + 20', '1000');
  check('Vorbedingung: die Gegenprobe hat den Code wirklich veraendert',
    naiv !== uhrCode);
  const { geschrieben } = await lauf({ sekunden: 60, verspaetung: 8, quelle: naiv });
  const { spruenge, fehlend } = pruefeFolge(geschrieben, 60);
  check('Gegenprobe: mit starrem 1000-ms-Takt faellt eine Sekunde aus',
    spruenge.length > 0 || fehlend.length > 0,
    spruenge.slice(0, 3).join(', ') || `fehlt: ${fehlend.slice(0, 3).join(', ')}`);
}

// 4. Gegenprobe B: das alte Verhalten.
//    Vorher hing die Anzeige am Abfragetakt. Ein Aufruf alle drei Sekunden
//    springt um drei – das ist der gemeldete Fehler, und so sieht er aus.
{
  const amAbfragetakt = uhrCode.replace('(left % 1000) + 20', '3000');
  const { geschrieben } = await lauf({ sekunden: 60, verspaetung: 8, quelle: amAbfragetakt });
  const { spruenge } = pruefeFolge(geschrieben, 60);
  check('Gegenprobe: am Abfragetakt (3s) springt die Uhr um drei Sekunden',
    spruenge.length > 0 && spruenge.some((s) => /→/.test(s)),
    spruenge.slice(0, 3).join(', '));
}

// 5. Die Uhr haelt an, statt ins Minus zu laufen.
{
  const { geschrieben, schutz } = await lauf({ sekunden: 3, verspaetung: 8 });
  const negativ = geschrieben.filter((g) => /^-/.test(g.v) || /:-/.test(g.v));
  check('Keine negative Anzeige', negativ.length === 0, negativ[0]?.v ?? 'keine');
  check('Die Uhr stellt sich bei 0:00 selbst ab',
    geschrieben[geschrieben.length - 1].v === '0:00 left' && schutz < 100,
    `${schutz} Durchlaeufe`);
}

// 6. Ein Ausschalter, nicht zwei.
//    stopPolling muss BEIDE Zeitgeber loeschen. Wird die Uhr vergessen,
//    schreibt sie unsichtbar weiter in ein Feld, das niemand mehr ansieht.
{
  const stop = schneide('const stopPolling = () => {', '\nfunction logout(');
  check('stopPolling loescht den Abfragezeitgeber', /clearTimeout\(state\.poller\)/.test(stop));
  check('stopPolling loescht auch die Uhr', /clearTimeout\(state\.uhr\)/.test(stop));
  check('startPolling startet die Uhr', /starteUhr\(deadline\)/.test(appJs));
  // Und: Die Uhr darf NICHT mehr an der Antwort haengen. Stuende die Zuweisung
  // an #pay-timer noch im Abfrageschritt, waere der Fehler zurueck, ohne dass
  // eine der Messungen oben etwas merkt – die messen ja starteUhr.
  const tick = schneide('  const tick = async () => {', '  tick();');
  check('Der Abfrageschritt schreibt die Uhrzeit nicht mehr selbst',
    !/pay-timer/.test(tick));
}

await browser.close();
console.log(`\n${fehler === 0 ? '✅ Alle Prüfungen bestanden' : `❌ ${fehler} Prüfung(en) fehlgeschlagen`}\n`);
process.exit(fehler === 0 ? 0 : 1);
