/**
 * Prüft, dass sich die Seite wirklich auf dem Startbildschirm ablegen lässt.
 *
 * Das ist die Sorte Sache, die still fehlschlägt: Manifest verlinkt, Icons
 * vorhanden, alles sieht richtig aus – und der Browser bietet das Ablegen
 * trotzdem nicht an, weil eine Icon-Datei 191 statt 192 Pixel hat oder der
 * Service Worker keinen fetch-Handler besitzt. Im Browser sieht man davon
 * nichts, hier schon.
 *
 *   node scripts/test-pwa.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  // Erst die Abfrageparameter abschneiden, dann auf index.html abbilden –
  // andersherum landete "/?sw=1" auf dem Verzeichnis statt auf der Seite.
  const pfad = req.url.split('?')[0];
  const file = pfad === '/' ? '/index.html' : pfad;
  const abs = path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(pub) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}${detail && !ok ? `\n         ${detail}` : ''}`);
};

/** PNG-Maße direkt aus dem Dateikopf lesen – ohne Bibliothek. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

console.log('\nStartbildschirm (PWA)\n');

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const manifestPath = path.join(pub, 'manifest.webmanifest');
check('manifest.webmanifest existiert', fs.existsSync(manifestPath));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check('Manifest ist gültiges JSON', true);
} catch (e) {
  check('Manifest ist gültiges JSON', false, e.message);
}

if (manifest) {
  check('name gesetzt', Boolean(manifest.name));
  check('start_url gesetzt', Boolean(manifest.start_url));
  check('display ist "standalone" (ohne Browserleiste)',
        manifest.display === 'standalone', `ist: ${manifest.display}`);
  check('background_color gesetzt (kein weißes Aufblitzen beim Start)',
        Boolean(manifest.background_color));

  // Genau hier geht es sonst schief.
  for (const icon of manifest.icons ?? []) {
    const f = path.join(pub, icon.src.replace(/^\//, ''));
    const exists = fs.existsSync(f);
    check(`Icon ${icon.src} vorhanden`, exists);
    if (!exists) continue;
    const size = pngSize(f);
    const [w, h] = icon.sizes.split('x').map(Number);
    check(`Icon ${icon.src} ist wirklich ${icon.sizes}`,
          size && size.w === w && size.h === h,
          size ? `gemessen: ${size.w}x${size.h}` : 'keine lesbare PNG-Datei');
  }

  const any = (manifest.icons ?? []).some((i) => (i.purpose ?? 'any').includes('any'));
  const mask = (manifest.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable'));
  check('Es gibt ein normales Icon', any);
  check('Es gibt ein maskierbares Icon (Android schneidet zu)', mask);

  const big = (manifest.icons ?? []).some((i) => Number(i.sizes.split('x')[0]) >= 512);
  check('Mindestens ein Icon mit 512 px (verlangt Chrome)', big);
}


// ---------------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------------

const swSrc = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
check('Service Worker reagiert auf fetch (sonst kein Ablegen-Angebot)',
      /addEventListener\(\s*['"]fetch['"]/.test(swSrc));
check('Service Worker fasst fremde Adressen nicht an',
      swSrc.includes('self.location.origin'));

// ---------------------------------------------------------------------------
// Im echten Browser
// ---------------------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// ?sw=1, weil der Service Worker auf localhost sonst absichtlich nicht
// angemeldet wird (er stünde beim Entwickeln zwischen Browser und Dateien).
// Ein sicherer Kontext ist Pflicht, also bleibt localhost der einzige Ort, an
// dem er sich überhaupt prüfen lässt.
await page.goto(base + '/?sw=1', { waitUntil: 'load' });

check('Manifest ist in der Seite verlinkt',
      await page.$eval('link[rel=manifest]', (el) => Boolean(el.href)).catch(() => false));
check('apple-touch-icon ist verlinkt (iPhone nutzt nicht das Manifest)',
      await page.$eval('link[rel=apple-touch-icon]', (el) => Boolean(el.href)).catch(() => false));
check('theme-color gesetzt',
      await page.$eval('meta[name=theme-color]', (el) => Boolean(el.content)).catch(() => false));

// Fehler beim Laden zuerst: Bricht das Modul ab, wird der Service Worker nie
// angemeldet – die Prüfung darunter wartete dann ewig. Ein Test, der hängt,
// sagt einem nicht, was kaputt ist.
check('Keine JavaScript-Fehler beim Laden', errors.length === 0, errors.join(' | '));

// Registrierung abwarten, aber nicht endlos.
const swOk = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'kein Service-Worker-Support';
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, ab) => setTimeout(() => ab(new Error('nach 10 s nicht bereit')), 10000)),
    ]);
    return reg.active ? true : 'nicht aktiv geworden';
  } catch (e) { return e.message; }
}).catch((e) => e.message);
check('Service Worker registriert und aktiv', swOk === true, String(swOk));


// Ohne Anmeldung muss der Login zu sehen sein – und die App nicht.
//
// Das klingt selbstverstaendlich, ist es seit Kurzem aber nicht mehr: Im Blatt
// sind BEIDE versteckt, damit bei einem geteilten Abstimmungslink nicht erst
// der Login und dann die Abstimmungen aufblitzen. Sichtbar macht sie nur noch das
// Skript. Faellt das aus oder greift eine Verzweigung daneben, sieht der
// Besucher eine schwarze Seite – und genau das wuerde man ohne diese Pruefung
// erst von jemand anderem erfahren.
// Abwarten, bevor gemessen wird.
// ---------------------------------------------------------------------------
// boot() fragt jetzt zuerst die Datenbank, ob die Seite noch zu ist. Erst
// danach steht fest, WAS zu sehen ist. Auf dem Testserver gibt es keine
// Datenbank, die Anfrage scheitert, und app.js faellt auf den Login zurueck –
// aber eben ein paar Millisekunden spaeter. Ohne dieses Warten misst der Test
// die Luecke dazwischen und meldet einen Fehler, den es nicht gibt.
await page.waitForFunction(() =>
  !document.querySelector('#login').hidden
  || !document.querySelector('#app').hidden
  || !document.querySelector('#soon').hidden, null, { timeout: 5000 })
  .catch(() => {});
const sichtbar = await page.evaluate(() => ({
  login: !document.querySelector('#login').hidden,
  app: !document.querySelector('#app').hidden,
}));
check('Ohne Anmeldung ist der Login sichtbar', sichtbar.login);
check('Ohne Anmeldung ist die App verborgen', !sichtbar.app);

// ---------------------------------------------------------------------------
// Der Startbildschirm-Schritt: Ordnung und der richtige Satz zur richtigen Zeit
// ---------------------------------------------------------------------------
//
// Zwei Dinge, die man auf einem Bild nicht sieht und die beide schon falsch
// waren:
//
//   1. Der Zahlungshinweis stand auf DIESEM Schritt, obwohl dort noch gar
//      keine Rede von einer Zahlung ist. Er gehoert einen Schritt spaeter.
//      Geregelt ist das ueber eine CSS-Regel mit :has() und nicht ueber
//      JavaScript -- der Schrittwechsel passiert an fuenf Stellen in app.js,
//      und eine Zeile, die an vier davon steht, faellt niemandem auf.
//
//   2. Die Anleitung war eine gewoehnliche Aufzaehlung. Bricht eine Zeile um
//      (bei 375 px tun das zwei von dreien), rutschte die zweite Zeile unter
//      die Nummer, und der linke Rand franste aus. Jetzt steht der Text in
//      einer eigenen Spalte.
//
// Gemessen wird beides an der echten Seite, nicht am Stylesheet.

await page.setViewportSize({ width: 375, height: 667 });
await page.evaluate(() => {
  document.querySelector('#login').hidden = false;
  document.querySelector('#app').hidden = true;
  document.querySelector('#step-install').hidden = false;
  document.querySelector('#step-address').hidden = true;
  document.querySelector('#ios-steps').hidden = false;
});
const install = await page.evaluate(() => {
  const fuss = document.querySelector('.foot-note');
  const kanten = [...document.querySelectorAll('.steps .txt')]
    .map((e) => Math.round(e.getBoundingClientRect().left));
  return {
    fussWeg: getComputedStyle(fuss).display === 'none',
    kanten: [...new Set(kanten)],
    anzahl: document.querySelectorAll('.steps li').length,
    hoehe: Math.round(document.querySelector('#login .login-card').getBoundingClientRect().height),
    text: document.querySelector('#step-install .lede').textContent.trim(),
  };
});

check('Auf dem Startbildschirm-Schritt steht kein Zahlungshinweis', install.fussWeg);
check('Von einer Zahlung ist dort auch sonst keine Rede',
  !/payment|pay again|costs/i.test(install.text), install.text);
check('Die Anleitung hat drei Schritte', install.anzahl === 3, String(install.anzahl));
// DIE Pruefung: Alle drei Texte beginnen an derselben Kante. Rutschte eine
// zweite Zeile unter die Nummer, gaebe es hier zwei verschiedene Werte.
check('Alle Schritte beginnen an derselben Kante',
  install.kanten.length === 1, install.kanten.join(' / ') + ' px');
check('Und die Karte passt auf einen 667-px-Bildschirm',
  install.hoehe <= 667, `${install.hoehe} px`);

// Gegenprobe: Einen Schritt weiter MUSS der Hinweis da sein. Ohne diese Zeile
// waere die Pruefung oben auch dann gruen, wenn der Satz ueberall fehlte.
await page.evaluate(() => {
  document.querySelector('#step-install').hidden = true;
  document.querySelector('#step-address').hidden = false;
});
const beiAdresse = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.foot-note')).display !== 'none');
check('Gegenprobe: beim Adressschritt steht er sehr wohl da', beiAdresse);

// ---------------------------------------------------------------------------
// Die sichere Zone – vom Startbildschirm aus beginnt die Seite unter der Uhr
// ---------------------------------------------------------------------------
//
// index.html setzt viewport-fit=cover und black-translucent. Beides zusammen
// heisst: Als abgelegte App faengt der Inhalt bei y=0 an, also UNTER Uhrzeit,
// Empfangsbalken und Akkustand. Im Browser-Tab faellt das nicht auf, weil dort
// die Browserleiste darueber liegt – der Fehler zeigt sich nur auf dem
// Startbildschirm, und genau von dort kam der Befund.
//
// Es gab dafuer im ganzen Stylesheet EINE Zeile, und die galt unten.
//
// Geprueft wird hier am Text der Regeln und nicht am gerenderten Bild:
// Chromium kennt env(safe-area-inset-*) ohne echten Geraeteausschnitt nicht,
// die Werte waeren im Test immer 0 und jede Messung darauf immer gruen. Was
// sich messen laesst – der Abstand nach oben im Inhalt – wird darunter
// gemessen.
const cssText = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');
const regelFuer = (wahl) => {
  const i = cssText.indexOf(wahl + ' {');
  return i < 0 ? '' : cssText.slice(i, cssText.indexOf('}', i));
};

check('Die Kopfzeile weicht der Statusleiste aus',
  /env\(safe-area-inset-top/.test(regelFuer('.topbar')));
check('Die Anmeldekarte ebenso',
  /env\(safe-area-inset-top/.test(regelFuer('.login')));
check('Und beide auch der Kameraaussparung im Querformat',
  /env\(safe-area-inset-left/.test(regelFuer('.topbar'))
  && /env\(safe-area-inset-right/.test(regelFuer('.login')));
// Unten liegt bei Telefonen ohne Knopf der Balken zum Schliessen. Die Zeile
// dafuer stand an .composer – die sitzt aber INNERHALB des DM-Rahmens und
// konnte den Rahmen selbst nicht anheben; dessen untere Ecken verschwanden
// darunter.
check('Die Eingabezeile weicht dem Schliess-Balken aus',
  /env\(safe-area-inset-bottom/.test(regelFuer('  .composer')));

// ---------------------------------------------------------------------------
// Und jetzt der untere Rand – gemessen statt gelesen
// ---------------------------------------------------------------------------
//
// Oben steht, Chromium kenne env(safe-area-inset-*) nicht. Das stimmt, ist
// aber kein Grund, es beim Lesen des Regeltexts zu belassen: Was fehlt, sind
// nur die WERTE. Der zweite Server unten liefert dieselbe styles.css, in der
// genau diese Aufrufe durch die Masse eines iPhone 14 ersetzt sind (oben 47,
// unten 34) – sonst Zeichen fuer Zeichen die ausgelieferte Datei. Damit laesst
// sich der Fall messen, aus dem beide Befunde vom Geraet kamen:
//
//   erst  die unteren Ecken des DM-Rahmens verschwanden unter dem Balken
//   dann  46 px leerer Grund darunter, weil sich zwei Abstaende addierten
//
// Beide Fehler haetten hier auffallen muessen und taten es nicht, weil an
// dieser Stelle nur der Regeltext geprueft wurde. Ein Regeltext sagt, DASS
// jemand an die sichere Zone gedacht hat – nicht, was dabei herauskommt.
const SICHER = { top: 47, bottom: 34, left: 0, right: 0 };
const mitSicherenZonen = (css) => css.replace(
  /env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g,
  (_, seite) => `${SICHER[seite]}px`);

const serverSicher = http.createServer((req, res) => {
  const pfad = req.url.split('?')[0];
  const file = pfad === '/' ? '/index.html' : pfad;
  const abs = path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(pub) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return res.writeHead(404).end('nicht gefunden');
  }
  if (pfad === '/styles.css') {
    return res.writeHead(200, { 'content-type': 'text/css' })
      .end(mitSicherenZonen(fs.readFileSync(abs, 'utf8')));
  }
  // app.js bleibt leer: Der Zustand wird hier von Hand gesetzt, sonst startet
  // das Skript den Anmeldeablauf und versteckt alles wieder.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => serverSicher.listen(0, r));

const geraet = await browser.newPage({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await geraet.goto(`http://127.0.0.1:${serverSicher.address().port}/`);
const unten = await geraet.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-thread').innerHTML =
    '<div class="dm-row"><div class="dm-block"><div class="msg dm">'
    + '<span class="body">Probe</span></div></div></div>';
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  return {
    unterRahmen: Math.round(innerHeight - r('#dm-user').bottom),
    eingabe: Math.round(innerHeight - r('#dm-input').bottom),
  };
});

// Der Balken selbst ist duenn; reserviert sind 34 px. Alles Antippbare muss
// darueber bleiben, sonst trifft der Finger den Balken statt den Knopf.
check('Die Eingabezeile bleibt ueber dem Schliess-Balken',
  unten.eingabe >= SICHER.bottom, `${unten.eingabe} px ueber der Kante`);
// Und der Rahmen laeuft darunter durch, statt daneben zu enden. Hier stand
// einmal die Summe aus beidem – 46 px leerer Grund, am Geraet gesehen.
check('Der Rahmen endet nicht schon ueber dem Balken',
  unten.unterRahmen < SICHER.bottom, `${unten.unterRahmen} px leer darunter`);
// Aber auch nicht an der Kante: Ohne Rand waeren die unteren Ecken
// angeschnitten und der Rahmen unten kein Rahmen mehr.
check('Seine unteren Ecken bleiben trotzdem sichtbar', unten.unterRahmen > 0,
  `${unten.unterRahmen} px`);

// Gegenprobe zum Ganzen: Dieselbe Messung am ERSTEN Server, der die Datei
// unveraendert liefert. Dort ist env() null, die Eingabe steht also dicht an
// der Kante – waere der Wert auch dort schon gross genug, wuerden die drei
// Pruefungen darueber nicht die sichere Zone messen, sondern irgendetwas
// anderes.
await geraet.goto(base + '/');
const ohneErsatz = await geraet.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  return Math.round(innerHeight
    - document.querySelector('#dm-input').getBoundingClientRect().bottom);
});
check('Gegenprobe: ohne den Ersatz misst dieselbe Stelle deutlich weniger',
  ohneErsatz < SICHER.bottom, `${ohneErsatz} px`);
await geraet.close();
serverSicher.close();

// Und der Abstand nach oben im Inhalt – der laesst sich messen.
await page.setViewportSize({ width: 375, height: 667 });
await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-polls').hidden = false;
  document.querySelector('#poll-list').innerHTML =
    '<article class="poll"><div class="poll-head"><h4>Probe</h4></div></article>';
});
const luft = await page.evaluate(() => Math.round(
  document.querySelector('.poll').getBoundingClientRect().top
  - document.querySelector('.topbar').getBoundingClientRect().bottom));
// Hier stand null. Die oberste Abstimmung stiess direkt an den Strich unter
// der Kopfzeile und sah dort abgeschnitten aus – derselbe Grund, aus dem der
// DM-Rahmen oben klebte.
check('Die oberste Abstimmung klebt nicht am Strich', luft >= 6, `${luft} px`);

// ---------------------------------------------------------------------------
// Der Ladekreis im Knopf
// ---------------------------------------------------------------------------
// Zwischen "Continue" und dem Betrag liegt ein Aufruf ueber das Handynetz. Der
// Knopf wurde dabei nur blass – das sieht aus wie kaputt, nicht wie
// beschaeftigt, und wer nichts passieren sieht, tippt noch einmal.
await page.evaluate(() => {
  document.querySelector('#app').hidden = true;
  document.querySelector('#login').hidden = false;
  document.querySelector('#step-install').hidden = true;
  document.querySelector('#step-address').hidden = false;
});
const knopf = await page.evaluate(() => {
  const b = document.querySelector('#btn-challenge');
  const vor = b.getBoundingClientRect();
  b.classList.add('laedt');
  const nach = b.getBoundingClientRect();
  // getComputedStyle liefert ein LEBENDIGES Objekt: Wird die Klasse entfernt,
  // aendern sich seine Werte mit. Erst auslesen, dann aufraeumen – sonst misst
  // man den Knopf ohne Ladekreis und wundert sich ueber "none".
  const nachher = getComputedStyle(b, '::after');
  const ring = String(nachher.animationName);
  const dick = String(nachher.width);
  b.classList.remove('laedt');
  return {
    gleicheBreite: Math.abs(vor.width - nach.width) < 1,
    gleicheHoehe: Math.abs(vor.height - nach.height) < 1,
    ring, sichtbar: dick,
  };
});
check('Der Knopf springt beim Laden nicht in der Groesse',
  knopf.gleicheBreite && knopf.gleicheHoehe);
check('Und zeigt einen drehenden Ring', knopf.ring === 'kreisel', knopf.ring);
check('Der einen Durchmesser hat', parseFloat(knopf.sichtbar) > 8, knopf.sichtbar);

const appQuelle = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
check('Und der Knopf bekommt die Klasse wirklich – und nimmt sie zurueck',
  /btn\.classList\.add\('laedt'\)/.test(appQuelle)
  && /btn\.classList\.remove\('laedt'\)/.test(appQuelle));

// ---------------------------------------------------------------------------
// Teilen heisst kopieren
// ---------------------------------------------------------------------------
// Hier klappte auf dem Handy das Systemmenue hoch (WhatsApp, Mail, ...). Der
// Knopf traegt aber ein Kettensymbol und verspricht damit einen Link, kein
// Menue – und meistens will man ihn ohnehin nur in der Zwischenablage haben.
// Geprueft wird GENAU teilePoll und nicht die ganze Datei.
//
// Der erste Anlauf suchte in app.js insgesamt nach navigator.share und schlug
// an – zu Recht: Es gibt einen zweiten Aufruf, beim BILD-Knopf. Der ist eine
// andere Sache und bleibt. Ein Bild laesst sich auf dem Handy schlecht "in die
// Zwischenablage" legen; dort ist das Systemmenue der richtige Weg, um es
// nach X zu bringen. Beim Link ist es das nicht.
const teilenQuelle = (() => {
  const a = appQuelle.indexOf('async function teilePoll(id) {');
  return a < 0 ? '' : appQuelle.slice(a, appQuelle.indexOf('\n}', a));
})();
check('teilePoll ist auffindbar', teilenQuelle.length > 0);
check('Der Link-Knopf oeffnet kein Systemmenue mehr',
  !/navigator\.share/.test(teilenQuelle.split('\n')
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')));
check('Sondern kopiert den Link', /if \(await copyText\(url\)\)/.test(teilenQuelle));
// Und die Gegenprobe, damit die Zeile darueber nicht einfach deshalb gruen
// ist, weil der Ausschnitt leer waere: Beim Bild-Knopf steht es weiterhin.
check('Beim Bild-Knopf bleibt das Menue dagegen stehen',
  /navigator\.share\(\{ files: \[datei\] \}\)/.test(appQuelle));

// ---------------------------------------------------------------------------
// Gerollt wird IN den Listen, nicht an der Seite
// ---------------------------------------------------------------------------
//
// Der Befund kam vom Geraet: Wer im DM-Fenster oder in den Abstimmungen bis
// ans Ende wischt, dessen Wisch wurde ab dort an die Seite weitergereicht –
// die ganze Ansicht rutschte nach oben oder unten weg. Auf dem Startbildschirm
// sieht das aus, als loese sich die App vom Rand.
//
// Zwei Dinge muessen dafuer stimmen, und beide einzeln geprueft: Die Seite
// darf gar nicht rollen koennen, und die Listen duerfen nichts weiterreichen.
await page.setViewportSize({ width: 375, height: 667 });
const rollen = await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  const t = document.querySelector('#dm-thread');
  // Reichlich Inhalt – sonst rollt gar nichts und die Messung waere gratis.
  t.innerHTML = Array.from({ length: 60 }, (_, i) =>
    `<div class="dm-row"><div class="msg dm"><span class="body">Nachricht ${i}</span></div></div>`).join('');
  // Ein zu hoher Klotz in den Koerper. Ohne ihn passt die Seite ohnehin
  // genau in den Bildschirm und liesse sich auch ohne jede Regel nicht
  // verschieben – die Messung waere dann gratis und faende nichts. Mit ihm
  // WUERDE die Seite rollen, wenn man sie liesse; genau das ist die Frage.
  const klotz = document.createElement('div');
  klotz.style.cssText = 'height: 3000px';
  document.body.append(klotz);

  const se = document.scrollingElement;

  // Erst die Gegenprobe: Mit von Hand aufgehobener Sperre MUSS sich die Seite
  // verschieben lassen. Tut sie das nicht, ist der Klotz zu klein oder der
  // Aufbau anders als gedacht – und die Messung darunter waere wertlos.
  document.documentElement.style.overflow = 'visible';
  document.body.style.overflow = 'visible';
  se.scrollTop = 9999;
  const ohneSperre = se.scrollTop;
  se.scrollTop = 0;
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';

  // Und jetzt mit der Sperre aus dem Stilblatt.
  se.scrollTop = 9999;
  const seiteVerschoben = se.scrollTop;
  klotz.remove();

  t.scrollTop = 99999;
  return {
    seiteVerschoben,
    ohneSperre,
    kette: getComputedStyle(t).overscrollBehaviorY,
    balken: getComputedStyle(t).scrollbarWidth,
    balkenPolls: getComputedStyle(document.querySelector('#poll-list')).scrollbarWidth,
    // Gegenprobe: Anderswo bleibt der Strich. Ohne diese Zeile waere oben
    // auch dann alles gruen, wenn die Regel versehentlich JEDE Rollleiste
    // der Seite abgeschaltet haette.
    // Der Koerper hat keine eigene Regel dazu; sein Wert ist der des
    // Browsers. Steht dort etwas anderes als "auto", hat eine Regel weiter
    // gegriffen als gedacht.
    balkenSonstwo: getComputedStyle(document.body).scrollbarWidth,
    listeRollt: t.scrollTop > 0,
  };
});
check('Die Seite selbst laesst sich nicht verschieben',
  rollen.seiteVerschoben === 0, `scrollTop ${rollen.seiteVerschoben}`);
// Gegenprobe dazu: Der Klotz war wirklich zu hoch. Ohne diese Zeile waere die
// Pruefung darueber auch dann gruen, wenn gar nichts zu rollen da gewesen ist.
check('Gegenprobe: ohne die Sperre liesse sie sich sehr wohl verschieben',
  rollen.ohneSperre > 0, `scrollTop ${rollen.ohneSperre}`);
check('Die Liste reicht den Wisch nicht an die Seite weiter',
  rollen.kette === 'contain', rollen.kette);
// Gegenprobe: Ohne diese Zeile waere alles oben auch dann gruen, wenn die
// Liste ueberhaupt nicht rollte.
check('Gegenprobe: die Liste rollt trotzdem', rollen.listeRollt);
check('Im Gespraech gibt es keine Rollleiste', rollen.balken === 'none', rollen.balken);
check('Bei den Abstimmungen auch nicht', rollen.balkenPolls === 'none', rollen.balkenPolls);
check('Gegenprobe: die Regel greift nicht auf die ganze Seite durch',
  rollen.balkenSonstwo === 'auto', rollen.balkenSonstwo);

// ---------------------------------------------------------------------------
// Die Tastatur darf nur das Gespraech kuerzen, nicht die Ansicht schieben
// ---------------------------------------------------------------------------
//
// Befund vom Geraet: Tippt man auf dem Handy eine DM, wandert alles nach oben
// aus dem Bild – Kopfzeile, Reiter, der obere Rand des Rahmens.
//
// Was hier NICHT geprueft werden kann: ob iOS danach wirklich aufhoert zu
// schieben. Dafuer braucht es eine Tastatur, und die gibt es in diesem
// Chromium nicht. Was geprueft werden KANN, ist die Folge, auf der die Loesung
// beruht – und die ist der eigentliche Anspruch:
//
//   Wird die Seite kuerzer, darf sich oberhalb des Gespraechs NICHTS bewegen.
//   Die ganze Verkleinerung muss in der Liste ankommen.
//
// Stimmt das nicht, hilft auch die beste Tastaturerkennung nichts: Dann
// wandert eben beim Schrumpfen, was vorher beim Schieben wanderte.
await page.setViewportSize({ width: 390, height: 844 });
const tastatur = await page.evaluate(() => {
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  // Der Abstimmungsbereich ist aus einer frueheren Pruefung noch offen. Beide
  // Bereiche sind flex: 1 im selben Stapel und teilen sich dann die Hoehe –
  // der Rahmen sass dadurch mitten auf dem Bild, und die Messung mass etwas
  // anderes als das, was sie behauptet. Im Betrieb ist immer genau einer da.
  document.querySelector('#pane-polls').hidden = true;
  document.querySelector('#pane-dms').hidden = false;
  document.querySelector('#dm-user').hidden = false;
  document.querySelector('#dm-thread').innerHTML =
    Array.from({ length: 40 }, (_, i) =>
      `<div class="dm-row"><div class="dm-block"><div class="msg dm">`
      + `<span class="body">Nachricht ${i}</span></div></div></div>`).join('');

  const messen = () => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return {
      kopf: Math.round(r('.topbar').top),
      reiter: Math.round(r('.tabs').top),
      rahmen: Math.round(r('#dm-user').top),
      eingabe: Math.round(r('#dm-input').bottom),
      liste: Math.round(r('#dm-thread').height),
    };
  };
  const vorher = messen();

  // Die Tastatur nachstellen: Genau das, was app.js tut, wenn
  // visualViewport meldet, dass unten etwas verdeckt ist – BEIDE Zeilen.
  const TASTATUR = 336;
  // Wie weit iOS den Ausschnitt dabei schiebt, haengt daran, wo das
  // Eingabefeld liegt. Ein mittlerer Wert genuegt: Geprueft wird, dass die
  // Ansicht ihn ausgleicht, nicht wie gross er ist.
  const VERSATZ = 120;
  document.documentElement.style.setProperty(
    '--sicht', `${innerHeight - TASTATUR}px`);
  document.documentElement.style.setProperty('--versatz', `${VERSATZ}px`);
  const nachher = messen();

  // Und dieselbe Lage OHNE den Ausgleich – so sah es aus, als der Befund kam:
  // Die ganze Ansicht stand um den Versatz zu hoch.
  document.documentElement.style.removeProperty('--versatz');
  const ohneAusgleich = messen();

  document.documentElement.style.setProperty('--versatz', `${VERSATZ}px`);
  document.documentElement.style.removeProperty('--sicht');
  document.documentElement.style.removeProperty('--versatz');
  const zurueck = messen();

  return { vorher, nachher, ohneAusgleich, zurueck,
    tastatur: TASTATUR, versatz: VERSATZ };
});

const t = tastatur;
// Die Kopfzeile muss dort stehen, wo der sichtbare Ausschnitt beginnt – also
// um den Versatz tiefer als vorher, gemessen in den Koordinaten der Seite.
// Auf dem Bildschirm ist das genau dieselbe Stelle wie ohne Tastatur.
check('Die Kopfzeile bleibt stehen, wenn die Tastatur kommt',
  t.nachher.kopf === t.vorher.kopf + t.versatz,
  `${t.vorher.kopf} -> ${t.nachher.kopf}, erwartet ${t.vorher.kopf + t.versatz}`);
// Das ist der Befund vom Geraet, nachgestellt: Ohne den Ausgleich steht alles
// um den Versatz zu hoch – die ganze Seite ist nach oben gewandert.
check('Gegenprobe: ohne den Ausgleich wandert sie sehr wohl nach oben',
  t.ohneAusgleich.kopf === t.vorher.kopf,
  `${t.ohneAusgleich.kopf} statt ${t.vorher.kopf + t.versatz}`);
check('Die Reiter ebenso', t.nachher.reiter === t.vorher.reiter + t.versatz,
  `${t.vorher.reiter} -> ${t.nachher.reiter}`);
check('Und der obere Rand des Gespraechsrahmens',
  t.nachher.rahmen === t.vorher.rahmen + t.versatz,
  `${t.vorher.rahmen} -> ${t.nachher.rahmen}`);
// Die Verkleinerung muss irgendwo ankommen – und zwar dort und nur dort.
check('Gekuerzt wird stattdessen das Gespraech',
  t.vorher.liste - t.nachher.liste === t.tastatur,
  `${t.vorher.liste} -> ${t.nachher.liste} px (erwartet ${t.tastatur} weniger)`);
// Der Sinn der Sache: Das Eingabefeld muss ueber die Tastatur rutschen.
check('Und die Eingabezeile steigt genau um die Tastaturhoehe',
  t.vorher.eingabe - t.nachher.eingabe === t.tastatur - t.versatz,
  `${t.vorher.eingabe} -> ${t.nachher.eingabe}`);
// Und wieder zurueck, sobald die Tastatur weg ist. Ohne diese Zeile waere
// oben auch dann alles gruen, wenn --sicht haengenbliebe.
check('Gegenprobe: ohne --sicht ist alles wieder wie vorher',
  JSON.stringify(t.zurueck) === JSON.stringify(t.vorher));

// Und die Verdrahtung: Ohne den Beobachter setzt niemand --sicht.
const appQ = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
// Und der Versatz muss aus visualViewport.offsetTop kommen und nirgendwo
// anders her – geraten laesst er sich nicht.
check('app.js liest den Versatz aus visualViewport.offsetTop',
  /--versatz['"`],\s*`\$\{vv\.offsetTop\}px`/.test(appQ));
check('app.js hoert auf visualViewport',
  /visualViewport/.test(appQ) && /addEventListener\('resize'/.test(appQ));
check('Und nimmt die Zeile wieder weg, statt sie zu ueberschreiben',
  /removeProperty\('--sicht'\)/.test(appQ));
// Eine Schwelle muss es geben: visualViewport.height aendert sich auch, wenn
// Safaris Adressleiste ein- und ausfaehrt. Ohne Schwelle zuckte das Blatt bei
// jedem Wisch.
check('Und unterscheidet eine Tastatur von einer Browserleiste',
  /TASTATUR_AB_PX/.test(appQ));

// Auf dem Anmeldebildschirm darf die Karte dagegen NACH OBEN AUSWEICHEN.
// ---------------------------------------------------------------------------
// Hier stand eine Weile das Gegenteil: app.js hielt die Karte fest, damit sie
// nicht wandert. Gewuenscht war es andersherum – dort soll Platz gemacht werden,
// und das ist auch der Unterschied zur App: In der App steht oben etwas, das
// stehenbleiben MUSS (Kopfzeile, Reiter). Auf dem Anmeldebildschirm steht dort
// nichts als Luft, und Luft darf weichen, wenn das Eingabefeld sonst unter der
// Tastatur laege.
//
// Geprueft wird deshalb, dass NIEMAND die Karte festhaelt – sonst kaeme die
// Sonderbehandlung bei der naechsten Umarbeitung unbemerkt zurueck.
const appQuelleLogin = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
check('Die Anmeldekarte wird nicht festgehalten',
  !/loginEinfrieren|marginTop\s*=/.test(appQuelleLogin));

// ---------------------------------------------------------------------------
// Und die Anmeldekarte bleibt trotzdem ganz erreichbar
// ---------------------------------------------------------------------------
// Seit die Seite nicht mehr rollt, muss der Anmeldebildschirm es selbst
// koennen. Der Fallstrick dabei ist justify-content: center in einem rollbaren
// Kasten: Passt der Inhalt nicht, schiebt es seinen Anfang NACH OBEN HINAUS,
// und dorthin kann man nicht rollen. Deshalb steht die Karte ueber einen
// automatischen Rand mittig und nicht ueber justify-content.
const loginLage = async (hoehe) => {
  await page.setViewportSize({ width: 375, height: hoehe });
  return page.evaluate(() => {
    document.querySelector('#app').hidden = true;
    document.querySelector('#login').hidden = false;
    document.querySelector('#step-install').hidden = true;
    document.querySelector('#step-address').hidden = false;
    const l = document.querySelector('#login');
    // Ausdruecklich die Karte IM Login. Seit es den Vorhang gibt ("Launching
    // soon"), tragen zwei Abschnitte die Klasse .login-card, und der erste im
    // Blatt ist der versteckte Vorhang – ein verstecktes Element misst sich
    // als 0 x 0. Der Test meldete daraufhin "0 px von oben" und sah aus, als
    // saesse die Anmeldekarte am oberen Rand.
    const k = document.querySelector('#login .login-card');
    l.scrollTop = 0;
    const obenAbgeschnitten = Math.round(
      k.getBoundingClientRect().top - l.getBoundingClientRect().top);
    l.scrollTop = 999999;
    const untenFehlt = Math.round(
      k.getBoundingClientRect().bottom - l.getBoundingClientRect().bottom);
    return { obenAbgeschnitten, untenFehlt, passt: l.scrollHeight <= l.clientHeight + 1 };
  });
};
const hoch = await loginLage(667);
const kurz = await loginLage(320);
check('Auf einem hohen Bildschirm steht die Karte mittig',
  hoch.passt && hoch.obenAbgeschnitten > 40, `${hoch.obenAbgeschnitten} px von oben`);
check('Auf einem kurzen ist oben nichts abgeschnitten',
  kurz.obenAbgeschnitten >= 0, `${kurz.obenAbgeschnitten} px`);
check('Und unten alles erreichbar', kurz.untenFehlt <= 0, `${kurz.untenFehlt} px`);
await page.setViewportSize({ width: 375, height: 667 });

// ---------------------------------------------------------------------------
// Ansem legt auf dem Handy eine Abstimmung an
// ---------------------------------------------------------------------------
//
// Drei Befunde, alle nachhandyForm und alle unangenehm auf genau die Art, die
// man erst merkt, wenn man es wirklich tut:
//
//   1. "+ New poll" war 84 x 18 px. Das ist der Schalter, mit dem er ueberhaupt
//      erst an das Formular kommt.
//   2. Die Eintraege in Days/Hours/Minutes waren 27 x 32 px – und getroffen hat
//      man sie nur genau auf der Ziffer, nicht auf der Zeile.
//   3. Der schlimmste: Mit fuenf Antworten und offener Tastatur endete das
//      Formular bei 604 px, sichtbar waren 508. "Start poll" stand 95 px unter
//      dem Rand, und der Bereich liess sich nicht rollen. Die Abstimmung war
//      fertig getippt und nicht abzuschicken.
const anlegen = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
await anlegen.goto(base + '/', { waitUntil: 'load' });
const handyForm = await anlegen.evaluate(() => {
  const $ = (x) => document.querySelector(x);
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#pane-dms').hidden = true;
  $('#pane-polls').hidden = false;
  $('#poll-admin').hidden = false;

  const pane = $('#pane-polls');
  const zu = getComputedStyle(pane).overflowY;

  $('#poll-admin-felder').hidden = false;
  // Fuenf Antworten, wie bei einer richtigen Abstimmung.
  const kasten = $('#poll-options');
  while (kasten.children.length < 5) kasten.append(kasten.lastElementChild.cloneNode(true));

  const hoch = (s) => Math.round($(s).getBoundingClientRect().height);

  // Die Trefferflaeche, nicht der Kasten.
  // -----------------------------------------------------------------------
  // Der Knopf DARF nicht hoeher werden – daran haengt, dass die Ueberschrift
  // auf einer Linie mit den Fragen bleibt und beim Aufklappen nichts springt.
  // Gemessen wird deshalb, was ein Finger trifft: ein Punkt 20 px ueber der
  // Mitte des Knopfes muss noch bei ihm landen.
  const knopf = $('#btn-poll-neu');
  const kb = knopf.getBoundingClientRect();
  const trifft = (dy) => {
    const el = document.elementFromPoint(
      Math.round(kb.left + kb.width / 2), Math.round(kb.top + kb.height / 2 + dy));
    return Boolean(el && (el === knopf || knopf.contains(el) || el.closest('#btn-poll-neu')));
  };
  // -35 und nicht weiter weg: Der Knopf ist 18 px hoch, die Flaeche reicht
  // 13 px darueber hinaus – ab 22 px von der Mitte ist man draussen. Bei -60
  // liegt der Punkt schon in der Kopfzeile, und die faengt ihn ohnehin ab;
  // eine Gegenprobe, die aus dem falschen Grund gruen ist, prueft nichts.
  const treffer = { oben: trifft(-20), unten: trifft(20), weitWeg: trifft(-35) };

  // Die Liste einmal oeffnen und einen Eintrag ausmessen.
  const liste = $('#lz-liste-minuten');
  liste.hidden = false;
  liste.innerHTML = '<button class="lz-eintrag" type="button">37</button>';
  const e = liste.querySelector('.lz-eintrag').getBoundingClientRect();
  const lr = liste.getBoundingClientRect();
  const eintrag = { h: Math.round(e.height), w: Math.round(e.width),
    listeBreite: Math.round(lr.width), listeUnten: Math.round(lr.bottom) };
  liste.hidden = true;

  // Und jetzt die Tastatur, genau wie app.js sie nachfuehrt.
  const TASTATUR = 336;
  document.documentElement.style.setProperty('--sicht', `${innerHeight - TASTATUR}px`);
  const sichtbar = innerHeight - TASTATUR;
  const knopfVor = Math.round($('#btn-create-poll').getBoundingClientRect().bottom);
  pane.scrollTop = 99999;
  const knopfNach = Math.round($('#btn-create-poll').getBoundingClientRect().bottom);
  const offen = getComputedStyle(pane).overflowY;
  pane.scrollTop = 0;
  document.documentElement.style.removeProperty('--sicht');

  return { neu: hoch('#btn-poll-neu'), treffer, eintrag, zu, offen,
    sichtbar, knopfVor, knopfNach };
});
await anlegen.close();

check('Der Schalter "+ New poll" ist daumentauglich',
  handyForm.treffer.oben && handyForm.treffer.unten,
  `20 px darueber: ${handyForm.treffer.oben}, darunter: ${handyForm.treffer.unten}`);
// Gegenprobe: Die Flaeche ist gewachsen, nicht die halbe Seite. 60 px ueber
// der Mitte gehoert schon der Kopfzeile.
check('Gegenprobe: weiter weg trifft man ihn nicht mehr',
  !handyForm.treffer.weitWeg);
// Und der Kasten selbst bleibt so hoch wie er war – daran haengen zwei
// Zusagen in test-polls-tab.mjs (Linie mit den Fragen, kein Sprung beim
// Aufklappen), die der erste Versuch mit min-height gerissen hat.
check('Und der Kasten selbst ist NICHT gewachsen',
  handyForm.neu < 30, `${handyForm.neu} px hoch`);
check('Ein Eintrag in der Laufzeit-Liste ebenso',
  handyForm.eintrag.h >= 44, `${handyForm.eintrag.h} px hoch`);
// Die Breite ist der zweite Teil desselben Fehlers: Ein Eintrag, der nur so
// breit ist wie seine Ziffer, laesst sich nur auf der Ziffer treffen.
check('Und er nimmt die ganze Breite der Liste',
  handyForm.eintrag.w >= handyForm.eintrag.listeBreite - 12,
  `${handyForm.eintrag.w} von ${handyForm.eintrag.listeBreite} px`);
// Die Liste klappt nach unten auf – sie darf nicht ueber den Bildschirm
// hinausreichen, sonst ist ihr unteres Ende nicht zu sehen.
check('Die Liste bleibt im Bild',
  handyForm.eintrag.listeUnten <= 844, `${handyForm.eintrag.listeUnten} px`);

// Der wichtigste Teil: Das Formular ist laenger als der Platz – und trotzdem
// erreichbar.
check('Gegenprobe: mit Tastatur steht der Knopf zunaechst unter dem Rand',
  handyForm.knopfVor > handyForm.sichtbar,
  `${handyForm.knopfVor} px bei ${handyForm.sichtbar} px sichtbar`);
check('Nach dem Rollen ist "Start poll" erreichbar',
  handyForm.knopfNach <= handyForm.sichtbar,
  `${handyForm.knopfNach} px bei ${handyForm.sichtbar} px sichtbar`);
check('Der Bereich rollt, solange das Formular offen ist',
  handyForm.offen === 'auto', handyForm.offen);
// Und nur dann. Zwei Rollflaechen ineinander sind eine Falle; solange Ansem
// nichts anlegt, gibt es weiterhin genau eine.
check('Gegenprobe: bei geschlossenem Formular rollt er nicht',
  handyForm.zu !== 'auto' && handyForm.zu !== 'scroll', handyForm.zu);

await browser.close();
server.close();

console.log(failed ? `\n  ${failed} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(failed ? 1 : 0);
