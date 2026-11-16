/* Cooper · 3D relief of the field (Three.js). The mesh is the real SRTM grid of the
 * analysis, vertically exaggerated, on a soil block; colours = RUSLE erosion classes. */
import * as THREE from "three";

const ORANGE = ["#f09a6e", "#e2622e", "#b0441a", "#73280c"];

function bicubicGrid(src, n, m) {
  // Catmull-Rom upsampling of an n×n grid to m×m.
  const at = (i, j) => src[Math.min(n - 1, Math.max(0, i)) * n + Math.min(n - 1, Math.max(0, j))];
  const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
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

function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (_) { return false; }
}

function mount(el, data, opts = {}) {
  if (!webglOk() || !data || !data.elev) { el.classList.add("flat"); return { destroy() {} }; }
  const dark = () => document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const hemi = new THREE.HemisphereLight(0xf4f1e6, 0x3a3226, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 9, 5);
  scene.add(hemi, sun);

  const n = data.n, M = 72, S = 6;
  const zs = bicubicGrid(data.elev, n, M);
  const ers = data.eros ? bicubicGrid(data.eros, n, M) : null;
  let zmin = Infinity, zmax = -Infinity;
  for (const v of zs) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
  const relief = Math.max(zmax - zmin, 1);
  const H = 1.25; // exaggerated height of the relief in scene units
  const geo = new THREE.PlaneGeometry(S, S, M - 1, M - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tol = data.tol || 7;
  const ramp = ORANGE.map((c) => new THREE.Color(c));
  const green = new THREE.Color("#6f9a45");
  for (let i = 0; i < pos.count; i++) {
    const h = ((zs[i] - zmin) / relief) * H + 0.35;
    pos.setY(i, h);
    let col = green.clone();
    if (ers) {
      const e = ers[i];
      const k = e < tol / 2 ? 0 : e < tol ? 1 : e < 2 * tol ? 2 : 3;
      col = ramp[k].clone().lerp(green, k === 0 ? 0.55 : 0.12);
    }
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false }));

  // Soil block under the terrain: strata on each side follow the surface profile.
  const block = new THREE.Group();
  const strata = ["#5b4632", "#6e5539", "#87684a", "#9b7c5a"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  const sideHeights = (getter) => Array.from({ length: M }, (_, k) => getter(k));
  const sides = [
    { h: sideHeights((k) => pos.getY(k)), x: (k) => -S / 2 + (k / (M - 1)) * S, z: () => -S / 2, flip: false },
    { h: sideHeights((k) => pos.getY((M - 1) * M + k)), x: (k) => -S / 2 + (k / (M - 1)) * S, z: () => S / 2, flip: true },
    { h: sideHeights((k) => pos.getY(k * M)), x: () => -S / 2, z: (k) => -S / 2 + (k / (M - 1)) * S, flip: true },
    { h: sideHeights((k) => pos.getY(k * M + M - 1)), x: () => S / 2, z: (k) => -S / 2 + (k / (M - 1)) * S, flip: false },
  ];
  const layers = [0, 0.1, 0.2, 0.28];
  for (const side of sides) {
    layers.forEach((y0, li) => {
      const y1 = li < layers.length - 1 ? layers[li + 1] : null;
      const verts = [];
      for (let k = 0; k < M - 1; k++) {
        const top0 = y1 ?? side.h[k], top1 = y1 ?? side.h[k + 1];
        const a = [side.x(k), y0, side.z(k)], b = [side.x(k + 1), y0, side.z(k + 1)];
        const c = [side.x(k + 1), top1, side.z(k + 1)], d = [side.x(k), top0, side.z(k)];
        verts.push(...(side.flip ? [...a, ...c, ...b, ...a, ...d, ...c] : [...a, ...b, ...c, ...a, ...c, ...d]));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.computeVertexNormals();
      block.add(new THREE.Mesh(g, strata[li]));
    });
  }
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(Math.PI / 2), strata[0]);
  block.add(bottom);
  const field = new THREE.Group();
  field.add(top, block);
  scene.add(field);

  // Contact shadow: a soft ellipse below the block (drawn once on a canvas).
  const sc = document.createElement("canvas"); sc.width = sc.height = 128;
  const sx = sc.getContext("2d"); sx.filter = "blur(10px)"; sx.fillStyle = "rgba(0,0,0,.45)";
  sx.beginPath(); sx.ellipse(64, 64, 44, 44, 0, 0, Math.PI * 2); sx.fill();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(S * 1.7, S * 1.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.position.y = -0.02;
  scene.add(shadow);

  camera.position.set(8.4, 6.6, 8.4);
  camera.lookAt(0, 0.5, 0);

  let raf = 0, visible = true, t0 = performance.now(), angle = 0.6;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
  function size() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.position.setLength(w / h < 1.2 ? 22 : w / h > 2.2 ? 15.5 : 17.5);
    camera.updateProjectionMatrix();
  }
  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
    if (opts.spin && !reduce) angle += dt * 0.12;
    field.rotation.y = angle; shadow.rotation.y = angle;
    hemi.intensity = dark() ? 0.85 : 1.2;
    renderer.render(scene, camera);
    if (visible && opts.spin && !reduce) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const ro = new ResizeObserver(() => { size(); kick(); });
  ro.observe(el);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible) kick(); });
  io.observe(el);
  const onVis = () => { visible = !document.hidden; if (visible) kick(); };
  document.addEventListener("visibilitychange", onVis);
  size(); kick();
  // Entrance: the block rises into place.
  if (!reduce) {
    field.position.y = -1.2; field.scale.setScalar(0.85);
    const start = performance.now();
    const rise = (t) => {
      const k = Math.min(1, (t - start) / 1400), e = 1 - Math.pow(1 - k, 4);
      field.position.y = -1.2 * (1 - e); field.scale.setScalar(0.85 + 0.15 * e);
      if (!opts.spin) kick();
      if (k < 1) requestAnimationFrame(rise);
    };
    requestAnimationFrame(rise);
  }
  return {
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); });
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}

window.CooperRelief = { mount };
window.Cooper?.emit?.("relief-ready");
