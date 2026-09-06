/**
 * Bilder der Oberfläche in echten Telefongrößen – ohne Backend.
 *
 * Die App braucht sonst eine bezahlte Verifikation, eine Datenbank und
 * Realtime, nur um überhaupt etwas anzuzeigen. Für die Frage "sieht und
 * bedient sich das auf dem Handy gut?" ist das alles nicht nötig: Hier wird
 * dieselbe HTML-Struktur eingesetzt, die app.js erzeugt, und dann fotografiert.
 *
 * Zusätzlich werden zwei Dinge gemessen, die man auf Bildern leicht übersieht:
 *   * waagerechtes Überlaufen (die Seite lässt sich seitlich schieben)
 *   * zu kleine Tippziele (Daumen brauchen ~44 px)
 *
 *   node scripts/preview-mobile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// ---------------------------------------------------------------------------
// Die Abstimmungen kommen WÖRTLICH aus app.js
// ---------------------------------------------------------------------------
//
// Hier stand eine von Hand geschriebene Nachbildung: "191 votes", ein blauer
// Balken auf einer OFFENEN Abstimmung, eine Spalte mit Stimmenzahlen. Nichts
// davon gab es zu diesem Zeitpunkt noch in der App – die Prozentangaben waren
// entfernt, die Stimmenzahl auch, und Blau erscheint erst, wenn eine
// Abstimmung beendet ist.
//
// Wir hätten also Bilder von einer Oberfläche angesehen, die es nicht gibt,
// und Entscheidungen daran getroffen. Deshalb wird pollHtml() jetzt Zeichen
// für Zeichen aus app.js herausgeschnitten und hier ausgeführt.
const appJsQuelle = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const schneideApp = (von, bis) => {
  const a = appJsQuelle.indexOf(von);
  const b = appJsQuelle.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJsQuelle.slice(a, b);
};
const POLL_CODE = [
  schneideApp('const esc = (s) =>', '\n\n'),
  schneideApp('const nfGanz =', 'const ganzeZahl'),
  schneideApp('const ganzeZahl =', '\n'),
  schneideApp('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen'),
  schneideApp('function fristText(closesAt)', '\n// Unter einer Stunde'),
  schneideApp('const BALD_MS =', '\n/**\n * Der Zeiger'),
  schneideApp('const fuehrenderAnteil =', '\nasync function zeichnePoll'),
  schneideApp('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen'),
].join('\n');

// Dieselbe Form, die loadPolls() aus der Datenbank baut.
const POLL_DATEN = [
  { id: 1, closed: false, myOptionId: 1, totalUsd: 781420,
    closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
    question: 'Should we open the token gate to smaller holders?',
    options: [
      { id: 1, label: 'Ship it this week', usd: 482900, share: 0.618 },
      { id: 2, label: 'Wait for the audit', usd: 210400, share: 0.269 },
      { id: 3, label: 'Do neither and keep building quietly', usd: 88120, share: 0.113 },
    ] },
  { id: 2, closed: true, myOptionId: null, totalUsd: 310000, closesAt: null,
    question: 'Next AMA time?',
    options: [
      { id: 4, label: 'Friday 8pm ET', usd: 220100, share: 0.71 },
      { id: 5, label: 'Sunday 2pm ET', usd: 89900, share: 0.29 },
    ] },
];


const outDir = path.join(root, 'preview');
fs.mkdirSync(outDir, { recursive: true });

// Echte Geräte, bewusst inklusive eines kleinen alten Telefons: Wer dort
// zurechtkommt, kommt überall zurecht.
//
// Farbprobe: Mit ACCENT=#eceff5 wird nur der Schreibtisch gezeichnet, dafuer
// mit ausgetauschter Akzentfarbe und einem Praefix im Dateinamen. Damit laesst
// sich eine Farbentscheidung am fertigen Bild treffen statt am Farbquadrat –
// und die normalen Vorschaubilder werden dabei nicht ueberschrieben.
//
//   ACCENT='#eceff5' ACCENT_NAME=weiss node scripts/preview-mobile.mjs
const ACCENT = process.env.ACCENT || null;
const ACCENT_NAME = process.env.ACCENT_NAME || 'accent';
// Freie Probe: beliebiges CSS oben drauf, sonst dieselbe Mechanik wie ACCENT.
// Damit laesst sich eine Alternative am fertigen Bild vergleichen, ohne das
// Stylesheet anzufassen und wieder zurueckdrehen zu muessen.
//
//   PROBE_CSS='.msg .body { color: var(--dim); }' PROBE_NAME=heller \
//     node scripts/preview-mobile.mjs
const PROBE_CSS = process.env.PROBE_CSS || null;
const PROBE_NAME = process.env.PROBE_NAME || 'probe';

const ALLE_GERAETE = [
  { name: 'iphone-se', width: 375, height: 667, dpr: 2 },
  { name: 'iphone-15', width: 393, height: 852, dpr: 3 },
  { name: 'pixel-8', width: 412, height: 915, dpr: 2.6 },
  { name: 'ipad-mini', width: 744, height: 1133, dpr: 2 },
  // Der Schreibtisch gehoert mit in die Reihe: Aenderungen fuer das Handy
  // duerfen die zweispaltige Ansicht dort nicht kaputt machen.
  { name: 'desktop', width: 1280, height: 900, dpr: 1 },
];

const DEVICES = (ACCENT || PROBE_CSS)
  ? ALLE_GERAETE.filter((g) => g.name === 'desktop')
  : ALLE_GERAETE;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// app.js wird bewusst NICHT geladen – es würde sofort Supabase anrufen.
// gateText() woertlich aus app.js – nicht abgetippt.
//
// Hier stand der Sperrhinweis als Zeichenkette im Skript, und als der Satz in
// app.js kuerzer wurde, zeigte die Vorschau weiter die alte Fassung. Eine
// Vorschau, die etwas anderes zeigt als die Seite, ist schlimmer als keine:
// Man sieht hin, findet es in Ordnung, und die Seite sagt etwas anderes.
const gateTextQuelle = (() => {
  const a = appJsQuelle.indexOf('function gateText(min, was) {');
  const b = appJsQuelle.indexOf('\n}', a);
  if (a < 0 || b < 0) throw new Error('gateText steht nicht mehr so in app.js');
  return appJsQuelle.slice(a, b + 2);
})();

const server = http.createServer((req, res) => {
  const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const abs = path.join(root, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(path.join(root, 'public')) || !fs.existsSync(abs)) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  // app.js wird bewusst durch eine leere Datei ersetzt: Diese Vorschau setzt
  // die Zustände selbst über Fixtures, und die echte Anwendung würde dabei
  // versuchen, sich anzumelden und Daten zu laden.
  //
  // Der Preis ist, dass hier KEINE JavaScript-Fehler auffallen können – die
  // Anwendung läuft ja gar nicht. Dafür ist test-pwa.mjs zuständig, das die
  // Seite echt lädt.
  if (file === '/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* im Vorschaumodus aus */');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' })
     .end(fs.readFileSync(abs));
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Beispielinhalte – so realistisch wie möglich, inklusive der unangenehmen
// Fälle: sehr lange Wörter, große Zahlen, viele Nachrichten.
// ---------------------------------------------------------------------------

