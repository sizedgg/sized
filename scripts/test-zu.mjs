// ============================================================================
// The site is closed - who sees what, and who gets in
//
// Two claims, and only one of them is a lock:
//
//   1. If app_config.open_to_public is false, a visitor sees "Launching
//      soon" and a small "Team access" button below it. That's a FACADE.
//      It doesn't stop anyone, it just shows something different.
//
//   2. Only whoever is in admin_wallet or test_wallet gets in. That's the
//      lock, it lives in the function, and no line in the browser can get
//      around it.
//
// Both are checked here, and separately - because they're worth different
// amounts. Whoever mistakes the second for the first ends up building a
// site you can open with the dev console.
//
// ----------------------------------------------------------------------------
// Why mayEnter comes from the real file
//
// _shared/freischaltung.ts is deliberately a file without imports -
// specifically so a test can load it. If the rule lived in common.ts, it
// would pull in the Supabase client from jsr: and couldn't be touched from
// Node at all. Nobody can verify a lock that only exists in production.
//
//   node scripts/test-zu.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}${detail && !ok ? `\n         ${detail}` : ''}`);
};

console.log('\nDie Seite ist zu\n');

// ---------------------------------------------------------------------------
// Part 1: the lock - mayEnter, from the real file
// ---------------------------------------------------------------------------
// TypeScript with no tooling: the file contains only an interface and a
// function. The interface gets cut away, the rest is valid JavaScript.
// Nothing is reproduced by hand - if someone changes the rule, this check
// changes right along with it.
const gateSource = fs.readFileSync(
  path.join(root, 'supabase', 'functions', '_shared', 'freischaltung.ts'), 'utf8');
const alsJs = gateSource
  .replace(/export interface TorConfig \{[\s\S]*?\n\}/, '')
  .replace('export function mayEnter(cfg: TorConfig, wallet: string | null): boolean {',
           'function mayEnter(cfg, wallet) {');
// eslint-disable-next-line no-new-func
const mayEnter = new Function(`${alsJs}\nreturn mayEnter;`)();

const ANSEM = '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo';
const NUTZER = 'Hs7QvNmK4dGbXe2LpRcTfZaU9wYjB6xM1noAiEuS3rVt';
const FREMD = 'So1anaFremdeAdresse11111111111111111111111';

const zu = { open_to_public: false, admin_wallet: ANSEM, test_wallet: NUTZER };
const auf = { open_to_public: true, admin_wallet: ANSEM, test_wallet: NUTZER };

check('Zu: Ansem kommt herein', mayEnter(zu, ANSEM));
check('Zu: die Testadresse kommt herein', mayEnter(zu, NUTZER));
check('Zu: sonst niemand', !mayEnter(zu, FREMD));
check('Zu: und ohne Adresse erst recht nicht', !mayEnter(zu, null));
// The control, without which everything above would pass even if mayEnter
// just stubbornly returned false.
check('Gegenprobe: offen kommt derselbe Fremde sehr wohl herein',
  mayEnter(auf, FREMD));

// An empty field must not become a master key: if test_wallet holds
// nothing, Boolean() catches that - otherwise anyone sending no address at
// all would get in.
check('Zu: ein leeres test_wallet oeffnet nichts',
  !mayEnter({ open_to_public: false, admin_wallet: ANSEM, test_wallet: null }, null)
  && !mayEnter({ open_to_public: false, admin_wallet: ANSEM, test_wallet: '' }, ''));
// And the direction of the switch: only an explicit false closes it. If
// the column is missing, it's open - the reasoning is in the file.
check('Fehlt die Spalte, ist die Seite offen',
  mayEnter({ admin_wallet: ANSEM, test_wallet: NUTZER }, FREMD));

// ---------------------------------------------------------------------------
// Part 2: the facade - what the visitor sees
// ---------------------------------------------------------------------------
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(pub, pfad);
  if (!file.startsWith(pub) || !fs.existsSync(file)) return res.writeHead(404).end('');
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b + bis.length);
};
// The real pieces, verbatim.
const PARTS = [
  cut("const TEAM_ZUGANG =", '\n'),
  cut('function teamFrei() {', '\n}'),
  cut('const TO_QUERY_MS =', '\n'),
  cut('async function pageIsClosed() {', '\n}'),
  cut('function showSoon() {', '\n}'),
  cut("$('#btn-team').addEventListener('click'", '\n});'),
].join('\n\n');

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

/**
 * Loads the page with a simulated database.
 *
 * @param offen  what app_config.open_to_public returns - or 'fehler', if
 *               the query should fail, or 'hangs', if it doesn't answer
 *               at all.
 */
