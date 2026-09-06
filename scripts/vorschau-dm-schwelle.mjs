// Bild von Ansems DM-Schwelle: zu und offen, am Rechner und auf dem Handy.
//   node scripts/vorschau-dm-schwelle.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oeffentlich = path.join(root, 'public');
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(oeffentlich, pfad);
  if (!datei.startsWith(oeffentlich) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

// Die Klappe wird aus app.js gebaut, aber app.js braucht eine Anmeldung. Statt
// die nachzustellen, wird hier NUR die Liste von Hand gefuellt – mit denselben
// Werten, die DM_STUFEN nennt, woertlich aus der Datei gelesen.
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const stufenRoh = /const DM_STUFEN = \[([\s\S]*?)\];/.exec(appJs)[1];
const STUFEN = stufenRoh.split(',').map((t) => Number(t.replace(/_/g, '').trim()))
  .filter((n) => Number.isFinite(n));
console.log('Stufen aus app.js:', STUFEN.join(', '));

for (const [name, breite, offen] of [
  ['rechner-zu', 900, false], ['rechner-offen', 900, true],
  ['handy-zu', 390, false], ['handy-offen', 390, true],
]) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 760 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(350);
  await seite.evaluate(([stufen, aufmachen]) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-admin').hidden = false;
    document.querySelector('#dm-user').hidden = true;
    document.querySelector('#dm-min-box').hidden = false;
    document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';

    const gruppiere = (n) => n.toLocaleString('en-US');
    const liste = document.querySelector('#wahl-liste-dm-min');
    liste.replaceChildren();
    for (const [i, usd] of stufen.entries()) {
      const el = document.createElement('div');
      el.id = `dm-min-${i}`;
      el.className = 'wahl-eintrag';
      el.role = 'option';
      el.dataset.wert = String(usd);
      el.textContent = '$' + gruppiere(usd);
      el.setAttribute('aria-selected', String(usd === 5000));
      liste.appendChild(el);
    }
    document.querySelector('#dm-min').dataset.wert = '5000';
    document.querySelector('#dm-min-wert').textContent = '$5,000';

    // Ein paar Gespraeche darunter, damit man sieht, worauf die Klappe liegt.
    document.querySelector('#thread-items').innerHTML = [
      ['EMwU…QLxP', '$1,204,880', 'gm, question about the next AMA'],
      ['7xKX…9Qm2', '$88,120', 'can you look at this'],
      ['H4vN…hbcs', '$12,400', 'thanks for the reply'],
    ].map(([w, u, t]) => `<button class="thread"><span class="thread-line">
        <span class="handle adresse">${w}</span>
        <span class="worth">${u}</span></span>
      <span class="thread-preview">${t}</span></button>`).join('');

    if (aufmachen) {
      const knopf = document.querySelector('#dm-min');
      liste.hidden = false;
      knopf.setAttribute('aria-expanded', 'true');
      liste.querySelector('[data-wert="5000"]')?.classList.add('ist-marke');
    }
  }, [STUFEN, offen]);
  await seite.waitForTimeout(150);
  const kasten = await seite.$('#dm-admin');
  await kasten.screenshot({ path: path.join(root, 'preview', `dm-schwelle-${name}.png`) });
  await seite.close();
}

await browser.close();
server.close();
console.log('preview/dm-schwelle-*.png');
