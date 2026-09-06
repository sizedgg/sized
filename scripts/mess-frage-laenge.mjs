// Einmalige Messung: Wie viele Zeichen passen wirklich in drei Zeilen?
//   node scripts/mess-frage-laenge.mjs
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
const seite = await browser.newPage();
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

const r = await seite.evaluate(() => {
  const mono = getComputedStyle(document.documentElement)
    .getPropertyValue('--mono').trim() || 'monospace';
  const c = document.createElement('canvas').getContext('2d');
  c.font = `700 54px ${mono}`;
  const inhalt = 1600 - (34 + 52) * 2;
  const zelle = c.measureText('M'.repeat(100)).width / 100;
  const zeilen = (text) => {
    const worte = String(text).split(/\s+/).filter(Boolean);
    const out = []; let z = '';
    for (const w of worte) {
      const v = z ? `${z} ${w}` : w;
      if (c.measureText(v).width <= inhalt || !z) { z = v; continue; }
      out.push(z); z = w;
    }
    if (z) out.push(z);
    return out.length;
  };
  // Wortlaengen: englische Prosa (1..12, Schwerpunkt 3-6) und hart (bis maxW).
  const satz = (n, maxW, prosa) => {
    const laenge = () => prosa
      ? [2,3,3,4,4,4,5,5,5,6,6,7,8,9,10,12][Math.floor(Math.random() * 16)]
      : 2 + Math.floor(Math.random() * (maxW - 1));
    let s = '';
    while (s.length < n) s += (s ? ' ' : '') + 'x'.repeat(laenge());
    // Auf genau n bringen, ohne ein Wort kuenstlich zu verlaengern.
    const w = s.split(' ');
    while (w.join(' ').length > n) w.pop();
    let rest = n - w.join(' ').length;
    if (rest > 0) w[w.length - 1] += 'x'.repeat(rest);
    return w.join(' ');
  };
  const probe = (n, maxW, prosa, runden = 4000) => {
    let schlecht = 0;
    for (let i = 0; i < runden; i++) if (zeilen(satz(n, maxW, prosa)) > 3) schlecht++;
    return schlecht;
  };
  const out = { zelle, proZeile: Math.floor(inhalt / zelle), reihen: [] };
  for (const n of [100, 105, 110, 115, 120, 125, 129]) {
    out.reihen.push({
      n,
      prosa: probe(n, 0, true),
      w13: probe(n, 13, false),
      w16: probe(n, 16, false),
      w20: probe(n, 20, false),
    });
  }
  return out;
});

console.log(`Zelle ${r.zelle.toFixed(2)} px, ${r.proZeile} Zeichen je Zeile`);
console.log('n     prosa   bis13   bis16   bis20   (von 4000 zu lang)');
for (const z of r.reihen) {
  console.log(`${String(z.n).padEnd(6)}${String(z.prosa).padEnd(8)}${String(z.w13).padEnd(8)}${String(z.w16).padEnd(8)}${z.w20}`);
}
await browser.close();
server.close();