async function lage({ offen, jwt = null, gemerkt = false }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base, { waitUntil: 'load' });
  // With its own timeout, and that's not incidental.
  // ---------------------------------------------------------------------------
  // If someone removes the time limit from pageIsClosed(), the call never
  // returns for the 'hangs' case - and this test then HANGS instead of
  // failing. A hanging test doesn't tell you what's broken; you just see
  // that nothing's moving. So better a clean no after eight seconds.
  const abbruch = new Promise((r) => setTimeout(
    () => r({ haenger: true, bald: false, login: false }), 8000));
  return Promise.race([abbruch, page.evaluate(async ({ parts, offen: o, jwt: j, gemerkt: g }) => {
    const $ = (s, w = document) => w.querySelector(s);
    window.$ = $;
    window.state = { jwt: j, db: null };
    window.makeClient = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              if (o === 'fehler') throw new Error('kein Netz');
              // Never answers - not even with an error.
              if (o === 'hangs') return new Promise(() => {});
              return { data: { open_to_public: o }, error: null };
            },
          }),
        }),
      }),
    });
    window.showLogin = () => { $('#app').hidden = true; $('#login').hidden = false; };
    window.maybeShowInstallStep = () => {};
    try { localStorage.setItem('size_team', g ? '1' : ''); } catch { /* doesn't matter */ }

    // eslint-disable-next-line no-eval
    (0, eval)(parts);

    // What boot() does first.
    if (await window.pageIsClosed()) window.showSoon();
    else window.showLogin();

    const sichtbar = (s) => !$(s).hidden;
    return {
      bald: sichtbar('#soon'),
      login: sichtbar('#login'),
      button: Boolean($('#btn-team')),
      knopfText: $('#btn-team')?.textContent.trim(),
      satz: $('#soon .lede')?.textContent.trim(),
      // Everything in the card except the brand and that one sentence.
      mehrText: [...$('#soon .login-card').children]
        .filter((e) => !e.classList.contains('brand') && !e.classList.contains('lede'))
        .map((e) => e.textContent.trim()).join(' '),
    };
  }, { parts: PARTS, offen, jwt, gemerkt })]).finally(() => page.close());
}

// And first: does boot() even call it?
// ---------------------------------------------------------------------------
// The checks below call pageIsClosed() themselves - they show that the
// function does the right thing, not that anyone uses it. That's exactly
// what the control uncovered: removing the line from boot() left
// everything green, and the curtain would never have shown up in
// production.
//
// It has to come first, even before the session check: someone with an
// expired session would otherwise get logged out and see the login instead
// of the curtain.
const bootBlock = appJs.slice(appJs.indexOf('(async function boot() {'));
check('boot() fragt als Erstes, ob die Seite zu ist',
  /^\(async function boot\(\) \{\s*\n\s*if \(await pageIsClosed\(\)\) \{ showSoon\(\); return; \}/
    .test(bootBlock),
  bootBlock.slice(0, 160));

const shut = await lage({ offen: false });
check('Zu: der Besucher sieht "Launching soon"',
  shut.bald && !shut.login, JSON.stringify(shut));
check('Und darunter steht der Knopf',
  shut.button && shut.knopfText === 'Team access', shut.knopfText);
// And nothing else. There used to be a line under "Launching soon." saying
// what SIZED is; it's gone, and this is where it's pinned down that it
// stays gone: whoever loads the site before launch shouldn't find out here.
check('Und sonst nichts – kein Satz darueber, was SIZED ist',
  shut.satz === 'Launching soon.' && !shut.mehrText,
  `${shut.satz} | ${shut.mehrText}`);

const offen = await lage({ offen: true });
check('Gegenprobe: offen sieht er den Login',
  offen.login && !offen.bald, JSON.stringify(offen));

// Whoever already has a session isn't stopped: whether they're allowed in
// gets decided by the function anyway at the next renewal.
const mitSitzung = await lage({ offen: false, jwt: 'irgendein.token.hier' });
check('Zu, aber mit Sitzung: kein Vorhang', mitSitzung.login && !mitSitzung.bald);

// Tapped once, straight to the login from then on.
const gemerkt = await lage({ offen: false, gemerkt: true });
check('Nach "Team access" kommt der Vorhang nicht wieder',
  gemerkt.login && !gemerkt.bald);

// And the case that could quietly go wrong: if the query fails, nobody may
// be locked out. A network error would otherwise show "Launching soon" on
// a site that's long since open - a bug nobody reports, because it looks
// like it's on purpose.
const kaputt = await lage({ offen: 'fehler' });
check('Faellt die Abfrage aus, wird nicht ausgesperrt',
  kaputt.login && !kaputt.bald, JSON.stringify(kaputt));

// And the worse case: the query NEVER ANSWERS.
// ---------------------------------------------------------------------------
// An error comes back and can be caught. A dead zone, a hotel wifi with a
// login page in front of it, an outage at Supabase - nothing comes back at
// all, not even an error. Without a time limit, boot() then waits
// indefinitely, and the visitor NEVER sees anything: neither login nor
// curtain, just black.
//
// That was exactly the state before TO_QUERY_MS was added, and it wasn't
// caught by thinking it through, but because two other suites afterward
// stared at an empty page forever.
const hangs = await lage({ offen: 'hangs' });
check('Antwortet die Abfrage gar nicht, kommt trotzdem der Login',
  hangs.login && !hangs.bald,
  hangs.haenger ? 'boot() kam nie back – fehlt die Zeitgrenze?'
    : JSON.stringify(hangs));

await browser.close();
server.close();

console.log(failed ? `\n  ${failed} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(failed ? 1 : 0);
