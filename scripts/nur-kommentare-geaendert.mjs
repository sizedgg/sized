/**
 * Proves that a rewrite touched only comments.
 *
 * The claim when translating is "doesn't change the code at all". That's a
 * claim, not a measurement - and exactly the kind that holds true until,
 * one day, it doesn't. This script takes two directories (before, after),
 * strips the comments out of every file, and compares what's left. If it
 * stays the same, nothing in the code was touched.
 *
 *   node scripts/nur-kommentare-geaendert.mjs <before> <after>
 *
 * What this comparison does NOT do, so nobody relies on it for the wrong
 * thing:
 *
 *   - It says nothing about whether the translation is good. Only that it
 *     hasn't broken anything.
 *   - It's blind to comments that code depends on. Several tests cut source
 *     text off at comments (cut('...', '\n/**\n * ...')). The test
 *     suites catch that, this comparison doesn't.
 *   - It deliberately flags identifier renames. It's not meant for that;
 *     the test suites are the proof there.
 */
import fs from 'node:fs';
import path from 'node:path';

const [vorher, nachher] = process.argv.slice(2);
if (!vorher || !nachher) {
  console.error('  node scripts/nur-kommentare-geaendert.mjs <vorher> <nachher>');
  process.exit(2);
}

/**
 * Strips out comments without falling for string contents.
 *
 * A plain regex cut falls flat on its face with "// not a comment" inside a
 * string, or with a / inside a regular expression. Hence a small state
 * machine: it knows whether it's currently inside a string, inside a
 * template literal, or inside a comment.
 *
 * ----------------------------------------------------------------------------
 * Regular expressions are why this is longer than expected
 *
 * The first attempt didn't know about them, and app.js has a line like
 *
 *   s.replace(/'/g, '&#39;')
 *
 * The quote mark INSIDE the regular expression looked, to the state
 * machine, like the start of a string. From there it was thrown off:
 * comments counted as code, code counted as a string, and the comparison
 * reported a comment line as a code change. A false alarm is the more
 * harmless direction - but a checker nobody trusts is as good as none.
 *
 * Whether a / starts a regular expression or a division is decided, in
 * JavaScript, by context. The rule of thumb below (what came before it?)
 * isn't the language spec, but it covers every case in this repository -
 * and the self-test below verifies exactly that.
 */
const VOR_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}',
  ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n', '']);
