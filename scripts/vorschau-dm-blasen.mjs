// ============================================================================
// Preview: the brightness of the speech bubbles in DMs
//
// Fourth round: the muted X-blue at several strengths. The direction is
// settled; the only open question now is how far the blue gets mixed into
// the page background. The incoming bubble stays the same across all
// versions - otherwise you're comparing two changes at once.
//
// Third round: one version matching how X colors its DMs - your own bubble
// blue, the incoming one dark gray, the text white. Both tones were measured
// from a screenshot of X, not from memory: your own bubble #4b9aea, the
// incoming one #212327, the text on them #ffffff and #e7e9ea, the
// background behind it pure black.
//
// Two things stand out here, worth knowing before adopting this: X uses
// PURE black, this page uses #0a0b0f - so the blue reads a touch less harsh
// here. And the page otherwise has no saturated color anywhere; purple was
// explicitly thrown out. A blue only in the DMs would be the only color in
// the whole house.
//
// Second round. The first was about the INCOMING bubble, which was too
// dark; it's been on --line since, the brightest surface in the palette.
// Now it's about YOUR OWN: that one is only outlined and carries the page
// background, so no surface at all - and next to a bright counterpart it
// reads as a hole rather than a bubble.
//
// So all the proposals below fill it in. The only remaining question is
// with what.
//
// The difficulty behind this is the same as in the Polls tab, and it's the
// reason the selection here looks the way it does: every surface in the
// palette sits within 1.4:1 of every other.
//
//   --bg    #0a0b0f
//   --bg-1  #101218   step 1.05:1
//   --bg-2  #161923   step 1.07:1
//   --bg-3  #1d212d   step 1.09:1
//   --line  #262b39   step 1.14:1
//
// So taking two neighboring steps as the two bubbles buys almost nothing -
// the difference sits below what reads as intentional. And since the
// incoming bubble sits on --line, the top of the palette is already spoken
// for: for your own bubble, all that's left is how far below it sits.
//
// So the proposals come in three different kinds:
//
//   * one palette step below (1, 2)
//   * no difference at all anymore, the page carries it alone (3)
//   * a tone BETWEEN the steps, via a white veil - the same way the quote
//     inside the bubble already does it (4)
//   * or swap the two, so your own bubble is the brighter one (5)
//
// Every version gets checked by the numbers: the text on both bubbles, the
// gap between the two bubbles, and the gap between each bubble and the
// background behind it. A bubble that doesn't stand out from the
// background isn't a bubble anymore.
//
// Produces preview/dmblasen-*.png and preview/dmblasen-uebersicht.png
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
const numbers = sn('const nfCompact =', 'const nfGanz = new Intl.NumberFormat(\'en-US\', { maximumFractionDigits: 0 });');
const escFn = sn('const esc = (s) =>', '\n\n');
const linkify = sn('const LINK_MUSTER =', '\nfunction toast(');
const tage = sn('const tagBeginn =', 'const handleOf');
const dmBau = sn('function dmQuoteHtml(row)', '\n// ------');

const a = html.indexOf('<main id="pane-dms"');
const b = html.indexOf('</main>', a);
const pane = html.slice(a, b + 7).replace('class="pane" hidden', 'class="pane"');

// --- Color math --------------------------------------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const kon = (a2, b2) => { const [x, y] = [lum(a2), lum(b2)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const get = (n) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
const mix = (v, al, h) => v.map((c, i) => Math.round(al * c + (1 - al) * h[i]));
const veil = (anteil, grund) => mix([255, 255, 255], anteil, grund);

const BG = hex(get('bg')), BG1 = hex(get('bg-1')), BG2 = hex(get('bg-2'));
const BG3 = hex(get('bg-3')), LINE = hex(get('line')), DIM = hex(get('dim'));

// In the user's own conversation, everything sits on the page background.
const GRUND = BG;

// Measured from the screenshot, not estimated.
const X_BLAU = hex('#4b9aea');
const TEXT = hex(get('text'));
const hx = (a2) => '#' + a2.map((v) => v.toString(16).padStart(2, '0')).join('');

// The incoming bubble stays the same across all versions - otherwise you're
// comparing two changes at once and end up not knowing which one worked.
const EIN = { css: 'background: var(--line);', color: LINE, margin: null, text: DIM };

const tier = (anteil, text = TEXT, name = null, hinweis = '') => {
  const f = mix(X_BLAU, anteil, GRUND);
  return {
    file: `blau-${Math.round(anteil * 100)}${text === DIM ? '-dim' : ''}`,
    name: name ?? `${Math.round(anteil * 100)} % Blau`,
    ein: EIN,
    eig: { css: `background: ${hx(f)}; border-color: ${hx(f)}; color: ${text === DIM ? 'var(--dim)' : 'var(--text)'};`,
           color: f, margin: f, text },
    hinweis: `${hinweis}${hinweis ? ' ' : ''}Gemischt: ${hx(f)}.`,
  };
};

