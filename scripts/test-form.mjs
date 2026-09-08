// ============================================================================
// The page is right-angled, and it is decided in one place
//
// Two claims are checked here, and a third that has been sitting in a
// comment without anything watching it.
//
// 1. No rule sets a corner with a number anymore. Forty of them used to,
//    which meant the page had no shape - it had forty opinions. They go
//    through --radius, --radius-klein and --radius-innen now, and the day
//    someone writes "border-radius: 8px" into a new rule, that rule silently
//    stops following the page. This is the check that says so out loud.
//
//    50% and 999px are exempt and stay exempt: a circle and a pill are
//    shapes of their own - the loading spinner, the profile picture, the 6px
//    unread dot, the preview banner. Rounding those down with everything
//    else gives you a square dot, and a square dot does not read as a
//    quieter dot, it reads as a bug.
//
// 2. The image posted to X follows the page. Its corners are drawn on a
//    canvas, not by CSS, so nothing connects the two automatically - they
//    are three constants in app.js and they have to be at zero as well.
//
// 3. CARD_VERSION is the same number in public/app.js and in
//    supabase/functions/og/index.ts. The comment above it says "both have to
//    match, or the link gets the fallback card" - and until now, nothing
//    checked. That is exactly the kind of failure nobody sees while
//    developing: the page looks right, and only a shared link on X is
//    broken.
//
//   node scripts/test-form.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const ogTs = fs.readFileSync(path.join(root, 'supabase/functions/og/index.ts'), 'utf8');

