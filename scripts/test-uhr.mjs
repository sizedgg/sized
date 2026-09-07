// ============================================================================
// The clock on the payment screen counts down second by second
//
// The reported bug: "24:59 ... 24:52". The clock only got rewritten when a
// response came back from the server, and the gap between requests grows
// (3s, 10s, 30s). After five minutes that would have meant jumps of half a
// minute.
//
// Why this deserves its own check: on this screen someone has just sent
// money and is waiting. A clock that stalls looks broken - and trust is the
// one thing the page has to offer at that moment.
//
// ----------------------------------------------------------------------------
// How this is measured
//
// Not in real time. The clock gets cut out of app.js verbatim and run
// against VIRTUAL time instead: Date.now and setTimeout are replaced, and
// the test decides when a timer fires and what time it is when it does.
// That way sixty seconds run in milliseconds, and - more importantly - the
// test can simulate a browser that fires every timer a few milliseconds TOO
// LATE. That's exactly what real browsers do, and it's exactly what would
// have broken the obvious fix (setInterval every 1000 ms): the delay adds
// up, drifts toward the second boundary, and eventually a number gets
// skipped.
//
//   node scripts/test-uhr.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Verbatim from app.js. A reconstructed copy would pass this test while the
// page keeps jumping - and then it would be measuring nothing.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const clockCode = cut('const restText = (ms) =>', 'function startPolling(');

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
 * Runs the clock for `sekunden` seconds in virtual time.
 *
 * `verspaetung` is the sloppiness real browsers add: a timer never fires
 * exactly on time, always a few milliseconds late.
 * `source` is the clock code - that lets the counter-check send through a
 * modified version.
 */
async function lauf({ sekunden, verspaetung, source = clockCode }) {
  return page.evaluate(({ code, sekunden, verspaetung }) => {
    let jetzt = 1_000_000;                       // some arbitrary starting point
    const deadline = jetzt + sekunden * 1000;
    const written = [];
    let offen = null;

    const echtesNow = Date.now;
    const echtesSetTimeout = globalThis.setTimeout;
    Date.now = () => jetzt;
    globalThis.setTimeout = (fn, ms) => { offen = { at: jetzt + ms, fn }; return 1; };

    // In place of the real $ and state: record what the clock would write.
    const $ = () => ({ set textContent(v) { written.push({ t: jetzt, v }); } });
    const state = {};

    try {
      // eslint-disable-next-line no-eval
      const startClock = eval(`(() => { ${code} ; return startClock; })()`);
      startClock(deadline);

      let guard = 0;
      while (offen && guard++ < 100_000) {
        const nowDue = offen;
        offen = null;
        jetzt = nowDue.at + verspaetung;   // the browser fires late
        if (jetzt > deadline + 2000) break;
        nowDue.fn();
      }
      return { written, guard };
    } finally {
      Date.now = echtesNow;
      globalThis.setTimeout = echtesSetTimeout;
    }
  }, { code: source, sekunden, verspaetung });
}

