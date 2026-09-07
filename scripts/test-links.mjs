// ============================================================================
// Checks the clickable left in DMs.
//
// This is where text turns into HTML, and it's the one place on the site
// where a bug doesn't mean "looks bad" but "foreign code runs in your
// browser". So half this test is an attack test.
//
// The dangerous path would have been: escape first, then run a regular
// expression over the escaped result. Escaping itself inserts characters
// (& becomes &amp;) that the expression would then have to take apart
// again - and whoever miscalculates there lets HTML through. withLinks()
// instead splits the RAW text apart and escapes each piece individually.
// The test doesn't check the implementation, it checks the result: does a
// < get through anywhere that didn't come from us?
//
// The second half is the question of WHERE left become clickable at all:
//
//   * In DMs, on both sides. Links are allowed there because exactly one
//     person is the recipient.
//   * Not at all in the quote above a reply: the quote IS a button, and a
//     link inside a button is invalid HTML with unpredictable behavior.
//   * Not in the inbox preview line either - for the same reason.
//
// Until chat was removed, a third rule stood here: there, left were only
// clickable for Ansem, as a second lock next to the database's. It fell
// away along with chat.
//
//   node scripts/test-links.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// Verbatim from app.js - a hand-rebuilt copy would only test itself.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const linker = cut('const esc =', 'function toast');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body><span class="msg"><span class="body" id="ziel"></span></span>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({ content: `${linker}\nwindow.withLinks = withLinks;` });

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// The text is really attached to the page and the DOM is then queried. A
// test that only looks at the string misses exactly the cases where the
// browser interprets something differently than expected.
const einsetzen = (text) => page.evaluate((t) => {
  const el = document.querySelector('#ziel');
  el.innerHTML = window.withLinks(t);
  return {
    html: el.innerHTML,
    text: el.textContent,
    left: [...el.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'), sichtbar: a.textContent,
      rel: a.getAttribute('rel'), ziel: a.getAttribute('target'),
      referrer: a.getAttribute('referrerpolicy'),
    })),
    fremd: [...el.querySelectorAll('*')].map((e) => e.tagName).filter((t2) => t2 !== 'A'),
  };
}, text);

console.log('\nNichts Fremdes kommt durch\n');

const ANGRIFFE = [
  ['<img src=x onerror=alert(1)>', 'ein Bild mit Fehler-Handler'],
  ['<script>alert(1)</script>', 'ein Skript-Element'],
  ['javascript:alert(1)', 'das javascript-Schema allein'],
  ['https://ok.com" onmouseover="alert(1)', 'Ausbruch aus dem href-Attribut'],
  ['https://ok.com<img src=x onerror=alert(1)>', 'Bild direkt hinter der Adresse'],
  ["https://ok.com' onfocus='alert(1)", 'Ausbruch mit einfachem Anfuehrungszeichen'],
  ['<a href="javascript:alert(1)">klick</a>', 'ein fertiger Link im Text'],
  ['data:text/html,<script>alert(1)</script>', 'das data-Schema'],
];

