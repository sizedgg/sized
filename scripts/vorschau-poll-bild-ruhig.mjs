// ============================================================================
// Entwurf "Ruhig", ohne Lila und mit harter Balkenkante
//
// Zwei Änderungen, beide mit Folgen, die man erst am Bild sieht:
//
// 1. Kein Violett mehr. Damit fällt die zweite Farbe im Verlauf weg – der
//    Balken ist jetzt einfarbig, und die einzige Frage ist noch, wie hell.
//    Der Lichtschein im Grund war ebenfalls violett; er wird hier entweder
//    ganz weggelassen oder auf das Knochenweiß umgestellt.
//
// 2. Harte Kante statt Verlauf. Der weiche Auslauf gibt es auf der Seite aus
//    einem bestimmten Grund: Dort läuft die Kante mitten durch den
//    Antworttext, der über dem Balken liegt, und eine harte senkrechte Linie
//    quer durch ein Wort sieht nach Darstellungsfehler aus. Im Bild für X
//    steht der Text nicht mehr über dem Balken, sondern links davon in einer
//    eigenen Spalte – die Kante trifft also nichts mehr, und sie darf hart
//    sein. Sie sagt dann sogar etwas: Genau hier endet der Anteil.
//
// Vier Stärken zur Auswahl, sonst identisch.
//
//   node scripts/vorschau-poll-bild-ruhig.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

await seite.addScriptTag({
  content: `
const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
const zahl = (n) => Number(n).toLocaleString('en-US');
const stimmen = (o) => zahl(o.votes) + ' vote' + (o.votes === 1 ? '' : 's');
const SYMBOL = 'ANSEM';

const F = () => {
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return {
    grund: v('--bg'), karte: v('--bg-1'), balken: v('--bg-3'), linie: v('--line'),
    text: v('--text'), dim: v('--dim'), dimmer: v('--dimmer'),
    akzent: v('--accent'), akzentRgb: v('--accent-rgb'),
    sans: v('--mono'), mono: v('--mono'),   // --sans gibt es nicht mehr: eine Schrift fuer alles
  };
};
function rr(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k); ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k); ctx.arcTo(x, y, x + w, y, k); ctx.closePath();
}
function bruch(ctx, text, maxW) {
  const worte = String(text).split(/\\s+/).filter(Boolean);
  const zeilen = []; let z = '';
  for (const w of worte) {
    const t = z ? z + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !z) { z = t; continue; }
    zeilen.push(z); z = w;
  }
  if (z) zeilen.push(z);
  return zeilen;
}
function kurz(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function marke(ctx, x, y, hoehe, f) {
  const e = hoehe / 64;
  ctx.fillStyle = f.akzent;
  rr(ctx, x, y + 38 * e, 18 * e, 26 * e, 9 * e); ctx.fill();
  rr(ctx, x + 24 * e, y, 18 * e, 64 * e, 9 * e); ctx.fill();
  ctx.font = '700 ' + Math.round(hoehe * .82) + 'px ' + f.sans;
  ctx.fillStyle = f.text;
  try { ctx.letterSpacing = Math.round(hoehe * .1) + 'px'; } catch {}
  ctx.fillText('SIZED', x + 42 * e + hoehe * .38, y + hoehe * .76);
  try { ctx.letterSpacing = '0px'; } catch {}
}

/**
 * @param stufe   Deckkraft der Balkenfüllung
 * @param schein  Lichtschein im Grund: 'keiner' oder 'weiss'
 */
async function ruhig(p, { stufe, schein }) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const mess = document.createElement('canvas').getContext('2d');
  mess.font = '700 54px ' + f.sans;
  const zeilen = bruch(mess, p.question, B - 220).slice(0, 3);

  let optH = 82; const luecke = 14;
  const fest = 150 + zeilen.length * 66 + 54 + 152;
  const H = Math.max(900, Math.min(2000, fest + p.options.length * (optH + luecke)));
  const frei = H - fest - p.options.length * (optH + luecke);
  if (frei > 0) optH = Math.min(132, optH + frei / p.options.length);
  const rest = Math.max(0, H - fest - p.options.length * (optH + luecke));

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);

  ctx.fillStyle = f.grund; ctx.fillRect(0, 0, B, H);
  if (schein === 'weiss') {
    // Derselbe Lichtschein wie vorher, nur im Knochenweiß statt im Violett.
    // Sehr schwach: Er soll dem Bild Tiefe geben, nicht auffallen.
    const g = ctx.createRadialGradient(B * .82, H * .9, 0, B * .82, H * .9, Math.max(B, H) * .8);
    g.addColorStop(0, 'rgba(' + f.akzentRgb + ', .055)');
    g.addColorStop(.55, 'rgba(' + f.akzentRgb + ', .018)');
    g.addColorStop(1, 'rgba(' + f.akzentRgb + ', 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, B, H);
  }

  const m = 40;
  ctx.fillStyle = 'rgba(16, 18, 24, .82)';
  rr(ctx, m, m, B - m * 2, H - m * 2, 26); ctx.fill();
  ctx.strokeStyle = f.linie; ctx.lineWidth = 1.5; ctx.stroke();

  const rand = m + 54;
  const inhalt = B - rand * 2;
  let y = m + 52;

  marke(ctx, rand, y, 30, f);
  ctx.font = '400 20px ' + f.mono; ctx.fillStyle = f.dimmer;
  ctx.textAlign = 'right'; ctx.fillText('sized.gg', B - rand, y + 24); ctx.textAlign = 'left';
  y += 96;

  ctx.font = '700 54px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of zeilen) { ctx.fillText(kurz(ctx, z, inhalt), rand, y + 46); y += 66; }

  ctx.font = '400 21px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(zahl(p.totalVotes) + ' votes   ·   ' + fmtUsd(p.totalUsd) + ' in $' + SYMBOL,
    rand, y + 26);
  y += 54 + rest * .55;

  const fuehrt = Math.max(...p.options.map((o) => o.share));
  ctx.font = '700 36px ' + f.mono;
  const geldB = Math.max(...p.options.map((o) => ctx.measureText(fmtUsd(o.usd)).width));

  for (const o of p.options) {
    const spitze = o.share === fuehrt && p.totalVotes > 0;
    ctx.fillStyle = f.balken; rr(ctx, rand, y, inhalt, optH, 13); ctx.fill();
    ctx.strokeStyle = spitze ? 'rgba(' + f.akzentRgb + ', .55)' : f.linie;
    ctx.lineWidth = spitze ? 2 : 1; ctx.stroke();

    // Harte Kante, einfarbig. Kein Verlauf, keine zweite Farbe.
    const fw = Math.max(0, Math.min(1, o.share)) * inhalt;
    if (fw > 1) {
      ctx.save(); rr(ctx, rand, y, inhalt, optH, 13); ctx.clip();
      ctx.fillStyle = 'rgba(' + f.akzentRgb + ', ' + stufe + ')';
      ctx.fillRect(rand, y, fw, optH);
      ctx.restore();
    }

    const mitte = y + optH / 2;
    ctx.textAlign = 'right';
    ctx.font = '700 36px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.text;
    ctx.fillText(fmtUsd(o.usd), B - rand - 24, mitte - 1);
    ctx.font = '400 17px ' + f.mono; ctx.fillStyle = f.dimmer;
    ctx.fillText(stimmen(o), B - rand - 24, mitte + 23);
    ctx.textAlign = 'left';

    ctx.font = (spitze ? '650 ' : '500 ') + '27px ' + f.sans;
    ctx.fillStyle = f.text;
    ctx.fillText(kurz(ctx, o.label, inhalt - 48 - geldB - 34), rand + 24, mitte + 10);
    y += optH + luecke;
  }

  ctx.font = '400 19px ' + f.sans; ctx.fillStyle = f.dimmer;
  ctx.fillText(p.closed ? 'This vote is closed' : 'Hold $' + SYMBOL + ' to vote',
    rand, H - m - 34);
  return c;
}
window.ruhig = ruhig;
`,
});

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });
const POLL = {
  id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  options: [
    opt('Ship it this week', 128, 482900, .62),
    opt('Wait for the audit', 44, 210400, .27),
    opt('Do neither and keep building quietly', 19, 88120, .11),
  ],
};

