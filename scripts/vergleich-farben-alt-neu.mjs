/**
 * Nothing about the colour has changed - checked element by element.
 *
 * The page was moved to a warm ground for a trial and moved back. "Moved
 * back" is easy to claim and easy to get almost right: sixteen values went
 * one way and sixteen came back, and a single typo in one of them would sit
 * on the page for weeks before anyone noticed the shade of a border.
 *
 * So this does not compare the palette - it compares the PAGE. It renders
 * the same markup twice, once against a reference copy of styles.css and
 * once against the current one, reads every colour-carrying property off
 * every element, and reports each difference.
 *
 * The corners and the amount's line box are supposed to differ. They are
 * not colour properties, so they never show up here.
 *
 *   node scripts/vergleich-farben-alt-neu.mjs <referenz.css>
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const referenz = process.argv[2];
if (!referenz || !fs.existsSync(referenz)) {
  console.error('\n  Aufruf: node scripts/vergleich-farben-alt-neu.mjs <referenz.css>\n');
  process.exit(2);
}

const publicDir = path.join(root, 'public');
const jetzt = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const alt = fs.readFileSync(referenz, 'utf8');

// The page is served as it is, only the stylesheet is swapped. app.js is
// replaced by nothing: it would try to log in, and what is being compared
// here is the markup's colours, not the application.
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let blatt = jetzt;
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  if (pfad === '/styles.css') {
    return res.writeHead(200, { 'content-type': 'text/css' }).end(blatt);
  }
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vergleich */');
  }
  const file = path.join(publicDir, pfad);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Every element gets unhidden first: half the page is [hidden] before a
// login, and a hidden element has no computed colour worth comparing.
const EIGENSCHAFTEN = [
  'color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
  'borderBottomColor', 'borderLeftColor', 'outlineColor', 'boxShadow',
  'textDecorationColor', 'caretColor', 'fill', 'stroke',
];

async function lies(css) {
  blatt = css;
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(200);
  const werte = await page.evaluate((props) => {
    for (const el of document.querySelectorAll('[hidden]')) el.hidden = false;
    const out = {};
    const alle = [...document.querySelectorAll('*')];
    alle.forEach((el, i) => {
      const c = getComputedStyle(el);
      // The index plus a readable name: the index is what makes the two runs
      // line up (same markup, same order), the name is what makes a
      // difference findable afterwards.
      const name = `${i} ${el.tagName.toLowerCase()}`
        + `${el.id ? `#${el.id}` : ''}`
        + `${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
      out[name] = props.map((p) => c[p]).join(' | ');
    });
    // The palette itself on top, so a difference in a token shows up as one
    // line instead of as forty elements.
    const wurzel = getComputedStyle(document.documentElement);
    for (const t of [...document.styleSheets].flatMap((s) => {
      try { return [...s.cssRules]; } catch { return []; }
    }).flatMap((r) => (r.style ? [...r.style] : [])).filter((n) => n.startsWith('--'))) {
      // Only tokens that actually carry a colour. --radius, --vorschau,
      // --du-breit and --mono are in the same block and are supposed to
      // differ here - the corners are the point of this change. Listing
      // them would make the script report the intended change as a finding.
      const v = wurzel.getPropertyValue(t).trim();
      if (/^(#[0-9a-f]{3,8}|rgba?\(|color\()/i.test(v)) out[`token ${t}`] = v;
    }
    return out;
  }, EIGENSCHAFTEN);
  await page.close();
  return werte;
}

const a = await lies(alt);
const b = await lies(jetzt);
await browser.close();
server.close();

const schluessel = [...new Set([...Object.keys(a), ...Object.keys(b)])];
// A name that exists on only ONE side is a new token, not a changed colour.
// They are listed separately: they are worth seeing, but reporting them as
// differences would drown the thing this script is actually for.
const neuTokens = schluessel.filter((k) => a[k] === undefined || b[k] === undefined);
const anders = schluessel.filter((k) =>
  a[k] !== undefined && b[k] !== undefined && a[k] !== b[k]);

console.log(`\n── ${schluessel.length} Elemente und Tokens verglichen ──\n`);
if (neuTokens.length) {
  console.log(`  ${neuTokens.length} neue Namen (vorher gab es sie nicht):`);
  console.log(`    ${neuTokens.map((k) => k.replace('token ', '')).join(', ')}\n`);
}
if (anders.length === 0) {
  console.log('  ✓ Kein einziger Farbwert unterscheidet sich\n');
} else {
  for (const k of anders.slice(0, 40)) {
    console.log(`  ✗ ${k}\n      alt: ${a[k]}\n      neu: ${b[k]}`);
  }
  if (anders.length > 40) console.log(`  … und ${anders.length - 40} weitere`);
  console.log('');
}

// Counter-check: the same run against a stylesheet with ONE value moved has
// to report it. Without this, "no difference" could just as well mean the
// comparison is reading nothing.
console.log('── Gegenprobe ──\n');
const kaputt = jetzt.replace('--line: #262b39;', '--line: #26303c;');
if (kaputt === jetzt) {
  console.log('  ✗ Vorbedingung: --line nicht gefunden, die Gegenprobe misst nichts\n');
  process.exit(1);
}
const browser2 = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const server2 = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  if (pfad === '/styles.css') return res.writeHead(200, { 'content-type': 'text/css' }).end(kaputt);
  if (pfad === '/app.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  const file = path.join(publicDir, pfad);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server2.listen(0, r));
const page2 = await browser2.newPage({ viewport: { width: 1180, height: 900 } });
await page2.goto(`http://127.0.0.1:${server2.address().port}/`);
await page2.waitForTimeout(200);
const c = await page2.evaluate((props) => {
  for (const el of document.querySelectorAll('[hidden]')) el.hidden = false;
  const out = {};
  [...document.querySelectorAll('*')].forEach((el, i) => {
    const s = getComputedStyle(el);
    const name = `${i} ${el.tagName.toLowerCase()}`
      + `${el.id ? `#${el.id}` : ''}`
      + `${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    out[name] = props.map((p) => s[p]).join(' | ');
  });
  return out;
}, EIGENSCHAFTEN);
await browser2.close();
server2.close();
const treffer = Object.keys(c).filter((k) => b[k] !== undefined && b[k] !== c[k]);
console.log(treffer.length
  ? `  ✓ Ein um 5% verschobener Linienton faellt an ${treffer.length} Elementen auf\n`
  : '  ✗ Ein verschobener Linienton faellt NICHT auf - der Vergleich misst nichts\n');

const ok = anders.length === 0 && treffer.length > 0;
console.log(ok ? '✅ Farben unveraendert, und der Vergleich haette es gemerkt\n'
                : '❌ Siehe oben\n');
process.exit(ok ? 0 : 1);
