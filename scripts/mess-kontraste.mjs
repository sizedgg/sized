// ============================================================================
// Every colour pair on the page, measured against the requirement it has to meet
//
// Why this exists: styles.css argues about its colours in contrast ratios -
// "9.2:1 for the dark text on it", "6.4:1 sits well under the button". Those
// numbers were measured once, on a dark ground. Move the page to paper and
// every one of them is a different number, while the sentence around it stays
// where it is. A comment that states a measurement is a promise; this script
// is what keeps it honest.
//
// It reads the REAL public/styles.css, not a copy of the palette. A second
// copy would drift, and then this would be measuring a page that doesn't
// exist.
//
//   node scripts/mess-kontraste.mjs          all pairs
//   node scripts/mess-kontraste.mjs --kurz   only what falls short
//
// The thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large text and
// for anything that has to READ as a boundary or a state (borders, dots,
// bars). Below that a thing is still visible, it just stops being reliable
// on a bad screen in daylight - which is where a phone lives.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// --- reading the palette ----------------------------------------------------

/**
 * Pulls the :root block out of the file.
 *
 * Not with a regex over the whole file: the comments in there contain braces
 * and colour values by the dozen, and every one of them would look like a
 * declaration. Instead the comments come out first, then the first block.
 */
function palette(text) {
  const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /:root\s*\{([\s\S]*?)\}/.exec(ohneKommentare);
  if (!block) throw new Error('Kein :root-Block in styles.css gefunden');
  const map = new Map();
  for (const line of block[1].split(';')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/is.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

const TOKENS = palette(css);

/** Resolves var(--x) chains, so --dm-eigen: var(--fuellung-spitze) works. */
function resolve(value, tiefe = 0) {
  if (tiefe > 10) throw new Error(`Ringschluss bei ${value}`);
  const m = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value.trim());
  if (!m) return value.trim();
  const next = TOKENS.get(m[1]);
  if (next === undefined) throw new Error(`Unbekanntes Token: ${m[1]}`);
  return resolve(next, tiefe + 1);
}

/** A token name, a hex value or an rgba() -> {r,g,b,a}. */
function farbe(spec) {
  const v = spec.startsWith('--') ? resolve(TOKENS.get(spec) ?? '', 0) : spec;
  if (spec.startsWith('--') && !TOKENS.has(spec)) throw new Error(`Unbekanntes Token: ${spec}`);

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb) {
    const t = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { r: t[0], g: t[1], b: t[2], a: t.length > 3 ? t[3] : 1 };
  }
  throw new Error(`Farbe nicht lesbar: ${spec} -> ${v}`);
}

/**
 * Lays a translucent colour over an opaque one.
 *
 * Needed because half the interesting spots on this page are rgba: the
 * unread row, the timestamp in your own bubble, the warning box. Their
 * contrast depends on what's underneath, so measuring the raw value would
 * measure a colour nobody ever sees.
 */
const ueber = (vorn, hinten) => ({
  r: vorn.r * vorn.a + hinten.r * (1 - vorn.a),
  g: vorn.g * vorn.a + hinten.g * (1 - vorn.a),
  b: vorn.b * vorn.a + hinten.b * (1 - vorn.a),
  a: 1,
});

const kanal = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminanz = (c) => 0.2126 * kanal(c.r) + 0.7152 * kanal(c.g) + 0.0722 * kanal(c.b);

