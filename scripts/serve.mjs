/**
 * Winziger Webserver für die Entwicklung – nur `public/`, ohne Zwischenspeicher.
 *
 * Aufruf:  npm run serve        (oder: node scripts/serve.mjs 8080)
 *
 * Warum nicht `python -m http.server`?
 *
 * Zwei Gründe, und der zweite hat schon Zeit gekostet:
 *
 * 1. Der Python-Server liefert das Verzeichnis aus, in dem er gestartet wurde.
 *    Startet man ihn im Projektordner, liegt die Seite unter /public/ – und
 *    alle absoluten Pfade der Seite (/styles.css, /app.js, /sw.js, das
 *    Manifest) zeigen dann ins Leere. Dieser Server hat `public/` fest
 *    eingebaut; von wo aus man ihn startet, spielt keine Rolle.
 *
 * 2. Er schickt kein Cache-Control, aber ein Last-Modified. Der Browser
 *    entscheidet daraufhin selbst, wie lange er eine Antwort behält, und tut
 *    das großzügig. Genau daher kommt der Fall, in dem man eine Datei ändert,
 *    neu lädt und trotzdem die alte Seite sieht. Hier geht `no-store` mit:
 *    jede Anfrage holt die Datei frisch von der Platte.
 *
 * Kein npm-Paket dahinter, nur Node. Ein Entwicklungswerkzeug soll keine
 * Abhängigkeit sein, die man pflegen muss.
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
  // Erst die Abfrageparameter abschneiden, dann auf index.html abbilden.
  // Andersherum landet "/?preview=admin" auf dem Verzeichnis statt auf der
  // Seite und antwortet mit 404.
  const pfad = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const datei = pfad === '/' ? '/index.html' : pfad;

  // Kein Ausbrechen aus public/ – auch lokal nicht. Ein Entwicklungsserver
  // liegt schneller im offenen WLAN, als einem lieb ist.
  const abs = path.join(pub, path.normalize(datei).replace(/^(\.\.[/\\])+/, ''));
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
