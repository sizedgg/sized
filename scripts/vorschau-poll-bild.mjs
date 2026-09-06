// ============================================================================
// Vier Entwürfe für das Bild, das auf X landet
//
// Der größte Hebel ist nicht die Farbe, sondern das Seitenverhältnis. X zeigt
// ein einzelnes Bild in der Zeitleiste bis 16:9 vollständig; alles Höhere wird
// beschnitten, und zwar oben und unten. Das jetzige Bild ist bei drei Antworten
// 2400 × 1324 – also 1,81:1 und damit knapp in Ordnung. Bei zehn Antworten sind
// es 2400 × 2476, und in der Zeitleiste sieht man davon die obere Hälfte: die
// Frage, und keine einzige Antwort. Genau das Bild, das niemand antippt.
//
// Deshalb zielen alle vier Entwürfe auf 16:9 und wachsen erst, wenn wirklich
// zu viele Antworten da sind – dann bis höchstens 4:5, was X ebenfalls noch
// ungeschnitten zeigt.
//
// Der zweite Hebel ist die Zahl, die groß dasteht. Hier ist das der
// DOLLARBETRAG – nicht der Anteil in Prozent und nicht die Stimmenzahl.
//
// Der Grund liegt in der Sache: In dieser Runde wiegt eine Stimme so viel wie
// der Bestand dahinter. "44 Stimmen" sagt deshalb fast nichts – es können vier
// große Halter und vierzig kleine sein oder umgekehrt. Der Betrag sagt, was
// wirklich hinter einer Antwort steht. Die Stimmenzahl bleibt trotzdem im
// Bild, klein: Sie beantwortet die zweite Frage, nämlich ob viele wenig oder
// wenige viel halten.
//
// Der Anteil steckt weiterhin in der Balkenbreite, nur eben nicht als Zahl –
// genau wie auf der Seite selbst.
//
//   node scripts/vorschau-poll-bild.mjs
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
const heutigerZeichner = schneide('const cssWert =', 'async function ladePollBild');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

