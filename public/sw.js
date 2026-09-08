/**
 * Service worker - as small as possible.
 *
 * It's NOT here to make the site usable offline: a poll without a network
 * connection serves no purpose. It exists so the site can be added to the
 * home screen at all - Chrome requires a worker that responds to requests
 * for that - and so a brief dead-zone moment doesn't turn into an error page.
 *
 * Hence network first, cache only as a safety net. The other way round
 * would be dangerous: after an update, people would otherwise keep running
 * an old version for days, with nobody noticing why.
 */

/* Bump this whenever the SHELL list changes. The activate handler deletes
   every cache whose name is not this one, so a new name is what makes an
   installed app pick up the new shell - without it, a phone that already has
   the app keeps serving the old styles.css and never fetches the font files
   at all. v3: the four font files joined the shell. */
const CACHE = 'sized-shell-v3';

// Only the shell. config.js deliberately does NOT sit here: if the project
// ever moves, no old address is allowed to get stuck in the cache.
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/vendor/supabase.js',
  '/icons/icon-192.png',
  // Ansem's profile picture. It's part of the shell because it's needed
  // immediately in the header, not only after a response from the server:
  // without this, a dead zone would leave an empty circle there. 3.5 KB.
  '/ansem.jpg',
  // The font. Without these four, the installed app falls back to the
  // system's monospace when offline - and that is a different face with
  // different widths, so the whole column of figures shifts. 59 KB, fetched
  // once at install.
  '/fonts/ibm-plex-mono-400.woff2',
  '/fonts/ibm-plex-mono-500.woff2',
  '/fonts/ibm-plex-mono-600.woff2',
  '/fonts/ibm-plex-mono-700.woff2',
];

self.addEventListener('install', (e) => {
  // Don't fail if a single file is missing - installation shouldn't get
  // stuck on that.
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

  // Anything that doesn't belong to this site is none of our business -
  // above all not the calls to Supabase. Those must never be answered from
  // the cache.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // /p/12 isn't a page of this app, it's the small redirect page for shared
  // left. It always has to come fresh: answered from the cache, it would
  // hand X an old question and old numbers.
  if (url.pathname.startsWith('/p/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Only store successful responses.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