const FIXTURE = `
  document.querySelector('#login').hidden = true;
  document.querySelector('#app').hidden = false;
  // Bei allen ausser Ansem stehen oben rechts die drei Zeichen in der eigenen
  // Farbe – dieselbe Kennung wie in den DMs. Genau die Form, die renderMe()
  // baut.
  document.querySelector('#me-handle').outerHTML =
    '<span id="me-handle" class="handle h t0">7xK</span>';
  document.querySelector('#me-holdings').textContent = '$5,208';
  document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';

  // Die Abstimmungen aus der echten pollHtml() – siehe POLL_CODE oben.
  const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false, usd: 3 } };
  ${POLL_CODE}
  document.querySelector('#poll-list').innerHTML =
    ${JSON.stringify(POLL_DATEN)}.map(pollHtml).join('');

  const dms = [
    ['sep', 'Aug 21', ''],
    ['', 'Hey Ansem, quick question about the vesting schedule', '14:01'],
    ['mine', 'What about it', '14:03'],
    ['sep', 'Today', ''],
    ['', 'Is the unlock linear or cliff based? I have been trying to work this out from the docs and cannot tell', '14:04'],
  ];
  document.querySelector('#dm-thread').innerHTML = dms.map(([cls, b, t]) =>
    cls === 'sep'
      ? \`<div class="day-sep"><span>\${b}</span></div>\`
      : \`<div class="dm-row \${cls}" data-id="1"><div class="msg dm \${cls}"><span class="body">\${b}</span>
         <span class="meta"><span class="time">\${t}</span></span></div>
         <button class="reply-btn" type="button" data-dm-reply="1">\u21A9</button></div>\`).join('');
`;

