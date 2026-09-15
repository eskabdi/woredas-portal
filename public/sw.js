// Task 12-C: hand-written service worker, not vite-plugin-pwa -- see
// docs/task12c-mapping-memo.md §6. Precaches the app shell only (the SPA
// document + favicon); never the hashed JS/CSS bundles Vite emits, since
// this file is static and cannot know their per-build filenames without a
// build-time codegen step this task deliberately doesn't add. Those bundles
// are already content-hashed and long-cache-headered by the normal HTTP
// cache, so they don't need the service worker's help.
//
// Bump CACHE_NAME whenever the shell URL list below changes, or whenever a
// fix here needs every client to pick up the new script -- the browser
// diffs this file byte-for-byte on each navigation and only re-runs
// install/activate when it differs.
const CACHE_NAME = "woreda-portal-shell-v1";
const APP_SHELL_URLS = ["/", "/favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Deliberately narrow: only ever serve the cached shell for a top-level
// navigation, and only as a fallback when the network is unreachable. Never
// intercept anything else -- in particular, never a Supabase REST/Auth/
// Storage/Functions call, which must always hit the network so a stale
// cache can never stand in for another tenant's or another session's data.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match("/").then((cached) => cached ?? Response.error()),
    ),
  );
});
