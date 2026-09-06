// ============================================================================
// Kontrollblick: die leere Abstimmungsliste – als Ansem und als Nutzer.
//
// Aendert nichts, schneidet Blatt und Geruest woertlich aus der Quelle.
//
//   node scripts/vorschau-leer.mjs
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const sn = (v, b) => { const i = appJs.indexOf(v), j = appJs.indexOf(b, i); return appJs.slice(i, j); };
// Der Beobachter, der --poll-kopf pflegt: Ohne ihn stuende der Hinweis in der
// Mitte der LISTE statt in der Mitte der Seite, und das Bild zeigte nicht,
// was die Seite tut.
const beobachter = sn('function beobachteKopfHoehe()', '\n/**\n * Die Laufzeit im Anlegeformular');

const a = html.indexOf('<main id="pane-polls"');
const b = html.indexOf('</main>', a);
if (a < 0 || b < 0) throw new Error('pane-polls nicht in index.html gefunden');
const geruest = html.slice(a, b + 7).replace('class="pane" hidden', 'class="pane"');

// Der Satz woertlich aus app.js – nicht abgetippt.
const leer = /list\.innerHTML = '(<div class="empty">[^']*<\/div>)'/.exec(appJs);
if (!leer) throw new Error('Der Hinweis auf die leere Liste sieht anders aus als erwartet');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0"><div style="display:flex;flex-direction:column;
         height:100vh;background:var(--bg)">${geruest}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

for (const [datei, breite, admin, offen] of [
  ['leer-polls-nutzer.png', 900, false, false],
  ['leer-polls-ansem.png', 900, true, false],
  ['leer-polls-ansem-offen.png', 900, true, true],
  ['leer-polls-handy.png', 390, false, false],
]) {
  const seite = await browser.newPage({
    viewport: { width: breite, height: breite < 500 ? 780 : 800 }, deviceScaleFactor: 2,
  });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({ content: `const $ = (s, r = document) => r.querySelector(s);\n${beobachter}` });
  await seite.evaluate(([inhalt, ist, offen]) => {
    const k = document.querySelector('#poll-admin');
    k.hidden = !ist;
    k.classList.toggle('offen', offen);
    document.querySelector('#poll-admin-felder').hidden = !offen;
    document.querySelector('#poll-list').innerHTML = inhalt;
  }, [leer[1], admin, !!offen]);
  await seite.waitForTimeout(250);

  // Nachgemessen statt nach Augenmass, und zwar gegen die Mitte der SEITE und
  // nicht der Liste. Das ist der Punkt der Fassung: Der Satz soll dort stehen
  // bleiben, egal ob der Anlegekasten darueber offen ist oder zu. Bleibt eine
  // Abweichung stehen, hat entweder die Sperre nach oben gegriffen (kurzer
  // Bildschirm) oder der Innenabstand der Seite ist oben und unten verschieden
  // – auf dem Handy hat .pane oben keinen.
  const abstand = await seite.evaluate(() => {
    const p = document.querySelector('#pane-polls').getBoundingClientRect();
    const e = document.querySelector('.empty').getBoundingClientRect();
    return Math.round(Math.abs((p.top + p.bottom) / 2 - (e.top + e.height / 2)));
  });
  await seite.screenshot({ path: path.join(ausgabe, datei) });
  await seite.close();
  console.log(`  ${datei.padEnd(30)} Abweichung von der Seitenmitte: ${abstand} px`);
}

await browser.close();
server.close();