const ADMIN_FIXTURE = `
  document.querySelector('#dm-user').hidden = true;
  document.querySelector('#dm-admin').hidden = false;
  document.querySelector('#poll-admin').hidden = false;
  // Ein drittes Antwortfeld, damit im Bild auch "[optional]" steht - die
  // ersten beiden sind Pflicht und tragen es nicht.
  document.querySelector('#poll-options').insertAdjacentHTML('beforeend',
    '<input class="poll-option" type="text" placeholder="Option 3 [optional]">');
  // Ansem sieht in jeder Abstimmung zusaetzlich den Loeschknopf. Der zweite
  // bekommt ihn scharf gestellt, damit im Bild beide Zustaende stehen.
  document.querySelectorAll('.poll-tools').forEach((w, i) => {
    w.insertAdjacentHTML('beforeend',
      '<button class="icon-btn poll-delete" title="Delete this poll">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.5h5v2"/>'
      + '<path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>'
      + '<path d="M10.5 10v6"/><path d="M13.5 10v6"/></svg></button>');
    // Beim zweiten steht statt des Korbs schon das Haekchen – so zeigt das
    // Bild beide Zustaende nebeneinander.
    if (i === 1) w.querySelector('.poll-delete').innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
      + 'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M4.5 12.5l5 5 10-11"/></svg>';
  });

  // Ansems Kopfzeile: an der Stelle der Adresse steht bei ihm sein Profilbild
  // (das legt das Blatt ueber .admin-name), der Betrag daneben wie bei allen
  // anderen.
  // Bei ihm das Profilbild, bei allen anderen die eigene Adresse. Der Hinweis
  // daneben braucht einen Zeiger und ist auf dem Handy deshalb nie zu sehen –
  // eine Vorlesestimme bekommt ihn ueber aria-describedby.
  document.querySelector('#me-handle').outerHTML =
    '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
    + '<span class="kuerzel">4bo</span></span>';
  document.querySelector('#me-holdings').textContent = '$14,204,880';
  // Nur Ansem sieht "DMs" – bei allen anderen bleibt das "s" unsichtbar.
  document.querySelector('[data-tab="dms"]').classList.add('zeigt-s');

  const threads = [
    ['zQ4', 0, '$31,500', 'I sold half my bag last week and…', 0],
    ['bH2', 1, '$8,820', 'Is the unlock linear or cliff based?', 0],
    ['Km9', 3, '$1,302', 'will cover it in the next poll', 1],
    ['Km9', 2, '$3', 'checking', 1],
  ];
  document.querySelector('#thread-items').innerHTML = threads.map(([h, tone, w, p, u]) =>
    \`<button class="thread \${u ? 'is-unread' : ''} \${h === 'bH2' ? 'is-active' : ''}">
      <span class="h t\${tone}">\${h}</span>
      <span class="thread-prev">\${p}</span>
      <span class="w">\${w}</span>
    </button>\`).join('');
  document.querySelector('#thread-title').innerHTML =
    '<strong class="h t1">bH2</strong>' +
    '<span class="addr dim">bH2kQ9vX1mNpL4rT7wYzA3cF6hJ8dS2gB5nM0qE</span>';
  document.querySelector('#admin-thread').innerHTML =
    document.querySelector('#dm-thread').innerHTML;
  // Eine Antwort mit Zitat, wie sie nach der DM-Antwort-Migration aussieht.
  document.querySelector('#admin-thread').insertAdjacentHTML('beforeend', \`
    <div class="dm-row mine is-active" data-id="9">
      <div class="msg dm mine has-quote">
        <button class="quote" type="button" data-dm-goto="8">
          <span class="quote-body">Is the unlock linear or cliff based?</span>
        </button>
        <span class="body">Cliff, then linear over 18 months.</span>
        <span class="meta"><span class="time">14:06</span></span>
      </div>
      <button class="reply-btn" type="button" data-dm-reply="9">\u21A9</button>
    </div>\`);
  document.querySelector('#admin-reply-bar').hidden = false;
  document.querySelector('#admin-reply-bar-text').textContent = 'Is the unlock linear or cliff based?';
  document.querySelector('#admin-dm-form').hidden = false;
  // Ansems Regler für die DM-Schwelle. Im echten Betrieb blendet ihn
  // renderDmMin ein, sobald die Spalte in app_config existiert.
  document.querySelector('#dm-min-box').hidden = false;
  document.querySelector('#dm-min-input').value = '10';
  document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';
`;

// ---------------------------------------------------------------------------
// Messungen, die auf einem Bild leicht untergehen
// ---------------------------------------------------------------------------

