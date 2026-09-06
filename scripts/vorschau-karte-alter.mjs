// ============================================================================
// Was passiert, wenn Bild und Text unterschiedlich alt sind
//
// Der Text der Vorschaukarte wird bei jedem Abruf frisch aus der Datenbank
// gelesen. Das Bild dagegen liegt fertig in der Ablage und stammt aus dem
// Moment, in dem Ansem die Abstimmung angelegt hat – da stand überall Null.
//
// Auf X fällt das nicht auf, weil X bei Linkkarten inzwischen nur das Bild und
// die Domain zeigt. Überall sonst – Slack, Discord, Telegram – steht der Text
// darunter, und dann sieht man den Widerspruch.
//
// Dieses Bild stellt beides nebeneinander:
//   oben   der jetzige Stand
//   unten  mit Auffrischen beim Öffnen des Polls-Tabs
//
//   node scripts/vorschau-karte-alter.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeichner = schneide('const cssWert =', 'async function ladePollBild');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.addScriptTag({
  content: `
    const state = { cfg: { symbol: 'ANSEM' }, polls: [] };
    const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
    ${formate}
    ${zeichner}
    window.zeichnePoll = zeichnePoll;
  `,
});

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });

// Dieselbe Abstimmung zweimal: wie sie beim Anlegen aussah und wie sie
// inzwischen aussieht.
const FRAGE = 'Should we open the token gate to smaller holders?';
const BEIM_ANLEGEN = {
  id: 16, closed: false, totalVotes: 0, totalUsd: 0, question: FRAGE,
  options: [
    opt('Ship it this week', 0, 0, 0),
    opt('Wait for the audit', 0, 0, 0),
    opt('Do neither and keep building quietly', 0, 0, 0),
  ],
};
const JETZT = {
  id: 16, closed: false, totalVotes: 142, totalUsd: 89300, question: FRAGE,
  options: [
    opt('Ship it this week', 94, 55_400, 55.4 / 89.3),
    opt('Wait for the audit', 31, 24_100, 24.1 / 89.3),
    opt('Do neither and keep building quietly', 17, 9_800, 9.8 / 89.3),
  ],
};

const male = (p) => seite.evaluate(async (poll) => {
  const c = await window.zeichnePoll(poll, { fuerKarte: true });
  return c.toDataURL('image/png');
}, p);

const bildAlt = await male(BEIM_ANLEGEN);
const bildNeu = await male(JETZT);

// Der Text kommt in beiden Fällen frisch aus der Datenbank – er ist also
// immer der von JETZT.
const TITEL = FRAGE;
const TEXT = '142 votes · $89,300 in $ANSEM';

const karte = (bild) => `
  <div class="karte">
    <img src="${bild}" alt="">
    <div class="leiste">
      <div class="domain">sized.gg</div>
      <div class="titel">${TITEL}</div>
      <div class="besch">${TEXT}</div>
    </div>
  </div>`;

const html = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 30px; background: var(--bg); }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.8rem; font-size: .82rem; color: var(--dim); max-width: 104ch; }
  section { margin: 0 0 30px; max-width: 620px; }
  h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-family: var(--mono); font-size: .78rem; }
  .hinweis { margin: 0 0 .7rem; font-size: .78rem; color: var(--dimmer); max-width: 104ch; }
  /* Die Kachel so, wie Slack, Discord und Telegram sie bauen: Bild oben,
     darunter Domain, Titel und Beschreibung. */
  .karte { border: 1px solid #2f3336; border-radius: 14px; overflow: hidden; background: #16181c; }
  .karte img { display: block; width: 100%; }
  .leiste { padding: 11px 13px; border-top: 1px solid #2f3336; font-size: 14px; line-height: 1.35; }
  .domain { color: #71767b; }
  .titel { color: #e7e9ee; margin: 2px 0; }
  .besch { color: #71767b; }
  .marke { display: inline-block; margin-left: .4rem; font-size: .68rem; font-family: var(--mono);
           padding: .1rem .4rem; border-radius: 4px; }
  .schlecht { background: rgba(255,107,107,.16); color: #ff8f8f; }
  .gut { background: rgba(var(--accent-rgb), .16); color: var(--accent); }
</style>
<h1>Bild und Text sind unterschiedlich alt</h1>
<p class="lead">Dieselbe Abstimmung, geteilt von einem Nutzer. Der Text unter der Kachel wird bei jedem Abruf frisch aus der Datenbank gelesen; das Bild liegt fertig in der Ablage. So sieht die Kachel in Slack, Discord oder Telegram aus — auf X wird nur das Bild gezeigt, der Text bleibt dort unsichtbar.</p>

<section>
  <h2><span class="nr">0</span>Jetziger Stand<span class="marke schlecht">Widerspruch</span></h2>
  <p class="hinweis">Das Bild stammt vom Anlegen der Abstimmung, also von vor den Stimmen. Darunter steht der aktuelle Stand. Wer genau hinsieht, liest im Bild dreimal 0 $ und in der Zeile darunter 142 Stimmen.</p>
  ${karte(bildAlt)}
</section>

<section>
  <h2><span class="nr">1</span>Mit Auffrischen<span class="marke gut">stimmig</span></h2>
  <p class="hinweis">Ansems Browser erneuert die Karten jedes Mal, wenn er den Polls-Tab öffnet. Dann liegt das aktuelle Bild bereit, sobald X, Slack oder Telegram das nächste Mal nachsehen.</p>
  ${karte(bildNeu)}
</section>
`;

fs.writeFileSync(path.join(root, 'public', '_vorschau-alter.html'), html);
const blatt = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 2 });
await blatt.goto(`file://${path.join(root, 'public', '_vorschau-alter.html')}`);
await blatt.waitForTimeout(350);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await blatt.screenshot({ path: path.join(root, 'preview', 'karte-alter.png'), fullPage: true });
fs.rmSync(path.join(root, 'public', '_vorschau-alter.html'), { force: true });

await browser.close();
server.close();
console.log('  preview/karte-alter.png');