const FASSUNGEN = [
  tier(.28, TEXT, '28 % – sehr leise',
    'Kaum mehr als ein kühler Hauch auf dem Seitengrund. Wer nicht danach sucht, hält es für Grau.'),
  tier(.35, TEXT, '35 %',
    'Als Farbe erkennbar, ohne dass sie sich meldet.'),
  tier(.42, TEXT, '42 % – die Fassung von vorhin',
    'Der Stand, den du gewählt hast. Alles darunter und darüber ist zum Vergleich da.'),
  tier(.55, TEXT, '55 %',
    'Deutlich blau. Die Blase wird zum farbigen Element der Seite statt zu einer Fläche mit Stich.'),
  tier(.70, TEXT, '70 % – nahe am vollen Blau',
    'Fast das X-Blau. Hier fängt es an, gegen den fast schwarzen Rest der Seite zu stehen statt in ihr zu liegen.'),
  tier(.42, DIM, '42 %, Text wie im Chat',
    'Dieselbe Fläche wie Fassung 2, aber der Text bleibt --dim statt --text. Zeigt, wie viel von der Wirkung an der Fläche hängt und wie viel an der helleren Schrift darauf.'),
];

console.log('\n  Die Textfarbe gehoert bei diesen Fassungen zum Vorschlag und steht nicht fest.\n');
console.log('  ' + 'Fassung'.padEnd(30) + 'Text ein.'.padEnd(11) + 'Text eig.'.padEnd(11)
  + 'Blasen zu-'.padEnd(12) + 'ein. zu'.padEnd(10) + 'eig. zu');
console.log('  ' + ' '.repeat(52) + 'einander'.padEnd(12) + 'Grund'.padEnd(10) + 'Grund');

for (const f of FASSUNGEN) {
  f.tEin = kon(f.ein.text ?? DIM, f.ein.color);
  f.tEig = kon(f.eig.text ?? DIM, f.eig.color);
  f.zwischen = kon(f.ein.color, f.eig.color);
  f.einGrund = f.ein.margin ? kon(f.ein.margin, GRUND) : kon(f.ein.color, GRUND);
  f.eigGrund = f.eig.margin ? kon(f.eig.margin, GRUND) : kon(f.eig.color, GRUND);
  f.knapp = f.tEin < 4.5 || f.tEig < 4.5;
  console.log('  ' + f.name.padEnd(30)
    + `${f.tEin.toFixed(1)}:1`.padEnd(11) + `${f.tEig.toFixed(1)}:1`.padEnd(11)
    + `${f.zwischen.toFixed(2)}:1`.padEnd(12)
    + `${f.einGrund.toFixed(2)}:1`.padEnd(10) + `${f.eigGrund.toFixed(2)}:1`
    + (f.knapp ? '   ACHTUNG: Text under 4,5:1' : ''));
}
console.log('\n  "zu Grund" ist der Abstand zum Seitengrund – bei umrissenen Blasen'
  + '\n  gerechnet ueber den Rand, denn der traegt dort die Form.\n');

// --- Images ------------------------------------------------------------
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
  const page = await browser.newPage({ viewport: { width: 720, height: 620 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  // Only these two declarations get replaced - the rest of the stylesheet stays real.
  await page.addStyleTag({ content: `
    .msg.dm { ${f.ein.css} }
    .msg.dm.mine { ${f.eig.css} }` });
  await page.addScriptTag({ content: `
    const state = { me: { isAdmin: false }, dmMessages: [], dmRepliesAvailable: true };
    ${numbers}${escFn}${linkify}${tage}${dmBau}
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-admin').hidden = true;
    state.dmMessages = ${JSON.stringify(DM)};
    document.querySelector('#dm-thread').innerHTML = dmListeHtml(state.dmMessages);
    document.querySelector('#dm-thread').scrollTop = 1e6;` });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const bild = await page.locator('#dm-user').screenshot();
  await page.close();
  fs.writeFileSync(path.join(ausgabe, `dmblasen-${f.file}.png`), bild);
  bilder.push('data:image/png;base64,' + bild.toString('base64'));
}

const blatt = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 26px; align-items: start; }
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
<p class="lead">In jedem Bild stehen die <b>eingehenden</b> Nachrichten left und die <b>eigenen</b> right.
Alle Fassungen show dasselbe X-Blau (<b>#4b9aea</b>), unterschiedlich far in den Seitengrund gemischt.
Die eingehende Blase bleibt überall gleich – sonst vergleicht man zwei Änderungen auf einmal.
Die Seite hat sonst nirgends einen gesättigten Farbton – Violett ist ausdrücklich rausgeflogen –, ein Blau nur
in den DMs wäre also die einzige Farbe im ganzen Haus. Dafür löst es ein Problem, an dem alle bisherigen
Fassungen scheiterten: Zwischen dem dunkelsten und dem hellsten Grau der Seite liegen 1,4:1, und zwei Grautöne
so dicht beieinander liest niemand als Absicht. Eine Farbe braucht diesen Abstand nicht.</p>
<div class="row">
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