const AUDIT = `((istHandy) => {
  const problems = [];

  // 1. Waagerechtes Überlaufen: Die Seite darf sich seitlich nicht schieben
  //    lassen. Auf dem Handy ist das der auffälligste Fehler überhaupt.
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > de.clientWidth + 1 || r.left < -1;
    }).slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect();
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
        + (el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
        + \` [\${Math.round(r.left)}..\${Math.round(r.right)}]\`;
    });
    problems.push({
      kind: 'ueberlauf',
      detail: \`Seite \${de.scrollWidth}px breit bei \${de.clientWidth}px Fenster\`,
      culprits: wide,
    });
  }

  // Tippziele und Mindestschriftgrößen sind Handy-Regeln. Am Schreibtisch mit
  // Maus gelten andere, und dort daran zu messen erzeugt nur Rauschen.
  if (!istHandy) return problems;

  // 2. Tippziele. Apple und Google nennen beide rund 44 px als Mindestmaß.
  //
  // Gemessen wird nicht der Kasten, sondern was der Daumen wirklich trifft.
  // Das ist nicht dasselbe: Ein absolut gesetztes ::before mit negativem inset
  // vergroessert die Trefferflaeche, ohne das Layout anzufassen – genau das
  // will man bei einem Knopf, der auf einer Linie mit einer Ueberschrift steht
  // und deshalb nicht wachsen darf. Wer nur getBoundingClientRect() liest,
  // meldet den Knopf als zu klein, obwohl er bequem zu treffen ist.
  //
  // document.elementFromPoint loest ein Pseudoelement auf sein Element auf,
  // also verraet ein Tastversuch ueber und unter der Mitte die echte Hoehe.
  const MIN = 44;
  const small = [];
  const trifft = (el, x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t));
  };
  for (const el of document.querySelectorAll('button, a, input, [role=button]')) {
    if (el.closest('[hidden]') || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Was nicht anklickbar ist, ist auch kein Tippziel. Betrifft Knöpfe, die
    // erst beim Schweben oder Antippen scharf werden.
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (r.height >= MIN - 0.5) continue;

    // Von der Mitte aus nach oben und unten tasten, hoechstens bis MIN – mehr
    // muss niemand wissen, und der Schritt kostet sonst Zeit auf jeder Seite.
    const mx = Math.round(r.left + r.width / 2);
    const my = Math.round(r.top + r.height / 2);
    let oben = 0;
    let unten = 0;
    while (oben < MIN && trifft(el, mx, my - oben - 1)) oben += 1;
    while (unten < MIN && trifft(el, mx, my + unten + 1)) unten += 1;
    const treffer = oben + unten + 1;
    if (treffer < MIN - 0.5) {
      small.push({
        el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
            + (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
        text: (el.textContent || el.placeholder || '').trim().slice(0, 24),
        h: Math.round(r.height),
        treffer,
      });
    }
  }
  if (small.length) problems.push({ kind: 'tippziel', detail: \`\${small.length} unter \${MIN}px\`, culprits: small });

  // 3. Schriftgrößen unter 11px sind auf dem Handy kaum lesbar. Nebenangaben
  //    wie Uhrzeiten dürfen darüber klein bleiben – Fließtext nicht.
  const tiny = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent.trim() || el.children.length) continue;
    // Unsichtbares nicht mitzählen – sonst meldet jeder Bildschirm die
    // Schriftgrößen des ausgeblendeten Logins und die Liste wird wertlos.
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) tiny.add(\`\${el.className || el.tagName.toLowerCase()} (\${fs.toFixed(1)}px)\`);
  }
  if (tiny.size) problems.push({ kind: 'schrift', detail: \`\${tiny.size} Stellen unter 11px\`, culprits: [...tiny].slice(0, 8) });

  return problems;
})`;

// ---------------------------------------------------------------------------