const STUFEN = [
  { stufe: .10, schein: 'keiner', name: 'Sehr zurückhaltend',
    hinweis: 'Deckkraft 10 %, kein Lichtschein im Grund. Der Balken ist gerade noch als Fläche zu erkennen – die Kante trägt hier fast allein.' },
  { stufe: .16, schein: 'weiss',
    name: 'Zurückhaltend',
    hinweis: 'Deckkraft 16 %, dazu ein sehr schwacher weißer Lichtschein unten rechts. Ungefähr so kräftig wie der Verlauf vorher an seiner hellsten Stelle.' },
  { stufe: .24, schein: 'weiss', name: 'Deutlich',
    hinweis: 'Deckkraft 24 %. Der Anteil ist auch als Daumennagel noch zu sehen, ohne dass die Fläche den Text überstrahlt.' },
  { stufe: .34, schein: 'weiss', name: 'Kräftig',
    hinweis: 'Deckkraft 34 %. Am weitesten von der Seite entfernt, aber in der Zeitleiste am eindeutigsten.' },
];

const bilder = [];
for (const s of STUFEN) {
  const data = await seite.evaluate(async ({ p, o }) => {
    const c = await window.ruhig(p, o);
    return c.toDataURL('image/png');
  }, { p: POLL, o: { stufe: s.stufe, schein: s.schein } });
  bilder.push({ ...s, data });
  const datei = path.join(root, 'preview',
    `poll-x-ruhig-${Math.round(s.stufe * 100)}.png`);
  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  fs.writeFileSync(datei, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`  ${s.name}: ${Math.round(s.stufe * 100)} %`);
}

const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 30px; background: var(--bg); }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 100ch; }
  .karte { margin: 0 0 26px; max-width: 1180px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-family: var(--mono); font-size: .78rem; }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); max-width: 100ch; }
  img { display: block; width: 100%; border-radius: 10px; border: 1px solid var(--line); }
</style>
<h1>„Ruhig" ohne Lila, mit harter Kante</h1>
<p class="lead">Einfarbige Füllung im Knochenweiß, die abrupt endet. Unterschied ist nur die Deckkraft – und ob unten rechts noch ein sehr schwacher Lichtschein liegt.</p>
${bilder.map((b, i) => `
  <section class="karte">
    <h2><span class="nr">${i}</span>${b.name}</h2>
    <p class="hinweis">${b.hinweis}</p>
    <img src="${b.data}" alt="">
  </section>`).join('')}
`;
fs.writeFileSync(path.join(root, 'public', '_vorschau-ruhig.html'), blatt);
const blattSeite = await browser.newPage({ viewport: { width: 1260, height: 900 }, deviceScaleFactor: 2 });
await blattSeite.goto(`file://${path.join(root, 'public', '_vorschau-ruhig.html')}`);
await blattSeite.waitForTimeout(350);
await blattSeite.screenshot({ path: path.join(root, 'preview', 'poll-bild-ruhig-stufen.png'), fullPage: true });
fs.rmSync(path.join(root, 'public', '_vorschau-ruhig.html'), { force: true });

await browser.close();
server.close();
console.log('\n  preview/poll-bild-ruhig-stufen.png\n');
