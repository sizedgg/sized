// ============================================================================
// Die Ersatzkarte: public/og-karte.png
//
// Sie erscheint nur in zwei Fällen – wenn ein geteilter Link auf eine gelöschte
// Abstimmung zeigt, und wenn die Datenbank beim Bauen der Karte nicht
// erreichbar war. Beides ist selten, aber ohne Ersatzbild zeigte X dort eine
// leere Fläche mit einem kaputten Bildsymbol, und das liest sich als "die
// Seite ist hin" statt als "diese eine Abstimmung gibt es nicht mehr".
//
// Format 1,91:1 wie die Abstimmungskarten – genau das Verhältnis, auf das X
// eine Linkkarte zuschneidet. Einfache Auflösung, weil PNG den Lichtschein im
// Grund mit einem Rauschen rastert, das sich bei doppelter Auflösung
// vervierfacht: 1,5 MB gegen 136 KB, ohne sichtbaren Unterschied.
//
// Der Name traegt bewusst keine Versionsnummer, ist aber einmal gewechselt:
// X merkt sich zu jeder Bildadresse auch das Scheitern eines Abrufs, und zwar
// tagelang. Wird ein Bild ausgetauscht, das X schon einmal nicht laden konnte,
// hilft nur eine Adresse, die es noch nie gesehen hat.
//
// Erzeugt public/og-karte.png (1600 × 838)
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
const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

const daten = await seite.evaluate(async () => {
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

  // Die Marke groß in der Mitte – dieselben zwei Balken wie im Logo,
  // nachgerechnet aus dem viewBox-Ausschnitt 42 × 64.
  const hoehe = 96, e = hoehe / 64;
  const wortBreite = (() => {
    ctx.font = `700 ${Math.round(hoehe * .82)}px ${v('--mono')}`;
    try { ctx.letterSpacing = `${Math.round(hoehe * .1)}px`; } catch { /* egal */ }
    const w = ctx.measureText('SIZED').width;
    try { ctx.letterSpacing = '0px'; } catch { /* egal */ }
    return w;
  })();
  const gesamt = 42 * e + hoehe * .38 + wortBreite;
  const x0 = (B - gesamt) / 2;
  const y0 = H / 2 - 96;

  ctx.fillStyle = v('--accent');
  rr(x0, y0 + 38 * e, 18 * e, 26 * e, 9 * e); ctx.fill();
  rr(x0 + 24 * e, y0, 18 * e, 64 * e, 9 * e); ctx.fill();
  ctx.font = `700 ${Math.round(hoehe * .82)}px ${v('--mono')}`;
  ctx.fillStyle = v('--text');
  try { ctx.letterSpacing = `${Math.round(hoehe * .1)}px`; } catch { /* egal */ }
  ctx.fillText('SIZED', x0 + 42 * e + hoehe * .38, y0 + hoehe * .76);
  try { ctx.letterSpacing = '0px'; } catch { /* egal */ }

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

const datei = path.join(root, 'public', 'og-karte.png');
fs.writeFileSync(datei, Buffer.from(daten.split(',')[1], 'base64'));
await browser.close();
server.close();
console.log(`  ${datei}  (${Math.round(fs.statSync(datei).size / 1024)} KB)`);
