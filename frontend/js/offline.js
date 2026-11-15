/* Cooper · offline use. Registers the service worker (sw.js), shows when the device has no
 * connection, and prepares the farmer's fields in advance: weather, soil and the map tiles
 * around each field are requested once while online, and the service worker keeps them.
 * Analyses and fields were already stored on the device (IndexedDB / localStorage). */
(function () {
  "use strict";
  const C = window.Cooper;
  const { $, esc, fmt, icon } = C;

  const supported = "serviceWorker" in navigator;
  const online = () => navigator.onLine !== false;
  const state = { busy: false, done: 0, total: 0 };

  if (supported) navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works online */ });

  /* ------------------------------------------------------------ map tiles */
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  /* Satellite, street map and NDVI. The land-cover server does not allow its tiles to be stored. */
  const LAYERS = [
    { zooms: [12, 13, 14, 15, 16, 17], padX: 3, padY: 2, max: 160,
      url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` },
    { zooms: [12, 13, 14, 15, 16], padX: 2, padY: 1, max: 60,
      url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
    { zooms: [7, 8, 9], padX: 1, padY: 1, max: 20,
      url: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${new Date(Date.now() - 16 * 864e5).toISOString().slice(0, 10)}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png` },
  ];
  /* The tiles a map centred on the field shows at each zoom: the field plus a few around it. */
  function fieldTiles(f) {
    const [[s, w], [n, e]] = C.fieldBounds(f.lat, f.lon, f.area_ha);
    const urls = [];
    for (const layer of LAYERS) for (const z of layer.zooms) {
      const x0 = lon2x(w, z) - layer.padX, x1 = lon2x(e, z) + layer.padX, y0 = lat2y(n, z) - layer.padY, y1 = lat2y(s, z) + layer.padY;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > layer.max) continue; // too large an area at this zoom
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(layer.url(z, x, y));
    }
    return urls;
  }

  /* -------------------------------------------------------------- prepare */
  function controlled() {
    if (navigator.serviceWorker.controller) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(!!navigator.serviceWorker.controller), 8000);
      navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(t); resolve(true); }, { once: true });
    });
  }
  async function prepare() {
    if (state.busy) return;
    if (!supported) { C.toast(C.t("This browser can't save Cooper for offline use."), "error"); return; }
    if (!online()) { C.toast(C.t("Connect to the internet to prepare your fields."), "info"); return; }
    state.busy = true; state.done = 0; state.total = 0;
    render();
    try {
      await navigator.serviceWorker.ready;
      if (!(await controlled())) throw new Error("no service worker");
      try { await navigator.storage?.persist?.(); } catch (_) { /* best effort */ }
      const fields = C.fields.list();
      const local = ["api/catalog"];
      for (const f of fields) local.push(`api/weather?lat=${f.lat}&lon=${f.lon}`, `api/soil?lat=${f.lat}&lon=${f.lon}`);
      const jobs = local.map((u) => () => fetch("/" + u, { signal: AbortSignal.timeout(40000) }).then((r) => r.ok));
      for (const url of new Set(fields.flatMap(fieldTiles)))
        jobs.push(() => fetch(url, { mode: "no-cors", credentials: "omit", signal: AbortSignal.timeout(20000) }).then(() => true));
      state.total = jobs.length;
      let failed = 0, next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          try { if (!(await job())) failed++; } catch (_) { failed++; }
          state.done++;
          paintProgress();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      C.storage.set("cooper-offline", { at: new Date().toISOString(), fields: fields.map((f) => f.id), failed, total: jobs.length });
      C.toast(failed > jobs.length / 4
        ? C.t("Some map images could not be saved. Try again with a better connection.")
        : C.t("Your fields are ready to use without a connection."), failed > jobs.length / 4 ? "info" : "ok", 5200);
    } catch (_) {
      C.toast(C.t("Could not prepare offline use. Reload the page and try again."), "error");
    } finally {
      state.busy = false;
      render();
    }
  }

  /* --------------------------------------------------------------- status */
  function swStatus() {
    return new Promise((resolve) => {
      const sw = supported && navigator.serviceWorker.controller;
      if (!sw) return resolve(null);
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 2500);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      sw.postMessage({ type: "status" }, [ch.port2]);
    });
  }
  function paintProgress() {
    const bar = $("#off-bar"), txt = $("#off-progress");
    if (!bar || !state.total) return;
    bar.style.setProperty("--p", `${Math.round((state.done / state.total) * 100)}%`);
    txt.textContent = `${C.t("Saving")} ${fmt(state.done)} / ${fmt(state.total)}`;
  }
  async function render() {
    const box = $("#off-status");
    if (!box) return;
    const btn = $("#off-prepare"), wrap = $("#off-progress-wrap");
    wrap.hidden = !state.busy;
    btn.disabled = state.busy || !supported || !online();
    btn.querySelector("span").textContent = C.t(state.busy ? "Preparing…" : "Prepare my fields for offline use");
    if (state.busy) { paintProgress(); return; }
    if (!supported) { box.innerHTML = row("alert", "This browser can't save Cooper for offline use.", "Open Cooper in an up-to-date browser, over a secure connection (https)."); return; }
    const [sw, drafts] = await Promise.all([swStatus(), C.db.all("drafts").catch(() => [])]);
    const prep = C.storage.get("cooper-offline", null);
    const fields = C.fields.list();
    const analysed = new Set(drafts.filter((d) => d.result).map((d) => d.fieldId));
    const appReady = sw && sw.files >= sw.expected && sw.libs >= 10;
    const rows = [
      online() ? row("check", "You are online.", "") : row("alert", "You are offline.", "Cooper is showing what is saved on this device."),
      !sw ? row("info", "Cooper is being saved on this device…", "Reload the page once to finish.")
        : appReady ? row("check", "The app opens without a connection.", `${fmt(sw.files)} ${C.t("app files")} · ${fmt(sw.tiles)} ${C.t("map images saved")}`)
          : row("info", "Cooper is being saved on this device…", `${fmt(sw.files)} / ${fmt(sw.expected)} ${C.t("app files")}`),
    ];
    box.innerHTML = rows.join("") + `<ul class="off-fields">${fields.map((f) => {
      const ready = prep?.fields?.includes(f.id), has = analysed.has(f.id);
      return `<li><strong class="notranslate">${esc(f.nombre)}</strong>
        <span class="off-tag ${has ? "ok" : "warn"}">${has ? "Analysis saved" : "No analysis yet: run one while online"}</span>
        <span class="off-tag ${ready ? "ok" : "warn"}">${ready ? "Maps, weather and soil saved" : "Maps not prepared yet"}</span></li>`;
    }).join("")}</ul>${prep ? `<p class="hint">${esc(C.t("Last prepared:"))} ${esc(C.dateLabel(prep.at))}</p>` : ""}`;
  }
  const row = (ic, title, detail) => `<p class="off-row">${icon(ic)}<span><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}</span></p>`;

  /* ----------------------------------------------------------- connection */
  function paintConnection(announce) {
    const off = !online();
    document.documentElement.classList.toggle("is-offline", off);
    const chip = $("#offline-chip");
    if (chip) chip.hidden = !off;
    if (announce) C.toast(C.t(off ? "You're offline. Cooper keeps working with what is saved on this device." : "Back online."), "info", off ? 5200 : 2400);
    render();
  }
  window.addEventListener("online", () => paintConnection(true));
  window.addEventListener("offline", () => paintConnection(true));
  window.addEventListener("hashchange", () => { if (location.hash.includes("settings")) render(); });
  window.addEventListener("cooper-language", () => render());
  if (supported) navigator.serviceWorker.addEventListener("controllerchange", () => render());
  C.listen("fields", () => render());
  document.addEventListener("click", (e) => { if (e.target.closest("#off-prepare")) prepare(); });

  C.offline = { online, prepare, fieldTiles, render };
  paintConnection(false);
})();
