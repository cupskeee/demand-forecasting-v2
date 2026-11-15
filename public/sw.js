// Service worker: lets the app open and run with the network off.
// It only ever answers GET requests for this site's own files.
const VERSION = 'dev';
const SHELL_FILES = [/* filled in by the build */];
const SHELL = `shell-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith('shell-') && n !== SHELL).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Engine files: serve the copy the app verified against the manifest, if there is one.
  if (url.pathname.startsWith('/engine/') && url.pathname !== '/engine/manifest.json') {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(request)));
    return;
  }
  if (!SHELL_FILES.length) return; // development: nothing is precached

  if (request.mode === 'navigate') {
    event.respondWith(
      // A redirected copy cannot be used to open a page, so never answer with one.
      caches.match('/').then((hit) => (hit && !hit.redirected ? hit : fetch(request))),
    );
    return;
  }
  event.respondWith(
    caches.match(url.pathname).then((hit) => hit || fetch(request)),
  );
});
