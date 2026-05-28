const CACHE_NAME = "sl-tracker-v3";
const STATIC_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

// Install: pre-cache only static assets (NOT index.html)
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: wipe ALL old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - index.html → NETWORK FIRST (always get latest code), fall back to cache
// - everything else → cache first, fall back to network
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isHTML = url.pathname === "/" || url.pathname.endsWith(".html");

  if (isHTML) {
    // Network first for HTML — ensures updates always show immediately
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache first for static assets
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
  }
});

// Notification click: open or focus the app
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow("/");
    })
  );
});

// Fallback: show notification if triggered via postMessage
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SHOW_NOTIFICATION") {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: "/icon-192.png",
      tag: "sl-reminder",
      renotify: true,
    });
  }
});
