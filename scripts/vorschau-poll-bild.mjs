// ============================================================================
// Four drafts for the image that goes out on X
//
// The biggest lever isn't the color, it's the aspect ratio. X shows a single
// image in the timeline in full up to 16:9; anything taller gets cropped,
// top and bottom both. The current image is 2400 x 1324 at three answers -
// so 1.81:1, which is just barely fine. At ten answers it's 2400 x 2476, and
// in the timeline you see the top half of that: the question, and not a
// single answer. Exactly the image nobody taps.
//
// That's why all four drafts target 16:9 and only grow once there really
// are too many answers - and then only up to 4:5 at most, which X still
// shows uncropped too.
//
// The second lever is the number that stands out large. Here that's the
// DOLLAR AMOUNT - not the percentage share and not the vote count.
//
// The reason is in the mechanics: in this round, one vote weighs as much as
// the balance behind it. "44 votes" therefore says almost nothing - it could
// be four large holders or forty small ones, or the other way round. The
// amount says what's really behind an answer. The vote count still stays in
// the image, small: it answers the second question, namely whether many
// hold a little or few hold a lot.
//
// The share still lives in the bar width, just not as a number - exactly
// like on the site itself.
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

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const heutigerZeichner = cut('const cssWert =', 'async function ladePollBild');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);