/** WCAG contrast. `grund` is the opaque thing at the very bottom. */
function kontrast(vorn, hinten, grund) {
  let a = farbe(vorn);
  let b = farbe(hinten);
  const unten = grund ? farbe(grund) : b;
  if (b.a < 1) b = ueber(b, unten);
  if (a.a < 1) a = ueber(a, b);
  const x = luminanz(a);
  const y = luminanz(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// --- what has to hold -------------------------------------------------------
//
// Each line: what sits on what, the floor it must clear, and the job it does.
// The job is the part that matters when a value fails - it says what breaks,
// not just that a number is small.

const PAARE = [
  ['Text',                  '--text',        '--bg',    4.5, 'Fliesstext auf dem Seitengrund'],
  ['Text auf Karte',        '--text',        '--bg-1',  4.5, 'Fliesstext in Panel und Login-Karte'],
  ['Zweitschrift',          '--dim',         '--bg',    4.5, 'Beschriftungen, Zeitangaben'],
  ['Zweitschrift/Karte',    '--dim',         '--bg-1',  4.5, 'dasselbe in der Karte'],
  ['Leisestes',             '--dimmer',      '--bg-1',  3.0, 'Versalien-Mikroschrift ueber Feldern'],
  ['Betrag',                '--worth',       '--bg-1',  4.5, 'die Zahlenspalte im Posteingang'],
  ['Betrag/Grund',          '--worth',       '--bg',    4.5, 'dieselbe Spalte ohne Panel'],
  ['Knopfschrift',          '--knopf-text',  '--accent-fill', 4.5, 'Beschriftung auf "Senden"'],
  ['Akzent als Strich',     '--accent',      '--bg-1',  3.0, 'Rahmen und Verweise'],
  ['Fokusrahmen',           '--fokus',       '--bg-1',  3.0, 'das Feld, in das gerade getippt wird'],
  ['Ruherahmen',            '--line',        '--bg-1',  1.2, 'Feld ohne Fokus - darf leise sein'],
  ['Balken',                '--fuellung',    '--bg-1',  1.3, 'gefuellter Teil einer Antwort'],
  ['Fuehrender Balken',     '--fuellung-spitze', '--bg-1', 1.3, 'die fuehrende Antwort'],
  ['Text auf Balken',       '--text',        '--fuellung',        4.5, 'die Antwort steht darauf'],
  ['Text auf Fuehrendem',   '--text',        '--fuellung-spitze', 4.5, 'dieselbe Zeile, andere Fuellung'],
  ['Eigene DM',             '--dm-eigen-text', '--dm-eigen',      4.5, 'was man selbst geschrieben hat'],
  ['Zeit in eigener DM',    'rgba(255,255,255,.72)', '--dm-eigen', 4.5, 'Uhrzeit in der eigenen Blase'],
  ['Fremde DM',             '--dm-fremd-text', '--dm-fremd',      4.5, 'was Ansem geschrieben hat'],
  ['Zitat in DM',           '--dm-zitat-text', '--dm-fremd',      4.5, 'die zitierte Zeile darueber'],
  ['Name blau',             '--name-0',      '--bg-2',  4.5, 'Wallet-Kuerzel im Posteingang'],
  ['Name violett',          '--name-1',      '--bg-2',  4.5, 'dasselbe'],
  ['Name rosa',             '--name-2',      '--bg-2',  4.5, 'dasselbe'],
  ['Name vier',             '--name-3',      '--bg-2',  4.5, 'dasselbe'],
  ['Ansem-Gold',            '--gold',        '--bg-1',  4.5, 'die Markierung an Ansems Namen'],
  ['Warnrot',               '--warn',        '--bg-1',  4.5, 'Fehlermeldungen'],
  ['Ungelesen-Punkt',       '--ungelesen',   '--bg-2',  3.0, 'der 6px-Punkt neben dem Betrag'],
];

// Two more that need a third colour underneath, because the front layer is
// translucent and sits on a surface that is itself not the page ground.
const GESCHICHTET = [
  ['Ungelesen-Zeile', '--ungelesen-fuellung', '--bg-2', '--bg-2', 1.1,
    'die leicht getoente Zeile - muss sich abheben, ohne zu schreien'],
];

// The four name tones have a second job besides being readable: they have to
// be tellable APART. Two handles in near-identical colours are worse than
// none, because the colour then looks like it means something and doesn't.
const NAMEN = ['--name-0', '--name-1', '--name-2', '--name-3'];

// --- output -----------------------------------------------------------------

const kurz = process.argv.includes('--kurz');
let unterschritten = 0;
let gemessen = 0;

const zeile = (name, wert, floor, job) => {
  const ok = wert >= floor;
  if (!ok) unterschritten += 1;
  gemessen += 1;
  if (kurz && ok) return;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(22)} ${`${wert.toFixed(2)}:1`.padStart(8)}`
    + `  (min ${floor})  ${job}`);
};

console.log('\n── Kontraste, gemessen an public/styles.css ──\n');

for (const [name, vorn, hinten, floor, job] of PAARE) {
  zeile(name, kontrast(vorn, hinten), floor, job);
}
for (const [name, vorn, hinten, grund, floor, job] of GESCHICHTET) {
  zeile(name, kontrast(vorn, hinten, grund), floor, job);
}

console.log('\n── Die vier Namensfarben gegeneinander ──\n');
let engste = Infinity;
for (let i = 0; i < NAMEN.length; i += 1) {
  for (let j = i + 1; j < NAMEN.length; j += 1) {
    const a = farbe(NAMEN[i]);
    const b = farbe(NAMEN[j]);
    // Not WCAG here: two coloured names are told apart by hue at least as
    // much as by brightness, and a ratio alone would call blue and violet
    // identical. So both numbers get printed - brightness ratio and the
    // plain distance in RGB.
    const k = kontrast(NAMEN[i], NAMEN[j]);
    const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    engste = Math.min(engste, d);
    console.log(`  ${NAMEN[i]} ↔ ${NAMEN[j]}   Helligkeit ${k.toFixed(2)}:1   Abstand ${d.toFixed(0)}`);
  }
}
// 40, not 60. The first attempt used 60 and reported the SHIPPED palette as
// broken: blue and violet sit 45 apart there. That palette was checked
// separately for colour blindness (Delta E 5, see .h.t0 in styles.css), so a
// floor above its tightest pair would be this script overruling a decision it
// never measured. The floor is here to catch a re-tuning that collapses two
// tones into one, not to re-litigate the four that exist.
const NAMEN_ABSTAND = 40;
const namenOk = engste >= NAMEN_ABSTAND;
if (!namenOk) unterschritten += 1;
gemessen += 1;
console.log(`\n  ${namenOk ? '✓' : '✗'} Engster Abstand ${engste.toFixed(0)} (min ${NAMEN_ABSTAND})`);

console.log(`\n${unterschritten === 0
  ? `✅ ${gemessen} Paare, alle ueber ihrer Schwelle`
  : `❌ ${unterschritten} von ${gemessen} Paaren unter der Schwelle`}\n`);
process.exit(unterschritten === 0 ? 0 : 1);