/** Checks a sequence of displayed values for gaps and repeats. */
function checkSequence(written, sekunden) {
  const numbers = written.map((g) => {
    const m = /^(\d+):(\d\d) left$/.exec(g.v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  });
  const invalid = numbers.filter((z) => z === null).length;
  // Consecutive repeats are harmless (same text), but a jump of more than
  // one second is exactly the reported bug.
  const eindeutig = numbers.filter((z, i) => i === 0 || z !== numbers[i - 1]);
  const jumps = [];
  for (let i = 1; i < eindeutig.length; i += 1) {
    const d = eindeutig[i - 1] - eindeutig[i];
    if (d !== 1) jumps.push(`${eindeutig[i - 1]}→${eindeutig[i]}`);
  }
  const fehlend = [];
  for (let s = sekunden; s >= 0; s -= 1) if (!eindeutig.includes(s)) fehlend.push(s);
  return { invalid, eindeutig, jumps, fehlend };
}

console.log('\n── Die Uhr auf dem Zahlungsbildschirm ──');

// 1. The fussy case: the browser fires every timer 8 ms late.
//    This is exactly where setInterval(1000) falls apart.
{
  const { written } = await lauf({ sekunden: 60, verspaetung: 8 });
  const { invalid, eindeutig, jumps, fehlend } = checkSequence(written, 60);
  check('Jede Anzeige hat die Form "m:ss left"', invalid === 0, `${invalid} unlesbar`);
  check('Keine Sekunde wird uebersprungen (Browser 8 ms zu late)',
    jumps.length === 0, jumps.slice(0, 5).join(', ') || 'keine Spruenge');
  check('Alle 61 Sekunden von 60 bis 0 kommen vor',
    fehlend.length === 0, fehlend.length ? `fehlt: ${fehlend.join(', ')}` : `${eindeutig.length} Werte`);
  check('Die Uhr endet bei 0:00', eindeutig[eindeutig.length - 1] === 0,
    written[written.length - 1]?.v);
}

// 2. A grossly inaccurate browser: 40 ms of delay per timer.
//    Over 60 seconds that would add up to a 2.4-second drift, if the clock
//    counted up instead of computing the time.
{
  const { written } = await lauf({ sekunden: 60, verspaetung: 40 });
  const { jumps, fehlend } = checkSequence(written, 60);
  check('Auch bei 40 ms Verspaetung keine Luecke',
    jumps.length === 0 && fehlend.length === 0,
    [...jumps, ...fehlend.map((f) => `fehlt ${f}`)].slice(0, 5).join(', ') || 'sauber');
}

// 3. Counter-check A: the obvious fix that doesn't work.
//    If the second boundary gets replaced with a rigid 1000, the test MUST
//    turn red - otherwise it isn't measuring the timing at all.
{
  const naiv = clockCode.replace('(left % 1000) + 20', '1000');
  check('Vorbedingung: die Gegenprobe hat den Code wirklich veraendert',
    naiv !== clockCode);
  const { written } = await lauf({ sekunden: 60, verspaetung: 8, source: naiv });
  const { jumps, fehlend } = checkSequence(written, 60);
  check('Gegenprobe: mit starrem 1000-ms-Takt faellt eine Sekunde aus',
    jumps.length > 0 || fehlend.length > 0,
    jumps.slice(0, 3).join(', ') || `fehlt: ${fehlend.slice(0, 3).join(', ')}`);
}

// 4. Counter-check B: the old behavior.
//    The display used to hang off the polling cadence. A call every three
//    seconds jumps by three - that's the reported bug, and this is what it
//    looks like.
{
  const atQueryCadence = clockCode.replace('(left % 1000) + 20', '3000');
  const { written } = await lauf({ sekunden: 60, verspaetung: 8, source: atQueryCadence });
  const { jumps } = checkSequence(written, 60);
  check('Gegenprobe: am Abfragetakt (3s) springt die Uhr um drei Sekunden',
    jumps.length > 0 && jumps.some((s) => /→/.test(s)),
    jumps.slice(0, 3).join(', '));
}

// 5. The clock stops instead of running into negative numbers.
{
  const { written, guard } = await lauf({ sekunden: 3, verspaetung: 8 });
  const negativ = written.filter((g) => /^-/.test(g.v) || /:-/.test(g.v));
  check('Keine negative Anzeige', negativ.length === 0, negativ[0]?.v ?? 'keine');
  check('Die Uhr stellt sich bei 0:00 selbst ab',
    written[written.length - 1].v === '0:00 left' && guard < 100,
    `${guard} Durchlaeufe`);
}

// 6. One off switch, not two.
//    stopPolling has to clear BOTH timers. If the clock is forgotten, it
//    keeps writing invisibly into a field nobody is looking at anymore.
{
  const stop = cut('const stopPolling = () => {', '\nfunction logout(');
  check('stopPolling loescht den Abfragezeitgeber', /clearTimeout\(state\.poller\)/.test(stop));
  check('stopPolling loescht auch die Uhr', /clearTimeout\(state\.clock\)/.test(stop));
  check('startPolling startet die Uhr', /startClock\(deadline\)/.test(appJs));
  // And: the clock must NOT hang off the response anymore. If the write to
  // #pay-timer still sat in the polling step, the bug would be back without
  // any of the checks above noticing - they're measuring startClock, after all.
  const tick = cut('  const tick = async () => {', '  tick();');
  check('Der Abfrageschritt schreibt die Uhrzeit nicht mehr selbst',
    !/pay-timer/.test(tick));
}

await browser.close();
console.log(`\n${fehler === 0 ? '✅ Alle Prüfungen bestanden' : `❌ ${fehler} Prüfung(en) fehlgeschlagen`}\n`);
process.exit(fehler === 0 ? 0 : 1);
