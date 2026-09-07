// ============================================================================
// Do the security headers hold - and does the page survive them?
//
// A Content-Security-Policy is the only setting on the whole page where a
// mistake is costly in BOTH directions:
//
//   too loose -> it doesn't protect anything, and nobody notices
//   too strict -> it breaks something, and nobody notices IMMEDIATELY. A
//                 blocked image, a blocked WebSocket: the page looks normal,
//                 only the DMs stop arriving. The browser writes it to a
//                 console that nobody has open.
//
// That's why this doesn't just read the file, it runs it: public/ is served
// with the headers from the REAL _headers file, the real index.html loaded
// in a real browser, and every violation the browser reports gets recorded.
//
// The rules are parsed from public/_headers, not transcribed here again. A
// check against a copy only checks the copy.
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
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
// Parsing _headers - the same shape Netlify reads
// ---------------------------------------------------------------------------

function parseHeaders(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = { pfad: line.trim(), header: {} };
      blocks.push(current);
      continue;
    }
    const i = line.indexOf(':');
    if (i < 0 || !current) continue;
    current.header[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return blocks;
}

const blocks = parseHeaders(rohHeaders);
const stern = blocks.filter((b) => b.pfad === '/*');
const pBlock = blocks.find((b) => b.pfad === '/p/*');
// Netlify merges multiple blocks for the same path.
const appHeader = Object.assign({}, ...stern.map((b) => b.header));

check('public/_headers hat einen Block für /* und einen für /p/*',
  stern.length > 0 && !!pBlock, `${blocks.length} Blöcke`);

const csp = appHeader['Content-Security-Policy'] ?? '';
const cspP = pBlock?.header['Content-Security-Policy'] ?? '';

// ---------------------------------------------------------------------------
console.log('\nDie Regeln selbst\n');
// ---------------------------------------------------------------------------

const part = (regel, name) =>
  (regel.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) ?? '')
    .slice(name.length).trim();

check('Skripte dürfen nur von der Seite selbst kommen',
  part(csp, 'script-src') === "'self'", part(csp, 'script-src') || '(fehlt)');
// The one line everything hangs on. Anyone who adds 'unsafe-inline' here
// removes the protection against injected code - and the file would still
// look complete.
check('Und ausdrücklich NICHT inline',
  !/unsafe-inline|unsafe-eval/.test(part(csp, 'script-src')));

check('Alles Nichtgenannte ist verboten',
  part(csp, 'default-src') === "'none'", part(csp, 'default-src') || '(fehlt)');
check('Die Seite lässt sich nicht in einen fremden Rahmen legen',
  part(csp, 'frame-ancestors') === "'none'" && appHeader['X-Frame-Options'] === 'DENY');
check('base-uri, form-action und object-src sind zu',
  ["base-uri", "form-action", "object-src"].every((d) => part(csp, d) === "'none'"));

const verbindung = part(csp, 'connect-src');
check('connect-src nennt die Datenbank über https',
  /https:\/\/[^\s]+\.supabase\.co/.test(verbindung), verbindung);
// Without wss:// the live connection stops working, and you only see it in
// production: the page loads normally, only DMs never arrive.
check('UND die Live-Leitung über wss – sonst kommen keine DMs mehr an',
  /wss:\/\/[^\s]+\.supabase\.co/.test(verbindung));
