// Minimal service worker for PWA installability.
// - /api/*  → never cached (network only)
// - navigations → network-first, cache fallback so the app opens offline once
// - hashed /assets/* → cache-first (immutable filenames)

const CACHE = "roulette-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(SHELL_URLS).catch(() => {
        /* best-effort */
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API calls: passthrough, no caching.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fallback to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((r) => {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put("/", clone)).catch(() => {});
          return r;
        })
        .catch(() => caches.match("/").then((r) => r ?? new Response("", { status: 503 }))),
    );
    return;
  }

  // Hashed assets and public files: cache-first, populate on miss.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((r) => {
            if (r.ok) {
              const clone = r.clone();
              caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
            }
            return r;
          }),
      ),
    );
  }
});
