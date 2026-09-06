// ============================================================================
// Halten die Sicherheitskopfzeilen – und hält die Seite sie aus?
//
// Eine Content-Security-Policy ist die einzige Einstellung der ganzen Seite,
// bei der ein Fehler in BEIDE Richtungen teuer ist:
//
//   zu weich -> sie schützt nicht, und niemand merkt es
//   zu streng -> sie bricht etwas, und niemand merkt es SOFORT. Ein blockiertes
//                Bild, ein blockierter WebSocket: Die Seite sieht normal aus,
//                nur die DMs kommen nicht mehr an. Der Browser schreibt es in
//                eine Konsole, die niemand offen hat.
//
// Deshalb wird hier nicht gelesen, sondern ausgeführt: public/ wird mit den
// Kopfzeilen aus der ECHTEN _headers-Datei ausgeliefert, die echte index.html
// in einem echten Browser geladen, und jeder Verstoss mitgeschrieben, den der
// Browser meldet.
//
// Die Regeln werden dabei aus public/_headers geparst, nicht hier
// nachgeschrieben. Eine Prüfung gegen eine Abschrift prüft die Abschrift.
//
//   node scripts/test-header.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rohHeaders = fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8');

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
// _headers parsen – dieselbe Form, die Netlify liest
// ---------------------------------------------------------------------------

function parseHeaders(text) {
  const bloecke = [];
  let aktuell = null;
  for (const zeile of text.split('\n')) {
    if (!zeile.trim() || zeile.trim().startsWith('#')) continue;
    if (!zeile.startsWith(' ') && !zeile.startsWith('\t')) {
      aktuell = { pfad: zeile.trim(), kopf: {} };
      bloecke.push(aktuell);
      continue;
    }
    const i = zeile.indexOf(':');
    if (i < 0 || !aktuell) continue;
    aktuell.kopf[zeile.slice(0, i).trim()] = zeile.slice(i + 1).trim();
  }
  return bloecke;
}

const bloecke = parseHeaders(rohHeaders);
const stern = bloecke.filter((b) => b.pfad === '/*');
const pBlock = bloecke.find((b) => b.pfad === '/p/*');
// Netlify führt mehrere Blöcke desselben Pfads zusammen.
const appKopf = Object.assign({}, ...stern.map((b) => b.kopf));

pruefe('public/_headers hat einen Block für /* und einen für /p/*',
  stern.length > 0 && !!pBlock, `${bloecke.length} Blöcke`);

const csp = appKopf['Content-Security-Policy'] ?? '';
const cspP = pBlock?.kopf['Content-Security-Policy'] ?? '';

// ---------------------------------------------------------------------------
console.log('\nDie Regeln selbst\n');
// ---------------------------------------------------------------------------

const teil = (regel, name) =>
  (regel.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) ?? '')
    .slice(name.length).trim();

pruefe('Skripte dürfen nur von der Seite selbst kommen',
  teil(csp, 'script-src') === "'self'", teil(csp, 'script-src') || '(fehlt)');
// Die eine Zeile, an der alles hängt. Wer hier 'unsafe-inline' einbaut, hebt
// den Schutz gegen eingeschleusten Code auf – und die Datei sähe weiter
// vollständig aus.
pruefe('Und ausdrücklich NICHT inline',
  !/unsafe-inline|unsafe-eval/.test(teil(csp, 'script-src')));

pruefe('Alles Nichtgenannte ist verboten',
  teil(csp, 'default-src') === "'none'", teil(csp, 'default-src') || '(fehlt)');
pruefe('Die Seite lässt sich nicht in einen fremden Rahmen legen',
  teil(csp, 'frame-ancestors') === "'none'" && appKopf['X-Frame-Options'] === 'DENY');
pruefe('base-uri, form-action und object-src sind zu',
  ["base-uri", "form-action", "object-src"].every((d) => teil(csp, d) === "'none'"));

const verbindung = teil(csp, 'connect-src');
pruefe('connect-src nennt die Datenbank über https',
  /https:\/\/[^\s]+\.supabase\.co/.test(verbindung), verbindung);
// Ohne wss:// verbindet sich die Live-Leitung nicht mehr, und man sieht es
// erst im Betrieb: die Seite laedt normal, nur DMs kommen nie an.
pruefe('UND die Live-Leitung über wss – sonst kommen keine DMs mehr an',
  /wss:\/\/[^\s]+\.supabase\.co/.test(verbindung));