check('Beide show auf dasselbe Projekt',
  (verbindung.match(/(?:https|wss):\/\/([^\s]+)/g) ?? [])
    .map((s) => s.replace(/^\w+:\/\//, '')).every((h, _, a) => h === a[0]), verbindung);

check('Keine gemischten Inhalte: alles wird auf https gehoben',
  /upgrade-insecure-requests/.test(csp));
check('Die Herkunft wird beim Klick nach draussen nicht verraten',
  appHeader['Referrer-Policy'] === 'no-referrer', appHeader['Referrer-Policy'] || '(fehlt)');
check('Kein Raten am Inhaltstyp', appHeader['X-Content-Type-Options'] === 'nosniff');

const hsts = appHeader['Strict-Transport-Security'] ?? '';
check('https wird für zwei Jahre erzwungen',
  /max-age=(\d+)/.test(hsts) && Number(/max-age=(\d+)/.exec(hsts)[1]) >= 31536000, hsts);
// preload is a one-way street: getting out of the browser list takes months.
// Deliberately only once the page has been up for a year.
check('Aber ohne preload – das ist eine Einbahnstrasse', !/preload/.test(hsts));

const pp = appHeader['Permissions-Policy'] ?? '';
check('Kamera, Mikrofon und Ort sind abgeschaltet',
  ['camera', 'microphone', 'geolocation'].every((f) => pp.includes(`${f}=()`)));

// Shared left: /p/* deliberately gets NO CSP of its own.
//
// A softer exception used to stand here, on the grounds that the og
// Function served a page with an inline script. Measured on 2026-09-03 it
// serves people an empty HTTP 302 - no HTML, nothing to block. And Netlify
// doesn't attach headers from this file to a passed-through response anyway
// (proven by the fact that Supabase's HSTS value showed up there, not
// ours). A rule there would have been doubly pointless.
check('/p/* traegt keine eigene, weichere CSP mehr',
  !/unsafe-inline/.test(cspP), cspP || 'keine CSP – richtig so');
check('Nur die Content-Type-Zeile bleibt dort stehen',
  pBlock?.header['Content-Type']?.startsWith('text/html'),
  pBlock?.header['Content-Type'] ?? '(fehlt)');
// And the actual assurance: the app runs under the strict rule without any
// loosening having been needed anywhere for it.
check('Die App running ohne jede Skript-Lockerung',
  !/script-src[^;]*unsafe-inline/.test(csp));

// The redirect is a real 302 from the og Function, not an inline script -
// that's why the strict rule can't touch shared left. If anyone ever
// rebuilds that, this check must fail.
const ogTs = fs.readFileSync(
  path.join(root, 'supabase/functions/og/index.ts'), 'utf8');
check('Menschen bekommen von /p/* eine echte Weiterleitung, keine Seite',
  /if \(!istCrawler\) \{[\s\S]{0,200}status: 302/.test(ogTs));

// ---------------------------------------------------------------------------
console.log('\nUnd jetzt der Browser: hält die Seite die Regeln aus?\n');
// ---------------------------------------------------------------------------

// The placeholders point to a project that doesn't exist. For the
// measurement, that becomes our own test server - so the requests actually
// fire, and a too-tight connect-src would show up.
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
  const file = path.join(root, 'public', pfad);
  const header = { 'Content-Security-Policy': cspTest };
  // config.js must point to the SAME host as the rewritten rule.
  // ---------------------------------------------------------------------------
  // Otherwise this would be checking something other than what it claims:
  // the request would go to DEIN-PROJEKT, the rule allows testprojekt, and
  // the violation would be a bug in the test rig instead of a statement
  // about the page.
  //
  // This only surfaced once app.js started loading something BEFORE the
  // login (the check for whether the page is closed). Before that, nothing
  // at all went out to the network before the login, and the contradiction
  // sat there unnoticed for years.
  if (pfad === '/config.js') {
    return res.writeHead(200, { ...header, 'content-type': 'text/javascript' })
      .end(fs.readFileSync(path.join(root, 'public', 'config.js'), 'utf8')
        .replace(/DEIN-PROJEKT\.supabase\.co/g, PROJEKT));
  }
  for (const [k, v] of Object.entries(appHeader)) {
    if (k !== 'Content-Security-Policy') header[k] = v;
  }
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    return res.writeHead(404, header).end('');
  }
  header['Content-Type'] = TYPEN[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, header).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });

// Record every violation the browser reports - that's the measurement.
const violations = [];
await page.addInitScript(() => {
  globalThis.__verstoesse = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    globalThis.__verstoesse.push({
      richtlinie: e.violatedDirective,
      source: String(e.blockedURI).slice(0, 120),
    });
  });
});
page.on('console', (m) => {
  if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) {
    violations.push({ richtlinie: '(Konsole)', source: m.text().slice(0, 160) });
  }
});

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const gemeldet = await page.evaluate(() => globalThis.__verstoesse ?? []);
const alle = [...gemeldet, ...violations];

