// ============================================================================
// Der erste Bildschirm auf dem Handy – vier Anordnungen desselben Textes
//
// Der Text steht fest:
//
//   "SIZED works best from your home screen."  + drei Schritte
//
// Offen ist nur die Ordnung. Unruhig wirkt die einfache Liste aus einem
// messbaren Grund: Bei 375 px brechen Schritte um ("Add to Home / Screen"),
// dadurch ist jede Zeile anders hoch und der rechte Rand fransig.
//
// Deshalb misst dieses Skript mit, WIE VIELE Zeilen umbrechen. Eine Anordnung,
// die auf dem Bild ruhig aussieht, aber bei einer längeren Zeile wieder
// zerfällt, ist keine Lösung – sie ist nur ein gut gewählter Beispieltext.
//
// Gezeichnet mit der echten index.html und der echten styles.css. Der
// Login-Bildschirm wird sonst per JavaScript eingeblendet; hier passiert das
// von Hand, sonst bliebe das Bild schwarz (genau das war es bisher).
//
//   node scripts/vorschau-login.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Das Teilen-Symbol aus der echten index.html – wörtlich, damit die Varianten
// nicht mit einem anderen Zeichen werben als die Seite später zeigt.
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const IOS_GLYPH = (() => {
  const a = html.indexOf('<span class="glyph">');
  const b = html.indexOf('</span>', html.indexOf('</svg>', a)) + 7;
  if (a < 0 || b < 7) throw new Error('Teilen-Symbol nicht in index.html gefunden');
  return html.slice(a, b);
})();

