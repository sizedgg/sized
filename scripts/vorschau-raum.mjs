// ============================================================================
// How the header shows WHOSE room this is
//
// The problem: Ansem doesn't appear anywhere in "sized.gg". Only the brand
// shows up at the top, and anyone arriving through a shared poll link
// learns nowhere whose room this is.
//
// The second requirement makes it more interesting: there should be room
// for more rooms later. So the right statement isn't "SIZED is Ansem" but
// "SIZED, and this is Ansem's room" - the room is a placeholder, not part
// of the brand. The drafts mainly differ in whether that shows.
//
// Drawn with the real header from index.html and the real styles.css.
// Nothing here is rebuilt.
//
// And every draft is shown TWICE: on desktop and at 375px. The header is
// the tightest spot on the page - brand, two tabs, handle, balance and the
// logout button all sit next to each other there. A draft that only looks
// good in the big picture isn't one.
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

// The state after logging in, as a normal user - not as Ansem: for him,
// his own profile picture sits top right, and two images of the same face
// in one line would be its own separate case. Whoever needs the hint
// isn't Ansem anyway.
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
    build: '', css: '',
  },
  {
    nr: 2, name: 'Wort neben der Marke',
    was: 'Ein kleines "ansem" hinter dem Namen, durch einen Punkt getrennt. '
       + 'Kostet keine Höhe und kein Bild.',
    build: `document.querySelector('.topbar > .brand-link')
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
    build: `document.querySelector('.topbar > .brand-link')
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
    build: `document.querySelector('.topbar > .brand-link')
            .insertAdjacentHTML('afterend', '<span class="raum-bild solo"></span>');`,
    css: `.raum-bild.solo { justify-self: start; width: 24px; height: 24px;
            border-radius: 50%; background: url('ansem.jpg') center/cover no-repeat;
            border: 1px solid var(--line); }
          .topbar { grid-template-columns: auto auto 1fr auto; }
          .topbar > .tabs { justify-self: center; }`,
  },
  {
    nr: 5, name: 'Eigene Zeile under der Kopfzeile',
    was: 'Ein narrower Streifen darunter, über die ganze Breite: Bild, Name '
       + 'und Konto. Drängelt sich nicht in die enge Zeile und sagt am '
       + 'deutlichsten, dass da auch ein anderer Raum stehen könnte. Kostet '
       + 'aber Höhe, auf dem Handy am meisten.',
    build: `document.querySelector('.topbar').insertAdjacentHTML('afterend',
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
    was: 'Gegenprobe: Der Raum steht peek, die Marke klein darunter. Dreht '
       + 'die Rangfolge um – der Raum ist die Seite, SIZED nur, worauf sie '
       + 'läuft.',
    build: `const b = document.querySelector('.topbar > .brand-link');
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
  const file = path.join(root, 'public', pfad);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    return res.writeHead(404).end('');
  }
  // app.js stays out: it would immediately try to log in. The fixture
  // sets the states instead.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

async function shoot(f, width) {
  const page = await browser.newPage({
    viewport: { width: width, height: 340 }, deviceScaleFactor: 2,
  });
  await page.goto(base);
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.evaluate(FIXTURE);
  if (f.build) await page.evaluate(f.build);
  if (f.text) {
    await page.evaluate((t) => {
      const b = document.querySelector('.topbar > .brand-link');
      for (const n of b.childNodes) if (n.nodeType === 3) n.textContent = t;
    }, f.text);
  }
  await page.waitForTimeout(150);

  // Just the header plus a bit of room below it - the rest of the page
  // isn't the question here.
  const height = await page.evaluate(() => {
    const t = document.querySelector('.topbar').getBoundingClientRect();
    const l = document.querySelector('.raum-leiste')?.getBoundingClientRect();
    return Math.round((l ? l.bottom : t.bottom) + 14);
  });
  const puffer = await page.screenshot({ clip: { x: 0, y: 0, width: width, height: height } });
  await page.close();
  return `data:image/png;base64,${puffer.toString('base64')}`;
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) {
  bilder.push({ ...f, big: await shoot(f, 900), klein: await shoot(f, 375) });
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
  .big { width: 760px; }
  .klein { width: 317px; }
  .marker { font-size: 10px; color: #6b6b73; margin: 0 0 3px; }
</style>
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <div class="paar">
      <div><p class="marker">Schreibtisch</p><img class="big" src="${b.big}"></div>
      <div><p class="marker">375 px</p><img class="klein" src="${b.klein}"></div>
    </div>
  </div>`).join('')}
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'raum-optionen.png'), fullPage: true });

console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/raum-optionen.png\n`);
await browser.close();
server.close();
