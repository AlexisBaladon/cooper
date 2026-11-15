/* Cooper · 3D view of any map. The field's real SRTM terrain (from the analysis) carries the
 * texture of the map the farmer was looking at: satellite, vegetation (NDVI), erosion,
 * wetness, slope, low spots, land cover or street map. Rotate, zoom, pan, exaggerate the
 * relief, pin notes on the ground and read elevation, slope and erosion under the pointer. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const C = window.Cooper;
const { $, $$, esc, fmt } = C;
const S = 10;     // side of the field in scene units
const M = 128;    // mesh resolution

const LAYERS = {
  satellite: { label: "Satellite", base: "sat" },
  ndvi: { label: "Vegetation (NDVI)", base: "sat", over: "ndvi" },
  erosion: { label: "Erosion", base: "sat", zone: "erosion" },
  humedad: { label: "Relative wetness", base: "sat", zone: "humedad" },
  pendiente: { label: "Slope", base: "sat", zone: "pendiente" },
  bajos: { label: "Low spots", base: "sat", zone: "bajos" },
  crop: { label: "Land cover", base: "sat", over: "worldcover" },
  map: { label: "Street map", base: "osm" },
};
const TILE = {
  sat: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  ndvi: (z, x, y) => { const d = new Date(Date.now() - 16 * 864e5).toISOString().slice(0, 10); return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${d}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png`; },
  worldcover: (z, x, y) => `https://services.terrascope.be/wmts/v2?layer=WORLDCOVER_2021_MAP&style=&tilematrixset=EPSG:3857&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=EPSG:3857:${z}&TileCol=${x}&TileRow=${y}`,
};
const MAXZ = { sat: 17, osm: 18, ndvi: 9, worldcover: 15 };

/* ------------------------------------------------------------- geometry */
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
function bicubic(src, n, m) {
  const at = (i, j) => src[Math.min(n - 1, Math.max(0, i)) * n + Math.min(n - 1, Math.max(0, j))];
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) {
    const fy = (y / (m - 1)) * (n - 1), iy = Math.floor(fy), ty = fy - iy;
    for (let x = 0; x < m; x++) {
      const fx = (x / (m - 1)) * (n - 1), ix = Math.floor(fx), tx = fx - ix;
      const rows = [-1, 0, 1, 2].map((d) => cr(at(iy + d, ix - 1), at(iy + d, ix), at(iy + d, ix + 1), at(iy + d, ix + 2), tx));
      out[y * m + x] = cr(rows[0], rows[1], rows[2], rows[3], ty);
    }
  }
  return out;
}

/* ------------------------------------------------------------- textures */
function loadImg(url) {
  return new Promise((res) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}
/* Stitches web-map tiles covering the bounds into a square canvas (north up). */
async function tiles(kind, bounds, size = 1024) {
  const [[s, w], [n, e]] = bounds;
  const span = Math.max(e - w, 1e-6);
  let z = Math.round(Math.log2((size * 360) / (span * 256)));
  z = Math.max(3, Math.min(MAXZ[kind], z));
  const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z);
  const tx0 = Math.floor(x0), tx1 = Math.floor(x1), ty0 = Math.floor(y0), ty1 = Math.floor(y1);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 36) return null;
  const work = document.createElement("canvas");
  work.width = (tx1 - tx0 + 1) * 256; work.height = (ty1 - ty0 + 1) * 256;
  const wc = work.getContext("2d");
  let ok = 0;
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    jobs.push(loadImg(TILE[kind](z, tx, ty)).then((im) => { if (im) { wc.drawImage(im, (tx - tx0) * 256, (ty - ty0) * 256); ok++; } }));
  }
  await Promise.all(jobs);
  if (!ok) return null;
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const oc = out.getContext("2d");
  oc.imageSmoothingQuality = "high";
  oc.drawImage(work, (x0 - tx0) * 256, (y0 - ty0) * 256, (x1 - x0) * 256, (y1 - y0) * 256, 0, 0, size, size);
  try { oc.getImageData(0, 0, 1, 1); } catch (_) { return null; } // tainted: not usable in WebGL
  return out;
}
async function texture(layer, ctx) {
  const L = LAYERS[layer], size = 1024;
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const g = cv.getContext("2d");
  g.fillStyle = "#6f8a52"; g.fillRect(0, 0, size, size);
  let real = false;
  const base = await tiles(L.base, ctx.bounds, size);
  if (base) { g.drawImage(base, 0, 0); real = true; }
  if (L.over) {
    const ov = await tiles(L.over, ctx.bounds, size);
    if (ov) { g.globalAlpha = 0.78; g.imageSmoothingEnabled = true; g.drawImage(ov, 0, 0); g.globalAlpha = 1; }
  }
  if (L.zone && ctx.zonas) {
    const z = C.results.zoneRaster(ctx.zonas, L.zone, ctx.rot, 512, false);
    g.globalAlpha = 0.85; g.drawImage(z, 0, 0, size, size); g.globalAlpha = 1;
  }
  // A thin fence line marks the field edge.
  g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 5; g.strokeRect(3, 3, size - 6, size - 6);
  return { canvas: cv, real };
}

