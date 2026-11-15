/* Cooper · service worker: lets the app open and show saved work without a connection.
 *
 *   app files (this origin)      network first, saved copy when the network fails or is slow
 *   libraries and fonts (CDN)    saved copy first (versioned URLs never change)
 *   map tiles                    saved copy first; NDVI prefers the network (it changes every 8 days)
 *   GET /api/catalog|weather|soil  network first; the saved answer carries "X-Cooper-Saved"
 *   POST /api/analyze            network first; the same settings can be reopened offline
 *
 * The list of app files comes from sw-files.js (scripts/make_offline_manifest.py). */
"use strict";
try { importScripts("sw-files.js"); } catch (_) { /* first run without a generated list */ }

const BUILD = self.COOPER_BUILD || "dev";
const FILES = self.COOPER_FILES || ["./", "index.html"];
const SHELL = `cooper-shell-${BUILD}`;
const LIBS = "cooper-libs-v1";
const TILES = "cooper-tiles-v1";
const API = "cooper-api-v1";
const SAVED = "X-Cooper-Saved";
const MAX_TILES = 2500, MAX_ANALYSES = 40;

const CDN = "https://cdn.jsdelivr.net/npm/";
const FONT_CSS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap";
const LIB_URLS = [
  "leaflet@1.9.4/dist/leaflet.css", "leaflet@1.9.4/dist/leaflet.js",
  "leaflet@1.9.4/dist/images/layers.png", "leaflet@1.9.4/dist/images/layers-2x.png",
  "leaflet@1.9.4/dist/images/marker-icon.png", "leaflet@1.9.4/dist/images/marker-icon-2x.png", "leaflet@1.9.4/dist/images/marker-shadow.png",
  "chart.js@4.4.4/dist/chart.umd.min.js", "gsap@3.12.5/dist/gsap.min.js",
  "three@0.160.0/build/three.module.js", "three@0.160.0/examples/jsm/controls/OrbitControls.js", "three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js",
  "jspdf@2.5.1/dist/jspdf.umd.min.js", "jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
].map((p) => CDN + p);

const LIB_HOSTS = new Set(["cdn.jsdelivr.net", "fonts.gstatic.com"]);
const isTileHost = (h) => h === "server.arcgisonline.com" || h.endsWith("tile.openstreetmap.org") || h === "gibs.earthdata.nasa.gov" || h === "services.terrascope.be";
const noCors = new Set(); // hosts that refused a CORS request: passed through, never stored

/* ------------------------------------------------------------- helpers */
async function inBatches(items, size, fn) {
  let ok = 0;
  for (let i = 0; i < items.length; i += size) {
    const res = await Promise.allSettled(items.slice(i, i + size).map(fn));
    ok += res.filter((r) => r.status === "fulfilled" && r.value).length;
  }
  return ok;
}
const corsGet = (url) => fetch(url, { mode: "cors", credentials: "omit" });
function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(SAVED, new Date().toISOString());
  return response.blob().then((body) => new Response(body, { status: response.status, statusText: response.statusText, headers }));
}
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}
/* The network, but never longer than `ms` when a saved copy exists. */
function networkOr(request, ms, saved, onFresh) {
  const net = fetch(request).then((r) => { if (r.ok) onFresh(r.clone()); else if (saved && r.status >= 500) return saved; return r; });
  if (!saved) return net;
  const late = new Promise((resolve) => setTimeout(() => resolve(saved), ms));
  return Promise.race([net.catch(() => saved), late]);
}

