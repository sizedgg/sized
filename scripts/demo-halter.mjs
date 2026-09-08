/**
 * Baut die Vorfuehrung aus der Sicht eines Halters - zum Anklicken, auf dem
 * eigenen Rechner, ohne Node, ohne Postgres, ohne Supabase.
 *
 *   node scripts/demo-halter.mjs          baut preview/demo-halter/
 *   node scripts/demo-halter.mjs --pruef  baut und misst die fertige Seite
 *
 * Danach im gebauten Ordner:
 *
 *   python3 -m http.server 8000     und dann http://localhost:8000 oeffnen
 *
 * Der Ordner ist eine KOPIE von public/. Drei Dinge sind darin anders, und
 * nur diese drei:
 *
 *   vendor/supabase.js   ist scripts/demo-client.js - dieselbe Form wie der
 *                        echte Client, aber die Daten kommen aus der Datei
 *                        statt aus der Datenbank. Dort steht auch, was die
 *                        Vorfuehrung NICHT nachbaut.
 *   config.js            Platzhalter. Es wird nie eine Adresse aufgerufen.
 *   index.html           eine Zeile mehr: das Token liegt vor dem Start im
 *                        localStorage, damit die Seite angemeldet aufgeht.
 *
 * public/ selbst bleibt unberuehrt. Wer diesen Ordner loescht, hat nichts
 * verloren - er entsteht aus public/ neu.
 *
 * Warum localhost und nicht die Datei direkt anklicken: app.js ist ein
 * Modul und importiert zwei Dateien. Ueber file:// verbietet der Browser
 * das, ohne sichtbaren Fehler - die Seite bliebe leer.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUELLE = path.join(root, 'public');
const ZIEL = path.join(root, 'preview', 'demo-halter');

// Die Adresse steht in scripts/demo-client.js und wird von dort gelesen -
// zwei Kopien derselben Adresse waeren zwei Stellen, die auseinanderlaufen.
const clientQuelle = fs.readFileSync(path.join(root, 'scripts', 'demo-client.js'), 'utf8');
const ICH = clientQuelle.match(/export const ICH = '([^']+)'/)?.[1];
if (!ICH) throw new Error('In scripts/demo-client.js steht keine Adresse (export const ICH)');

/* --------------------------------------------------------------------------
 * Bauen
 * ----------------------------------------------------------------------- */

fs.rmSync(ZIEL, { recursive: true, force: true });
fs.mkdirSync(ZIEL, { recursive: true });
fs.cpSync(QUELLE, ZIEL, { recursive: true });

// config.js liegt nicht im Verzeichnis (siehe .gitignore) und wird hier auch
// nicht gebraucht: der Ersatz-Client ruft nichts auf. Die Platzhalter muessen
// trotzdem da sein, sonst schlaegt der Import in app.js fehl.
fs.writeFileSync(path.join(ZIEL, 'config.js'), `// Platzhalter fuer die Vorfuehrung - es wird nichts aufgerufen.
export const SUPABASE_URL = 'http://demo.invalid';
export const SUPABASE_ANON_KEY = 'demo';
`);

fs.copyFileSync(path.join(root, 'scripts', 'demo-client.js'), path.join(ZIEL, 'vendor', 'supabase.js'));

// Das Token. Nicht unterschrieben, und das muss es auch nicht sein: die
// Unterschrift prueft der Server, und hier gibt es keinen. Der Browser liest
// nur den Mittelteil, fuer die Adresse und die Laufzeit.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jetzt = Math.floor(Date.now() / 1000);
const token = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  // iat eine Minute alt, exp in sieben Tagen: app.js erneuert ein Token,
  // sobald die Haelfte der Laufzeit um ist - mit diesen Zahlen kommt es gar
  // nicht erst auf den Gedanken, und die Vorfuehrung laeuft eine Woche.
  b64({ wallet: ICH, is_admin: false, role: 'authenticated', iat: jetzt - 60, exp: jetzt + 7 * 86400 }),
  'demo',
].join('.');

const indexPfad = path.join(ZIEL, 'index.html');
let html = fs.readFileSync(indexPfad, 'utf8');
const einschub = `<script>
/* Vorfuehrung: angemeldet, bevor app.js laeuft. Ein normaler Klick auf
   "Sign out" wirft einen wieder heraus - dann diese Seite neu laden. */
try { localStorage.setItem('ansem_jwt', ${JSON.stringify(token)}); } catch (e) { /* egal */ }
</script>
`;
const anker = '<script src="/app.js" type="module"></script>';
if (!html.includes(anker)) throw new Error('Der Skript-Verweis in index.html sieht anders aus als erwartet');
html = html.replace(anker, einschub + anker);
fs.writeFileSync(indexPfad, html);

