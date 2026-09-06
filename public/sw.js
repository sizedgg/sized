/**
 * Service Worker – so klein wie möglich.
 *
 * Er ist hier NICHT dafür da, die Seite offline nutzbar zu machen: Eine
 * Abstimmung ohne Netz hat keinen Zweck. Er ist da, damit sich die Seite überhaupt auf dem
 * Startbildschirm ablegen lässt – Chrome verlangt dafür einen Worker, der auf
 * Anfragen reagiert – und damit ein kurzer Funkloch-Moment nicht zur
 * Fehlerseite führt.
 *
 * Deshalb Netz zuerst, Zwischenspeicher nur als Auffangnetz. Andersherum wäre
 * gefährlich: Nach einer Aktualisierung liefe bei den Leuten sonst tagelang
 * eine alte Fassung weiter, ohne dass jemand merkt, warum.
 */

const CACHE = 'sized-shell-v2';

// Nur die Hülle. config.js steht bewusst NICHT hier: Wenn das Projekt einmal
// umzieht, darf keine alte Adresse im Zwischenspeicher hängen bleiben.
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/vendor/supabase.js',
  '/icons/icon-192.png',
  // Ansems Profilbild. Es steht in der Huelle, weil es in der Kopfzeile
  // sofort gebraucht wird und nicht erst nach einer Antwort vom Server: Ohne
  // das steht dort in einem Funkloch ein leerer Kreis. 3,5 KB.
  '/ansem.jpg',
];

self.addEventListener('install', (e) => {
  // Nicht scheitern, wenn eine einzelne Datei fehlt – die Installation soll
  // daran nicht hängen bleiben.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Alles, was nicht zu dieser Seite gehört, geht uns nichts an – vor allem
  // nicht die Aufrufe an Supabase. Die dürfen niemals aus dem Speicher
  // beantwortet werden.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // /p/12 ist keine Seite dieser App, sondern die kleine Umleitungsseite für
  // geteilte Links. Sie muss immer frisch kommen: Aus dem Speicher beantwortet
  // wuerde sie eine alte Frage und alte Zahlen an X ausliefern.
  if (url.pathname.startsWith('/p/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Nur erfolgreiche Antworten ablegen.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