for (const [angriff, was] of ANGRIFFE) {
  const r = await einsetzen(angriff);
  check(`Kein fremdes Element: ${was}`, r.fremd.length === 0, r.fremd.join(', '));
  const malicious = r.left.some((l) => !/^https?:\/\//i.test(l.href));
  check(`Kein Link ohne http/https: ${was}`, !malicious,
    r.left.map((l) => l.href).join(' | '));
  // The text must stay readable unchanged - whoever writes something like
  // this should see what they wrote.
  check(`Der Text bleibt vollständig stehen: ${was}`,
    r.text === angriff, JSON.stringify(r.text));
}

console.log('\nWas ein Link ist und was nicht\n');

const CASES = [
  ['https://sized.gg', ['https://sized.gg'], 'volle Adresse'],
  ['www.sized.gg', ['https://www.sized.gg'], 'www ohne Schema bekommt https'],
  ['schau auf https://sized.gg.', ['https://sized.gg'], 'Punkt am Satzende bleibt draussen'],
  ['ende: https://sized.gg/p/12!', ['https://sized.gg/p/12'], 'Ausrufezeichen ebenso'],
  ['(https://en.wikipedia.org/wiki/Foo_(bar))', ['https://en.wikipedia.org/wiki/Foo_(bar)'],
   'Klammern werden counted, nicht geraten'],
  ['https://x.com/a?b=1&c=2', ['https://x.com/a?b=1&c=2'], 'kaufmaennisches Und im Parameter'],
  ['preis 1.25 und z.b nichts', [], 'Zahlen und Abkuerzungen werden nicht verlinkt'],
  ['sized.gg', [], 'die nackte Domain bleibt Text'],
  ['gm', [], 'gewoehnlicher Text'],
];

for (const [text, erwartet, was] of CASES) {
  const r = await einsetzen(text);
  const hrefs = r.left.map((l) => l.href);
  check(`${was}`, JSON.stringify(hrefs) === JSON.stringify(erwartet),
    `${JSON.stringify(hrefs)} statt ${JSON.stringify(erwartet)}`);
}

// The address always sits there in plain text. That's the real protection
// against fraud: there's no way to write "sized.gg" and link somewhere
// else, because the text has no concept of formatting.
const sicht = await einsetzen('https://böse-nachbau.example/login');
check('Der sichtbare Text ist die Adresse selbst',
  sicht.left[0].sichtbar === 'https://böse-nachbau.example/login', sicht.left[0].sichtbar);

console.log('\nWie der Link geöffnet wird\n');

const eins = (await einsetzen('https://sized.gg')).left[0];
check('Öffnet in einem neuen Tab', eins.ziel === '_blank', eins.ziel);
// Without noopener, the opened page could redirect this one via
// window.opener while the user reads it in the other tab.
check('noopener ist gesetzt', /noopener/.test(eins.rel), eins.rel);
check('noreferrer ist gesetzt', /noreferrer/.test(eins.rel), eins.rel);
check('Die Zielseite erfährt nicht, woher der Klick kam',
  eins.referrer === 'no-referrer', eins.referrer);

console.log('\nWo Links anklickbar werden\n');

check('In DMs bei beiden Seiten',
  /<span class="body">\$\{withLinks\(row\.body\)\}<\/span>/.test(appJs));
// An <a> inside a <button> is invalid HTML; the browser is free to do
// whatever it wants with it.
check('Im Zitat über einer Antwort nicht',
  /<span class="quote-body">\$\{esc\(text\)\}<\/span>/.test(appJs));
check('Und in der Vorschauzeile des Posteingangs auch nicht',
  /<span class="thread-prev">\$\{esc\(t\.preview\)\}<\/span>/.test(appJs));

console.log('\nLesbarkeit\n');

// Color alone doesn't carry the message "clickable" - someone who can't
// tell colors apart well would otherwise see nothing at all.
check('Links sind unterstrichen, nicht nur eingefärbt',
  /\.msg \.body a \{[^}]*text-decoration: underline/s.test(css));
// This check has flipped twice, both times for the same reason: it
// depends on how light the "own message" bubble currently is.
//
//   near-white bubble  -> link needed its own, dark color
//   both bubbles dark  -> exception gone, --worth was enough everywhere
//   blue bubble (X)    -> its own color again, white this time
//
// So this no longer says "there is an exception" or "there is none", but
// states the condition behind it: the link has to stand out against the
// ground it actually sits on. What stays fixed here is the rule that the
// base color comes from --worth and the bubble only deviates from it when
// it has to.
check('Links fetch ihre Grundfarbe aus --worth',
  /\.msg \.body a \{[^}]*color: var\(--worth\)/s.test(css));
check('Auf der farbigen Blase weichen sie davon ab',
  /\.msg\.dm\.mine \.body a \{[^}]*color:/s.test(css));

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
