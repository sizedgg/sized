// ============================================================================
// Wie in der Kopfzeile steht, WESSEN Raum das hier ist
//
// Das Problem: In "sized.gg" kommt Ansem nicht vor. Oben steht nur die Marke,
// und wer über einen geteilten Abstimmungslink hereinkommt, erfährt nirgends,
// wem der Raum gehört.
//
// Die zweite Anforderung macht es interessanter: Es soll später mehr Räume
// geben können. Damit ist die richtige Aussage nicht "SIZED ist Ansem",
// sondern "SIZED, und dies ist Ansems Raum" – der Raum ist ein Platzhalter,
// kein Teil der Marke. Die Entwürfe unterscheiden sich vor allem darin, ob man
// ihnen das ansieht.
//
// Gezeichnet wird mit der echten Kopfzeile aus index.html und der echten
// styles.css. Nachgebaut wird nichts.
//
// Und jeder Entwurf wird ZWEIMAL gezeigt: auf dem Schreibtisch und auf 375 px.
// Die Kopfzeile ist die engste Stelle der Seite – dort stehen Marke, zwei
// Reiter, Kürzel, Betrag und der Abmeldeknopf nebeneinander. Ein Entwurf, der
// nur auf dem großen Bild gut aussieht, ist keiner.
//
//   node scripts/vorschau-raum.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const HANDLE = '@blknoiz06';

// Der Zustand nach dem Anmelden, als normaler Nutzer – nicht als Ansem: Bei
// ihm steht oben rechts sein Profilbild, und zwei Bilder desselben Gesichts in
// einer Zeile wären ein eigener Fall. Wer den Hinweis braucht, ist ohnehin
// nicht Ansem.
const FIXTURE = `
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#me-handle').outerHTML =
    '<span id="me-handle" class="handle h t0">7xK</span>';
  document.querySelector('#me-holdings').textContent = '$5,208';
  document.querySelector('#poll-list').innerHTML =
    '<div class="empty">No polls yet.</div>';
`;

const FASSUNGEN = [
  {
    nr: 1, name: 'Wie es jetzt ist',
    was: 'Nur die Marke. Wessen Raum das ist, steht nirgends.',
    bau: '', css: '',
  },
  {
    nr: 2, name: 'Wort neben der Marke',
    was: 'Ein kleines "ansem" hinter dem Namen, durch einen Punkt getrennt. '
       + 'Kostet keine Höhe und kein Bild.',
    bau: `document.querySelector('.topbar > .brand-link')
            .insertAdjacentHTML('afterend',
              '<span class="raum-wort">· ansem</span>');`,
    css: `.raum-wort { justify-self: start; color: var(--dim); font-size: .8rem;
                       margin-left: -.55rem; white-space: nowrap; }
          .topbar { grid-template-columns: auto auto 1fr auto; }
          .topbar > .tabs { justify-self: center; }`,
  },
  {
    nr: 3, name: 'Bild und Name als Schild',
    was: 'Ein Etikett neben der Marke, mit Ansems Bild. So lesen Leute auf X '
       + 'Identität – man erkennt es, ohne zu lesen.',
    bau: `document.querySelector('.topbar > .brand-link')
            .insertAdjacentHTML('afterend',
              '<span class="raum-schild"><span class="raum-bild"></span>ansem</span>');`,
    css: `.raum-schild {
            justify-self: start; display: inline-flex; align-items: center;
            gap: .35rem; padding: .2rem .55rem .2rem .25rem;
            border: 1px solid var(--line); border-radius: 999px;
            background: var(--bg-2); color: var(--text);
            font-size: .78rem; white-space: nowrap;
          }
          .raum-bild { width: 18px; height: 18px; border-radius: 50%; flex: none;
                       background: url('ansem.jpg') center/cover no-repeat; }
          .topbar { grid-template-columns: auto auto 1fr auto; }
          .topbar > .tabs { justify-self: center; }`,
  },
  {
    nr: 4, name: 'Nur das Bild',
    was: 'Ohne Wort, nur das Gesicht neben der Marke. Am sparsamsten – und '
       + 'am unklarsten, solange niemand weiss, wer das ist.',
    bau: `document.querySelector('.topbar > .brand-link')
            .insertAdjacentHTML('afterend', '<span class="raum-bild solo"></span>');`,
    css: `.raum-bild.solo { justify-self: start; width: 24px; height: 24px;
            border-radius: 50%; background: url('ansem.jpg') center/cover no-repeat;
            border: 1px solid var(--line); }
          .topbar { grid-template-columns: auto auto 1fr auto; }
          .topbar > .tabs { justify-self: center; }`,
  },
  {
    nr: 5, name: 'Eigene Zeile unter der Kopfzeile',
    was: 'Ein schmaler Streifen darunter, über die ganze Breite: Bild, Name '
       + 'und Konto. Drängelt sich nicht in die enge Zeile und sagt am '
       + 'deutlichsten, dass da auch ein anderer Raum stehen könnte. Kostet '
       + 'aber Höhe, auf dem Handy am meisten.',
    bau: `document.querySelector('.topbar').insertAdjacentHTML('afterend',
            '<div class="raum-leiste">' +
              '<span class="raum-bild"></span>' +
              '<strong>Ansem\\'s room</strong>' +
              '<a class="raum-handle" href="#">${HANDLE}</a>' +
            '</div>');`,
    css: `.raum-leiste {
            display: flex; align-items: center; gap: .5rem;
            padding: .45rem 1rem; border-bottom: 1px solid var(--line);
            background: var(--bg-1); font-size: .85rem;
          }
          .raum-leiste strong { font-weight: 600; color: var(--text); }
          .raum-bild { width: 20px; height: 20px; border-radius: 50%; flex: none;
                       background: url('ansem.jpg') center/cover no-repeat; }
          .raum-handle { color: var(--dim); text-decoration: none; }`,
  },
  {
    nr: 6, name: 'Statt der Marke',
    was: 'Gegenprobe: Der Raum steht oben, die Marke klein darunter. Dreht '
       + 'die Rangfolge um – der Raum ist die Seite, SIZED nur, worauf sie '
       + 'läuft.',
    bau: `const b = document.querySelector('.topbar > .brand-link');
          b.classList.add('umgedreht');
          b.insertAdjacentHTML('afterbegin',
            '<span class="raum-bild"></span>');
          b.insertAdjacentHTML('beforeend',
            '<span class="raum-unter">on SIZED</span>');
          b.querySelector('.brand-mark').remove();`,
    css: `.brand-link.umgedreht {
            display: grid; grid-template-columns: auto auto;
            grid-template-rows: auto auto; column-gap: .45rem;
            align-items: center; letter-spacing: 0; font-size: .95rem;
          }
          .brand-link.umgedreht .raum-bild {
            grid-row: 1 / 3; width: 28px; height: 28px; border-radius: 50%;
            background: url('ansem.jpg') center/cover no-repeat;
          }
          .raum-unter { font-size: .68rem; font-weight: 400; color: var(--dim);
                        letter-spacing: .04em; }`,
    text: 'Ansem',
  },
];

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  // app.js bleibt aus: Es würde sofort versuchen, sich anzumelden. Die
  // Zustände setzt die Fixture.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

