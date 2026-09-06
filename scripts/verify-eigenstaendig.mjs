// ============================================================================
// Baut aus verify/index.ts eine Datei, die man ins Dashboard einfügen kann.
//
// Warum es die gibt: Auf dem Mac liegt kein Node und keine Supabase-CLI, und
// eine Function mit relativen Importen (../_shared/...) lässt sich im
// Dashboard-Editor nicht speichern – dort gibt es die Nachbardateien nicht.
// og/index.ts ist deshalb von Hand importfrei gehalten. Bei verify ginge das
// auch, wäre aber die schlechtere Lösung: Der Code ist zehnmal so lang, und
// drei der fünf Nachbardateien (jwt, solana, holdings) werden auch von
// anderen Functions gebraucht.
//
// Also andersherum: EINE Quelle, und diese Datei setzt daraus die Fassung für
// den Editor zusammen. Was hier herauskommt, wird nie von Hand bearbeitet –
// eine Änderung geht immer in die Quelle und wird neu erzeugt.
//
//   node scripts/verify-eigenstaendig.mjs
//   -> supabase/functions/verify/index.dashboard.ts
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fnDir = path.join(root, 'supabase/functions');

const lies = (p) => fs.readFileSync(path.join(fnDir, p), 'utf8');

const quelle = lies('verify/index.ts');

// Die Nachbardateien in der Reihenfolge, in der sie voneinander abhängen.
// Nicht aus den Importen abgeleitet, sondern hier benannt: Eine falsche
// Reihenfolge fällt sonst erst im Betrieb auf, und zwar als leere Seite.
const NACHBARN = [
  '_shared/base58.ts',
  '_shared/freischaltung.ts',
  '_shared/common.ts',
  '_shared/jwt.ts',
  '_shared/solana.ts',
  '_shared/holdings.ts',
];

/** Nimmt einer Datei ihre Importe und ihre export-Schlüsselwörter. */
function entkleiden(text, datei) {
  const externe = [];
  // "export { x } from './y.ts'" ist ein Weiterreichen, kein Import: Der Inhalt
  // steht in dieser Fassung ohnehin schon da, die Zeile fällt ersatzlos weg.
  const ohneWeitergabe = text.replace(/^export\s*\{[^}]*\}\s*from\s+'\.[^']*';?\s*$/gm, '');

  const ohneImporte = ohneWeitergabe.replace(
    /^import\s[\s\S]*?from\s+'([^']+)';?\s*$/gm,
    (ganz, woher) => {
      // Externe Importe (jsr:, npm:, https:) müssen bleiben – sie kommen
      // ganz nach oben. Nur die relativen fallen weg, weil ihr Inhalt
      // gleich darunter steht.
      if (!woher.startsWith('.')) { externe.push(ganz.trim()); }
      return '';
    });

  return {
    externe,
    text: `// ---------------------------------------------------------------------------\n`
      + `// aus ${datei}\n`
      + `// ---------------------------------------------------------------------------\n`
      + ohneImporte
        .replace(/^export\s+(async\s+function|function|const|interface|type|class)\s/gm, '$1 ')
        .trim(),
  };
}

const teile = [];
const externe = new Set();

for (const datei of NACHBARN) {
  const e = entkleiden(lies(datei), datei);
  e.externe.forEach((x) => externe.add(x));
  teile.push(e.text);
}
const haupt = entkleiden(quelle, 'verify/index.ts');
haupt.externe.forEach((x) => externe.add(x));

const kopf = `// ============================================================================
// verify – EIGENSTÄNDIGE FASSUNG FÜR DEN DASHBOARD-EDITOR
//
// ACHTUNG: Diese Datei wird NICHT von Hand bearbeitet. Sie entsteht aus
// supabase/functions/verify/index.ts und den Dateien unter _shared/ durch
//
//     node scripts/verify-eigenstaendig.mjs
//
// Wer hier etwas ändert, verliert es beim nächsten Lauf – und schlimmer: Die
// Fassung im Dashboard und die im Projekt sagen dann Verschiedenes, ohne dass
// man es einer von beiden ansieht.
//
// Erzeugt am ${new Date().toISOString().slice(0, 10)}
// ============================================================================

${[...externe].join('\n')}
`;

const ziel = path.join(fnDir, 'verify/index.dashboard.ts');
fs.writeFileSync(ziel, `${kopf}\n${teile.join('\n\n')}\n\n${haupt.text}\n`);

const inhalt = fs.readFileSync(ziel, 'utf8');
const relativeUebrig = [...inhalt.matchAll(/from\s+'\.[^']*'/g)].map((m) => m[0]);
if (relativeUebrig.length) {
  console.error(`\n  Es sind noch relative Importe drin: ${relativeUebrig.join(', ')}\n`);
  process.exit(1);
}

console.log(`\n  ${ziel.replace(root + '/', '')} – ${inhalt.split('\n').length} Zeilen, `
  + `keine relativen Importe\n`);
