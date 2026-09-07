// ============================================================================
// Builds a file from verify/index.ts that can be pasted into the dashboard.
//
// Why this exists: Node and the Supabase CLI aren't available everywhere,
// and a function with relative imports (../_shared/...) can't be saved in
// the dashboard editor - the neighboring files don't exist there. og/index.ts
// is therefore kept import-free by hand. The same could be done for verify,
// but that would be the worse solution: the code is ten times as long, and
// three of the five neighboring files (jwt, solana, holdings) are also
// needed by other functions.
//
// So the other way round: ONE source, and this file assembles the editor
// version from it. What comes out of this is never edited by hand - a
// change always goes into the source and gets regenerated.
//
//   node scripts/verify-eigenstaendig.mjs
//   -> supabase/functions/verify/index.dashboard.ts
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fnDir = path.join(root, 'supabase/functions');

const read = (p) => fs.readFileSync(path.join(fnDir, p), 'utf8');

const source = read('verify/index.ts');

// The neighboring files in the order they depend on each other. Not derived
// from the imports but named explicitly here: a wrong order would otherwise
// only show up in production, as a blank page.
const NACHBARN = [
  '_shared/base58.ts',
  '_shared/freischaltung.ts',
  '_shared/common.ts',
  '_shared/jwt.ts',
  '_shared/solana.ts',
  '_shared/holdings.ts',
];

/** Strips a file of its imports and its export keywords. */
function entkleiden(text, file) {
  const externe = [];
  // "export { x } from './y.ts'" is a pass-through, not an import: the
  // content is already right there in this version, so the line just drops
  // out with nothing to replace it.
  const withoutForwarding = text.replace(/^export\s*\{[^}]*\}\s*from\s+'\.[^']*';?\s*$/gm, '');

  const ohneImporte = withoutForwarding.replace(
    /^import\s[\s\S]*?from\s+'([^']+)';?\s*$/gm,
    (ganz, woher) => {
      // External imports (jsr:, npm:, https:) have to stay - they go right
      // to the top. Only the relative ones fall away, because their content
      // sits right below.
      if (!woher.startsWith('.')) { externe.push(ganz.trim()); }
      return '';
    });

  return {
    externe,
    text: `// ---------------------------------------------------------------------------\n`
      + `// aus ${file}\n`
      + `// ---------------------------------------------------------------------------\n`
      + ohneImporte
        .replace(/^export\s+(async\s+function|function|const|interface|type|class)\s/gm, '$1 ')
        .trim(),
  };
}

const parts = [];
const externe = new Set();

for (const file of NACHBARN) {
  const e = entkleiden(read(file), file);
  e.externe.forEach((x) => externe.add(x));
  parts.push(e.text);
}
const haupt = entkleiden(source, 'verify/index.ts');
haupt.externe.forEach((x) => externe.add(x));

const header = `// ============================================================================
// verify - SELF-CONTAINED VERSION FOR THE DASHBOARD EDITOR
//
// WARNING: this file is NOT edited by hand. It is generated from
// supabase/functions/verify/index.ts and the files under _shared/ by
//
//     node scripts/verify-eigenstaendig.mjs
//
// Anyone who changes something here loses it on the next run - and worse: the
// version in the dashboard and the one in the project then say different
// things, without either of them showing it.
//
// Generated on ${new Date().toISOString().slice(0, 10)}
// ============================================================================

${[...externe].join('\n')}
`;

const ziel = path.join(fnDir, 'verify/index.dashboard.ts');
fs.writeFileSync(ziel, `${header}\n${parts.join('\n\n')}\n\n${haupt.text}\n`);

const content = fs.readFileSync(ziel, 'utf8');
const relativeRemaining = [...content.matchAll(/from\s+'\.[^']*'/g)].map((m) => m[0]);
if (relativeRemaining.length) {
  console.error(`\n  Es sind noch relative Importe drin: ${relativeRemaining.join(', ')}\n`);
  process.exit(1);
}

console.log(`\n  ${ziel.replace(root + '/', '')} – ${content.split('\n').length} Zeilen, `
  + `keine relativen Importe\n`);