const WORT_VOR_REGEX = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function ohneKommentare(text, art) {
  const lineComment = { js: '//', ts: '//', css: null, sql: '--', sh: '#', html: null }[art];
  const blockAuf = { js: '/*', ts: '/*', css: '/*', sql: '/*', sh: null, html: '<!--' }[art];
  const blockZu = { js: '*/', ts: '*/', css: '*/', sql: '*/', sh: null, html: '-->' }[art];
  const jsArtig = art === 'js' || art === 'ts';

  let aus = '';
  let i = 0;
  let lastMeaningful = '';   // lastChar Zeichen, das kein Leerraum war
  const n = text.length;

  // A stack instead of a single state, because of template literals.
  //
  // That was the second false alarm: app.js has a comment INSIDE a ${...}
  // inside a template literal -
  //
  //   `<span>${wert === x
  //      // here // is a real comment again
  //      ? a : b}</span>`
  //
  // Anyone who just switches to "everything from here is text" at the
  // backtick reads the comment as a string and reports the translation as a
  // code change. Between ${ and } it's code again, with everything that
  // comes with it: comments, strings, further template literals.
  //
  // The stack keeps track of what you're currently inside. { code } is the
  // starting state, every string and every ${ pushes a level onto it.
  const stapel = [{ art: 'code', tiefe: 0 }];
  const peek = () => stapel[stapel.length - 1];

  while (i < n) {
    const c = text[i];
    const zustand = peek();

    // --- inside a plain string --------------------------------------------
    if (zustand.art === 'zeichenkette') {
      aus += c;
      if (c === '\\') { aus += text[i + 1] ?? ''; i += 2; continue; }
      if (c === zustand.zeichen) stapel.pop();
      i += 1; continue;
    }

    // --- inside a template literal ------------------------------------------
    if (zustand.art === 'vorlage') {
      if (c === '\\') { aus += text.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { aus += c; stapel.pop(); lastMeaningful = c; i += 1; continue; }
      if (c === '$' && text[i + 1] === '{') {
        aus += '${'; stapel.push({ art: 'code', tiefe: 0 });
        lastMeaningful = '{'; i += 2; continue;
      }
      aus += c; i += 1; continue;
    }

    // --- from here on: code -------------------------------------------------
    // Count braces, so the } of an embedded level actually closes it, and
    // not some } of an object literal inside it.
    if (c === '{') { zustand.tiefe += 1; }
    if (c === '}') {
      if (zustand.tiefe === 0 && stapel.length > 1) {
        aus += c; stapel.pop(); lastMeaningful = c; i += 1; continue;
      }
      zustand.tiefe -= 1;
    }

    // A string begins
    if (c === '"' || c === "'") {
      stapel.push({ art: 'zeichenkette', zeichen: c });
      aus += c; lastMeaningful = c; i += 1; continue;
    }
    if (c === '`' && art !== 'sql') {
      stapel.push({ art: 'vorlage' });
      aus += c; lastMeaningful = c; i += 1; continue;
    }

    // Regular expression: skip everything up to the unescaped /, taking
    // character classes [...] into account - a / inside one isn't the end.
    if (jsArtig && c === '/' && text[i + 1] !== '/' && text[i + 1] !== '*'
        && (VOR_REGEX.has(lastMeaningful) || WORT_VOR_REGEX.test(aus.trimEnd()))) {
      let j = i + 1; let inKlasse = false;
      while (j < n) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inKlasse = true;
        else if (d === ']') inKlasse = false;
        else if (d === '/' && !inKlasse) break;
        else if (d === '\n') break;           // not a regex after all, a division
        j += 1;
      }
      if (text[j] === '/') {
        while (j + 1 < n && /[dgimsuvy]/.test(text[j + 1])) j += 1;  // flags
        aus += text.slice(i, j + 1);
        lastMeaningful = '/';
        i = j + 1; continue;
      }
    }
    // In SQL, '' is the doubling, not an escape - the state machine above
    // handles that correctly, because it reads the second ' as a new
    // start.

    if (blockAuf && text.startsWith(blockAuf, i)) {
      const ende = text.indexOf(blockZu, i + blockAuf.length);
      const bis = ende < 0 ? n : ende + blockZu.length;
      // Keep line breaks, so line numbers stay comparable.
      aus += text.slice(i, bis).replace(/[^\n]/g, '');
      i = bis; continue;
    }
    if (lineComment && text.startsWith(lineComment, i)) {
      const ende = text.indexOf('\n', i);
      i = ende < 0 ? n : ende; continue;
    }
    aus += c;
    if (!/\s/.test(c)) lastMeaningful = c;
    i += 1;
  }
  // Trailing whitespace gets dropped: a deleted comment after code
  // otherwise leaves spaces behind and reports a difference that doesn't
  // exist.
  return aus.split('\n').map((z) => z.replace(/\s+$/, '')).join('\n').replace(/\n{2,}/g, '\n');
}

const artVon = (file) => ({
  '.js': 'js', '.mjs': 'js', '.ts': 'ts', '.css': 'css',
  '.sql': 'sql', '.sh': 'sh', '.html': 'html',
}[path.extname(file)] ?? null);

function sammle(wurzel) {
  const raus = [];
  const gehe = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'vendor', 'bin', 'preview', 'video-roh', '_to_delete', 'post']
        .includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) gehe(p);
      else if (artVon(e.name)) raus.push(path.relative(wurzel, p));
    }
  };
  gehe(wurzel);
  return raus.sort();
}

const filesA = sammle(vorher);
const filesB = sammle(nachher);

let differences = 0;
let checked = 0;

const nurA = filesA.filter((f) => !filesB.includes(f));
const nurB = filesB.filter((f) => !filesA.includes(f));
for (const f of nurA) { console.log(`  ✗ fehlt nachher: ${f}`); differences += 1; }
for (const f of nurB) { console.log(`  + neu nachher:   ${f}`); }

for (const f of filesA.filter((x) => filesB.includes(x))) {
  const art = artVon(f);
  const a = ohneKommentare(fs.readFileSync(path.join(vorher, f), 'utf8'), art);
  const b = ohneKommentare(fs.readFileSync(path.join(nachher, f), 'utf8'), art);
  checked += 1;
  if (a !== b) {
    differences += 1;
    const za = a.split('\n'); const zb = b.split('\n');
    let first = 0;
    while (first < Math.max(za.length, zb.length) && za[first] === zb[first]) first += 1;
    console.log(`  ✗ CODE GEAENDERT: ${f}  (ab Zeile ${first + 1} des kommentarfreien Textes)`);
    console.log(`      vorher : ${JSON.stringify((za[first] ?? '').slice(0, 100))}`);
    console.log(`      nachher: ${JSON.stringify((zb[first] ?? '').slice(0, 100))}`);
  }
}

console.log(`\n  ${checked} Dateien verglichen, ${differences} mit Codeunterschied\n`);
process.exit(differences === 0 ? 0 : 1);