// Der vorinstallierte Chromium liegt an einem festen Ort; Playwright sucht
// sonst nach einer Version, die es hier nicht gibt.
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(
  fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
let issues = 0;

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.width < 700,
    hasTouch: d.width < 700,
  });
  const page = await ctx.newPage();

  const views = [
    ['login', ''],
    ['install-ios', ''],
    ['install-android', ''],
    ['polls', FIXTURE + `document.querySelector('#pane-polls').hidden = false;`],
    ['dms', FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;`],
    // Zu wenig gehalten, um Ansem zu schreiben.
    ['dms-gated', FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;
       document.querySelector('#dm-form').classList.add('locked');
       document.querySelector('#dm-gate').hidden = false;
       // esc und state kommen schon aus FIXTURE – hier nur noch, was fehlt.
       ${gateTextQuelle}
       const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
       document.querySelector('#dm-gate-text').innerHTML =
         gateText(10, 'to message Ansem');`],
    ['polls-ansem', FIXTURE + ADMIN_FIXTURE + `document.querySelector('#pane-polls').hidden = false;`],
    // Der aufgeklappte Anlegekasten. Er gehoert eigens ins Bild, seit die
    // Laufzeit darin steht: drei Auswahlfelder nebeneinander sind auf 375 px
    // die engste Stelle der ganzen Seite, und zugeklappt sieht man davon
    // nichts.
    ['polls-ansem-offen', FIXTURE + ADMIN_FIXTURE + `
       document.querySelector('#pane-polls').hidden = false;
       document.querySelector('#poll-admin').classList.add('offen');
       document.querySelector('#poll-admin-felder').hidden = false;`],
    ['dms-ansem-inbox', FIXTURE + ADMIN_FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;`],
    // Der geöffnete Faden: Auf dem Handy ersetzt er die Liste, am Schreibtisch
    // steht er daneben. Beide Zustände gehören ins Bild.
    ['dms-ansem-thread', FIXTURE + ADMIN_FIXTURE + `document.querySelectorAll('.tab')[1].classList.add('is-active');
       document.querySelectorAll('.tab')[0].classList.remove('is-active');
       document.querySelector('#pane-polls').hidden = true;
       document.querySelector('#pane-dms').hidden = false;
       document.querySelector('#dm-admin').classList.add('viewing');`],
  ];

  for (const [view, fixture] of views) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });

    // Die Akzentfarbe wird nur ueberschrieben, nicht im Stylesheet geaendert –
    // die Probe soll nichts hinterlassen. Ansems Name bekommt dabei Gold: Er
    // haengt heute am Akzent, und in einem neutralen Akzent wuerde aus dem
    // Auffaelligsten gewoehnlicher Text. Gold ist im Farbkommentar
    // ohnehin schon fuer ihn reserviert.
    if (ACCENT) {
      // Auch --accent-rgb setzen, sonst blieben alle halbdurchsichtigen
      // Stellen gruen: eigene DM-Blase, Aufleuchten, Balken im Poll.
      const kanaele = ACCENT.replace('#', '').match(/../g)
        .map((h) => parseInt(h, 16)).join(', ');
      await page.addStyleTag({ content:
        `:root { --accent: ${ACCENT}; --accent-rgb: ${kanaele}; }\n` +
        `.admin-name { color: var(--accent); }` });
    }
    if (PROBE_CSS) await page.addStyleTag({ content: PROBE_CSS });
    if (view.startsWith('install-')) {
      await page.evaluate(`
        document.querySelector('#step-address').hidden = true;
        document.querySelector('#step-install').hidden = false;
        document.querySelector('#ios-steps').hidden = ${view === 'install-android'};
        document.querySelector('#btn-install').hidden = ${view === 'install-ios'};
      `);
    } else if (view === 'login') {
      // Der Zahlschritt ist der Bildschirm, auf dem Leute wirklich hängen.
      await page.evaluate(`
        document.querySelector('#step-address').hidden = true;
        document.querySelector('#step-pay').hidden = false;
        document.querySelector('#pay-amount').textContent = '0.020847 SOL';
        document.querySelector('#pay-treasury').textContent = 'AnsQ7vX1mNpL4rT7wYzA3cF6hJ8dS2gB5nM0qE9Kv';
        document.querySelector('#pay-timer').textContent = '24:12 left';
      `);
    } else {
      await page.evaluate(fixture);
    }
    await page.waitForTimeout(120);

    const file = path.join(outDir,
      ACCENT ? `farbprobe-${ACCENT_NAME}-${view}.png`
      : PROBE_CSS ? `probe-${PROBE_NAME}-${view}.png`
      : `${d.name}-${view}.png`);
    await page.screenshot({ path: file });

    const problems = await page.evaluate(`${AUDIT}(${d.width < 900})`);
    if (problems.length) {
      issues += problems.length;
      console.log(`\n  ${d.name} / ${view}`);
      for (const p of problems) {
        console.log(`    ${p.kind}: ${p.detail}`);
        for (const c of p.culprits) {
          console.log(`      - ${typeof c === 'string' ? c
            : `${c.el} "${c.text}" ${c.h}px`
              // Wenn die Trefferflaeche groesser ist als der Kasten, gehoert
              // beides in die Meldung: Sonst sucht man den Fehler im Layout,
              // obwohl er in der Flaeche steckt (oder umgekehrt).
              + (c.treffer !== undefined && c.treffer !== c.h
                ? ` (Trefferflaeche ${c.treffer}px)` : '')}`);
        }
      }
    }
  }
  await ctx.close();
}

await browser.close();
server.close();

console.log(issues
  ? `\n  ${issues} Befund(e). Bilder in preview/\n`
  : '\n  Keine Befunde. Bilder in preview/\n');