// Ein Doppelklick statt einer Zeile im Terminal. .command, weil macOS genau
// diese Endung im Finder ausfuehrt.
const starter = path.join(ZIEL, 'START.command');
fs.writeFileSync(starter, `#!/bin/bash
# Doppelklicken. Zum Beenden dieses Fenster schliessen.
cd "$(dirname "$0")" || exit 1
(sleep 1; open "http://localhost:8000") &
echo "SIZED - Vorfuehrung laeuft auf http://localhost:8000"
echo "Zum Beenden: Strg-C oder dieses Fenster schliessen."
python3 -m http.server 8000
`);
fs.chmodSync(starter, 0o755);

const dateien = [];
(function zaehle(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) zaehle(q); else dateien.push(q);
  }
})(ZIEL);
console.log(`\n  ${path.relative(root, ZIEL)}/  ${dateien.length} Dateien, `
  + `${Math.round(dateien.reduce((a, f) => a + fs.statSync(f).size, 0) / 1024)} KB`);
console.log(`  Halter ${ICH}\n`);

if (!process.argv.includes('--pruef')) process.exit(0);

/* --------------------------------------------------------------------------
 * Messen
 *
 * Eine Vorfuehrung, die aussieht wie die Seite, aber beim Klicken nichts
 * tut, faellt erst dem auf, der sie vorfuehrt. Also wird hier geklickt:
 * abstimmen, nachsehen ob die eigenen 7.240 $ dazugekommen sind,
 * zurueckschreiben, nachsehen ob die Zeile steht.
 * ----------------------------------------------------------------------- */