// ---------------------------------------------------------------------------
// Die Entwürfe. Alles läuft im Browser, weil dort die echten Schriften und die
// echten Farbwerte aus dem Stylesheet stehen.
// ---------------------------------------------------------------------------
await seite.addScriptTag({
  content: `
const state = { cfg: { symbol: 'ANSEM' } };
const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
${heutigerZeichner}
window.heute = zeichnePoll;

// --- Werkzeuge -------------------------------------------------------------
const F = () => {
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return {
    grund: v('--bg'), karte: v('--bg-1'), balken: v('--bg-3'), linie: v('--line'),
    text: v('--text'), dim: v('--dim'), dimmer: v('--dimmer'),
    akzent: v('--accent'), akzentRgb: v('--accent-rgb'), akzent2Rgb: v('--accent-2-rgb'),
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
/* Mit Tausenderpunkten. "38100 votes" liest sich als eine Ziffernkette, bei
   der man mitzaehlen muss – "38,100 votes" nicht. */
const zahl = (n) => Number(n).toLocaleString('en-US');
const stimmen = (o) => zahl(o.votes) + ' vote' + (o.votes === 1 ? '' : 's');
/* Die breiteste Dollarzahl im Feld bestimmt die Spalte. Sonst begaenne der
   Antworttext in jeder Zeile woanders – und eine Liste, in der die Texte
   treppenfoermig einruecken, sieht nach Fehler aus, nicht nach Gestaltung. */
function geldSpalte(ctx, p) {
  return Math.max(...p.options.map((o) => ctx.measureText(fmtUsd(o.usd)).width));
}

/* Der Grund: nicht flach schwarz, sondern ein sehr schwacher Lichtschein aus
   einer Ecke. In der Zeitleiste steht das Bild zwischen lauter anderen dunklen
   Kacheln – eine flache Fläche verschwindet dort, eine mit Tiefe nicht. */
function grundMitSchein(ctx, B, H, f, ecke = 'br') {
  ctx.fillStyle = f.grund; ctx.fillRect(0, 0, B, H);
  const [gx, gy] = ecke === 'br' ? [B * .82, H * .9] : [B * .12, H * .1];
  const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(B, H) * .8);
  g.addColorStop(0, 'rgba(' + f.akzent2Rgb + ', .13)');
  g.addColorStop(.55, 'rgba(' + f.akzent2Rgb + ', .04)');
  g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', 0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, B, H);
}

/** Die zwei Balken des Logos, in beliebiger Höhe. */
function marke(ctx, x, y, hoehe, f, wort = true, wortFarbe) {
  const e = hoehe / 64;
  ctx.fillStyle = f.akzent;
  rr(ctx, x, y + 38 * e, 18 * e, 26 * e, 9 * e); ctx.fill();
  rr(ctx, x + 24 * e, y, 18 * e, 64 * e, 9 * e); ctx.fill();
  if (!wort) return x + 42 * e;
  ctx.font = '700 ' + Math.round(hoehe * .82) + 'px ' + f.sans;
  ctx.fillStyle = wortFarbe || f.text;
  try { ctx.letterSpacing = Math.round(hoehe * .1) + 'px'; } catch {}
  ctx.fillText('SIZED', x + 42 * e + hoehe * .38, y + hoehe * .76);
  const w = ctx.measureText('SIZED').width;
  try { ctx.letterSpacing = '0px'; } catch {}
  return x + 42 * e + hoehe * .38 + w;
}

/**
 * Höhe wählen.
 *
 * Ziel ist 16:9. Passt der Inhalt nicht, wächst das Bild – aber nur bis 4:5.
 * Darüber schneidet X in der Zeitleiste, und dann ist die Frage sichtbar und
 * keine einzige Antwort.
 */
function hoeheFuer(B, gebraucht) {
  const ziel = Math.round(B * 9 / 16);
  const max = Math.round(B * 5 / 4);
  return Math.max(ziel, Math.min(max, gebraucht));
}

// ===========================================================================
// Entwurf 1 – "Ruhig"
// Alles auf einer Karte mit Rand, viel Luft. Der Führende bekommt einen
// hellen Rahmen, sonst keine Auszeichnung. Prozent groß, Stimmen und Dollar
// klein darunter.
// ===========================================================================
async function entwurf1(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const mess = document.createElement('canvas').getContext('2d');
  mess.font = '700 54px ' + f.sans;
  const zeilen = bruch(mess, p.question, B - 220).slice(0, 3);

  let optH = 82; const luecke = 14;
  const fest = 150 + zeilen.length * 66 + 54 + 152;
  const H = hoeheFuer(B, fest + p.options.length * (optH + luecke));
  // Bleibt im 16:9-Rahmen Platz uebrig, wachsen die Balken hinein statt unten
  // ein Loch zu lassen. Gedeckelt, weil ein 200 px hoher Balken fuer eine
  // dreiwortige Antwort albern aussieht.
  const frei1 = H - fest - p.options.length * (optH + luecke);
  if (frei1 > 0) optH = Math.min(132, optH + frei1 / p.options.length);
  const restOben1 = Math.max(0, H - fest - p.options.length * (optH + luecke));

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  grundMitSchein(ctx, B, H, f);

  // Die Karte
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
  ctx.fillText(zahl(p.totalVotes) + ' vote' + (p.totalVotes === 1 ? '' : 's')
    + '   ·   ' + fmtUsd(p.totalUsd) + ' in $' + state.cfg.symbol, rand, y + 26);
  y += 54 + restOben1 * .55;

  const fuehrt = Math.max(...p.options.map((o) => o.share));
  ctx.font = '700 36px ' + f.mono;
  const geldB1 = geldSpalte(ctx, p);
  for (const o of p.options) {
    const spitze = o.share === fuehrt && p.totalVotes > 0;
    ctx.fillStyle = f.balken; rr(ctx, rand, y, inhalt, optH, 13); ctx.fill();
    ctx.strokeStyle = spitze ? 'rgba(' + f.akzentRgb + ', .55)' : f.linie;
    ctx.lineWidth = spitze ? 2 : 1; ctx.stroke();

    const fw = Math.max(0, Math.min(1, o.share)) * inhalt;
    if (fw > 1) {
      ctx.save(); rr(ctx, rand, y, inhalt, optH, 13); ctx.clip();
      const g = ctx.createLinearGradient(rand, 0, rand + fw, 0);
      g.addColorStop(0, 'rgba(' + f.akzentRgb + ', .3)');
      g.addColorStop(Math.max(0, (fw - 26) / fw), 'rgba(' + f.akzent2Rgb + ', .24)');
      g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', 0)');
      ctx.fillStyle = g; ctx.fillRect(rand, y, fw, optH); ctx.restore();
    }

    const mitte = y + optH / 2;
    ctx.textAlign = 'right';
    ctx.font = '700 36px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.text;
    ctx.fillText(fmtUsd(o.usd), B - rand - 24, mitte - 1);
    const wGeld = ctx.measureText(fmtUsd(o.usd)).width;
    ctx.font = '400 17px ' + f.mono; ctx.fillStyle = f.dimmer;
    ctx.fillText(stimmen(o), B - rand - 24, mitte + 23);
    ctx.textAlign = 'left';

    ctx.font = (spitze ? '650 ' : '500 ') + '27px ' + f.sans;
    ctx.fillStyle = f.text;
    ctx.fillText(kurz(ctx, o.label, inhalt - 48 - geldB1 - 34), rand + 24, mitte + 10);
    y += optH + luecke;
  }

  ctx.font = '400 19px ' + f.sans; ctx.fillStyle = f.dimmer;
  ctx.fillText(p.closed ? 'This vote is closed' : 'Hold $' + state.cfg.symbol + ' to vote',
    rand, H - m - 34);
  return c;
}

// ===========================================================================
// Entwurf 2 – "Zwei Spalten"
// Frage links groß, Ergebnisse rechts kompakt. Die Frage bekommt damit die
// halbe Fläche und bleibt auch daumennagelgroß lesbar; die Antworten stehen
// als schmale Zeilen daneben.
// ===========================================================================
async function entwurf2(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, H = 900, f = F();
  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  grundMitSchein(ctx, B, H, f, 'tl');

  const rand = 72;
  const spalte = 640;

  marke(ctx, rand, rand, 32, f);


  ctx.font = '700 58px ' + f.sans; ctx.fillStyle = f.text;
  const zeilen = bruch(ctx, p.question, spalte).slice(0, 5);
  // Der Block aus Zeile, Frage und Zahlen wird als Ganzes mittig gesetzt.
  const blockH = 44 + zeilen.length * 70 + 40;
  let qy = Math.max(rand + 186, (H - blockH) / 2 + 44);
  ctx.save();
  ctx.font = '600 18px ' + f.mono; ctx.fillStyle = f.dimmer;
  try { ctx.letterSpacing = '3px'; } catch {}
  ctx.fillText(p.closed ? 'CLOSED VOTE' : 'COMMUNITY VOTE', rand, qy - 44);
  ctx.restore();
  ctx.font = '700 58px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of zeilen) { ctx.fillText(kurz(ctx, z, spalte), rand, qy); qy += 70; }

  ctx.font = '400 22px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(zahl(p.totalVotes) + ' votes  ·  ' + fmtUsd(p.totalUsd), rand, qy + 18);

  ctx.font = '400 19px ' + f.mono; ctx.fillStyle = f.dimmer;
  ctx.fillText('sized.gg', rand, H - rand);

  // Rechte Spalte
  const rx = rand + spalte + 96;
  const rw = B - rx - rand;
  const zeigen = p.options.slice(0, 6);
  // Die Zeilen fuellen die Hoehe zwischen den Raendern, statt in der Mitte zu
  // klumpen. Der letzte Block ist 74 px hoch (Titel, Strich, Kleinzeile) –
  // ohne dieses Zugestaendnis sitzt die Spalte optisch zu hoch.
  const zh = Math.max(84, Math.min(132, (H - rand * 2 - 74) / (zeigen.length - 1 || 1)));
  let ry = (H - ((zeigen.length - 1) * zh + 74)) / 2;
  const fuehrt = Math.max(...p.options.map((o) => o.share));

  for (const o of zeigen) {
    const spitze = o.share === fuehrt && p.totalVotes > 0;
    ctx.font = '700 30px ' + f.mono;
    const wGeld2 = geldSpalte(ctx, p);
    ctx.font = (spitze ? '650 ' : '500 ') + '24px ' + f.sans;
    ctx.fillStyle = spitze ? f.text : f.dim;
    ctx.fillText(kurz(ctx, o.label, rw - wGeld2 - 30), rx, ry + 26);

    ctx.textAlign = 'right';
    ctx.font = '700 30px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.dim;
    ctx.fillText(fmtUsd(o.usd), rx + rw, ry + 28);
    ctx.textAlign = 'left';

    // Der Strich darunter ist der Balken – dünn, weil er hier nur die
    // Reihenfolge zeigen muss, nicht den genauen Wert. Den nennt die Zahl.
    const by = ry + 46;
    ctx.fillStyle = f.balken; rr(ctx, rx, by, rw, 7, 4); ctx.fill();
    const fw = Math.max(0, Math.min(1, o.share)) * rw;
    if (fw > 2) {
      const g = ctx.createLinearGradient(rx, 0, rx + fw, 0);
      g.addColorStop(0, 'rgba(' + f.akzentRgb + ', .85)');
      g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', .75)');
      ctx.fillStyle = g; rr(ctx, rx, by, fw, 7, 4); ctx.fill();
    }
    ctx.font = '400 16px ' + f.mono; ctx.fillStyle = f.dimmer;
    ctx.fillText(stimmen(o), rx, by + 28);
    ry += zh;
  }
  if (p.options.length > zeigen.length) {
    ctx.font = '400 17px ' + f.sans; ctx.fillStyle = f.dimmer;
    ctx.fillText('+ ' + (p.options.length - zeigen.length) + ' more on sized.gg', rx, ry + 14);
  }
  return c;
}

// ===========================================================================
// Entwurf 3 – "Groß"
// Nur wenige, sehr große Elemente. Die Prozentzahl steht im Balken selbst.
// Das ist der Entwurf, der als Daumennagel noch funktioniert.
// ===========================================================================
async function entwurf3(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const mess = document.createElement('canvas').getContext('2d');
  mess.font = '700 60px ' + f.sans;
  const zeilen = bruch(mess, p.question, B - 160).slice(0, 2);

  const zeigen = p.options.slice(0, 5);
  let optH = 106; const luecke = 16;
  const fest = 128 + zeilen.length * 74 + 56 + 96;
  const H = hoeheFuer(B, fest + zeigen.length * (optH + luecke));
  const frei3 = H - fest - zeigen.length * (optH + luecke);
  if (frei3 > 0) optH = Math.min(158, optH + frei3 / zeigen.length);
  const restOben3 = Math.max(0, H - fest - zeigen.length * (optH + luecke));

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  grundMitSchein(ctx, B, H, f);

  const rand = 80;
  const inhalt = B - rand * 2;
  let y = rand;

  marke(ctx, rand, y, 34, f);
  ctx.font = '400 20px ' + f.mono; ctx.fillStyle = f.dimmer;
  ctx.textAlign = 'right'; ctx.fillText('sized.gg', B - rand, y + 26); ctx.textAlign = 'left';
  y += 108;

  ctx.font = '700 60px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of zeilen) { ctx.fillText(kurz(ctx, z, inhalt), rand, y + 52); y += 74; }

  ctx.font = '400 22px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(zahl(p.totalVotes) + ' votes  ·  ' + fmtUsd(p.totalUsd) + ' in $' + state.cfg.symbol,
    rand, y + 26);
  y += 56 + restOben3 * .5;

  const fuehrt = Math.max(...p.options.map((o) => o.share));
  // Die Schriftgroesse des Betrags richtet sich nach der breitesten Zahl:
  // "$902,000,000" bei 52 px wuerde die halbe Zeile fressen.
  let geldGroesse = 52;
  ctx.font = '700 ' + geldGroesse + 'px ' + f.mono;
  while (geldGroesse > 30 && geldSpalte(ctx, p) > inhalt * .34) {
    geldGroesse -= 2;
    ctx.font = '700 ' + geldGroesse + 'px ' + f.mono;
  }
  const geldB3 = geldSpalte(ctx, p);
  for (const o of zeigen) {
    const spitze = o.share === fuehrt && p.totalVotes > 0;
    ctx.fillStyle = f.balken; rr(ctx, rand, y, inhalt, optH, 16); ctx.fill();

    const fw = Math.max(0, Math.min(1, o.share)) * inhalt;
    if (fw > 1) {
      ctx.save(); rr(ctx, rand, y, inhalt, optH, 16); ctx.clip();
      const g = ctx.createLinearGradient(rand, 0, rand + fw, 0);
      g.addColorStop(0, 'rgba(' + f.akzentRgb + ', ' + (spitze ? .34 : .2) + ')');
      g.addColorStop(Math.max(0, (fw - 30) / fw), 'rgba(' + f.akzent2Rgb + ', ' + (spitze ? .3 : .16) + ')');
      g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', 0)');
      ctx.fillStyle = g; ctx.fillRect(rand, y, fw, optH); ctx.restore();
    }
    if (spitze) {
      ctx.strokeStyle = 'rgba(' + f.akzentRgb + ', .5)'; ctx.lineWidth = 2;
      rr(ctx, rand, y, inhalt, optH, 16); ctx.stroke();
    }

    // Die Prozentzahl steht links IM Balken, nicht am Rand: Dort trifft das
    // Auge sie zuerst, und sie sitzt genau auf der Fläche, die sie beschreibt.
    const mitte3 = y + optH / 2;
    // Der Betrag steht links IM Balken, rechtsbuendig in einer festen Spalte:
    // Dort trifft das Auge ihn zuerst, und weil die Spalte fuer alle Zeilen
    // gleich breit ist, beginnen die Antworten alle an derselben Stelle.
    ctx.font = '700 ' + geldGroesse + 'px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.dim;
    ctx.textAlign = 'right';
    ctx.fillText(fmtUsd(o.usd), rand + 30 + geldB3, mitte3 + geldGroesse * .35);

    ctx.font = '400 19px ' + f.mono; ctx.fillStyle = f.dimmer;
    const rechts = stimmen(o);
    ctx.fillText(rechts, B - rand - 30, mitte3 + 14);
    const wr = ctx.measureText(rechts).width;
    ctx.textAlign = 'left';

    ctx.font = (spitze ? '650 ' : '500 ') + '30px ' + f.sans;
    ctx.fillStyle = f.text;
    ctx.fillText(kurz(ctx, o.label, inhalt - 60 - geldB3 - 34 - wr - 30),
      rand + 30 + geldB3 + 26, mitte3 + 14);
    y += optH + luecke;
  }
  if (p.options.length > zeigen.length) {
    ctx.font = '400 20px ' + f.sans; ctx.fillStyle = f.dimmer;
    ctx.fillText('+ ' + (p.options.length - zeigen.length) + ' more options on sized.gg', rand, y + 22);
  }
  return c;
}

// ===========================================================================
// Entwurf 4 – "Band"
// Ein Streifen in der Markenfarbe oben, darunter Weißraum und die Ergebnisse
// als feine Linien. Der auffälligste der vier – und der, der am wenigsten nach
// Anwendungsfenster aussieht.
// ===========================================================================
async function entwurf4(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const mess = document.createElement('canvas').getContext('2d');
  mess.font = '700 56px ' + f.sans;
  const zeilen = bruch(mess, p.question, B - 300).slice(0, 3);
  const zeigen = p.options.slice(0, 6);
  let zh = 78;
  const fest4 = 260 + zeilen.length * 70 + 40 + 110;
  const H = hoeheFuer(B, fest4 + zeigen.length * zh);
  const frei4 = H - fest4 - zeigen.length * zh;
  if (frei4 > 0) zh = Math.min(124, zh + frei4 / zeigen.length);
  const restOben4 = Math.max(0, H - fest4 - zeigen.length * zh);

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  ctx.fillStyle = f.grund; ctx.fillRect(0, 0, B, H);

  // Der Streifen
  const bandH = 150;
  const bg = ctx.createLinearGradient(0, 0, B, bandH);
  bg.addColorStop(0, 'rgba(' + f.akzentRgb + ', .92)');
  bg.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', .85)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, B, bandH);

  // Marke im Streifen, in der Grundfarbe – Negativschrift auf hellem Grund.
  const e = 34 / 64;
  ctx.fillStyle = f.grund;
  rr(ctx, 80, 58 + 38 * e, 18 * e, 26 * e, 9 * e); ctx.fill();
  rr(ctx, 80 + 24 * e, 58, 18 * e, 64 * e, 9 * e); ctx.fill();
  ctx.font = '700 28px ' + f.sans;
  try { ctx.letterSpacing = '4px'; } catch {}
  ctx.fillText('SIZED', 80 + 42 * e + 14, 58 + 26);
  try { ctx.letterSpacing = '0px'; } catch {}
  ctx.font = '600 19px ' + f.mono;
  ctx.textAlign = 'right';
  ctx.fillText(p.closed ? 'CLOSED' : 'LIVE VOTE', B - 80, 58 + 24);
  ctx.textAlign = 'left';

  let y = bandH + 92;
  ctx.font = '700 56px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of zeilen) { ctx.fillText(kurz(ctx, z, B - 160), 80, y); y += 70; }

  ctx.font = '400 21px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(zahl(p.totalVotes) + ' votes  ·  ' + fmtUsd(p.totalUsd) + ' in $' + state.cfg.symbol, 80, y + 12);
  y += 58 + restOben4 * .5;

  const fuehrt = Math.max(...p.options.map((o) => o.share));
  const bw = B - 160;
  for (const o of zeigen) {
    const spitze = o.share === fuehrt && p.totalVotes > 0;
    ctx.font = (spitze ? '650 ' : '450 ') + '27px ' + f.sans;
    ctx.fillStyle = spitze ? f.text : f.dim;
    ctx.fillText(kurz(ctx, o.label, bw - 260), 80, y + 24);

    ctx.textAlign = 'right';
    ctx.font = '700 32px ' + f.mono; ctx.fillStyle = spitze ? f.akzent : f.dim;
    ctx.fillText(fmtUsd(o.usd), 80 + bw, y + 26);
    ctx.font = '400 16px ' + f.mono; ctx.fillStyle = f.dimmer;
    ctx.fillText(stimmen(o), 80 + bw, y + 52);
    ctx.textAlign = 'left';

    const ly = y + 44;
    ctx.fillStyle = f.balken; rr(ctx, 80, ly, bw - 260, 4, 2); ctx.fill();
    const fw = Math.max(0, Math.min(1, o.share)) * (bw - 260);
    if (fw > 2) {
      const g = ctx.createLinearGradient(80, 0, 80 + fw, 0);
      g.addColorStop(0, 'rgba(' + f.akzentRgb + ', .9)');
      g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', .8)');
      ctx.fillStyle = g; rr(ctx, 80, ly, fw, 4, 2); ctx.fill();
    }
    y += zh;
  }

  ctx.font = '400 20px ' + f.sans; ctx.fillStyle = f.dimmer;
  ctx.fillText('sized.gg  ·  hold $' + state.cfg.symbol + ' to vote', 80, H - 52);
  return c;
}

window.ENTWUERFE = { heute, entwurf1, entwurf2, entwurf3, entwurf4 };
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

const NAMEN = [
  ['heute', 'Heute', 'Der jetzige Stand. Betrag und Stimmen gleich groß nebeneinander, flacher Grund – und bei mehr Antworten wird das Bild hoch, sodass X es in der Zeitleiste abschneidet.'],
  ['entwurf1', 'Ruhig', 'Alles auf einer Karte mit Rand, ein schwacher Lichtschein im Grund. Der Betrag groß rechts, Stimmen klein darunter, der Führende bekommt einen hellen Rahmen. Am nächsten am jetzigen Aussehen.'],
  ['entwurf2', 'Zwei Spalten', 'Frage links über die halbe Breite, Ergebnisse rechts als schmale Zeilen mit dünnem Balken. Die Frage bleibt auch daumennagelgroß lesbar.'],
  ['entwurf3', 'Groß', 'Wenige, sehr große Elemente. Der Betrag steht links im Balken selbst, in einer festen Spalte – dadurch beginnen alle Antworten an derselben Stelle. Der Entwurf, der als Daumennagel am besten durchkommt.'],
  ['entwurf4', 'Band', 'Ein heller Streifen in der Markenfarbe oben, darunter feine Linien statt Balken. Sieht am wenigsten nach Anwendungsfenster aus.'],
];

// Zusaetzlich der unangenehme Fall: neunstellige Betraege und eine sehr lange
// Antwort. Wenn ein Entwurf bricht, dann hier.
const HART = {
  id: 2, closed: false, totalVotes: 41822, totalUsd: 918400000,
  question: 'Should the treasury buy back tokens from the open market this quarter?',
  options: [
    opt('Yes, start immediately', 38100, 902000000, .982),
    opt('No, keep the runway and revisit this in six months', 3722, 16400000, .018),
  ],
};

const bilder = [];
for (const [fn, name, hinweis] of NAMEN) {
  const d = await seite.evaluate(async ({ fn, p }) => {
    const c = await window.ENTWUERFE[fn](p);
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height };
  }, { fn, p: POLL });
  bilder.push({ name, hinweis, ...d, verhaeltnis: (d.w / d.h).toFixed(2) });
  console.log(`  ${name}: ${d.w} × ${d.h}  (${(d.w / d.h).toFixed(2)}:1)`);
}

// Übersichtsblatt: alle fünf untereinander, jeweils auf dieselbe Breite
// gebracht – so vergleicht man die Gestaltung und nicht die Größe.
const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 30px; background: var(--bg); }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 100ch; }
  .karte { margin: 0 0 28px; max-width: 1180px; }
  .karte h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-family: var(--mono); font-size: .78rem; }
  .mass { font-family: var(--mono); font-size: .72rem; font-weight: 400; color: var(--dimmer); }
  .hinweis { margin: 0 0 .6rem; font-size: .78rem; color: var(--dimmer); max-width: 100ch; }
  img { display: block; width: 100%; border-radius: 10px; border: 1px solid var(--line); }
</style>
<h1>Das Bild für X</h1>
<p class="lead">Alle fünf mit derselben Abstimmung und auf dieselbe Breite gebracht. Entscheidend ist das Seitenverhältnis hinter jedem Titel: X zeigt bis 16:9 (1,78) alles, darüber wird in der Zeitleiste beschnitten.</p>
${bilder.map((b, i) => `
  <section class="karte">
    <h2><span class="nr">${i}</span>${b.name}<span class="mass">${b.w} × ${b.h} · ${b.verhaeltnis}:1</span></h2>
    <p class="hinweis">${b.hinweis}</p>
    <img src="${b.data}" alt="">
  </section>`).join('')}
`;

fs.writeFileSync(path.join(root, 'public', '_vorschau-poll-bild.html'), blatt);
const blattSeite = await browser.newPage({ viewport: { width: 1260, height: 900 }, deviceScaleFactor: 2 });
await blattSeite.goto(`file://${path.join(root, 'public', '_vorschau-poll-bild.html')}`);
await blattSeite.waitForTimeout(400);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await blattSeite.screenshot({ path: path.join(root, 'preview', 'poll-bild-entwuerfe.png'), fullPage: true });

// Jeden Entwurf zusätzlich einzeln, in voller Größe.
for (const b of bilder) {
  fs.writeFileSync(path.join(root, 'preview', `poll-x-${b.name.toLowerCase().replace(/\s/g, '-')}.png`),
    Buffer.from(b.data.split(',')[1], 'base64'));
}

// Der harte Fall, einzeln je Entwurf.
for (const [fn, name] of NAMEN) {
  const d = await seite.evaluate(async ({ fn, p }) => {
    const c = await window.ENTWUERFE[fn](p);
    return c.toDataURL('image/png');
  }, { fn, p: HART });
  fs.writeFileSync(path.join(root, 'preview',
    `poll-x-hart-${name.toLowerCase().replace(/\s/g, '-')}.png`),
    Buffer.from(d.split(',')[1], 'base64'));
}

fs.rmSync(path.join(root, 'public', '_vorschau-poll-bild.html'), { force: true });
await browser.close();
server.close();
console.log('\n  preview/poll-bild-entwuerfe.png\n');