/* ------------------------------------------------------------- install */
async function saveShell() {
  const cache = await caches.open(SHELL);
  return inBatches(FILES, 8, async (path) => {
    const r = await fetch(new Request(path, { cache: "reload" }));
    if (!r.ok) return false;
    await cache.put(new URL(path, self.registration.scope).href, r);
    return true;
  });
}
async function saveLibs() {
  const cache = await caches.open(LIBS);
  const get = async (url) => {
    if (await cache.match(url)) return true;
    const r = await corsGet(url);
    if (!r.ok) return false;
    await cache.put(url, r);
    return true;
  };
  const ok = await inBatches(LIB_URLS, 6, get);
  /* the font stylesheet names the font files this browser needs */
  try {
    const css = await corsGet(FONT_CSS);
    if (css.ok) {
      await cache.put(FONT_CSS, css.clone());
      const fonts = [...(await css.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
      await inBatches([...new Set(fonts)], 6, get);
    }
  } catch (_) { /* system fonts are used instead */ }
  return ok;
}
self.addEventListener("install", (event) => {
  event.waitUntil(Promise.allSettled([saveShell(), saveLibs()]).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("cooper-shell-") && name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});

/* --------------------------------------------------------------- fetch */
async function shellMatch(request) {
  const cache = await caches.open(SHELL);
  return (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true })) ||
    (request.mode === "navigate" ? cache.match(self.registration.scope) : undefined);
}
async function appFile(request) {
  const saved = await shellMatch(request);
  try {
    return await networkOr(request, 4000, saved, async (fresh) => (await caches.open(SHELL)).put(request, fresh));
  } catch (err) {
    if (saved) return saved;
    throw err;
  }
}
async function library(request) {
  const cache = await caches.open(LIBS);
  const saved = await cache.match(request.url);
  if (saved) return saved;
  const r = await corsGet(request.url);
  if (r.ok) cache.put(request.url, r.clone());
  return r;
}
async function fontCss(request) {
  const cache = await caches.open(LIBS);
  const saved = await cache.match(request.url);
  const net = corsGet(request.url).then((r) => { if (r.ok) cache.put(request.url, r.clone()); return r; });
  if (!saved) return net;
  net.catch(() => {});
  return saved;
}
/* One key per tile, whatever the mirror (a/b/c) or the NDVI date in the address. */
function tileKey(url) {
  const u = new URL(url);
  if (u.hostname.endsWith(".tile.openstreetmap.org")) u.hostname = "tile.openstreetmap.org";
  if (u.hostname === "gibs.earthdata.nasa.gov") u.pathname = u.pathname.replace(/\/default\/\d{4}-\d{2}-\d{2}\//, "/default/latest/");
  return u.href;
}
async function tile(request) {
  const url = new URL(request.url), key = tileKey(request.url);
  if (noCors.has(url.hostname)) return fetch(request);
  const cache = await caches.open(TILES);
  const saved = await cache.match(key);
  const fresh = async () => {
    let r;
    try { r = await corsGet(request.url); }
    catch (err) {
      if (self.navigator.onLine === false) throw err;
      noCors.add(url.hostname); // this server does not allow storing its tiles
      return fetch(request);
    }
    if (r.ok) { await cache.put(key, r.clone()); if (Math.random() < 0.02) trim(TILES, MAX_TILES); }
    return r;
  };
  if (url.hostname === "gibs.earthdata.nasa.gov") {
    if (!saved) return fresh();
    return Promise.race([fresh().catch(() => saved), new Promise((res) => setTimeout(() => res(saved), 5000))]);
  }
  return saved || fresh();
}
async function apiGet(request) {
  const cache = await caches.open(API);
  const saved = await cache.match(request.url);
  const store = async (fresh) => cache.put(request.url, await stamped(fresh));
  try { return await networkOr(request, 8000, saved, store); }
  catch (err) { if (saved) return saved; throw err; }
}
async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/* A comparison already made with exactly these settings can be shown again offline. */
async function analyze(request) {
  const key = new URL("__offline/analyze/" + (await sha(await request.clone().text())), self.registration.scope).href;
  const cache = await caches.open(API);
  try {
    const r = await fetch(request);
    if (r.ok) { await cache.put(key, await stamped(r.clone())); trimAnalyses(cache); }
    return r;
  } catch (err) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw err;
  }
}
async function trimAnalyses(cache) {
  const keys = (await cache.keys()).filter((k) => k.url.includes("/__offline/analyze/"));
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ANALYSES))) await cache.delete(k);
}

self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.method === "POST" && url.pathname.endsWith("/api/analyze")) return event.respondWith(analyze(request));
    if (request.method !== "GET" || request.headers.has("range")) return;
    if (/\/api\/(catalog|weather|soil)$/.test(url.pathname)) return event.respondWith(apiGet(request));
    if (/\/(api|health)(\/|$)/.test(url.pathname) || url.pathname.endsWith("/version.json")) return;
    return event.respondWith(appFile(request));
  }
  if (request.method !== "GET") return;
  if (LIB_HOSTS.has(url.hostname)) return event.respondWith(library(request));
  if (url.hostname === "fonts.googleapis.com") return event.respondWith(fontCss(request));
  if (isTileHost(url.hostname)) return event.respondWith(tile(request));
});

/* The page asks how much is saved (Settings → Offline use). */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "status") return;
  event.waitUntil((async () => {
    const count = async (name) => (await (await caches.open(name)).keys()).length;
    event.ports[0]?.postMessage({ build: BUILD, files: await count(SHELL), expected: FILES.length, libs: await count(LIBS), tiles: await count(TILES) });
  })());
});
