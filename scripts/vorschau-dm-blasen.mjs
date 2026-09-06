// ============================================================================
// Vorschau: die Helligkeit der Sprechblasen in den DMs
//
// Vierte Runde: das gedaempfte X-Blau in mehreren Staerken. Die Richtung
// steht, es geht nur noch darum, wie weit das Blau in den Seitengrund
// gemischt wird. Die eingehende Blase bleibt in allen Fassungen gleich –
// sonst vergleicht man zwei Aenderungen auf einmal.
//
// Dritte Runde: einmal so, wie X seine DMs faerbt – die eigene Blase blau,
// die eingehende dunkelgrau, der Text weiss. Die beiden Toene sind aus einem
// Bildschirmfoto von X abgemessen und nicht aus dem Gedaechtnis: die eigene
// Blase #4b9aea, die eingehende #212327, der Text darauf #ffffff und #e7e9ea,
// der Grund dahinter reines Schwarz.
//
// Zwei Dinge, die dabei auffallen und die man wissen sollte, bevor man es
// uebernimmt: X setzt auf REINES Schwarz, die Seite hier auf #0a0b0f – das
// Blau steht dort also einen Hauch weniger hart. Und die Seite hat sonst
// nirgends einen gesaettigten Farbton; Violett ist ausdruecklich rausgeflogen.
// Ein Blau nur in den DMs waere die einzige Farbe im ganzen Haus.
//
// Zweite Runde. In der ersten ging es um die EINGEHENDE Blase, die zu dunkel
// war; sie steht seitdem auf --line, der hellsten Flaeche der Palette. Jetzt
// geht es um die EIGENE: Die ist nur umrissen und traegt den Seitengrund, also
// gar keine Flaeche – und neben einer hellen Gegenueberliegenden liest sie
// sich als Loch statt als Blase.
//
// Alle Vorschlaege unten fuellen sie deshalb. Die Frage ist nur noch, womit.
//
// Die Schwierigkeit dahinter ist dieselbe wie im Polls-Tab, und sie ist der
// Grund, warum die Auswahl hier so aussieht, wie sie aussieht: Alle Flaechen
// der Palette liegen innerhalb von 1,4:1 zueinander.
//
//   --bg    #0a0b0f
//   --bg-1  #101218   Schritt 1,05:1
//   --bg-2  #161923   Schritt 1,07:1
//   --bg-3  #1d212d   Schritt 1,09:1
//   --line  #262b39   Schritt 1,14:1
//
// Zwei benachbarte Stufen als die beiden Blasen zu nehmen bringt also fast
// nichts – der Unterschied liegt unter dem, was als Absicht gelesen wird. Und
// seit die eingehende Blase auf --line steht, ist das obere Ende der Palette
// belegt: Fuer die eigene bleibt nur, wie weit sie darunter sitzt.
//
// Deshalb sind die Vorschlaege von drei verschiedenen Sorten:
//
//   * eine Palettenstufe darunter (1, 2)
//   * gar kein Unterschied mehr, die Seite traegt ihn allein (3)
//   * ein Ton ZWISCHEN den Stufen, ueber einen weissen Schleier – so macht es
//     das Zitat in der Blase schon (4)
//   * oder die beiden vertauschen, damit die eigene die hellere ist (5)
//
// Jede Fassung wird nachgerechnet: der Text auf beiden Blasen, der Abstand
// der Blasen zueinander, und der Abstand jeder Blase zum Grund dahinter. Eine
// Blase, die sich vom Grund nicht absetzt, ist keine Blase mehr.
//
// Erzeugt preview/dmblasen-*.png und preview/dmblasen-uebersicht.png
//   node scripts/vorschau-dm-blasen.mjs
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

const sn = (v, b) => {
  const i = appJs.indexOf(v), j = appJs.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`Nicht gefunden in app.js: ${v}`);
  return appJs.slice(i, j);
};
const zahlen = sn('const nfCompact =', '/* Ausgeschrieben statt');
const escFn = sn('const esc = (s) =>', '\n\n');
const linkify = sn('const LINK_MUSTER =', '\nfunction toast(');
const tage = sn('const tagBeginn =', 'const handleOf');
const dmBau = sn('function dmQuoteHtml(row)', '\n// ------');

const a = html.indexOf('<main id="pane-dms"');
const b = html.indexOf('</main>', a);
const pane = html.slice(a, b + 7).replace('class="pane" hidden', 'class="pane"');

