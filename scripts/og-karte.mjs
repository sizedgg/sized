// ============================================================================
// The fallback card: public/og-karte.png
//
// It only shows up in two cases - when a shared link points at a deleted
// poll, and when the database was unreachable while building the card.
// Both are rare, but without a fallback image, X would show an empty area
// with a broken image icon there, and that reads as "the site is dead"
// instead of "this one poll doesn't exist anymore".
//
// Format 1.91:1, same as the poll cards - exactly the ratio X crops a link
// card to. Single resolution, because PNG rasterizes the glow in the
// background with a noise pattern that quadruples in size at double
// resolution: 1.5 MB versus 136 KB, with no visible difference.
//
// The filename deliberately carries no version number, but has been
// changed once: X remembers, per image URL, whether a fetch failed - for
// days at a time. If an image gets swapped out that X has already failed
// to load once, only a URL it has never seen before will help.
//
// Produces public/og-karte.png (1600 x 838)
//
//   node scripts/og-karte.mjs
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
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);

const daten = await page.evaluate(async () => {
  await document.fonts.ready;
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const S = 1, B = 1600, H = Math.round(1600 / 1.91), m = 34, ecke = 28;
  const c = document.createElement('canvas');
  c.width = B * S; c.height = H * S;
  const ctx = c.getContext('2d');
  ctx.scale(S, S);

  const rr = (x, y, w, h, r) => {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    const k = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k); ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k); ctx.arcTo(x, y, x + w, y, k); ctx.closePath();
  };

  ctx.fillStyle = v('--bg'); ctx.fillRect(0, 0, B, H);
  ctx.save();
  rr(m, m, B - m * 2, H - m * 2, ecke); ctx.clip();
  ctx.fillStyle = v('--bg-1'); ctx.fillRect(m, m, B - m * 2, H - m * 2);
  const g = ctx.createRadialGradient(B * .82, H * .9, 0, B * .82, H * .9, Math.max(B, H) * .8);
  g.addColorStop(0, `rgba(${v('--accent-rgb')}, .055)`);
  g.addColorStop(.55, `rgba(${v('--accent-rgb')}, .018)`);
  g.addColorStop(1, `rgba(${v('--accent-rgb')}, 0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, B, H);

  // The mark, large, in the middle - the same two bars as in the logo,
  // recomputed from the viewBox region 42 x 64.
  const height = 96, e = height / 64;
  const wordWidth = (() => {
    ctx.font = `700 ${Math.round(height * .82)}px ${v('--mono')}`;
    try { ctx.letterSpacing = `${Math.round(height * .1)}px`; } catch { /* doesn't matter */ }
    const w = ctx.measureText('SIZED').width;
    try { ctx.letterSpacing = '0px'; } catch { /* doesn't matter */ }
    return w;
  })();
  const gesamt = 42 * e + height * .38 + wordWidth;
  const x0 = (B - gesamt) / 2;
  const y0 = H / 2 - 96;

  ctx.fillStyle = v('--accent');
  rr(x0, y0 + 38 * e, 18 * e, 26 * e, 9 * e); ctx.fill();
  rr(x0 + 24 * e, y0, 18 * e, 64 * e, 9 * e); ctx.fill();
  ctx.font = `700 ${Math.round(height * .82)}px ${v('--mono')}`;
  ctx.fillStyle = v('--text');
  try { ctx.letterSpacing = `${Math.round(height * .1)}px`; } catch { /* doesn't matter */ }
  ctx.fillText('SIZED', x0 + 42 * e + height * .38, y0 + height * .76);
  try { ctx.letterSpacing = '0px'; } catch { /* doesn't matter */ }

  ctx.textAlign = 'center';
  ctx.font = `400 30px ${v('--mono')}`;
  ctx.fillStyle = v('--dim');
  ctx.fillText('Community votes, weighted by what you hold', B / 2, H / 2 + 58);
  ctx.font = `400 24px ${v('--mono')}`;
  ctx.fillStyle = v('--dimmer');
  ctx.fillText('sized.gg', B / 2, H / 2 + 118);
  ctx.textAlign = 'left';
  ctx.restore();

  ctx.strokeStyle = v('--line'); ctx.lineWidth = 1.5;
  rr(m, m, B - m * 2, H - m * 2, ecke); ctx.stroke();
  return c.toDataURL('image/png');
});

const file = path.join(root, 'public', 'og-karte.png');
fs.writeFileSync(file, Buffer.from(daten.split(',')[1], 'base64'));
await browser.close();
server.close();
console.log(`  ${file}  (${Math.round(fs.statSync(file).size / 1024)} KB)`);