let fehler = 0;
const check = (name, ok, hinweis = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${hinweis ? `  – ${hinweis}` : ''}`);
  if (!ok) fehler += 1;
};

/**
 * Every border-radius value in the file, comments stripped.
 *
 * Stripping the comments first is not tidiness: this stylesheet argues about
 * its own history at length, and the old numbers are quoted in those
 * arguments. Without stripping, the check would report the reasoning as a
 * violation.
 */
function radien(text) {
  const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...ohneKommentare.matchAll(/border-radius:\s*([^;{}]+?)\s*(?=[;\n}])/g)]
    .map((m) => m[1].trim());
}

const ERLAUBT = /^(0|50%|999px|(var\(--radius(-klein|-innen)?\)|0)(\s+(var\(--radius(-klein|-innen)?\)|0)){0,3})$/;

console.log('\nDie Ecken stehen an einer Stelle\n');

const alle = radien(css);
const fremd = alle.filter((w) => !ERLAUBT.test(w));
check('Kein Rundungswert steht als Zahl in einer Regel',
  fremd.length === 0, fremd.length ? fremd.join(' / ') : `${alle.length} Werte, alle ueber Namen`);

// The three names themselves. Not "they exist" - what they are set to.
const wert = (name) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return m ? m[1].trim() : null;
};
for (const n of ['--radius', '--radius-klein', '--radius-innen']) {
  check(`${n} steht auf 0`, wert(n) === '0', wert(n) ?? 'fehlt');
}

// And the circles are still circles. If a future pass sets these to 0 too,
// the dot next to an unread conversation becomes a square and the profile
// picture a box.
check('Der Ungelesen-Punkt ist rund', /width: 6px; height: 6px; border-radius: 50%/.test(css));
check('Das Profilbild ist rund',
  /--bild\); height: var\(--bild\); border-radius: 50%/.test(css));

console.log('\nDas Bild fuer X folgt der Seite\n');

for (const konst of ['BILD_ECKE', 'BALKEN_ECKE', 'SCHILD_ECKE']) {
  const m = new RegExp(`const ${konst} = (\\d+)`).exec(appJs);
  check(`${konst} steht auf 0`, m?.[1] === '0', m?.[1] ?? 'fehlt');
}
// The bars and the tag have to USE the constants. Setting them to zero and
// then passing a literal at the call site would leave the check green and
// the image round.
check('Die Balken zeichnen mit BALKEN_ECKE',
  (appJs.match(/roundedRect\([^)]*BALKEN_ECKE\)/g) || []).length === 2,
  `${(appJs.match(/roundedRect\([^)]*BALKEN_ECKE\)/g) || []).length} Aufrufe`);
check('Das CLOSED-Schild zeichnet mit SCHILD_ECKE',
  /roundedRect\([^)]*SCHILD_ECKE\)/.test(appJs));
// Except the logo: two rounded bars are what the mark IS.
check('Die Logomarke bleibt rund', /roundedRect\(ctx, margin \+ 24 \* e, y, 18 \* e, 64 \* e, 9 \* e\)/.test(appJs));

console.log('\nDie Schriftdateien\n');

// A font is the one asset that fails silently. A missing image leaves a hole
// somebody notices; a missing .woff2 makes the browser fall through to the
// system's monospace, which looks almost right - and every figure on the
// page is then a different width than it was designed for, without an error
// anywhere.
const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const da = (rel) => fs.existsSync(path.join(root, 'public', rel));

const faces = [...css.matchAll(/@font-face\s*\{[^}]*url\('([^']+)'\)[^}]*font-weight:\s*(\d+)/g)]
  .map((m) => ({ pfad: m[1], gewicht: m[2] }));
check('Das Blatt bindet Schriftdateien ein', faces.length > 0, `${faces.length} Schnitte`);
const fehlend = faces.filter((f) => !da(f.pfad)).map((f) => f.pfad);
check('Und jede davon liegt auch da', fehlend.length === 0,
  fehlend.join(', ') || faces.map((f) => f.gewicht).join(', '));

// The page asks for five weights - 400, 500, 600, 650, 700 - and 650 lands
// on 700 by the CSS matching rules. So four files have to be there; a
// missing 600 would quietly be drawn at 700.
const gewichte = faces.map((f) => f.gewicht).sort();
check('Alle vier Schnitte sind dabei',
  ['400', '500', '600', '700'].every((g) => gewichte.includes(g)), gewichte.join(', '));

// The licence has to travel with the font - that is what the OFL asks for,
// and it is the kind of file that gets left behind in a copy.
check('Die Lizenz liegt bei der Schrift',
  fs.readdirSync(path.join(root, 'public', 'fonts')).some((f) => /^LICENSE/i.test(f)));

// Preload: without it the browser only learns about the font once the sheet
// is parsed, and every figure shifts on the first frame.
const vorgeladen = /<link[^>]+rel="preload"[^>]+href="\/([^"]+\.woff2)"/.exec(html)?.[1];
check('Die Textschrift wird vorgeladen', Boolean(vorgeladen), vorgeladen ?? 'keine');
check('Und die vorgeladene Datei gibt es', vorgeladen ? da(vorgeladen) : false, vorgeladen ?? '');
check('Der Vorlader traegt crossorigin',
  /rel="preload"[^>]*\.woff2"[^>]*crossorigin/.test(html));

// Offline: the installed app serves its shell from the cache. A font that is
// not in the list is fetched from the network - and in a dead zone it is not
// fetched at all.
const imShell = faces.filter((f) => sw.includes(`/${f.pfad}`)).length;
check('Alle Schriftdateien stehen im Cache des Service Workers',
  imShell === faces.length, `${imShell} von ${faces.length}`);
// And the cache name has to have moved, or an installed app keeps the old
// list and never asks for the new files at all.
check('Der Cache-Name ist nicht mehr v2',
  !/const CACHE = 'sized-shell-v2'/.test(sw),
  /const CACHE = '([^']+)'/.exec(sw)?.[1] ?? 'keiner');

console.log('\nDie Kartenversion steht in zwei Dateien und muss uebereinstimmen\n');

const vApp = /const CARD_VERSION = (\d+);/.exec(appJs)?.[1];
const vOg = /const CARD_VERSION = (\d+);/.exec(ogTs)?.[1];
check('app.js nennt eine Version', Boolean(vApp), vApp ?? 'keine');
check('og/index.ts nennt eine Version', Boolean(vOg), vOg ?? 'keine');
check('Beide sind dieselbe', vApp === vOg, `app.js ${vApp} / og ${vOg}`);

// --- Gegenproben -----------------------------------------------------------
// Each of the three checks above gets broken on a copy, and has to turn red.
// A check that stays green on a broken file is not a check.
console.log('\nGegenproben\n');

const kaputt1 = css.replace('  --radius: 0;', '  --radius: 12px;');
check('Vorbedingung: --radius wurde wirklich veraendert', kaputt1 !== css);
const w1 = /--radius:\s*([^;]+);/.exec(kaputt1.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1].trim();
check('Gegenprobe: eine gerundete Ecke faellt auf', w1 !== '0', w1);

const kaputt2 = css.replace('.closed-tag { font-size: .68rem; background: var(--bg-3); '
  + 'border: 1px solid var(--line); border-radius: var(--radius-klein);',
  '.closed-tag { font-size: .68rem; background: var(--bg-3); '
  + 'border: 1px solid var(--line); border-radius: 4px;');
check('Vorbedingung: eine Zahl wurde wirklich eingeschleust', kaputt2 !== css);
check('Gegenprobe: eine Zahl in einer Regel faellt auf',
  radien(kaputt2).some((w) => !ERLAUBT.test(w)),
  radien(kaputt2).filter((w) => !ERLAUBT.test(w)).join(' / '));

const kaputt3 = ogTs.replace(`const CARD_VERSION = ${vOg};`, `const CARD_VERSION = ${Number(vOg) + 1};`);
check('Vorbedingung: die Version wurde wirklich veraendert', kaputt3 !== ogTs);
check('Gegenprobe: zwei verschiedene Versionen fallen auf',
  /const CARD_VERSION = (\d+);/.exec(kaputt3)?.[1] !== vApp);

console.log(`\n${fehler === 0 ? `  Alle ${'✓'} bestanden` : `  ${fehler} fehlgeschlagen`}\n`);
process.exit(fehler === 0 ? 0 : 1);