async function schuss(f, breite) {
  const seite = await browser.newPage({
    viewport: { width: breite, height: 340 }, deviceScaleFactor: 2,
  });
  await seite.goto(base);
  if (f.css) await seite.addStyleTag({ content: f.css });
  await seite.evaluate(FIXTURE);
  if (f.bau) await seite.evaluate(f.bau);
  if (f.text) {
    await seite.evaluate((t) => {
      const b = document.querySelector('.topbar > .brand-link');
      for (const n of b.childNodes) if (n.nodeType === 3) n.textContent = t;
    }, f.text);
  }
  await seite.waitForTimeout(150);

  // Nur die Kopfzeile plus etwas Luft darunter – der Rest der Seite ist hier
  // nicht die Frage.
  const hoehe = await seite.evaluate(() => {
    const t = document.querySelector('.topbar').getBoundingClientRect();
    const l = document.querySelector('.raum-leiste')?.getBoundingClientRect();
    return Math.round((l ? l.bottom : t.bottom) + 14);
  });
  const puffer = await seite.screenshot({ clip: { x: 0, y: 0, width: breite, height: hoehe } });
  await seite.close();
  return `data:image/png;base64,${puffer.toString('base64')}`;
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) {
  bilder.push({ ...f, gross: await schuss(f, 900), klein: await schuss(f, 375) });
}

const blatt = await browser.newPage({ viewport: { width: 1180, height: 1600 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 24px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .fall { margin-bottom: 26px; }
  h2 { font-size: 14px; margin: 0 0 3px; }
  p { font-size: 11.5px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px;
      max-width: 66rem; }
  .paar { display: flex; gap: 14px; align-items: flex-start; }
  .paar img { display: block; border-radius: 8px; border: 1px solid #23232a; }
  .gross { width: 760px; }
  .klein { width: 317px; }
  .marke { font-size: 10px; color: #6b6b73; margin: 0 0 3px; }
</style>
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <div class="paar">
      <div><p class="marke">Schreibtisch</p><img class="gross" src="${b.gross}"></div>
      <div><p class="marke">375 px</p><img class="klein" src="${b.klein}"></div>
    </div>
  </div>`).join('')}
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'raum-optionen.png'), fullPage: true });

console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/raum-optionen.png\n`);
await browser.close();
server.close();