// --- Farbrechnung ----------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (a2, b2) => { const [x, y] = [lum(a2), lum(b2)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const hol = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, al, h) => v.map((c, i) => Math.round(al * c + (1 - al) * h[i]));
const schleier = (anteil, grund) => mix([255, 255, 255], anteil, grund);

const BG = hex(hol('bg')), BG1 = hex(hol('bg-1')), BG2 = hex(hol('bg-2'));
const BG3 = hex(hol('bg-3')), LINE = hex(hol('line')), DIM = hex(hol('dim'));

// Im Verlauf des Nutzers liegt alles auf dem Seitengrund.
const GRUND = BG;

// Aus dem Bildschirmfoto abgemessen, nicht geschaetzt.
const X_BLAU = hex('#4b9aea');
const TEXT = hex(hol('text'));
const hx = (a2) => '#' + a2.map((v) => v.toString(16).padStart(2, '0')).join('');

// Die eingehende Blase bleibt in allen Fassungen dieselbe – sonst vergleicht
// man zwei Aenderungen auf einmal und weiss am Ende nicht, welche gewirkt hat.
const EIN = { css: 'background: var(--line);', farbe: LINE, rand: null, text: DIM };

const stufe = (anteil, text = TEXT, name = null, hinweis = '') => {
  const f = mix(X_BLAU, anteil, GRUND);
  return {
    datei: `blau-${Math.round(anteil * 100)}${text === DIM ? '-dim' : ''}`,
    name: name ?? `${Math.round(anteil * 100)} % Blau`,
    ein: EIN,
    eig: { css: `background: ${hx(f)}; border-color: ${hx(f)}; color: ${text === DIM ? 'var(--dim)' : 'var(--text)'};`,
           farbe: f, rand: f, text },
    hinweis: `${hinweis}${hinweis ? ' ' : ''}Gemischt: ${hx(f)}.`,
  };
};

const FASSUNGEN = [
  stufe(.28, TEXT, '28 % – sehr leise',
    'Kaum mehr als ein kühler Hauch auf dem Seitengrund. Wer nicht danach sucht, hält es für Grau.'),
  stufe(.35, TEXT, '35 %',
    'Als Farbe erkennbar, ohne dass sie sich meldet.'),
  stufe(.42, TEXT, '42 % – die Fassung von vorhin',
    'Der Stand, den du gewählt hast. Alles darunter und darüber ist zum Vergleich da.'),
  stufe(.55, TEXT, '55 %',
    'Deutlich blau. Die Blase wird zum farbigen Element der Seite statt zu einer Fläche mit Stich.'),
  stufe(.70, TEXT, '70 % – nahe am vollen Blau',
    'Fast das X-Blau. Hier fängt es an, gegen den fast schwarzen Rest der Seite zu stehen statt in ihr zu liegen.'),
  stufe(.42, DIM, '42 %, Text wie im Chat',
    'Dieselbe Fläche wie Fassung 2, aber der Text bleibt --dim statt --text. Zeigt, wie viel von der Wirkung an der Fläche hängt und wie viel an der helleren Schrift darauf.'),
];

console.log('\n  Die Textfarbe gehoert bei diesen Fassungen zum Vorschlag und steht nicht fest.\n');
console.log('  ' + 'Fassung'.padEnd(30) + 'Text ein.'.padEnd(11) + 'Text eig.'.padEnd(11)
  + 'Blasen zu-'.padEnd(12) + 'ein. zu'.padEnd(10) + 'eig. zu');
console.log('  ' + ' '.repeat(52) + 'einander'.padEnd(12) + 'Grund'.padEnd(10) + 'Grund');

for (const f of FASSUNGEN) {
  f.tEin = kon(f.ein.text ?? DIM, f.ein.farbe);
  f.tEig = kon(f.eig.text ?? DIM, f.eig.farbe);
  f.zwischen = kon(f.ein.farbe, f.eig.farbe);
  f.einGrund = f.ein.rand ? kon(f.ein.rand, GRUND) : kon(f.ein.farbe, GRUND);
  f.eigGrund = f.eig.rand ? kon(f.eig.rand, GRUND) : kon(f.eig.farbe, GRUND);
  f.knapp = f.tEin < 4.5 || f.tEig < 4.5;
  console.log('  ' + f.name.padEnd(30)
    + `${f.tEin.toFixed(1)}:1`.padEnd(11) + `${f.tEig.toFixed(1)}:1`.padEnd(11)
    + `${f.zwischen.toFixed(2)}:1`.padEnd(12)
    + `${f.einGrund.toFixed(2)}:1`.padEnd(10) + `${f.eigGrund.toFixed(2)}:1`
    + (f.knapp ? '   ACHTUNG: Text unter 4,5:1' : ''));
}
console.log('\n  "zu Grund" ist der Abstand zum Seitengrund – bei umrissenen Blasen'
  + '\n  gerechnet ueber den Rand, denn der traegt dort die Form.\n');