/* --------------------------------------------------------------- viewer */
let current = null;

async function open({ field, rec, layer = "satellite", originEl = null, rot = null } = {}) {
  if (current) current.close(true);
  const zonas = rec?.result?.zonas || null;
  const bounds = zonas?.bounds || C.fieldBounds(field.lat, field.lon, field.area_ha);
  const rotId = rot || rec?.result?.rotaciones?.[0]?.id;
  const ranking = rec?.result?.ranking || rec?.result?.rotaciones || [];
  const pinKey = "cooper-pins:" + field.id;
  const ctx = { bounds, zonas, rot: rotId };

  const wrap = document.createElement("div");
  wrap.className = "m3d-wrap";
  wrap.innerHTML = `<div class="m3d" role="dialog" aria-modal="true" aria-label="3D view of the field">
    <header class="m3d-head">
      <div class="m3d-title"><img class="ic i3d" src="assets/icons/field.webp" alt=""><div><strong class="notranslate">${esc(field.nombre)}</strong>
        <small>${zonas ? `${C.t("Real NASA SRTM terrain")} · ${fmt(zonas.area_ha)} ha` : C.t("Flat preview: run an analysis to model the real terrain")}</small></div></div>
      <div class="m3d-layers seg" role="group" aria-label="Map layer">${Object.entries(LAYERS).filter(([k, l]) => !l.zone || zonas).map(([k, l]) =>
        `<button type="button" data-layer="${k}" aria-pressed="${k === layer}">${esc(C.t(l.label))}</button>`).join("")}</div>
      <button type="button" class="icon-btn m3d-close" aria-label="Close">${C.line("close")}</button>
    </header>
    <div class="m3d-stage">
      <canvas class="m3d-canvas"></canvas>
      <div class="m3d-pins" aria-hidden="true"></div>
      <div class="m3d-loading"><div class="ld-orbit"><img src="assets/icons/satellite.webp" alt=""><i></i><i></i></div><span>${C.t("Building the 3D model…")}</span></div>
      <div class="m3d-read" hidden></div>
      <div class="m3d-hint">${C.t("Drag to rotate · scroll to zoom · right-drag to move · double-click to pin a note")}</div>
    </div>
    <aside class="m3d-side">
      <label class="range"><span>${C.t("Relief exaggeration")} <strong class="ex-val">×3</strong></span><input type="range" class="m3d-ex" min="1" max="8" step="0.5" value="3"></label>
      ${zonas && ranking.length ? `<label class="field">${C.t("Rotation for erosion")}<select class="m3d-rot">${ranking.map((r) => `<option value="${esc(r.id)}" ${r.id === rotId ? "selected" : ""}>${esc(r.nombre)}</option>`).join("")}</select></label>` : ""}
      <div class="btn-row">
        <button type="button" class="btn soft sm" data-m3d="spin" aria-pressed="true">${C.line("history")}<span>${C.t("Auto-rotate")}</span></button>
        <button type="button" class="btn soft sm" data-m3d="reset">${C.line("expand")}<span>${C.t("Reset view")}</span></button>
        <button type="button" class="btn soft sm" data-m3d="shot">${C.line("download")}<span>${C.t("Save image")}</span></button>
      </div>
      <h3>${C.t("Notes on the ground")}</h3>
      <ol class="m3d-pinlist"></ol>
      <p class="hint m3d-src"></p>
    </aside>
  </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("has-dialog");
  const box = $(".m3d", wrap), stage = $(".m3d-stage", wrap), canvas = $(".m3d-canvas", wrap);
  const g = C.motion.gsap;
  const from = originEl?.getBoundingClientRect?.();
  if (g) {
    g.fromTo(wrap, { backgroundColor: "rgba(3,8,6,0)", backdropFilter: "blur(0px)" }, { backgroundColor: "rgba(3,8,6,.66)", backdropFilter: "blur(16px)", duration: 0.6 });
    if (from?.width) {
      const to = box.getBoundingClientRect();
      g.fromTo(box, { x: from.left - to.left, y: from.top - to.top, scaleX: from.width / to.width, scaleY: from.height / to.height, transformOrigin: "0 0", borderRadius: 20 },
        { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.9, ease: "expo.inOut" });
    } else g.fromTo(box, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.6, ease: "expo.out" });
  }

  /* ------------------------------------------------ scene */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = C.scene?.current === "noche" ? 1.25 : 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const night = C.scene?.current === "noche", dusk = C.scene?.current === "tarde";
  const sky = new THREE.Color(night ? "#1a2448" : dusk ? "#e9a27a" : "#a9c9e8");
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 34, 80);
  let alive = true;
  // The same photograph as the app's sky sits behind the model.
  new THREE.TextureLoader().load((C.scene?.SCENES?.[C.scene.current] || C.scene?.SCENES?.lindo)?.img || "", (t) => { t.colorSpace = THREE.SRGBColorSpace; if (alive) scene.background = t; });
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const home = new THREE.Vector3(11, 9.5, 11);
  camera.position.copy(home);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 5; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI * 0.47;
  controls.target.set(0, 0.6, 0);
  controls.autoRotate = !C.reducedMotion(); controls.autoRotateSpeed = 0.6;
  const hemi = new THREE.HemisphereLight(night ? 0x9fb2e6 : 0xdfe9f5, 0x4a3b2a, night ? 1.15 : 0.95);
  const sun = new THREE.DirectionalLight(night ? 0xc8d6ff : dusk ? 0xffb37a : 0xfff4e0, night ? 1.6 : 2.4);
  sun.position.set(dusk ? -14 : -9, dusk ? 5 : 14, 7);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 50 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun);

  // Ground around the field: soft grass disc that fades into the fog.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: night ? 0x1d2a1c : 0x56703f, roughness: 1 }));
  ground.position.y = -0.62; ground.receiveShadow = true; scene.add(ground);
  ground.material.transparent = true; ground.material.opacity = 0.9;

  /* ------------------------------------------------ terrain */
  const n = zonas ? Math.round(Math.sqrt(zonas.celdas.length)) : 0;
  const zs = zonas ? bicubic(zonas.celdas.map((c) => c.elev), n, M) : new Float32Array(M * M);
  let zmin = Infinity, zmax = -Infinity;
  for (const v of zs) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
  const relief = Math.max(zmax - zmin, 0.01);
  const sideM = zonas ? zonas.celda_m * n : Math.sqrt(field.area_ha * 1e4);
  const geo = new THREE.PlaneGeometry(S, S, M - 1, M - 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.castShadow = true; terrain.receiveShadow = true;
  const block = new THREE.Group();
  const field3d = new THREE.Group();
  field3d.add(terrain, block);
  scene.add(field3d);
  const strata = ["#4e3b2a", "#64492f", "#7d5f41", "#977652"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  let ex = 3;
  function heights() {
    const pos = geo.attributes.position;
    // Real proportions times the exaggeration (true scale would look flat on a field this size).
    const k = (S / sideM) * ex;
    for (let i = 0; i < pos.count; i++) pos.setY(i, (zs[i] - zmin) * k + 0.5);
    pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    block.children.forEach((m) => { m.geometry.dispose(); }); block.clear();
    const edges = [
      { h: (q) => pos.getY(q), x: (q) => -S / 2 + (q / (M - 1)) * S, z: () => -S / 2, flip: false },
      { h: (q) => pos.getY((M - 1) * M + q), x: (q) => -S / 2 + (q / (M - 1)) * S, z: () => S / 2, flip: true },
      { h: (q) => pos.getY(q * M), x: () => -S / 2, z: (q) => -S / 2 + (q / (M - 1)) * S, flip: true },
      { h: (q) => pos.getY(q * M + M - 1), x: () => S / 2, z: (q) => -S / 2 + (q / (M - 1)) * S, flip: false },
    ];
    const layers = [-0.6, -0.3, 0.05, 0.3];
    for (const e of edges) layers.forEach((y0, li) => {
      const y1 = li < layers.length - 1 ? layers[li + 1] : null;
      const v = [];
      for (let q = 0; q < M - 1; q++) {
        const t0 = y1 ?? e.h(q), t1 = y1 ?? e.h(q + 1);
        const a = [e.x(q), y0, e.z(q)], b = [e.x(q + 1), y0, e.z(q + 1)], c = [e.x(q + 1), t1, e.z(q + 1)], d = [e.x(q), t0, e.z(q)];
        v.push(...(e.flip ? [...a, ...c, ...b, ...a, ...d, ...c] : [...a, ...b, ...c, ...a, ...c, ...d]));
      }
      const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); bg.computeVertexNormals();
      const m = new THREE.Mesh(bg, strata[li]); m.castShadow = true; block.add(m);
    });
    placePins();
  }

  /* ------------------------------------------------ layers */
  let texReq = 0;
  async function setLayer(name) {
    layer = name;
    $$(".m3d-layers button", wrap).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === name)));
    const my = ++texReq;
    $(".m3d-loading", wrap).hidden = false;
    const t = await texture(name, ctx);
    if (my !== texReq || !alive) return;
    const tex = new THREE.CanvasTexture(t.canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const old = mat.map; mat.map = tex; mat.needsUpdate = true; old?.dispose();
    $(".m3d-loading", wrap).hidden = true;
    $(".m3d-src", wrap).textContent = t.real ? `${C.t("Imagery")}: ${C.t(LAYERS[name].label)}${LAYERS[name].base === "sat" ? " · Esri World Imagery" : " · © OpenStreetMap"}` : C.t("Imagery unavailable here; the colours show the layer only.");
  }

  /* ------------------------------------------------ pins */
  let pins = C.storage.get(pinKey, []);
  const pinLayer = $(".m3d-pins", wrap);
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  function surfaceAt(u, v) {
    const col = Math.round(u * (M - 1)), row = Math.round((1 - v) * (M - 1));
    const y = geo.attributes.position.getY(row * M + col);
    return new THREE.Vector3(-S / 2 + u * S, y, -S / 2 + (1 - v) * S);
  }
  function placePins() {
    pinLayer.innerHTML = pins.map((p, i) => `<div class="m3d-pin" data-i="${i}"><i></i><span>${esc(p.text || C.t("Note"))}</span></div>`).join("");
    $(".m3d-pinlist", wrap).innerHTML = pins.length ? pins.map((p, i) => `<li><input value="${esc(p.text)}" data-i="${i}" maxlength="80" placeholder="${esc(C.t("Write a note"))}" aria-label="${esc(C.t("Note"))} ${i + 1}">
      <button type="button" class="icon-btn danger" data-del="${i}" aria-label="${esc(C.t("Delete note"))}">${C.line("trash")}</button></li>`).join("") : `<li class="hint">${C.t("Double-click the terrain to pin a note, such as a wet corner or a gully.")}</li>`;
  }
  const savePins = () => C.storage.set(pinKey, pins);
  $(".m3d-pinlist", wrap).addEventListener("input", (e) => { const i = e.target.dataset.i; if (i == null) return; pins[i].text = e.target.value; savePins(); const lab = pinLayer.querySelector(`[data-i="${i}"] span`); if (lab) lab.textContent = e.target.value || C.t("Note"); });
  $(".m3d-pinlist", wrap).addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (!d) return; pins.splice(Number(d.dataset.del), 1); savePins(); placePins(); });

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObject(terrain)[0] || null;
  }
  canvas.addEventListener("dblclick", (e) => {
    const h = hit(e); if (!h) return;
    pins.push({ u: h.uv.x, v: h.uv.y, text: "" });
    savePins(); placePins();
    const inp = $(`.m3d-pinlist input[data-i="${pins.length - 1}"]`, wrap); inp?.focus();
    const el = pinLayer.lastElementChild;
    if (g && el) g.fromTo(el, { scale: 0, y: -30 }, { scale: 1, y: 0, duration: 0.7, ease: "bounce.out" });
  });
  const read = $(".m3d-read", wrap);
  canvas.addEventListener("pointermove", (e) => {
    const h = hit(e);
    if (!h) { read.hidden = true; return; }
    const u = h.uv.x, v = h.uv.y;
    let html = `<strong>${fmt(u * sideM, 0)} m E · ${fmt((1 - v) * sideM, 0)} m S</strong>`;
    if (zonas) {
      const col = Math.min(n - 1, Math.floor(u * n)), row = Math.min(n - 1, Math.floor((1 - v) * n)), ci = row * n + col, c = zonas.celdas[ci];
      const er = C.results.erosionOf(zonas, c, ci, ctx.rot);
      html += `<span>${C.t("Elevation")} <b>${fmt(c.elev, 1)} m</b></span><span>${C.t("Slope")} <b>${fmt(c.pend, 1)}%</b></span>
        <span>${C.t("Erosion")} <b>${fmt(er, 1)} t/ha</b></span><span>${C.t(["Dries out first", "Intermediate", "Collects water"][c.hum])}${c.bajo ? " · " + C.t("Low spot") : ""}</span>`;
    }
    read.innerHTML = html; read.hidden = false;
    read.style.left = Math.min(stage.clientWidth - 220, e.clientX - stage.getBoundingClientRect().left + 16) + "px";
    read.style.top = (e.clientY - stage.getBoundingClientRect().top + 16) + "px";
  });
  canvas.addEventListener("pointerleave", () => { read.hidden = true; });
  canvas.addEventListener("pointerdown", () => { controls.autoRotate = false; $('[data-m3d="spin"]', wrap).setAttribute("aria-pressed", "false"); });

  /* ------------------------------------------------ controls */
  $(".m3d-layers", wrap).addEventListener("click", (e) => { const b = e.target.closest("[data-layer]"); if (b) setLayer(b.dataset.layer); });
  const exIn = $(".m3d-ex", wrap);
  exIn.addEventListener("input", () => { ex = Number(exIn.value); $(".ex-val", wrap).textContent = "×" + ex; exIn.style.setProperty("--p", ((ex - 1) / 7) * 100 + "%"); heights(); });
  exIn.style.setProperty("--p", ((ex - 1) / 7) * 100 + "%");
  $(".m3d-rot", wrap)?.addEventListener("change", (e) => { ctx.rot = e.target.value; if (LAYERS[layer].zone) setLayer(layer); });
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-m3d]");
    if (e.target === wrap || e.target.closest(".m3d-close")) return close();
    if (!b) return;
    if (b.dataset.m3d === "spin") { controls.autoRotate = !controls.autoRotate; b.setAttribute("aria-pressed", String(controls.autoRotate)); }
    if (b.dataset.m3d === "reset") { g ? g.to(camera.position, { x: home.x, y: home.y, z: home.z, duration: 1.2, ease: "expo.inOut" }) : camera.position.copy(home); controls.target.set(0, 0.6, 0); }
    if (b.dataset.m3d === "shot") { renderer.render(scene, camera); const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = `cooper-3d-${Date.now()}.png`; a.click(); }
  });
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.target.matches("input")) close(); });

  /* ------------------------------------------------ loop */
  let raf = 0;
  const tmp = new THREE.Vector3();
  function size() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(size); ro.observe(stage);
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    controls.update();
    renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    pins.forEach((p, i) => {
      const el = pinLayer.children[i]; if (!el) return;
      tmp.copy(surfaceAt(p.u, p.v)); tmp.y += 0.05; tmp.project(camera);
      el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
      el.style.opacity = tmp.z < 1 ? "1" : "0";
    });
  }
  size(); heights(); frame();
  // Entrance: the field rises out of the ground.
  if (g) { field3d.position.y = -2.4; field3d.scale.setScalar(0.8); g.to(field3d.position, { y: 0, duration: 1.6, ease: "expo.out", delay: 0.35 }); g.to(field3d.scale, { x: 1, y: 1, z: 1, duration: 1.6, ease: "expo.out", delay: 0.35 }); }
  await setLayer(layer);
  setTimeout(() => $(".m3d-close", wrap)?.focus(), 60);

  function close(immediate = false) {
    if (!alive) return;
    const done = () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); });
      renderer.dispose(); wrap.remove(); current = null;
      if (!$(".dlg-wrap, .focus-wrap, .m3d-wrap")) document.body.classList.remove("has-dialog");
      originEl?.focus?.({ preventScroll: true });
    };
    if (immediate || !g) return done();
    g.to(box, { opacity: 0, scale: 0.96, duration: 0.3, ease: "power2.in" });
    g.to(wrap, { backgroundColor: "rgba(3,8,6,0)", backdropFilter: "blur(0px)", duration: 0.35, onComplete: done });
  }
  current = { close };
}

window.CooperMap3D = { open, LAYERS };
C.emit?.("map3d-ready");
