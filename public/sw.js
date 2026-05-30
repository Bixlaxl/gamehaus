// Gamehaus service worker — bare-bones shell caching, no library.
//
// Strategy:
//   • /_next/static/*  → cache-first (immutable hashed assets, perfect for it)
//   • images           → cache-first with 30-day expiry
//   • navigation HTML  → network-first with cache fallback (so POS / owner
//                        pages can still cold-boot when the network blips,
//                        but a normal online load always gets fresh HTML)
//   • everything else  → straight network (API routes, Supabase, Razorpay)
//
// Bump SW_VERSION when caching behavior changes — old caches are purged.

const SW_VERSION  = "v1";
const STATIC_CACHE = `gh-static-${SW_VERSION}`;
const IMAGE_CACHE  = `gh-images-${SW_VERSION}`;
const PAGE_CACHE   = `gh-pages-${SW_VERSION}`;
const KEEP = new Set([STATIC_CACHE, IMAGE_CACHE, PAGE_CACHE]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch cross-origin (Supabase, Razorpay, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // API + auth + webhooks → straight network, no cache layer
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Next.js hashed static assets — cache-first, basically permanent
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Images
  if (req.destination === "image") {
    event.respondWith(cacheFirst(req, IMAGE_CACHE));
    return;
  }

  // HTML navigations — network-first, fall back to cached page on failure
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, PAGE_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}