// ---------------------------------------------------------------------------
// The drafts. Everything runs in the browser, because that's where the real
// fonts and the real color values from the stylesheet live.
// ---------------------------------------------------------------------------
await page.addScriptTag({
  content: `
const state = { cfg: { symbol: 'ANSEM' } };
const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
${heutigerZeichner}
window.heute = drawPoll;

// --- Tools -------------------------------------------------------------------
const F = () => {
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return {
    grund: v('--bg'), card: v('--bg-1'), balken: v('--bg-3'), linie: v('--line'),
    text: v('--text'), dim: v('--dim'), dimmer: v('--dimmer'),
    akzent: v('--accent'), akzentRgb: v('--accent-rgb'), akzent2Rgb: v('--accent-2-rgb'),
    sans: v('--mono'), mono: v('--mono'),   // --sans no longer exists: one font for everything
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
  const lines = []; let z = '';
  for (const w of worte) {
    const t = z ? z + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !z) { z = t; continue; }
    lines.push(z); z = w;
  }
  if (z) lines.push(z);
  return lines;
}
function short(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
/* With thousands separators. "38100 votes" reads as one string of digits
   you have to count along - "38,100 votes" doesn't. */
const number = (n) => Number(n).toLocaleString('en-US');
const stimmen = (o) => number(o.votes) + ' vote' + (o.votes === 1 ? '' : 's');
/* The widest dollar figure in the field determines the column. Otherwise the
   answer text would start somewhere different on every row - and a list
   where the texts indent like a staircase looks like a bug, not a design. */
function geldSpalte(ctx, p) {
  return Math.max(...p.options.map((o) => ctx.measureText(fmtUsd(o.usd)).width));
}

/* The background: not flat black, but a very faint glow from one corner. In
   the timeline the image sits among a bunch of other dark tiles - a flat
   surface disappears there, one with depth doesn't. */
function grundMitSchein(ctx, B, H, f, ecke = 'br') {
  ctx.fillStyle = f.grund; ctx.fillRect(0, 0, B, H);
  const [gx, gy] = ecke === 'br' ? [B * .82, H * .9] : [B * .12, H * .1];
  const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(B, H) * .8);
  g.addColorStop(0, 'rgba(' + f.akzent2Rgb + ', .13)');
  g.addColorStop(.55, 'rgba(' + f.akzent2Rgb + ', .04)');
  g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', 0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, B, H);
}

/** The logo's two bars, at any height. */
function marker(ctx, x, y, height, f, wort = true, wortFarbe) {
  const e = height / 64;
  ctx.fillStyle = f.akzent;
  rr(ctx, x, y + 38 * e, 18 * e, 26 * e, 9 * e); ctx.fill();
  rr(ctx, x + 24 * e, y, 18 * e, 64 * e, 9 * e); ctx.fill();
  if (!wort) return x + 42 * e;
  ctx.font = '700 ' + Math.round(height * .82) + 'px ' + f.sans;
  ctx.fillStyle = wortFarbe || f.text;
  try { ctx.letterSpacing = Math.round(height * .1) + 'px'; } catch {}
  ctx.fillText('SIZED', x + 42 * e + height * .38, y + height * .76);
  const w = ctx.measureText('SIZED').width;
  try { ctx.letterSpacing = '0px'; } catch {}
  return x + 42 * e + height * .38 + w;
}

/**
 * Choose a height.
 *
 * The target is 16:9. If the content doesn't fit, the image grows - but only
 * up to 4:5. Beyond that X crops in the timeline, and then the question is
 * visible and not a single answer.
 */
function hoeheFuer(B, gebraucht) {
  const ziel = Math.round(B * 9 / 16);
  const max = Math.round(B * 5 / 4);
  return Math.max(ziel, Math.min(max, gebraucht));
}

// ===========================================================================
// Draft 1 - "Calm"
// Everything on one card with a border, lots of air. The leader gets a
// light-colored border, otherwise no distinguishing mark. Percent large,
// votes and dollars small underneath.
// ===========================================================================
async function entwurf1(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = '700 54px ' + f.sans;
  const lines = bruch(measurer, p.question, B - 220).slice(0, 3);

  let optH = 82; const gap = 14;
  const fest = 150 + lines.length * 66 + 54 + 152;
  const H = hoeheFuer(B, fest + p.options.length * (optH + gap));
  // If space is left over within the 16:9 frame, the bars grow into it
  // instead of leaving a hole at the bottom. Capped, because a 200 px tall
  // bar looks silly for a three-word answer.
  const frei1 = H - fest - p.options.length * (optH + gap);
  if (frei1 > 0) optH = Math.min(132, optH + frei1 / p.options.length);
  const restOben1 = Math.max(0, H - fest - p.options.length * (optH + gap));

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  grundMitSchein(ctx, B, H, f);

  // The card
  const m = 40;
  ctx.fillStyle = 'rgba(16, 18, 24, .82)';
  rr(ctx, m, m, B - m * 2, H - m * 2, 26); ctx.fill();
  ctx.strokeStyle = f.linie; ctx.lineWidth = 1.5; ctx.stroke();

  const margin = m + 54;
  const content = B - margin * 2;
  let y = m + 52;

  marker(ctx, margin, y, 30, f);
  ctx.font = '400 20px ' + f.mono; ctx.fillStyle = f.dimmer;
  ctx.textAlign = 'right'; ctx.fillText('sized.gg', B - margin, y + 24); ctx.textAlign = 'left';
  y += 96;

  ctx.font = '700 54px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of lines) { ctx.fillText(short(ctx, z, content), margin, y + 46); y += 66; }

  ctx.font = '400 21px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(number(p.totalVotes) + ' vote' + (p.totalVotes === 1 ? '' : 's')
    + '   ·   ' + fmtUsd(p.totalUsd) + ' in $' + state.cfg.symbol, margin, y + 26);
  y += 54 + restOben1 * .55;

  const leads = Math.max(...p.options.map((o) => o.share));
  ctx.font = '700 36px ' + f.mono;
  const geldB1 = geldSpalte(ctx, p);
  for (const o of p.options) {
    const spitze = o.share === leads && p.totalVotes > 0;
    ctx.fillStyle = f.balken; rr(ctx, margin, y, content, optH, 13); ctx.fill();
    ctx.strokeStyle = spitze ? 'rgba(' + f.akzentRgb + ', .55)' : f.linie;
    ctx.lineWidth = spitze ? 2 : 1; ctx.stroke();

    const fw = Math.max(0, Math.min(1, o.share)) * content;
    if (fw > 1) {
      ctx.save(); rr(ctx, margin, y, content, optH, 13); ctx.clip();
      const g = ctx.createLinearGradient(margin, 0, margin + fw, 0);
      g.addColorStop(0, 'rgba(' + f.akzentRgb + ', .3)');
      g.addColorStop(Math.max(0, (fw - 26) / fw), 'rgba(' + f.akzent2Rgb + ', .24)');
      g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', 0)');
      ctx.fillStyle = g; ctx.fillRect(margin, y, fw, optH); ctx.restore();
    }

    const center = y + optH / 2;
    ctx.textAlign = 'right';
    ctx.font = '700 36px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.text;
    ctx.fillText(fmtUsd(o.usd), B - margin - 24, center - 1);
    const wGeld = ctx.measureText(fmtUsd(o.usd)).width;
    ctx.font = '400 17px ' + f.mono; ctx.fillStyle = f.dimmer;
    ctx.fillText(stimmen(o), B - margin - 24, center + 23);
    ctx.textAlign = 'left';

    ctx.font = (spitze ? '650 ' : '500 ') + '27px ' + f.sans;
    ctx.fillStyle = f.text;
    ctx.fillText(short(ctx, o.label, content - 48 - geldB1 - 34), margin + 24, center + 10);
    y += optH + gap;
  }

  ctx.font = '400 19px ' + f.sans; ctx.fillStyle = f.dimmer;
  ctx.fillText(p.closed ? 'This vote is closed' : 'Hold $' + state.cfg.symbol + ' to vote',
    margin, H - m - 34);
  return c;
}

// ===========================================================================
// Draft 2 - "Two columns"
// Question large on the left, results compact on the right. That gives the
// question half the area and keeps it readable even at thumbnail size; the
// answers sit as narrow rows next to it.
// ===========================================================================
async function entwurf2(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, H = 900, f = F();
  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  grundMitSchein(ctx, B, H, f, 'tl');

  const margin = 72;
  const column = 640;

  marker(ctx, margin, margin, 32, f);


  ctx.font = '700 58px ' + f.sans; ctx.fillStyle = f.text;
  const lines = bruch(ctx, p.question, column).slice(0, 5);
  // The block of label, question and numbers is centered as a whole.
  const blockH = 44 + lines.length * 70 + 40;
  let qy = Math.max(margin + 186, (H - blockH) / 2 + 44);
  ctx.save();
  ctx.font = '600 18px ' + f.mono; ctx.fillStyle = f.dimmer;
  try { ctx.letterSpacing = '3px'; } catch {}
  ctx.fillText(p.closed ? 'CLOSED VOTE' : 'COMMUNITY VOTE', margin, qy - 44);
  ctx.restore();
  ctx.font = '700 58px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of lines) { ctx.fillText(short(ctx, z, column), margin, qy); qy += 70; }

  ctx.font = '400 22px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(number(p.totalVotes) + ' votes  ·  ' + fmtUsd(p.totalUsd), margin, qy + 18);

  ctx.font = '400 19px ' + f.mono; ctx.fillStyle = f.dimmer;
  ctx.fillText('sized.gg', margin, H - margin);

  // Right column
  const rx = margin + column + 96;
  const rw = B - rx - margin;
  const show = p.options.slice(0, 6);
  // The rows fill the height between the margins instead of bunching up in
  // the middle. The last block is 74 px tall (title, line, small text) -
  // without this allowance the column sits visually too high.
  const zh = Math.max(84, Math.min(132, (H - margin * 2 - 74) / (show.length - 1 || 1)));
  let ry = (H - ((show.length - 1) * zh + 74)) / 2;
  const leads = Math.max(...p.options.map((o) => o.share));

  for (const o of show) {
    const spitze = o.share === leads && p.totalVotes > 0;
    ctx.font = '700 30px ' + f.mono;
    const wGeld2 = geldSpalte(ctx, p);
    ctx.font = (spitze ? '650 ' : '500 ') + '24px ' + f.sans;
    ctx.fillStyle = spitze ? f.text : f.dim;
    ctx.fillText(short(ctx, o.label, rw - wGeld2 - 30), rx, ry + 26);

    ctx.textAlign = 'right';
    ctx.font = '700 30px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.dim;
    ctx.fillText(fmtUsd(o.usd), rx + rw, ry + 28);
    ctx.textAlign = 'left';

    // The line underneath is the bar - thin, because here it only has to
    // show the order, not the exact value. The number states that.
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
  if (p.options.length > show.length) {
    ctx.font = '400 17px ' + f.sans; ctx.fillStyle = f.dimmer;
    ctx.fillText('+ ' + (p.options.length - show.length) + ' more on sized.gg', rx, ry + 14);
  }
  return c;
}

// ===========================================================================
// Draft 3 - "Large"
// Only a few, very large elements. The percentage sits inside the bar
// itself. This is the draft that still works as a thumbnail.
// ===========================================================================
async function entwurf3(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = '700 60px ' + f.sans;
  const lines = bruch(measurer, p.question, B - 160).slice(0, 2);

  const show = p.options.slice(0, 5);
  let optH = 106; const gap = 16;
  const fest = 128 + lines.length * 74 + 56 + 96;
  const H = hoeheFuer(B, fest + show.length * (optH + gap));
  const frei3 = H - fest - show.length * (optH + gap);
  if (frei3 > 0) optH = Math.min(158, optH + frei3 / show.length);
  const restOben3 = Math.max(0, H - fest - show.length * (optH + gap));

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  grundMitSchein(ctx, B, H, f);

  const margin = 80;
  const content = B - margin * 2;
  let y = margin;

  marker(ctx, margin, y, 34, f);
  ctx.font = '400 20px ' + f.mono; ctx.fillStyle = f.dimmer;
  ctx.textAlign = 'right'; ctx.fillText('sized.gg', B - margin, y + 26); ctx.textAlign = 'left';
  y += 108;

  ctx.font = '700 60px ' + f.sans; ctx.fillStyle = f.text;
  for (const z of lines) { ctx.fillText(short(ctx, z, content), margin, y + 52); y += 74; }

  ctx.font = '400 22px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(number(p.totalVotes) + ' votes  ·  ' + fmtUsd(p.totalUsd) + ' in $' + state.cfg.symbol,
    margin, y + 26);
  y += 56 + restOben3 * .5;

  const leads = Math.max(...p.options.map((o) => o.share));
  // The amount's font size is set by the widest number: "$902,000,000" at
  // 52 px would eat half the row.
  let geldGroesse = 52;
  ctx.font = '700 ' + geldGroesse + 'px ' + f.mono;
  while (geldGroesse > 30 && geldSpalte(ctx, p) > content * .34) {
    geldGroesse -= 2;
    ctx.font = '700 ' + geldGroesse + 'px ' + f.mono;
  }
  const geldB3 = geldSpalte(ctx, p);
  for (const o of show) {
    const spitze = o.share === leads && p.totalVotes > 0;
    ctx.fillStyle = f.balken; rr(ctx, margin, y, content, optH, 16); ctx.fill();

    const fw = Math.max(0, Math.min(1, o.share)) * content;
    if (fw > 1) {
      ctx.save(); rr(ctx, margin, y, content, optH, 16); ctx.clip();
      const g = ctx.createLinearGradient(margin, 0, margin + fw, 0);
      g.addColorStop(0, 'rgba(' + f.akzentRgb + ', ' + (spitze ? .34 : .2) + ')');
      g.addColorStop(Math.max(0, (fw - 30) / fw), 'rgba(' + f.akzent2Rgb + ', ' + (spitze ? .3 : .16) + ')');
      g.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', 0)');
      ctx.fillStyle = g; ctx.fillRect(margin, y, fw, optH); ctx.restore();
    }
    if (spitze) {
      ctx.strokeStyle = 'rgba(' + f.akzentRgb + ', .5)'; ctx.lineWidth = 2;
      rr(ctx, margin, y, content, optH, 16); ctx.stroke();
    }

    // The percentage sits on the left INSIDE the bar, not at the edge:
    // that's where the eye hits it first, and it sits right on the area it
    // describes.
    const mitte3 = y + optH / 2;
    // The amount sits on the left INSIDE the bar, right-aligned in a fixed
    // column: that's where the eye hits it first, and because the column is
    // the same width for every row, the answers all start at the same spot.
    ctx.font = '700 ' + geldGroesse + 'px ' + f.mono;
    ctx.fillStyle = spitze ? f.akzent : f.dim;
    ctx.textAlign = 'right';
    ctx.fillText(fmtUsd(o.usd), margin + 30 + geldB3, mitte3 + geldGroesse * .35);

    ctx.font = '400 19px ' + f.mono; ctx.fillStyle = f.dimmer;
    const right = stimmen(o);
    ctx.fillText(right, B - margin - 30, mitte3 + 14);
    const wr = ctx.measureText(right).width;
    ctx.textAlign = 'left';

    ctx.font = (spitze ? '650 ' : '500 ') + '30px ' + f.sans;
    ctx.fillStyle = f.text;
    ctx.fillText(short(ctx, o.label, content - 60 - geldB3 - 34 - wr - 30),
      margin + 30 + geldB3 + 26, mitte3 + 14);
    y += optH + gap;
  }
  if (p.options.length > show.length) {
    ctx.font = '400 20px ' + f.sans; ctx.fillStyle = f.dimmer;
    ctx.fillText('+ ' + (p.options.length - show.length) + ' more options on sized.gg', margin, y + 22);
  }
  return c;
}

// ===========================================================================
// Draft 4 - "Band"
// A stripe in the brand color at the top, whitespace below and the results
// as fine lines. The most eye-catching of the four - and the one that looks
// least like an app window.
// ===========================================================================
async function entwurf4(p) {
  await document.fonts.ready;
  const S = 2, B = 1600, f = F();
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = '700 56px ' + f.sans;
  const lines = bruch(measurer, p.question, B - 300).slice(0, 3);
  const show = p.options.slice(0, 6);
  let zh = 78;
  const fest4 = 260 + lines.length * 70 + 40 + 110;
  const H = hoeheFuer(B, fest4 + show.length * zh);
  const frei4 = H - fest4 - show.length * zh;
  if (frei4 > 0) zh = Math.min(124, zh + frei4 / show.length);
  const restOben4 = Math.max(0, H - fest4 - show.length * zh);

  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  ctx.fillStyle = f.grund; ctx.fillRect(0, 0, B, H);

  // The stripe
  const bandH = 150;
  const bg = ctx.createLinearGradient(0, 0, B, bandH);
  bg.addColorStop(0, 'rgba(' + f.akzentRgb + ', .92)');
  bg.addColorStop(1, 'rgba(' + f.akzent2Rgb + ', .85)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, B, bandH);

  // Logo in the stripe, in the background color - reversed text on a light
  // background.
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
  for (const z of lines) { ctx.fillText(short(ctx, z, B - 160), 80, y); y += 70; }

  ctx.font = '400 21px ' + f.sans; ctx.fillStyle = f.dim;
  ctx.fillText(number(p.totalVotes) + ' votes  ·  ' + fmtUsd(p.totalUsd) + ' in $' + state.cfg.symbol, 80, y + 12);
  y += 58 + restOben4 * .5;

  const leads = Math.max(...p.options.map((o) => o.share));
  const bw = B - 160;
  for (const o of show) {
    const spitze = o.share === leads && p.totalVotes > 0;
    ctx.font = (spitze ? '650 ' : '450 ') + '27px ' + f.sans;
    ctx.fillStyle = spitze ? f.text : f.dim;
    ctx.fillText(short(ctx, o.label, bw - 260), 80, y + 24);

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

window.DRAFTS = { heute, entwurf1, entwurf2, entwurf3, entwurf4 };
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
  ['entwurf1', 'Ruhig', 'Alles auf einer Karte mit Rand, ein schwacher Lichtschein im Grund. Der Betrag groß right, Stimmen klein darunter, der Führende bekommt einen hellen Rahmen. Am nächsten am jetzigen Aussehen.'],
  ['entwurf2', 'Zwei Spalten', 'Frage left über die halbe Breite, Ergebnisse right als schmale Zeilen mit dünnem Balken. Die Frage bleibt auch daumennagelgroß lesbar.'],
  ['entwurf3', 'Groß', 'Wenige, sehr große Elemente. Der Betrag steht left im Balken selbst, in einer festen Spalte – dadurch beginnen alle Antworten an derselben Stelle. Der Entwurf, der als Daumennagel am besten durchkommt.'],
  ['entwurf4', 'Band', 'Ein heller Streifen in der Markenfarbe peek, darunter feine Linien statt Balken. Sieht am wenigsten nach Anwendungsfenster aus.'],
];

// On top of that, the unpleasant case: nine-digit amounts and a very long
// answer. If a draft breaks, it's here.
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
  const d = await page.evaluate(async ({ fn, p }) => {
    const c = await window.DRAFTS[fn](p);
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height };
  }, { fn, p: POLL });
  bilder.push({ name, hinweis, ...d, ratio: (d.w / d.h).toFixed(2) });
  console.log(`  ${name}: ${d.w} × ${d.h}  (${(d.w / d.h).toFixed(2)}:1)`);
}

// Overview sheet: all five stacked, each scaled to the same width - that
// way you compare the design and not the size.
const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 30px; background: var(--bg); }
  h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  .lead { margin: 0 0 1.6rem; font-size: .82rem; color: var(--dim); max-width: 100ch; }
  .card { margin: 0 0 28px; max-width: 1180px; }
  .card h2 { margin: 0 0 .15rem; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
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
  <section class="card">
    <h2><span class="nr">${i}</span>${b.name}<span class="mass">${b.w} × ${b.h} · ${b.ratio}:1</span></h2>
    <p class="hinweis">${b.hinweis}</p>
    <img src="${b.data}" alt="">
  </section>`).join('')}
`;

fs.writeFileSync(path.join(root, 'public', '_vorschau-poll-bild.html'), blatt);
const sheetPage = await browser.newPage({ viewport: { width: 1260, height: 900 }, deviceScaleFactor: 2 });
await sheetPage.goto(`file://${path.join(root, 'public', '_vorschau-poll-bild.html')}`);
await sheetPage.waitForTimeout(400);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await sheetPage.screenshot({ path: path.join(root, 'preview', 'poll-bild-entwuerfe.png'), fullPage: true });

// Each draft additionally on its own, at full size.
for (const b of bilder) {
  fs.writeFileSync(path.join(root, 'preview', `poll-x-${b.name.toLowerCase().replace(/\s/g, '-')}.png`),
    Buffer.from(b.data.split(',')[1], 'base64'));
}

// The hard case, one per draft.
for (const [fn, name] of NAMEN) {
  const d = await page.evaluate(async ({ fn, p }) => {
    const c = await window.DRAFTS[fn](p);
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