pruefe('Beide zeigen auf dasselbe Projekt',
  (verbindung.match(/(?:https|wss):\/\/([^\s]+)/g) ?? [])
    .map((s) => s.replace(/^\w+:\/\//, '')).every((h, _, a) => h === a[0]), verbindung);

pruefe('Keine gemischten Inhalte: alles wird auf https gehoben',
  /upgrade-insecure-requests/.test(csp));
pruefe('Die Herkunft wird beim Klick nach draussen nicht verraten',
  appKopf['Referrer-Policy'] === 'no-referrer', appKopf['Referrer-Policy'] || '(fehlt)');
pruefe('Kein Raten am Inhaltstyp', appKopf['X-Content-Type-Options'] === 'nosniff');

const hsts = appKopf['Strict-Transport-Security'] ?? '';
pruefe('https wird für zwei Jahre erzwungen',
  /max-age=(\d+)/.test(hsts) && Number(/max-age=(\d+)/.exec(hsts)[1]) >= 31536000, hsts);
// preload ist eine Einbahnstrasse: raus aus der Browserliste dauert Monate.
// Bewusst erst, wenn die Seite ein Jahr steht.
pruefe('Aber ohne preload – das ist eine Einbahnstrasse', !/preload/.test(hsts));

const pp = appKopf['Permissions-Policy'] ?? '';
pruefe('Kamera, Mikrofon und Ort sind abgeschaltet',
  ['camera', 'microphone', 'geolocation'].every((f) => pp.includes(`${f}=()`)));

// Geteilte Links: /p/* bekommt bewusst KEINE eigene CSP.
//
// Hier stand eine weichere Ausnahme, mit der Begruendung, die og-Function
// liefere eine Seite mit Inline-Skript. Gemessen am 3.9.2026 liefert sie
// Menschen ein leeres HTTP 302 – kein HTML, nichts zu blockieren. Und
// Netlify legt auf eine durchgereichte Antwort ohnehin keine Kopfzeilen aus
// dieser Datei (bewiesen daran, dass dort Supabases HSTS-Wert stand, nicht
// unserer). Eine Regel dort waere doppelt wirkungslos gewesen.
pruefe('/p/* traegt keine eigene, weichere CSP mehr',
  !/unsafe-inline/.test(cspP), cspP || 'keine CSP – richtig so');
pruefe('Nur die Content-Type-Zeile bleibt dort stehen',
  pBlock?.kopf['Content-Type']?.startsWith('text/html'),
  pBlock?.kopf['Content-Type'] ?? '(fehlt)');
// Und die eigentliche Zusicherung: Die App laeuft unter der strengen Regel,
// ohne dass irgendwo eine Lockerung dafuer noetig war.
pruefe('Die App laeuft ohne jede Skript-Lockerung',
  !/script-src[^;]*unsafe-inline/.test(csp));

// Die Weiterleitung ist ein echtes 302 der og-Function, kein Inline-Skript –
// das ist der Grund, warum die strenge Regel geteilten Links nichts anhaben
// kann. Wenn jemand das je umbaut, muss diese Pruefung anschlagen.
const ogTs = fs.readFileSync(
  path.join(root, 'supabase/functions/og/index.ts'), 'utf8');
pruefe('Menschen bekommen von /p/* eine echte Weiterleitung, keine Seite',
  /if \(!istCrawler\) \{[\s\S]{0,200}status: 302/.test(ogTs));

// ---------------------------------------------------------------------------
console.log('\nUnd jetzt der Browser: hält die Seite die Regeln aus?\n');
// ---------------------------------------------------------------------------

// Die Platzhalter zeigen auf ein Projekt, das es nicht gibt. Für die Messung
// wird daraus der eigene Testserver – so laufen die Anfragen wirklich los und
// ein zu enges connect-src fiele auf.
const PROJEKT = 'testprojekt.supabase.co';
const cspTest = csp.replace(/DEIN-PROJEKT\.supabase\.co/g, PROJEKT);

const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  const kopf = { 'Content-Security-Policy': cspTest };
  // config.js muss auf DENSELBEN Host zeigen wie die umgerechnete Regel.
  // ---------------------------------------------------------------------------
  // Sonst prueft das hier etwas anderes, als es behauptet: Die Anfrage ginge an
  // DEIN-PROJEKT, die Regel erlaubt testprojekt, und der Verstoss waere ein
  // Fehler der Vorrichtung statt einer Aussage ueber die Seite.
  //
  // Aufgefallen ist das erst, als app.js anfing, VOR dem Login etwas zu laden
  // (die Abfrage, ob die Seite zu ist). Vorher ging vor dem Login gar nichts
  // ins Netz, und der Widerspruch lag jahrelang unbemerkt da.
  if (pfad === '/config.js') {
    return res.writeHead(200, { ...kopf, 'content-type': 'text/javascript' })
      .end(fs.readFileSync(path.join(root, 'public', 'config.js'), 'utf8')
        .replace(/DEIN-PROJEKT\.supabase\.co/g, PROJEKT));
  }
  for (const [k, v] of Object.entries(appKopf)) {
    if (k !== 'Content-Security-Policy') kopf[k] = v;
  }
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404, kopf).end('');
  }
  kopf['Content-Type'] = TYPEN[path.extname(datei)] ?? 'application/octet-stream';
  res.writeHead(200, kopf).end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 420, height: 860 } });

