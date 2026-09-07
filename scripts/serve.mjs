/**
 * Tiny development web server - only `public/`, no caching.
 *
 * Usage:  npm run serve        (or: node scripts/serve.mjs 8080)
 *
 * Why not `python -m http.server`?
 *
 * Two reasons, and the second one has already cost real time.
 *
 * 1. The Python server serves the directory it was started in. Start it in
 *    the project root and the page ends up under /public/ - and every
 *    absolute path on the page (/styles.css, /app.js, /sw.js, the manifest)
 *    then points nowhere. This server has `public/` hardcoded; it doesn't
 *    matter where you start it from.
 *
 * 2. It sends no Cache-Control, but does send a Last-Modified. The browser
 *    then decides for itself how long to keep a response, and does so
 *    generously. That's exactly where the case comes from where you edit a
 *    file, reload, and still see the old page. `no-store` goes out with
 *    every response here: every request fetches the file fresh from disk.
 *
 * No npm package behind this, just Node. A development tool shouldn't be a
 * dependency you have to maintain.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Strip the query string first, then map to index.html. The other way
  // around, "/?preview=admin" would resolve to the directory instead of the
  // page and answer with 404.
  const pfad = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = pfad === '/' ? '/index.html' : pfad;

  // No escaping public/ - not even locally. A dev server ends up on an open
  // wifi network faster than you'd like.
  const abs = path.join(pub, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(pub) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
       .end('nicht gefunden');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
    'cache-control': 'no-store, must-revalidate',
  }).end(fs.readFileSync(abs));
});

server.listen(PORT, () => {
  console.log(`\n  SIZED  http://localhost:${PORT}`);
  console.log(`  liefert ${path.relative(root, pub)}/ aus, ohne Zwischenspeicher`);
  console.log(`  Ansems Ansicht ansehen:  http://localhost:${PORT}/?preview=admin\n`);
});
