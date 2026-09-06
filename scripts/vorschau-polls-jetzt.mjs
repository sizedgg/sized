// ============================================================================
// Kontrollblick auf den eingebauten Stand des Polls-Tabs.
//
// Drei Ansichten: Ansem mit zugeklapptem Kasten, Ansem mit offenem Kasten,
// und ein normaler Nutzer, der den Kasten gar nicht hat.
//
// Aendert nichts – schneidet Blatt und Markup woertlich aus der Quelle.
//
//   node scripts/vorschau-polls-jetzt.mjs
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeit = schneide('function fristText(closesAt)', '\n// Unter einer Stunde');
const zeile = schneide('const BALD_MS =', '\n/**\n * Der Zeiger');
const markup = schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');
const escFn = schneide('const esc = (s) =>', '\n\n');
const symbole = schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen');

const kasten = /<div id="poll-admin"[\s\S]*?\n {4}<\/div>/.exec(html);
if (!kasten) throw new Error('poll-admin nicht in index.html gefunden');
const sichtbar = kasten[0].replace('class="poll-admin" hidden', 'class="poll-admin"');
const offen = sichtbar
  .replace('class="poll-admin"', 'class="poll-admin offen"')
  .replace('id="poll-admin-felder" hidden', 'id="poll-admin-felder"')
  .replace('aria-expanded="false"', 'aria-expanded="true"');

const opt = (id, label, votes, usd, share) => ({ id, label, votes, usd, share });
const POLLS = [
  { id: 1, closed: false, myOptionId: null, totalVotes: 191, totalUsd: 781420, stunden: 29,
    question: 'Should we open the token gate to smaller holders?',
    options: [opt(1, 'Ship it this week', 128, 482900, .618),
              opt(2, 'Wait for the audit', 63, 298520, .382)] },
  { id: 2, closed: false, myOptionId: 4, totalVotes: 88, totalUsd: 214300, stunden: 0.6,
    question: 'Next AMA: Thursday or Sunday?',
    options: [opt(3, 'Thursday', 51, 142100, .663), opt(4, 'Sunday', 37, 72200, .337)] },
  { id: 3, closed: true, myOptionId: 5, totalVotes: 240, totalUsd: 998400, stunden: null,
    question: 'Should the chat minimum go up?',
    options: [opt(5, 'Yes, to $50', 96, 612000, .613), opt(6, 'No, leave it', 144, 386400, .387)] },
];

const server = http.createServer((q, res) => {
  const form = q.url.includes('offen') ? offen : q.url.includes('nutzer') ? '' : sichtbar;
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body><main class="pane" id="pane" style="background:var(--bg);padding:14px">
       ${form}<div id="poll-list" class="poll-list"></div></main>`);
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

for (const [pfad, datei, admin] of [
  ['zu', 'polls-jetzt-zu.png', true],
  ['offen', 'polls-jetzt-offen.png', true],
  ['nutzer', 'polls-jetzt-nutzer.png', false],
]) {
  // 900 und nicht 760: Bei genau 760 greift schon der Handy-Block
  // (@media max-width: 760px), und dann zeigt das Bild die Handyfassung,
  // waehrend die Ueberschrift "am Schreibtisch" verspricht.
  const seite = await browser.newPage({ viewport: { width: 900, height: 880 }, deviceScaleFactor: 2 });
  await seite.goto(`http://127.0.0.1:${server.address().port}/?${pfad}`);
  await seite.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: ${admin} }, polls: [] };
      const toast = () => {};
      ${escFn}
      ${formate}
      ${symbole}
      ${zeit}
      ${zeile}
      ${markup}
      window.pollHtml = pollHtml;`,
  });
  // Ansem hat nie eine eigene Stimme – die Datenbank weist sie ab. Ein
  // Vorschaubild, das ihm einen Haken an einer Antwort zeigt, waere ein
  // Zustand, den es nicht geben kann, und genau solche Bilder fuehren spaeter
  // in die Irre.
  await seite.evaluate(([ps, ist]) => {
    document.querySelector('#poll-list').innerHTML = ps.map((p) => window.pollHtml({
      ...p,
      myOptionId: ist ? null : p.myOptionId,
      closesAt: p.stunden === null ? null : new Date(Date.now() + p.stunden * 3600e3 + 2000).toISOString(),
    })).join('');
  }, [POLLS, admin]);
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(350);
  await seite.locator('#pane').screenshot({ path: path.join(ausgabe, datei) });
  await seite.close();
  console.log(`  ${path.join(ausgabe, datei)}`);
}

await browser.close();
server.close();