// --- Bilder ----------------------------------------------------------------
const std = (h) => Date.now() - h * 3600e3, min = (m) => Date.now() - m * 60_000;
const DM = [
  { id: 1, from_admin: false, body: 'hey — congrats on the launch', created_at: std(30) },
  { id: 2, from_admin: true, body: 'thanks', created_at: std(29) },
  { id: 3, from_admin: false, body: 'quick one: is the token gate number final or are you still moving it around', created_at: std(28) },
  { id: 4, from_admin: true, reply_to: 3, body: 'final for now. i will say something in chat if it changes', created_at: std(28) },
  { id: 5, from_admin: false, body: 'sent you the numbers: https://sized.gg/p/12', created_at: min(90) },
  { id: 6, from_admin: true, body: 'looking', created_at: min(60) },
  { id: 7, from_admin: false, reply_to: 6, body: 'no rush', created_at: min(20) },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body style="margin:0">
       <div style="display:flex;flex-direction:column;height:100vh;background:var(--bg)">${pane}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const bilder = [];
for (const f of FASSUNGEN) {
  const seite = await browser.newPage({ viewport: { width: 720, height: 620 }, deviceScaleFactor: 2 });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  // Nur die beiden Deklarationen werden ersetzt – der Rest des Blattes bleibt echt.
  await seite.addStyleTag({ content: `
    .msg.dm { ${f.ein.css} }
    .msg.dm.mine { ${f.eig.css} }` });
  await seite.addScriptTag({ content: `
    const state = { me: { isAdmin: false }, dmMessages: [], dmRepliesAvailable: true };
    ${zahlen}${escFn}${linkify}${tage}${dmBau}
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-admin').hidden = true;
    state.dmMessages = ${JSON.stringify(DM)};
    document.querySelector('#dm-thread').innerHTML = dmListeHtml(state.dmMessages);
    document.querySelector('#dm-thread').scrollTop = 1e6;` });
  await seite.mouse.move(0, 0);
  await seite.waitForTimeout(300);
  const bild = await seite.locator('#dm-user').screenshot();
  await seite.close();
  fs.writeFileSync(path.join(ausgabe, `dmblasen-${f.datei}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .reihe { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 26px; align-items: start; }
  h2 { margin: 0 0 .1rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .78rem; }
  .werte { font-size: .68rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  p.t { margin: .3rem 0 .7rem; font-size: .8rem; color: #8b93a7; line-height: 1.5; }
  img { width: 100%; display: block; border-radius: 10px; }
  .buehne { background: #16181c; padding: 10px; border-radius: 12px; }
</style>
<h1>Wie hell die Sprechblasen sind</h1>
<p class="lead">In jedem Bild stehen die <b>eingehenden</b> Nachrichten links und die <b>eigenen</b> rechts.
Alle Fassungen zeigen dasselbe X-Blau (<b>#4b9aea</b>), unterschiedlich weit in den Seitengrund gemischt.
Die eingehende Blase bleibt überall gleich – sonst vergleicht man zwei Änderungen auf einmal.
Die Seite hat sonst nirgends einen gesättigten Farbton – Violett ist ausdrücklich rausgeflogen –, ein Blau nur
in den DMs wäre also die einzige Farbe im ganzen Haus. Dafür löst es ein Problem, an dem alle bisherigen
Fassungen scheiterten: Zwischen dem dunkelsten und dem hellsten Grau der Seite liegen 1,4:1, und zwei Grautöne
so dicht beieinander liest niemand als Absicht. Eine Farbe braucht diesen Abstand nicht.</p>
<div class="reihe">
${FASSUNGEN.map((f, i) => `
<div>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte ${f.knapp ? 'knapp' : ''}">Text ${f.tEin.toFixed(1)}:1 / ${f.tEig.toFixed(1)}:1
      · Blasen zueinander ${f.zwischen.toFixed(2)}:1</span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="buehne"><img src="${bilder[i]}"></div>
</div>`).join('')}
</div>`;

const s = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 1.4 });
await s.setContent(blatt);
await s.waitForTimeout(600);
await s.screenshot({ path: path.join(ausgabe, 'dmblasen-uebersicht.png'), fullPage: true });
await browser.close();
server.close();
console.log(`  ${path.join(ausgabe, 'dmblasen-uebersicht.png')}\n`);
