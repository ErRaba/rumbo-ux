/* Rumbo UX · funciona sin conexión: guarda la app entera la primera vez */
const V = "rumboux-21ed843959";
const FILES = ["./","index.html","acceso.js","firebase-config.js","datos.bin","manifest.webmanifest","fuentes/Fraunces-italic-latin-1.woff2","fuentes/Fraunces-italic-latin-ext-0.woff2","fuentes/Fraunces-normal-latin-3.woff2","fuentes/Fraunces-normal-latin-ext-2.woff2","fuentes/fuentes.css","fuentes/JetBrainsMono-normal-latin-5.woff2","fuentes/JetBrainsMono-normal-latin-ext-4.woff2","fuentes/Manrope-normal-latin-7.woff2","fuentes/Manrope-normal-latin-ext-6.woff2","iconos/icono-180.png","iconos/icono-192.png","iconos/icono-512.png"];
// cache:"reload" evita copiar versiones antiguas de la caché HTTP del navegador (GitHub guarda 10 min)
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
/* primero la caché (rápido y sin datos); si hay red, se actualiza en segundo plano */
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.endsWith("admin.html")) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: "no-cache" }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