// styles.css, app.js, supabase.js from vendor/, the SVG symbol as data:, the
// manifest file: if any of these gets blocked, it now shows up here.
check('Die Seite lädt under der Regel ohne einen einzigen Verstoss',
  alle.length === 0,
  alle.length ? alle.map((v) => `${v.richtlinie}: ${v.source}`).join(' | ') : '');

check('Und das Stylesheet ist wirklich angekommen (Gegenprobe)',
  await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'),
  await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

// Wait, instead of checking right away.
// ---------------------------------------------------------------------------
// Since boot() first asks whether the page is closed, the first visible
// screen is preceded by a network response. Here the test address points
// into the void, the request fails, and app.js then falls back to the login
// - that takes a few milliseconds. Anyone measuring at that exact moment
// sees an empty page and mistakes it for a bug.
const einerSichtbar = await page.waitForFunction(() =>
  ['#login', '#app', '#soon'].some((s) => document.querySelector(s)
    && !document.querySelector(s).hidden), null, { timeout: 5000 })
  .then(() => true).catch(() => false);
check('Und app.js ist wirklich gelaufen (Gegenprobe)', einerSichtbar,
  'keiner der drei Bildschirme wurde sichtbar');

// ---------------------------------------------------------------------------
// The bar - the spot where 'unsafe-inline' for style is load-bearing
// ---------------------------------------------------------------------------
// pollHtml sets style="width:61.8%" directly in the markup. If
// 'unsafe-inline' is ever removed from style-src, ALL bars end up at zero,
// and the page looks completely normal while doing so - only every poll
// looks unanswered. That's why the real line from app.js is plugged in here
// and the width measured in pixels.

const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const barLine = /<div class="opt-fill" style="width:\$\{[^}]+\}%"><\/div>/.exec(appJs);
check('Die Balkenbreite steht wirklich als style-Attribut in app.js',
  !!barLine, barLine ? barLine[0].slice(0, 60) : 'Form geändert – Prüfung bottom neu fassen');

const width = await page.evaluate(() => {
  const wirt = document.createElement('div');
  wirt.style.width = '300px';
  wirt.innerHTML = '<div class="opt"><div class="opt-bar">'
    + '<div class="opt-fill" style="width:61.8%"></div></div></div>';
  document.body.appendChild(wirt);
  const b = wirt.querySelector('.opt-fill').getBoundingClientRect().width;
  wirt.remove();
  return b;
});
check('Und der Balken hat under dieser Regel wirklich Breite',
  width > 10, `${width.toFixed(1)} px`);

// ---------------------------------------------------------------------------
// The live connection - the line whose absence you only notice in production
// ---------------------------------------------------------------------------
// connect-src must name the database TWICE: once via https:// for queries,
// once via wss:// for the live connection. A CSP treats the two as
// different targets. If the wss:// were missing, the page would appear to
// run normally - DMs would just never arrive.
//
// This isn't read here, it's tried out: two WebSockets, one to the allowed
// address, one to a foreign one. Both fail to connect (the addresses don't
// exist), but only one of them gets BLOCKED by the rule - and that's
// exactly the difference that matters.

const wsErgebnis = await page.evaluate(async (projekt) => {
  const versuch = (adresse) => new Promise((fertig) => {
    const gemeldet = [];
    const listener = (e) => {
      if (String(e.blockedURI).includes(new URL(adresse).host)) gemeldet.push(e.violatedDirective);
    };
    document.addEventListener('securitypolicyviolation', listener);
    try { new WebSocket(adresse); } catch { gemeldet.push('(Ausnahme)'); }
    setTimeout(() => {
      document.removeEventListener('securitypolicyviolation', listener);
      fertig(gemeldet);
    }, 300);
  });
  return {
    erlaubt: await versuch(`wss://${projekt}/realtime/v1/websocket`),
    fremd:   await versuch('wss://irgendwo-anders.example/realtime'),
  };
}, PROJEKT);

check('Die Live-Leitung zur eigenen Datenbank wird NICHT blockiert',
  wsErgebnis.erlaubt.length === 0,
  wsErgebnis.erlaubt.join(', ') || 'kein Verstoss');
// Without this control check, the line above would show green even if the
// rule doesn't check WebSockets at all.
check('Gegenprobe: eine fremde Live-Leitung wird sehr wohl blockiert',
  wsErgebnis.fremd.length > 0, wsErgebnis.fremd.join(', ') || 'nicht blockiert');

const fetchErgebnis = await page.evaluate(async () => {
  const gemeldet = [];
  const listener = (e) => gemeldet.push(String(e.blockedURI).slice(0, 60));
  document.addEventListener('securitypolicyviolation', listener);
  await fetch('https://irgendwo-anders.example/klau').catch(() => {});
  await new Promise((r) => setTimeout(r, 250));
  document.removeEventListener('securitypolicyviolation', listener);
  return gemeldet;
});
check('Und eine Abfrage an eine fremde Adresse ebenso',
  fetchErgebnis.length > 0, fetchErgebnis.join(', ') || 'nicht blockiert');

// ---------------------------------------------------------------------------
// Control check: does the rig measure anything at all?
// ---------------------------------------------------------------------------
// Without this check, everything above could be green just because the
// browser never reports any violations - for instance because the listener
// was never attached.

const strict = await browser.newPage();
const strictViolations = [];
await strict.addInitScript(() => {
  globalThis.__v = [];
  document.addEventListener('securitypolicyviolation',
    (e) => globalThis.__v.push(e.violatedDirective));
});
await strict.route('**/*', (route) => {
  const p = new URL(route.request().url()).pathname;
  const file = path.join(root, 'public', p === '/' ? '/index.html' : p);
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
  route.fulfill({
    status: 200,
    headers: {
      'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream',
      // Deliberately too strict: no script-src. Now app.js MUST stand out.
      'content-security-policy': "default-src 'none'; style-src 'self'",
    },
    body: fs.readFileSync(file),
  });
});
await strict.goto('https://sized.test/', { waitUntil: 'domcontentloaded' });
await strict.waitForTimeout(400);
strictViolations.push(...await strict.evaluate(() => globalThis.__v ?? []));
check('Gegenprobe: eine absichtlich zu strenge Regel wird bemerkt',
  strictViolations.length > 0, `${strictViolations.length} Verstoss/Verstösse gemeldet`);
await strict.close();

// ---------------------------------------------------------------------------
console.log('\nDer Platzhalter\n');
// ---------------------------------------------------------------------------

// The file ships with DEIN-PROJEKT in it. It must not go out to production
// like that - then the page can't reach its own database.
const stillPlaceholder = /DEIN-PROJEKT/.test(rohHeaders);
check(stillPlaceholder
  ? 'HINWEIS: connect-src trägt noch DEIN-PROJEKT – vor dem Hochladen ersetzen'
  : 'connect-src trägt eine echte Projektadresse',
  true, stillPlaceholder ? 'siehe sed-Befehl peek in public/_headers' : '');

await page.close();
await browser.close();
server.close();

const fehl = befunde.filter((b) => !b.ok);
console.log(`\n  ${befunde.length - fehl.length}/${befunde.length} ok`);
if (fehl.length) {
  for (const f of fehl) console.log(`  FEHL  ${f.name}`);
  process.exit(1);
}
console.log('');