// Jeden Verstoss mitschreiben, den der Browser meldet – das ist die Messung.
const verstoesse = [];
await seite.addInitScript(() => {
  globalThis.__verstoesse = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    globalThis.__verstoesse.push({
      richtlinie: e.violatedDirective,
      quelle: String(e.blockedURI).slice(0, 120),
    });
  });
});
seite.on('console', (m) => {
  if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) {
    verstoesse.push({ richtlinie: '(Konsole)', quelle: m.text().slice(0, 160) });
  }
});

await seite.goto(base, { waitUntil: 'networkidle' });
await seite.waitForTimeout(400);

const gemeldet = await seite.evaluate(() => globalThis.__verstoesse ?? []);
const alle = [...gemeldet, ...verstoesse];

// styles.css, app.js, supabase.js aus vendor/, das SVG-Symbol als data:, die
// manifest-Datei: Wenn eines davon blockiert wird, steht es jetzt hier.
pruefe('Die Seite lädt unter der Regel ohne einen einzigen Verstoss',
  alle.length === 0,
  alle.length ? alle.map((v) => `${v.richtlinie}: ${v.quelle}`).join(' | ') : '');

pruefe('Und das Stylesheet ist wirklich angekommen (Gegenprobe)',
  await seite.evaluate(() =>
    getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'),
  await seite.evaluate(() => getComputedStyle(document.body).backgroundColor));

// Warten, statt sofort zu schauen.
// ---------------------------------------------------------------------------
// Seit boot() zuerst fragt, ob die Seite zu ist, geht dem ersten sichtbaren
// Bildschirm eine Netzantwort voraus. Hier zeigt die Testadresse ins Leere,
// die Anfrage scheitert, und app.js faellt danach auf den Login zurueck – das
// dauert ein paar Millisekunden. Wer in dem Moment schon misst, sieht eine
// leere Seite und haelt sie fuer einen Fehler.
const einerSichtbar = await seite.waitForFunction(() =>
  ['#login', '#app', '#soon'].some((s) => document.querySelector(s)
    && !document.querySelector(s).hidden), null, { timeout: 5000 })
  .then(() => true).catch(() => false);
pruefe('Und app.js ist wirklich gelaufen (Gegenprobe)', einerSichtbar,
  'keiner der drei Bildschirme wurde sichtbar');

// ---------------------------------------------------------------------------
// Der Balken – die Stelle, an der 'unsafe-inline' beim Stil hängt
// ---------------------------------------------------------------------------
// pollHtml setzt style="width:61.8%" direkt in die Auszeichnung. Wird
// 'unsafe-inline' bei style-src je entfernt, stehen ALLE Balken auf null, und
// die Seite sieht dabei völlig normal aus – nur alle Abstimmungen wirken
// unbeantwortet. Deshalb wird hier die echte Zeile aus app.js eingesetzt und
// die Breite in Pixeln nachgemessen.

const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const balkenZeile = /<div class="opt-fill" style="width:\$\{[^}]+\}%"><\/div>/.exec(appJs);
pruefe('Die Balkenbreite steht wirklich als style-Attribut in app.js',
  !!balkenZeile, balkenZeile ? balkenZeile[0].slice(0, 60) : 'Form geändert – Prüfung unten neu fassen');

const breite = await seite.evaluate(() => {
  const wirt = document.createElement('div');
  wirt.style.width = '300px';
  wirt.innerHTML = '<div class="opt"><div class="opt-bar">'
    + '<div class="opt-fill" style="width:61.8%"></div></div></div>';
  document.body.appendChild(wirt);
  const b = wirt.querySelector('.opt-fill').getBoundingClientRect().width;
  wirt.remove();
  return b;
});
pruefe('Und der Balken hat unter dieser Regel wirklich Breite',
  breite > 10, `${breite.toFixed(1)} px`);

// ---------------------------------------------------------------------------
// Die Live-Leitung – die Zeile, deren Fehlen man erst im Betrieb merkt
// ---------------------------------------------------------------------------
// connect-src muss die Datenbank ZWEIMAL nennen: einmal https:// für die
// Abfragen, einmal wss:// für die Live-Leitung. Eine CSP behandelt die beiden
// als verschiedene Ziele. Fehlte das wss://, liefe die Seite scheinbar
// normal – DMs kämen nur nie an.
//
// Hier wird das nicht gelesen, sondern ausprobiert: zwei WebSockets, einer
// zur erlaubten Adresse, einer zu einer fremden. Beide scheitern beim
// Verbinden (die Adressen gibt es nicht), aber nur einer davon wird von der
// Regel BLOCKIERT – und genau das ist der Unterschied, auf den es ankommt.

const wsErgebnis = await seite.evaluate(async (projekt) => {
  const versuch = (adresse) => new Promise((fertig) => {
    const gemeldet = [];
    const zuhoerer = (e) => {
      if (String(e.blockedURI).includes(new URL(adresse).host)) gemeldet.push(e.violatedDirective);
    };
    document.addEventListener('securitypolicyviolation', zuhoerer);
    try { new WebSocket(adresse); } catch { gemeldet.push('(Ausnahme)'); }
    setTimeout(() => {
      document.removeEventListener('securitypolicyviolation', zuhoerer);
      fertig(gemeldet);
    }, 300);
  });
  return {
    erlaubt: await versuch(`wss://${projekt}/realtime/v1/websocket`),
    fremd:   await versuch('wss://irgendwo-anders.example/realtime'),
  };
}, PROJEKT);

pruefe('Die Live-Leitung zur eigenen Datenbank wird NICHT blockiert',
  wsErgebnis.erlaubt.length === 0,
  wsErgebnis.erlaubt.join(', ') || 'kein Verstoss');
// Ohne diese Gegenprobe wäre die Zeile darüber auch dann grün, wenn die Regel
// überhaupt keine WebSockets prüft.
pruefe('Gegenprobe: eine fremde Live-Leitung wird sehr wohl blockiert',
  wsErgebnis.fremd.length > 0, wsErgebnis.fremd.join(', ') || 'nicht blockiert');

const fetchErgebnis = await seite.evaluate(async () => {
  const gemeldet = [];
  const zuhoerer = (e) => gemeldet.push(String(e.blockedURI).slice(0, 60));
  document.addEventListener('securitypolicyviolation', zuhoerer);
  await fetch('https://irgendwo-anders.example/klau').catch(() => {});
  await new Promise((r) => setTimeout(r, 250));
  document.removeEventListener('securitypolicyviolation', zuhoerer);
  return gemeldet;
});
pruefe('Und eine Abfrage an eine fremde Adresse ebenso',
  fetchErgebnis.length > 0, fetchErgebnis.join(', ') || 'nicht blockiert');

// ---------------------------------------------------------------------------
// Gegenprobe: Misst der Aufbau überhaupt etwas?
// ---------------------------------------------------------------------------
// Ohne diese Prüfung könnte oben alles grün sein, weil der Browser gar keine
// Verstösse meldet – etwa weil der Zuhörer nie angehängt wurde.

const streng = await browser.newPage();
const strengVerstoesse = [];
await streng.addInitScript(() => {
  globalThis.__v = [];
  document.addEventListener('securitypolicyviolation',
    (e) => globalThis.__v.push(e.violatedDirective));
});
await streng.route('**/*', (route) => {
  const p = new URL(route.request().url()).pathname;
  const datei = path.join(root, 'public', p === '/' ? '/index.html' : p);
  if (!fs.existsSync(datei)) return route.fulfill({ status: 404, body: '' });
  route.fulfill({
    status: 200,
    headers: {
      'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream',
      // Absichtlich zu streng: kein script-src. Jetzt MUSS app.js auffallen.
      'content-security-policy': "default-src 'none'; style-src 'self'",
    },
    body: fs.readFileSync(datei),
  });
});
await streng.goto('https://sized.test/', { waitUntil: 'domcontentloaded' });
await streng.waitForTimeout(400);
strengVerstoesse.push(...await streng.evaluate(() => globalThis.__v ?? []));
pruefe('Gegenprobe: eine absichtlich zu strenge Regel wird bemerkt',
  strengVerstoesse.length > 0, `${strengVerstoesse.length} Verstoss/Verstösse gemeldet`);
await streng.close();

// ---------------------------------------------------------------------------
console.log('\nDer Platzhalter\n');
// ---------------------------------------------------------------------------

// Die Datei geht mit DEIN-PROJEKT hinaus. Ausgeliefert werden darf sie so
// nicht – dann kommt die Seite an ihre eigene Datenbank nicht heran.
const nochPlatzhalter = /DEIN-PROJEKT/.test(rohHeaders);
pruefe(nochPlatzhalter
  ? 'HINWEIS: connect-src trägt noch DEIN-PROJEKT – vor dem Hochladen ersetzen'
  : 'connect-src trägt eine echte Projektadresse',
  true, nochPlatzhalter ? 'siehe sed-Befehl oben in public/_headers' : '');

await seite.close();
await browser.close();
server.close();

const fehl = befunde.filter((b) => !b.ok);
console.log(`\n  ${befunde.length - fehl.length}/${befunde.length} ok`);
if (fehl.length) {
  for (const f of fehl) console.log(`  FEHL  ${f.name}`);
  process.exit(1);
}
console.log('');