const { chromium } = await import('playwright');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const pfad = req.url.split('?')[0];
  const abs = path.join(ZIEL, path.normalize(pfad === '/' ? '/index.html' : pfad).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(ZIEL) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let schlecht = 0;
const pruef = (was, ok, dazu = '') => {
  if (!ok) schlecht++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${was}${dazu && !ok ? `\n         ${dazu}` : ''}`);
};

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const fehler = [];
page.on('pageerror', (e) => fehler.push(e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('#app:not([hidden])', { timeout: 20_000 });
await page.waitForSelector('.poll', { timeout: 20_000 });
await page.waitForTimeout(400);

pruef('Die Seite kommt angemeldet hoch', true);
pruef('Ohne JavaScript-Fehler', fehler.length === 0, fehler.join(' | '));

const kopf = (await page.textContent('#me-holdings').catch(() => '') ?? '').trim();
pruef('Oben steht der eigene Bestand', /7[,.]?2/.test(kopf), `steht: ${kopf}`);

const vorher = await page.evaluate(() => [...document.querySelectorAll('.poll')].map((p) => ({
  frage: p.querySelector('h4')?.textContent?.trim(),
  zu: Boolean(p.querySelector('.closed-tag')),
  summe: p.querySelector('.poll-meta span')?.textContent?.trim(),
  optionen: [...p.querySelectorAll('.opt')].map((o) => ({
    id: o.dataset.option,
    text: o.querySelector('.opt-label')?.textContent?.trim(),
    betrag: o.querySelector('.opt-num .held')?.textContent?.trim(),
  })),
})));
pruef('Zwei Abstimmungen', vorher.length === 2, `es sind ${vorher.length}`);
pruef('Die laufende fragt nach der Beta',
  /favorite \$ANSEM beta/i.test(vorher[0]?.frage ?? ''), vorher[0]?.frage);
pruef('$bullshit steht oben und fuehrt',
  vorher[0]?.optionen?.[0]?.text === '$bullshit', JSON.stringify(vorher[0]?.optionen?.[0]));
pruef('Die laufende hat 400.000 $ Volumen',
  /400,000/.test(vorher[0]?.summe ?? ''), vorher[0]?.summe);
pruef('Die abgelaufene hat 300.000 $ Volumen',
  /300,000/.test(vorher[1]?.summe ?? ''), vorher[1]?.summe);
pruef('Und sie ist als geschlossen ausgezeichnet', vorher[1]?.zu === true);
pruef('Die abgelaufene fragt nach der Chain',
  /chain/i.test(vorher[1]?.frage ?? ''), vorher[1]?.frage);

// Abstimmen. Auf $mensa, nicht auf den Fuehrenden: eine Stimme, die den
// Balken NICHT nur laenger macht, sondern die Reihenfolge unberuehrt laesst,
// zeigt beides - dass gezaehlt wird und dass nichts durcheinandergeraet.
const zahl = (t) => Number(String(t ?? '').replace(/[^0-9]/g, ''));
const vorAbstimmung = zahl(vorher[0].optionen[1].betrag);
await page.click('.opt[data-option="22"]');
await page.waitForTimeout(800);
const nachher = await page.evaluate(() => ({
  meine: [...document.querySelectorAll('.opt[aria-pressed="true"]')].map((o) => o.dataset.option),
  betrag: document.querySelector('.opt[data-option="22"] .opt-num .held')?.textContent?.trim(),
  summe: document.querySelector('.poll .poll-meta span')?.textContent?.trim(),
}));
pruef('Genau eine Antwort ist als eigene markiert',
  nachher.meine.length === 1 && nachher.meine[0] === '22', JSON.stringify(nachher.meine));
pruef('Und die eigenen 7.240 $ sind dazugekommen',
  zahl(nachher.betrag) - vorAbstimmung === 7240,
  `vorher ${vorAbstimmung}, nachher ${zahl(nachher.betrag)}`);
pruef('Das Volumen der Abstimmung waechst mit',
  zahl(nachher.summe) === 407_240, `steht: ${nachher.summe}`);

// Umentscheiden darf nicht doppelt zaehlen - dieselbe Regel wie in der
// Datenbank, wo eine Wallet pro Abstimmung eine Zeile hat.
await page.click('.opt[data-option="21"]');
await page.waitForTimeout(800);
const umentschieden = await page.evaluate(() => ({
  meine: [...document.querySelectorAll('.opt[aria-pressed="true"]')].map((o) => o.dataset.option),
  mensa: document.querySelector('.opt[data-option="22"] .opt-num .held')?.textContent?.trim(),
  summe: document.querySelector('.poll .poll-meta span')?.textContent?.trim(),
}));
pruef('Nach dem Umentscheiden zaehlt nur noch die neue Antwort',
  umentschieden.meine.length === 1 && umentschieden.meine[0] === '21',
  JSON.stringify(umentschieden.meine));
pruef('Und der alte Betrag ist wieder ohne die eigene Stimme',
  zahl(umentschieden.mensa) === 149_100, `steht: ${umentschieden.mensa}`);
pruef('Das Volumen bleibt bei 407.240 $',
  zahl(umentschieden.summe) === 407_240, `steht: ${umentschieden.summe}`);

// Auf die geschlossene Abstimmung darf nichts gehen.
const zuKlickbar = await page.evaluate(() => {
  const o = document.querySelector('.opt[data-option="11"]');
  return o ? o.getAttribute('aria-disabled') !== 'true' && o.tabIndex !== -1 : null;
});
pruef('Die abgelaufene Abstimmung nimmt keine Stimme mehr an', zuKlickbar === false, `klickbar: ${zuKlickbar}`);

// Das Gespraech.
await page.click('.tab[data-tab="dms"]');
await page.waitForSelector('.dm-row', { timeout: 20_000 });
await page.waitForTimeout(400);
const gespraech = await page.evaluate(() => ({
  zeilen: [...document.querySelectorAll('.dm-row')].map((r) => ({
    eigen: r.classList.contains('mine'),
    text: r.querySelector('.dm-body')?.textContent?.trim() ?? r.textContent.trim(),
  })),
}));
pruef('Zwei Nachrichten im Gespraech', gespraech.zeilen.length === 2, `es sind ${gespraech.zeilen.length}`);
pruef('Die Frage ist die eigene', gespraech.zeilen[0]?.eigen === true);
pruef('Und "maybe" kommt von Ansem',
  gespraech.zeilen[1]?.eigen === false && /maybe/i.test(gespraech.zeilen[1]?.text ?? ''),
  JSON.stringify(gespraech.zeilen[1]));

await page.fill('#dm-input', 'fair enough. ill take a maybe');
await page.click('#dm-form button[type="submit"]');
await page.waitForTimeout(800);
const danach = await page.evaluate(() => [...document.querySelectorAll('.dm-row')].map((r) => ({
  eigen: r.classList.contains('mine'),
  text: r.querySelector('.dm-body')?.textContent?.trim() ?? r.textContent.trim(),
})));
pruef('Die eigene Antwort steht im Gespraech',
  danach.length === 3 && danach[2].eigen && /fair enough/.test(danach[2].text),
  JSON.stringify(danach.at(-1)));

// Gegenprobe: ohne den Ersatz-Client kaeme die Seite gar nicht hoch. Das
// misst, dass oben wirklich der echte app.js gelaufen ist und nicht
// irgendetwas, das immer gruen meldet.
{
  const p2 = await ctx.newPage();
  const kaputt = [];
  p2.on('console', (m) => { if (m.type() === 'error') kaputt.push(m.text()); });
  await p2.route('**/vendor/supabase.js', (r) => r.fulfill({ status: 404, body: '' }));
  await p2.goto(base, { waitUntil: 'load' });
  await p2.waitForTimeout(1200);
  const leer = await p2.evaluate(() => document.querySelector('#app')?.hidden !== false);
  await p2.close();
  pruef('Gegenprobe: ohne vendor/supabase.js bleibt die Seite leer', leer === true);
}

const bilder = path.join(root, 'preview', 'demo-halter-bilder');
fs.mkdirSync(bilder, { recursive: true });
await page.click('.tab[data-tab="polls"]');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(bilder, '1-polls.png') });
await page.click('.tab[data-tab="dms"]');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(bilder, '2-dm.png') });

await browser.close();
server.close();
console.log(schlecht ? `\n  ${schlecht} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(schlecht ? 1 : 0);