const HAUS = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"
  stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">
  <path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5V19h11V9.5"/>
  <path d="M10 19v-4.5h4V19"/></svg>`;

const iosSchritte = (letzte) => `
  <ol id="ios-steps" class="steps">
    <li>Tap ${IOS_GLYPH} in the browser bar</li>
    <li>Scroll down and choose <strong>Add to Home Screen</strong></li>
    <li>${letzte}</li>
  </ol>`;

// ---------------------------------------------------------------------------
// Die vier Fassungen
// ---------------------------------------------------------------------------

const LEDE = 'SIZED works best from your home screen.';

// Zwei Fassungen der Schritte: einmal vollständig, einmal gekürzt.
// "Scroll down and" ist inhaltlich nicht überflüssig – im Teilen-Menü von iOS
// liegt der Eintrag wirklich weit unten. Es ist aber auch das, was den Umbruch
// verursacht. Beide zur Auswahl, statt die Entscheidung zu verstecken.
const SCHRITTE_LANG = (g) => [
  `Tap ${g} in the browser bar`,
  'Scroll down and choose <strong>Add to Home Screen</strong>',
  'Open SIZED from there and verify',
];
const SCHRITTE_KURZ = (g) => [
  `Tap ${g} in the browser bar`,
  'Choose <strong>Add to Home Screen</strong>',
  'Open SIZED from there',
];

// Der Text jedes Schrittes steckt in EINEM span.
//
// Ohne diesen Umweg zerfällt die Zeile: Sitzt flex oder grid direkt auf dem
// <li>, wird jedes Textstück darin ein eigenes Element – "Scroll down and
// choose" und "<strong>Add to Home Screen</strong>" werden dann
// auseinandergezogen, und bei grid landet jedes Wort auf einer eigenen Zeile.
// Genau so sahen die ersten beiden Bilder aus.
const liste = (schritte) =>
  `<ol class="steps">${schritte.map((s) => `<li><span class="txt">${s}</span></li>`).join('')}</ol>`;

const FASSUNGEN = [
  {
    nr: 1,
    name: 'Mittig, alles auf einer Achse',
    was: 'Marke, Satz und Schritte stehen auf derselben Mittelachse. Symmetrie '
       + 'ist die billigste Art von Ordnung – und der leere Raum darunter '
       + 'wirkt dann wie Absicht statt wie ein Rest.',
    css: `.login-card .lede { text-align: center; }
          .steps { list-style: none; padding: 0; counter-reset: s;
                   display: flex; flex-direction: column; gap: .5rem; }
          .steps li { counter-increment: s; display: flex; gap: .6rem;
                      align-items: baseline; justify-content: center;
                      text-align: left; }
          .steps li::before { content: counter(s); color: var(--dim);
                      font-family: var(--mono); font-size: .8rem; flex: none; }
          .steps .txt { display: block; }`,
    inhalt: (g) => `<p class="lede">${LEDE}</p>${liste(SCHRITTE_KURZ(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
  {
    nr: 2,
    name: 'Schritte als Zeilen mit Trennlinien',
    was: 'Wie eine Einstellungsliste auf dem Telefon: gleiche Höhe, gleiche '
       + 'Einrückung, eine Haarlinie dazwischen. Die Nummern stehen in einer '
       + 'Spalte, dadurch ist der linke Rand ruhig – und ein Umbruch fällt '
       + 'nicht mehr auf, weil jede Zeile ohnehin ihren eigenen Streifen hat.',
    css: `.steps { list-style: none; padding: 0; margin: 0; counter-reset: s;
            border: 1px solid var(--line); border-radius: var(--radius);
            background: var(--bg-1); overflow: hidden; }
          .steps li { counter-increment: s; display: flex; gap: .7rem;
            align-items: flex-start; padding: .7rem .85rem;
            border-bottom: 1px solid var(--line); text-align: left; }
          .steps li:last-child { border-bottom: 0; }
          .steps li::before { content: counter(s); color: var(--dim);
            font-family: var(--mono); font-size: .78rem; line-height: 1.55;
            flex: none; width: .9rem; }
          .steps .txt { display: block; }`,
    inhalt: (g) => `<p class="lede">${LEDE}</p>${liste(SCHRITTE_LANG(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
  {
    nr: 3,
    name: 'Nummern als Kreise, feste Spalte',
    was: 'Die Nummern sitzen in gleich grossen Kreisen, der Text beginnt bei '
       + 'allen dreien an derselben Kante. Auch wenn eine Zeile umbricht, '
       + 'bleibt die Spalte stehen – das ist der Unterschied zur heutigen '
       + 'Liste, bei der die zweite Zeile nach links unter die Nummer rutscht.',
    css: `.steps { list-style: none; padding: 0; margin: 0; counter-reset: s;
            display: flex; flex-direction: column; gap: .75rem; }
          .steps li { counter-increment: s; display: grid;
            grid-template-columns: 1.55rem 1fr; gap: .7rem;
            align-items: start; text-align: left; }
          .steps li::before { content: counter(s);
            display: grid; place-items: center;
            width: 1.55rem; height: 1.55rem; border-radius: 50%;
            border: 1px solid var(--line); background: var(--bg-1);
            font-family: var(--mono); font-size: .74rem; color: var(--dim); }
          .steps .txt { display: block; }`,
    inhalt: (g) => `<p class="lede">${LEDE}</p>${liste(SCHRITTE_LANG(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
  {
    nr: 4,
    name: 'Ohne Nummern, nur Zeilen',
    was: 'Die Reihenfolge steht ohnehin in den Sätzen ("Tap … Choose … Open"). '
       + 'Ohne Ziffern fällt eine ganze Spalte weg, und der Text steht am '
       + 'linken Rand wie der Satz darüber. Am wenigsten Bauteile – die Frage '
       + 'ist, ob es dadurch als Anleitung noch erkennbar bleibt.',
    css: `.steps { list-style: none; padding: 0; margin: 0;
            display: flex; flex-direction: column; gap: .55rem; }
          .steps li { text-align: left; padding-left: .9rem; position: relative; }
          .steps li::before { content: ''; position: absolute; left: 0; top: .62em;
            width: 4px; height: 4px; border-radius: 50%; background: var(--dim); }`,
    inhalt: (g) => `<p class="lede">${LEDE}</p>${liste(SCHRITTE_KURZ(g))}
      <button class="btn btn-ghost">Continue in the browser</button>`,
  },
];

// ---------------------------------------------------------------------------

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  // app.js bleibt leer: Die Vorschau setzt den Zustand selbst, sonst würde das
  // Skript sofort den Login-Ablauf starten und alles wieder verstecken.
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

const GERAET = { width: 375, height: 667, dpr: 2 };   // iPhone SE – die engste Lage

async function schuss(f) {
  const seite = await browser.newPage({
    viewport: { width: GERAET.width, height: GERAET.height },
    deviceScaleFactor: GERAET.dpr, isMobile: true, hasTouch: true,
  });
  await seite.goto(base);
  if (f.css) await seite.addStyleTag({ content: f.css });
  await seite.evaluate((inhalt) => {
    document.querySelector('#login').hidden = false;
    document.querySelector('#app').hidden = true;
    const karte = document.querySelector('#login .login-card');
    // Marke behalten, alles darunter durch die Fassung ersetzen.
    const marke = karte.querySelector('.brand').outerHTML;
    karte.innerHTML = marke + `<div class="step">${inhalt}</div>`;
  }, f.inhalt(IOS_GLYPH));
  await seite.waitForTimeout(180);
  const puffer = await seite.screenshot();

  // Zwei Zahlen, die man auf dem Bild nicht sieht:
  //
  //   hoehe    Läuft die Karte über den Bildschirm hinaus? Ein Foto vom
  //            sichtbaren Teil verrät das nicht.
  //   umbrueche  Wie viele Schritte gehen über mehr als eine Zeile? Genau das
  //            macht die heutige Liste unruhig, und genau das würde bei einer
  //            längeren Übersetzung oder Zeile wiederkommen.
  const mass = await seite.evaluate(() => {
    const karte = document.querySelector('#login .login-card');
    let umbrueche = 0;
    for (const li of document.querySelectorAll('.steps li')) {
      const zeile = parseFloat(getComputedStyle(li).lineHeight);
      const innen = li.getBoundingClientRect().height
        - parseFloat(getComputedStyle(li).paddingTop)
        - parseFloat(getComputedStyle(li).paddingBottom);
      if (innen > zeile * 1.6) umbrueche++;
    }
    return { hoehe: Math.round(karte.getBoundingClientRect().height), umbrueche };
  });
  await seite.close();
  return { bild: `data:image/png;base64,${puffer.toString('base64')}`, ...mass };
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) bilder.push({ ...f, ...(await schuss(f)) });

const PLATZ = GERAET.height;
const blatt = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 26px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .reihe { display: flex; gap: 22px; align-items: flex-start; }
  .fall { width: 262px; }
  h2 { font-size: 13.5px; margin: 0 0 3px; line-height: 1.3; }
  p { font-size: 11px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px; }
  .warn { color: #e8b45c; }
  .mass { font-family: ui-monospace, Menlo, monospace; font-size: 10px;
          color: #6f6f7a; margin: 0 0 8px; }
  img { width: 262px; display: block; border-radius: 10px; border: 1px solid #23232a; }
</style>
<div class="reihe">
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <p class="mass">Karte ${b.hoehe} px · ${b.umbrueche === 0
       ? 'kein Schritt bricht um'
       : `${b.umbrueche} von 3 Schritten brechen um`}</p>
    ${b.hoehe > PLATZ ? `<p class="warn">Passt nicht auf einen Bildschirm:
       ${b.hoehe} px auf ${PLATZ} px – man muss scrollen.</p>` : ''}
    <img src="${b.bild}">
  </div>`).join('')}
</div>
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'login-optionen.png'), fullPage: true });

console.log('');
for (const b of bilder) {
  console.log(`  ${b.nr}. ${b.name}`);
  console.log(`     Karte ${b.hoehe} px, ${b.umbrueche} Umbruch/Umbrueche`
    + (b.hoehe > PLATZ ? `  – mehr als ${PLATZ} px, also Scrollen` : ''));
}
console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/login-optionen.png\n`);
await browser.close();
server.close();
