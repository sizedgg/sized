// ============================================================================
// Wie der geteilte Link auf X aussehen wird
//
// Kein echter Abruf – X gibt es hier nicht zu sehen. Das Bild baut die Kachel
// nach, wie X sie aus den Meta-Zeilen zusammensetzt, damit man vor dem
// Ausrollen beurteilen kann, was am Ende in der Zeitleiste steht.
//
// Wichtig ist der Unterschied zu einem angehängten Bild: Eine Linkkarte hat
// unter dem Bild eine Leiste mit Domain, Titel und Beschreibung, und das Bild
// darüber wird auf rund 1,91:1 zugeschnitten. Deshalb wird die Karte genau in
// diesem Verhältnis gezeichnet – so fällt nichts weg.
//
//   node scripts/vorschau-x-karte.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bild = path.join(root, 'preview', 'poll-karte-normal.png');
if (!fs.existsSync(bild)) {
  console.error('  Erst node scripts/test-poll-bild.mjs laufen lassen – das erzeugt die Karten.');
  process.exit(1);
}
const daten = 'data:image/png;base64,' + fs.readFileSync(bild).toString('base64');

// Die Beschreibung baut supabase/functions/og genauso zusammen.
const TITEL = 'Should we open the token gate to smaller holders?';
const BESCHREIBUNG = '191 votes · $781,420 in $ANSEM';

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 34px; background: #000; color: #e7e9ee;
    font: 15px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  .tweet { max-width: 600px; display: flex; gap: 12px; }
  .avatar { width: 40px; height: 40px; border-radius: 999px; background: #2f3336; flex: none; }
  .kopf { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
  .name { font-weight: 700; }
  .griff, .zeit { color: #71767b; }
  .text { margin: 0 0 12px; }
  /* Die Kachel: Bild oben, darunter die Leiste. Rundung und Rahmen sind die,
     die X selbst verwendet. */
  .karte {
    border: 1px solid #2f3336; border-radius: 16px; overflow: hidden;
    cursor: pointer;
  }
  .karte img { display: block; width: 100%; }
  .leiste { padding: 12px; border-top: 1px solid #2f3336; }
  .domain { color: #71767b; font-size: 15px; }
  .titel { margin: 2px 0 2px; }
  .besch { color: #71767b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .aktionen { display: flex; gap: 78px; margin-top: 12px; color: #71767b; font-size: 18px; }
  .hinweis { max-width: 600px; margin: 26px 0 0; color: #5d657a; font-size: 12.5px; line-height: 1.55; }
</style>
<div class="tweet">
  <div class="avatar"></div>
  <div style="flex:1; min-width:0">
    <div class="kopf"><span class="name">Ansem</span><span class="griff">@blknoiz06 · 1m</span></div>
    <p class="text">new vote is up</p>
    <div class="karte">
      <img src="${daten}" alt="">
      <div class="leiste">
        <div class="domain">sized.gg</div>
        <div class="titel">${TITEL}</div>
        <div class="besch">${BESCHREIBUNG}</div>
      </div>
    </div>
    <div class="aktionen"><span>&#128172;</span><span>&#8635;</span><span>&#9825;</span><span>&#8599;</span></div>
  </div>
</div>
<p class="hinweis">
  Nachbau, kein echter Abruf. Die ganze Kachel ist ein Link auf sized.gg/p/12;
  die Leiste unten mit Domain, Frage und Zahlen setzt X selbst aus den
  Meta-Zeilen zusammen, die supabase/functions/og ausliefert.
</p>
`;

fs.writeFileSync(path.join(root, 'public', '_vorschau-x.html'), html);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 2 });
await seite.goto(`file://${path.join(root, 'public', '_vorschau-x.html')}`);
await seite.waitForTimeout(300);
await seite.screenshot({ path: path.join(root, 'preview', 'x-karte.png'), fullPage: true });
await browser.close();
fs.rmSync(path.join(root, 'public', '_vorschau-x.html'), { force: true });
console.log('  preview/x-karte.png');
