// Librería de visuales 3D que el modelo puede elegir mientras habla.
// Todo se arma por código (sin modelos externos) con el mismo estilo holográfico del núcleo.
// Cada visual: build(spec) -> { group, update(t, dt) }, con t = segundos desde que apareció.
// Para animar la opacidad, los update cambian material.userData.base (el escenario
// la multiplica por el fundido de entrada/salida en cada cuadro).
//
// Los ids y parámetros tienen que coincidir con VISUALS en backend/app/jarvis.py.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
const dummy = new THREE.Object3D();

/* ------------------------------------------------------------ helpers */
const DOT = (() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

const mesh = (geo, color, opacity = 0.5) =>
  new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, opacity, side: THREE.DoubleSide, ...ADD }));
const lines = (geo, color, opacity = 0.8) =>
  new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, opacity, ...ADD }));
const edges = (geo, color, opacity = 0.8) => lines(new THREE.EdgesGeometry(geo), color, opacity);
function line(pts, color, opacity = 0.8, loop = false) {
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new (loop ? THREE.LineLoop : THREE.Line)(geo, new THREE.LineBasicMaterial({ color, opacity, ...ADD }));
}
function segs(arr) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}
function points(arr, color, size, opacity = 0.85) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: DOT, opacity, ...ADD }));
}
function glow(color, size, opacity = 0.5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color, opacity, ...ADD }));
  s.scale.setScalar(size);
  return s;
}
const circle = (r, n = 96) => Array.from({ length: n }, (_, i) => V(Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r));

// Texto como sprite (siempre mira a la cámara).
function text(str, color, height = 0.2) {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  const font = '600 48px Consolas, "Cascadia Mono", monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(str).width) + 28;
  cv.width = w; cv.height = 64;
  ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
  ctx.fillText(str, w / 2, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }));
  s.scale.set((height * w) / 64, height, 1);
  return s;
}
const monthInitials = (lang = "") => (lang.startsWith("es") ? "EFMAMJJASOND" : "JFMAMJJASOND").split("");
const fmt = (v, lang) => new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 }).format(v);
const merge = (geos) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));

/* ----------------------------------------------- plantas y datos de campo */
// Cultivos de Cooper (data/crops.json) → forma de planta de esta librería.
export const CROP_KIND = {
  soja: "soy", soja2: "soy", vicia: "soy", colza: "soy", maiz: "corn", sorgo: "corn",
  trigo: "wheat", cebada: "wheat", avena_negra: "pasture", raigras: "pasture", pradera: "pasture",
};
export const KIND_COLOR = { wheat: "#ffd36b", corn: "#a6ff6b", soy: "#7dffa0", pasture: "#6bff8f" };
export const cropColor = (id) => KIND_COLOR[CROP_KIND[id] || "pasture"];

function plantGeo(kind) {
  const box = (w, h, d, x = 0, y = 0, rz = 0) => { const b = new THREE.BoxGeometry(w, h, d); b.rotateZ(rz); b.translate(x, y, 0); return b; };
  const ico = (r, x, y, z) => { const b = new THREE.IcosahedronGeometry(r, 0); b.translate(x, y, z); return b; };
  return merge({
    wheat: [box(0.014, 0.5, 0.014, 0, 0.25), box(0.045, 0.16, 0.045, 0, 0.56)],
    corn: [box(0.02, 0.8, 0.02, 0, 0.4), box(0.22, 0.012, 0.04, 0.09, 0.4, 0.5), box(0.22, 0.012, 0.04, -0.09, 0.56, -0.5), box(0.05, 0.15, 0.05, 0.03, 0.64)],
    soy: [box(0.012, 0.12, 0.012, 0, 0.06), ico(0.09, 0, 0.14, 0), ico(0.07, 0.07, 0.09, 0.03), ico(0.06, -0.06, 0.1, -0.03)],
    pasture: [box(0.012, 0.16, 0.012, 0, 0.08, 0.15), box(0.012, 0.13, 0.012, 0.02, 0.065, -0.3), box(0.012, 0.11, 0.012, -0.02, 0.055, 0.4)],
  }[kind]);
}

// Grilla n×n (fila 0 = norte), interpolada en coordenadas de celda.
function bilinear(grid, n, fx, fy) {
  const x = clamp(fx, 0, n - 1), y = clamp(fy, 0, n - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  return (grid[y0 * n + x0] * (1 - tx) + grid[y0 * n + x1] * tx) * (1 - ty)
       + (grid[y1 * n + x0] * (1 - tx) + grid[y1 * n + x1] * tx) * ty;
}

// Erosión relativa a la tolerancia (1 = en el límite): verde → amarillo → naranja → rojo.
const EROSION_STOPS = [[0, "#3dffc2"], [0.5, "#b8f27a"], [1, "#ffe066"], [2, "#ff8c42"], [3, "#ff3b3b"]]
  .map(([t, hex]) => [t, new THREE.Color(hex)]);
function erosionColor(ratio, out = new THREE.Color()) {
  const r = clamp(ratio, 0, 3);
  for (let i = 1; i < EROSION_STOPS.length; i++) {
    const [t0, c0] = EROSION_STOPS[i - 1], [t1, c1] = EROSION_STOPS[i];
    if (r <= t1) return out.copy(c0).lerp(c1, (r - t0) / (t1 - t0));
  }
  return out.copy(EROSION_STOPS.at(-1)[1]);
}

/* ============================================================ visuales */
export const VISUALS = {
  /* ---------------------------------------------------------- sol */
  sun: { color: "#ffc857", build: ({ color: c }) => {
    const g = new THREE.Group();
    const ball = mesh(new THREE.IcosahedronGeometry(0.62, 4), c, 0.1);
    const wire = lines(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.66, 1)), c, 0.55);
    const halo = glow(c, 2.2, 0.16);
    const v = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, r1 = i % 2 ? 1.22 : 1.6;
      v.push(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    const rays = lines(segs(v), c, 0.85);
    const orbit = line(circle(1.85, 128), c, 0.25, true);
    g.add(halo, ball, wire, rays, orbit);
    return { group: g, update: (t) => {
      rays.rotation.z = t * 0.25;
      const s = 1 + 0.06 * Math.sin(t * 3);
      rays.scale.set(s, s, 1);
      halo.scale.setScalar(2.2 + 0.15 * Math.sin(t * 2));
      wire.rotation.y = t * 0.4; wire.rotation.x = t * 0.15;
    } };
  } },

  /* --------------------------------------------------------- lluvia */
  rain: { color: "#5ab8ff", build: ({ color: c }) => {
    const g = new THREE.Group();
    const blobs = [[-0.6, 0.95, 0, 0.45], [0, 1.12, 0, 0.6], [0.62, 0.95, 0, 0.45], [-0.25, 0.8, 0.15, 0.4], [0.3, 0.8, -0.1, 0.42]];
    const cp = new Float32Array(1100 * 3);
    for (let i = 0; i < 1100; i++) {
      const b = blobs[i % blobs.length], u = rand(-1, 1), th = rand(0, TAU), s = Math.sqrt(1 - u * u), r = b[3] * rand(0.7, 1);
      cp.set([b[0] + Math.cos(th) * s * r, b[1] + u * r * 0.75, b[2] + Math.sin(th) * s * r], i * 3);
    }
    const cloud = points(cp, "#dff4ff", 0.045, 0.45);
    const N = 140, dp = new Float32Array(N * 6);
    const drops = Array.from({ length: N }, () => ({ x: rand(-1.1, 1.1), z: rand(-0.4, 0.4), y: rand(-1.3, 0.6), s: rand(2.4, 3.4) }));
    const rain = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: c, opacity: 0.75, ...ADD }));
    rain.geometry.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    const ripples = [0, 1, 2].map((i) => {
      const r = line(circle(0.35, 48), c, 0.6, true);
      r.rotation.x = -Math.PI / 2 + 0.5;
      r.position.set(-0.6 + i * 0.6, -1.35, 0);
      return r;
    });
    g.add(cloud, rain, ...ripples);
    return { group: g, update: (t, dt) => {
      drops.forEach((d, i) => {
        d.y -= d.s * dt;
        if (d.y < -1.3) d.y = 0.6;
        dp.set([d.x, d.y, d.z, d.x - 0.03, d.y + 0.16, d.z], i * 6);
      });
      rain.geometry.attributes.position.needsUpdate = true;
      ripples.forEach((r, i) => {
        const k = (t * 0.6 + i / 3) % 1;
        r.scale.setScalar(0.2 + k);
        r.material.userData.base = 0.6 * (1 - k);
      });
      cloud.position.x = Math.sin(t * 0.5) * 0.06;
    } };
  } },

  /* -------------------------------------------------------- sequía */
  drought: { color: "#ff8c42", build: ({ color: c }) => {
    const g = new THREE.Group();
    const ground = new THREE.Group();
    ground.rotation.x = -Math.PI / 2 + 0.55;
    ground.position.y = -0.55;
    ground.add(mesh(new THREE.CircleGeometry(1.7, 64), c, 0.07), line(circle(1.7), c, 0.6, true));
    const v = [];
    const walk = (x, y, a, len, depth) => {
      for (let i = 0; i < len; i++) {
        const nx = x + Math.cos(a) * 0.09, ny = y + Math.sin(a) * 0.09;
        if (nx * nx + ny * ny > 1.62 * 1.62) return;
        v.push(x, y, 0.001, nx, ny, 0.001);
        x = nx; y = ny; a += rand(-0.45, 0.45);
        if (depth < 2 && Math.random() < 0.12) walk(x, y, a + (Math.random() < 0.5 ? 1 : -1) * rand(0.6, 1.2), (len / 2) | 0, depth + 1);
      }
    };
    for (let k = 0; k < 14; k++) { const a = rand(0, TAU), r = rand(0, 1.2); walk(Math.cos(a) * r, Math.sin(a) * r, rand(0, TAU), (10 + rand(0, 12)) | 0, 0); }
    const cracks = lines(segs(v), c, 0.9);
    ground.add(cracks);
    const H = 220, hp = new Float32Array(H * 3);
    const heat = Array.from({ length: H }, () => ({ x: rand(-1.4, 1.4), z: rand(-0.5, 0.5), y: rand(-0.5, 1.3), s: rand(0.25, 0.6), p: rand(0, TAU) }));
    const shimmer = points(hp, "#ffd29a", 0.05, 0.55);
    const sunRing = line(circle(0.28, 48), "#ffc857", 0.8, true);
    const sunFill = mesh(new THREE.CircleGeometry(0.26, 48), "#ffc857", 0.25);
    sunRing.position.set(1.15, 1.25, 0); sunFill.position.copy(sunRing.position);
    g.add(ground, shimmer, sunRing, sunFill, glow("#ffc857", 1.0, 0.15).translateX(1.15).translateY(1.25));
    return { group: g, update: (t, dt) => {
      heat.forEach((h, i) => {
        h.y += h.s * dt;
        if (h.y > 1.3) h.y = -0.5;
        hp.set([h.x + Math.sin(t * 2 + h.p) * 0.04, h.y, h.z], i * 3);
      });
      shimmer.geometry.attributes.position.needsUpdate = true;
      cracks.material.userData.base = 0.7 + 0.25 * Math.sin(t * 2);
      ground.rotation.z = t * 0.08;
    } };
  } },

  /* --------------------------------------------------------- helada */
  frost: { color: "#bfefff", build: ({ color: c }) => {
    const flake = (size) => {
      const v = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        v.push(0, 0, 0, ca * size, sa * size, 0);
        for (const f of [0.45, 0.72]) {
          const bx = ca * size * f, by = sa * size * f, bl = size * 0.3 * (1.1 - f);
          for (const s of [-1, 1]) { const b = a + s * 0.75; v.push(bx, by, 0, bx + Math.cos(b) * bl, by + Math.sin(b) * bl, 0); }
        }
      }
      return segs(v);
    };
    const g = new THREE.Group();
    const big = lines(flake(1.0), c, 0.95);
    const hex = line(circle(0.22, 6), c, 0.8, true);
    g.add(glow(c, 2.0, 0.1), big, hex);
    const small = Array.from({ length: 10 }, () => {
      const f = lines(flake(rand(0.1, 0.22)), c, 0.7);
      let x; do { x = rand(-1.75, 1.75); } while (Math.abs(x) < 0.5);
      f.position.set(x, rand(-1.6, 1.6), rand(-0.3, 0.3));
      f.userData = { s: rand(0.12, 0.28), spin: rand(-1, 1), x };
      g.add(f);
      return f;
    });
    return { group: g, update: (t, dt) => {
      big.rotation.z = hex.rotation.z = t * 0.15;
      small.forEach((f) => {
        f.position.y -= f.userData.s * dt;
        if (f.position.y < -1.6) f.position.y = 1.6;
        f.position.x = f.userData.x + Math.sin(t + f.userData.x * 3) * 0.08;
        f.rotation.z += f.userData.spin * dt;
      });
    } };
  } },

  /* ---------------------------------------------------------- viento */
  wind: { color: "#9fe8ff", build: ({ color: c }) => {
    const g = new THREE.Group();
    const curves = [];
    for (let i = 0; i < 8; i++) {
      const y = -1.2 + i * 0.34 + rand(-0.05, 0.05), z = rand(-0.4, 0.4), amp = rand(0.1, 0.28), ph = rand(0, TAU);
      const pts = [];
      for (let j = 0; j <= 8; j++) { const x = -1.9 + j * (3.8 / 8); pts.push(V(x, y + Math.sin(x * 1.6 + ph) * amp, z)); }
      const curve = new THREE.CatmullRomCurve3(pts);
      curves.push({ curve, speed: rand(0.16, 0.3), off: rand() });
      g.add(line(curve.getPoints(80), c, 0.16));
    }
    const K = 5, T = 10;
    const heads = points(new Float32Array(curves.length * K * 3), c, 0.09, 0.95);
    const trail = points(new Float32Array(curves.length * K * T * 3), c, 0.045, 0.45);
    g.add(heads, trail);
    const p = new THREE.Vector3();
    return { group: g, update: (t) => {
      const hp = heads.geometry.attributes.position.array, tp = trail.geometry.attributes.position.array;
      let h = 0, q = 0;
      curves.forEach(({ curve, speed, off }) => {
        for (let k = 0; k < K; k++) {
          const u = (off + k / K + t * speed) % 1;
          curve.getPointAt(u, p); hp.set([p.x, p.y, p.z], h); h += 3;
          for (let j = 1; j <= T; j++) { curve.getPointAt(Math.max(0, u - j * 0.007), p); tp.set([p.x, p.y, p.z], q); q += 3; }
        }
      });
      heads.geometry.attributes.position.needsUpdate = trail.geometry.attributes.position.needsUpdate = true;
    } };
  } },

  /* ----------------------------------------------------- temperatura */
  temperature: { color: "#ff7a45", build: ({ value, lang }) => {
    const val = Number.isFinite(value) ? value : 25;
    const lo = -5, hi = 40, w = 0.16, R = 0.32, cy = -1.25, top = 1.4;
    const bot = cy + Math.sqrt(R * R - w * w);
    const col = new THREE.Color("#5ab8ff").lerp(new THREE.Color("#ff5a3c"), clamp(val / 35));
    const g = new THREE.Group();
    g.position.x = -0.2;
    // contorno: tubo con tapa redonda + bulbo
    const pts = [V(w, bot), V(w, top)];
    for (let i = 1; i < 16; i++) { const a = (i / 16) * Math.PI; pts.push(V(Math.cos(a) * w, top + Math.sin(a) * w)); }
    pts.push(V(-w, top), V(-w, bot));
    const a0 = Math.atan2(bot - cy, -w), a1 = Math.atan2(bot - cy, w) + TAU;
    for (let i = 1; i < 40; i++) { const a = a0 + ((a1 - a0) * i) / 40; pts.push(V(Math.cos(a) * R, cy + Math.sin(a) * R)); }
    const bulb = mesh(new THREE.CircleGeometry(R - 0.06, 40), col, 0.7);
    bulb.position.y = cy;
    const colGeo = new THREE.PlaneGeometry(2 * w - 0.08, 1);
    colGeo.translate(0, 0.5, 0);
    const column = mesh(colGeo, col, 0.7);
    column.position.y = bot - 0.03;
    column.scale.y = 0.001;
    const marker = line([V(-w - 0.12, 0), V(w + 0.12, 0)], col, 1);
    const level = (v) => bot + (clamp((v - lo) / (hi - lo)) * (top - bot));
    g.add(line(pts, "#dff7ff", 0.8, true), bulb, column, marker, glow(col, 1.1, 0.18).translateY(cy));
    for (let T = 0; T <= 40; T += 10) {
      const y = level(T);
      g.add(line([V(w + 0.04, y), V(w + 0.16, y)], "#dff7ff", 0.6));
      const s = text(`${T}°`, "#bfe9f5", 0.15);
      s.position.set(w + 0.42, y, 0);
      g.add(s);
    }
    const valText = text(`${fmt(val, lang)}°C`, col, 0.3);
    valText.position.set(-0.85, level(val), 0);
    g.add(valText);
    const target = level(val) - bot + 0.03;
    let cur = 0;
    return { group: g, update: (t, dt) => {
      cur += (target - cur) * Math.min(1, dt * 2.5);
      column.scale.y = Math.max(0.001, cur);
      marker.position.y = valText.position.y = bot - 0.03 + cur;
      bulb.material.userData.base = 0.6 + 0.15 * Math.sin(t * 3);
    } };
  } },

  /* --------------------------------------------------------- cultivos */
  crops: { color: "#8dff7a", build: ({ variant }) => {
    const kind = KIND_COLOR[variant] ? variant : "wheat";
    const col = KIND_COLOR[kind];
    const geo = plantGeo(kind);
    const W = 1.6, D = 1.15;
    const spots = [];
    if (kind === "pasture") for (let i = 0; i < 380; i++) spots.push({ x: rand(-W, W), z: rand(-D, D) });
    else {
      const per = { wheat: 16, corn: 10, soy: 14 }[kind];
      for (let r = 0; r < 7; r++) for (let i = 0; i < per; i++) spots.push({ x: -W + 0.1 + (i / (per - 1)) * (2 * W - 0.2) + rand(-0.02, 0.02), z: -D + 0.15 + (r / 6) * (2 * D - 0.3) });
    }
    spots.forEach((s) => { s.ry = rand(0, TAU); s.k = rand(0.85, 1.15); });
    const plants = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: col, opacity: 0.8, ...ADD }), spots.length);
    const field = new THREE.Group();
    field.rotation.x = 0.5;
    field.position.y = -0.35;
    const ground = mesh(new THREE.PlaneGeometry(2 * W, 2 * D), col, 0.06);
    ground.rotation.x = -Math.PI / 2;
    const furrows = [];
    if (kind !== "pasture") for (let r = 0; r < 7; r++) { const z = -D + 0.15 + (r / 6) * (2 * D - 0.3); furrows.push(-W, 0, z, W, 0, z); }
    field.add(ground, line([V(-W, 0, -D), V(W, 0, -D), V(W, 0, D), V(-W, 0, D)], col, 0.55, true), lines(segs(furrows), col, 0.2), plants);
    const g = new THREE.Group();
    g.add(field);
    return { group: g, update: (t) => {
      const grow = easeOut(t / 1.4);
      spots.forEach((s, i) => {
        dummy.position.set(s.x, 0, s.z);
        dummy.rotation.set(0, s.ry, Math.sin(t * 1.6 + s.x * 1.2 + s.z * 0.6) * 0.09);
        dummy.scale.setScalar(Math.max(0.001, s.k * clamp(grow * 1.3 - Math.abs(s.x) * 0.15)));
        dummy.updateMatrix();
        plants.setMatrixAt(i, dummy.matrix);
      });
      plants.instanceMatrix.needsUpdate = true;
      field.rotation.y = Math.sin(t * 0.25) * 0.12;
    } };
  } },

  /* ------------------------------------------------------------ suelo */
  soil: { color: "#d9a066", build: ({ variant }) => {
    const erosion = variant === "erosion";
    const W = 2.2, Dp = 1.1, topY = 0.55;
    const block = new THREE.Group();
    block.rotation.set(0.42, -0.62, 0);
    block.position.y = -0.2;
    const layers = [
      { h: erosion ? 0.18 : 0.4, col: "#c9905a", op: 0.16 },
      { h: 0.55, col: "#a8774a", op: 0.09 },
      { h: 0.5, col: "#8f9aa0", op: 0.06 },
    ];
    let y = topY;
    for (const L of layers) {
      const geo = new THREE.BoxGeometry(W, L.h, Dp);
      const m = mesh(geo, L.col, L.op), e = edges(geo, L.col, 0.7);
      m.position.y = e.position.y = y - L.h / 2;
      block.add(m, e);
      y -= L.h;
    }
    for (let i = 0; i < 9; i++) {
      const r = lines(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(rand(0.05, 0.11), 0)), "#8f9aa0", 0.6);
      r.position.set(rand(-W / 2 + 0.15, W / 2 - 0.15), rand(y + 0.08, y + 0.42), rand(-Dp / 2 + 0.1, Dp / 2 - 0.1));
      block.add(r);
    }
    const g = new THREE.Group();
    g.add(block);
    const P = erosion ? 170 : 70;
    const parts = Array.from({ length: P }, () => ({ u: rand(), z: rand(-Dp / 2 + 0.05, Dp / 2 - 0.05), x: rand(-W / 2 + 0.1, W / 2 - 0.1), s: rand(0.18, 0.35) }));
    const pp = points(new Float32Array(P * 3), erosion ? "#e0a86a" : "#5ab8ff", erosion ? 0.06 : 0.055, 0.85);
    block.add(pp);
    if (!erosion) {
      // raíces y plantas: suelo cubierto
      const v = [];
      for (let i = 0; i < 16; i++) {
        let x = rand(-W / 2 + 0.15, W / 2 - 0.15), yy = topY, z = rand(-Dp / 2 + 0.1, Dp / 2 - 0.1), a = -Math.PI / 2;
        for (let k = 0; k < 6; k++) { const nx = x + Math.cos(a) * 0.1, ny = yy + Math.sin(a) * 0.1; v.push(x, yy, z, nx, ny, z); x = nx; yy = ny; a += rand(-0.6, 0.6); }
        for (let b = 0; b < 3; b++) { const bx = x + rand(-0.06, 0.06); v.push(bx, topY, z, bx + rand(-0.05, 0.05), topY + rand(0.12, 0.25), z); }
      }
      block.add(lines(segs(v), "#8dff7a", 0.95));
    } else {
      const v = [];
      for (let i = 0; i < 40; i++) { const x = rand(-W / 2, W / 2), z = rand(-Dp / 2, Dp / 2), yy = rand(0.9, 1.6); v.push(x, yy, z, x - 0.03, yy - 0.14, z); }
      block.add(lines(segs(v), "#5ab8ff", 0.5));
    }
    return { group: g, update: (t, dt) => {
      const a = pp.geometry.attributes.position.array;
      parts.forEach((p, i) => {
        p.u = (p.u + p.s * dt) % 1;
        if (erosion) {
          // escurre por la superficie y cae por el borde
          const x = -W / 2 + p.u * 1.6 * W;
          const fall = Math.max(0, x - W / 2);
          a.set([Math.min(x, W / 2 + fall * 0.4), topY + 0.02 - fall * fall * 3, p.z], i * 3);
        } else {
          a.set([p.x, topY - p.u * 0.85, p.z], i * 3);   // agua infiltrando
        }
      });
      pp.geometry.attributes.position.needsUpdate = true;
      block.rotation.y = -0.62 + Math.sin(t * 0.3) * 0.12;
    } };
  } },

  /* ---------------------------------------------- terreno del campo */
  terrain: { color: "#4fd8ff", build: ({ color: c }) => {
    const h = (x, y) => 0.12 * Math.sin(x * 1.7 + 0.5) * Math.cos(y * 1.3) + 0.06 * Math.sin(x * 3.1 + y * 2.3) + 0.04 * Math.cos(y * 4.7 - x * 1.1);
    const S = 3.1;
    const land = new THREE.Group();
    land.rotation.x = -Math.PI / 2 + 0.62;
    land.position.y = -0.3;
    const geo = new THREE.PlaneGeometry(S, S, 44, 44), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, h(pos.getX(i), pos.getY(i)));
    land.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, wireframe: true, opacity: 0.2, ...ADD })));
    const river = [];
    for (let i = 0; i <= 60; i++) { const x = -S / 2 + (i / 60) * S, y = -0.75 + 0.3 * Math.sin(x * 1.8); river.push(V(x, y, h(x, y) + 0.02)); }
    const fx = 0.15, fy = 0.25, fw = 0.28, fh = 0.2;
    const corners = [[-fw, -fh], [fw, -fh], [fw, fh], [-fw, fh]].map(([dx, dy]) => V(fx + dx, fy + dy, h(fx + dx, fy + dy) + 0.03));
    const fill = mesh(new THREE.PlaneGeometry(fw * 2, fh * 2), "#3dffc2", 0.22);
    fill.position.set(fx, fy, h(fx, fy) + 0.03);
    const pinBase = h(fx, fy);
    const pin = new THREE.Group();
    pin.position.set(fx, fy, pinBase);
    const head = mesh(new THREE.IcosahedronGeometry(0.07, 1), "#eaffff", 0.9);
    head.position.z = 0.72;
    pin.add(line([V(0, 0, 0), V(0, 0, 0.66)], "#eaffff", 0.85), head, glow("#3dffc2", 0.45, 0.3).translateZ(0.72));
    const ring = line(circle(0.14, 40), "#3dffc2", 0.8, true);
    ring.position.set(fx, fy, pinBase + 0.035);
    const scanPts = new Float32Array(61 * 3);
    const scan = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#eaffff", opacity: 0.5, ...ADD }));
    scan.geometry.setAttribute("position", new THREE.BufferAttribute(scanPts, 3));
    land.add(line(river, "#5ab8ff", 0.9), line(corners, "#3dffc2", 1, true), fill, pin, ring, scan);
    const g = new THREE.Group();
    g.add(land);
    return { group: g, update: (t) => {
      head.position.z = 0.72 + 0.05 * Math.sin(t * 2);
      const k = (t % 1.6) / 1.6;
      ring.scale.setScalar(1 + k * 2.5);
      ring.material.userData.base = 0.8 * (1 - k);
      fill.material.userData.base = 0.15 + 0.1 * Math.sin(t * 3);
      const sy = ((t * 0.3) % 1) * S - S / 2;
      for (let i = 0; i <= 60; i++) { const x = -S / 2 + (i / 60) * S; scanPts.set([x, sy, h(x, sy) + 0.01], i * 3); }
      scan.geometry.attributes.position.needsUpdate = true;
      land.rotation.z = Math.sin(t * 0.2) * 0.15;
    } };
  } },

  /* --------------------------------------------------- gráfico de barras */
  // limit: { value, label } dibuja una línea de referencia (p. ej. la tolerancia de erosión).
  // colors: un color por barra (p. ej. para destacar la rotación actual).
  chart: { color: "#4fd8ff", build: ({ color: c, values = [], labels, lang, limit, colors }) => {
    const vals = values.slice(0, 12), n = vals.length;
    const ref = Number.isFinite(limit?.value) ? limit.value : 0;
    const lo = Math.min(0, ...vals), hi = Math.max(0, ref, ...vals), span = hi - lo || 1;
    const Y = (v) => -1.1 + ((v - lo) / span) * 2.1;
    const step = 3.2 / n, bw = Math.min(0.7, step * 0.62);
    const names = labels?.length === n ? labels : n === 12 ? monthInitials(lang) : vals.map((_, i) => `${i + 1}`);
    const g = new THREE.Group();
    g.rotation.set(0.12, -0.22, 0);
    g.add(line([V(-1.7, Y(0)), V(1.7, Y(0))], c, 0.7));
    if (ref) {
      const dash = [];
      for (let x = -1.7; x < 1.7; x += 0.16) dash.push(x, Y(ref), 0.13, x + 0.09, Y(ref), 0.13);
      g.add(lines(segs(dash), "#ffb347", 0.95));
      if (limit.label) { const s = text(String(limit.label).slice(0, 24), "#ffb347", 0.13); s.position.set(1.15, Y(ref) + 0.12, 0.13); g.add(s); }
    }
    const bars = vals.map((v, i) => {
      const x = -1.6 + step * (i + 0.5);
      const geo = new THREE.BoxGeometry(bw, 1, 0.22);
      geo.translate(0, 0.5, 0);
      const bar = new THREE.Group();
      const bc = colors?.[i] || c;
      bar.add(mesh(geo, bc, 0.3), edges(geo, bc, 0.9));
      bar.position.set(x, Y(Math.min(0, v)), 0);
      const hgt = Math.max(0.001, Math.abs(Y(v) - Y(0)));
      bar.scale.y = 0.001;
      const num = text(fmt(v, lang), "#eaffff", 0.14);
      num.position.set(x, Math.max(Y(v), Y(0)) + 0.13, 0.12);
      const lab = text(String(names[i]).slice(0, 8), "#9fdcef", 0.13);
      lab.position.set(x, Y(Math.min(0, ...vals)) - 0.15, 0.12);
      g.add(bar, num, lab);
      return { bar, hgt, num, i };
    });
    return { group: g, update: (t) => {
      bars.forEach(({ bar, hgt, num, i }) => {
        const k = easeOut((t - 0.15 - i * 0.07) / 0.6);
        bar.scale.y = Math.max(0.001, hgt * k);
        num.material.userData.base = 0.95 * k;
      });
    } };
  } },

  /* ------------------------------------------------------- calendario */
  // months: meses a destacar. O cells: 12 celdas { id, abrev } | null (calendario de una rotación),
  // empezando en el mes "first" (Cooper usa el año agrícola: mayo = 5).
  calendar: { color: "#3dffc2", build: ({ color: c, months = [], lang, cells, first = 1 }) => {
    const on = new Set(months);
    const init = monthInitials(lang);
    const g = new THREE.Group();
    g.rotation.x = -0.25;
    const gap = 0.02, segs12 = [];
    const monthAt = (p) => ((first - 1 + p) % 12) + 1;
    for (let m = 0; m < 12; m++) {
      const start = Math.PI / 2 - ((m + 1) / 12) * TAU + gap;
      const geo = new THREE.RingGeometry(1.15, 1.55, 16, 1, start, TAU / 12 - 2 * gap);
      const cell = cells?.[m];
      const lit = cells ? !!cell : on.has(monthAt(m));
      const col = cell ? cropColor(cell.id) : c;
      const seg = mesh(geo, lit ? col : "#7fa9b8", lit ? 0.55 : 0.07);
      const out = edges(geo, lit ? col : "#7fa9b8", lit ? 0.9 : 0.25);
      if (lit) seg.position.z = out.position.z = 0.06;
      const mid = Math.PI / 2 - ((m + 0.5) / 12) * TAU;
      const letter = text(init[monthAt(m) - 1], lit ? col : "#7fa9b8", 0.2);
      letter.position.set(Math.cos(mid) * 1.82, Math.sin(mid) * 1.82, 0);
      g.add(seg, out, letter);
      if (cell?.abrev) {
        const ab = text(String(cell.abrev).slice(0, 3), "#eaffff", 0.13);
        ab.position.set(Math.cos(mid) * 1.35, Math.sin(mid) * 1.35, 0.1);
        g.add(ab);
      }
      segs12.push({ seg, lit, m });
    }
    g.add(line(circle(0.98, 96), c, 0.3, true));
    const now = (new Date().getMonth() + 1 - first + 12) % 12, mid = Math.PI / 2 - ((now + 0.5) / 12) * TAU;
    g.add(line([V(Math.cos(mid) * 0.9, Math.sin(mid) * 0.9), V(Math.cos(mid) * 1.12, Math.sin(mid) * 1.12)], "#eaffff", 0.9));
    const count = cells ? cells.filter(Boolean).length : on.size;
    if (count) g.add(text(`${count}/12`, c, 0.42));
    return { group: g, update: (t) => {
      segs12.forEach(({ seg, lit, m }) => {
        if (lit) seg.material.userData.base = t > m * 0.08 ? 0.45 + 0.15 * Math.sin(t * 3 - m * 0.5) : 0.05;
      });
    } };
  } },

  /* ------------------------------ campo real: relieve, cultivos y erosión */
  // grid: { n, elev[n·n] (fila 0 = norte), side_m }. Opcionales:
  //   image     URL de la imagen satelital del cuadrado del campo (va sobre el relieve);
  //   eros, tol t/ha por celda y tolerancia: colorea el suelo y muestra tierra bajando la pendiente;
  //   calendar  12 celdas { id, nombre } | null: los cultivos cambian mes a mes;
  //   monthNames[12], bareText: textos del cartel del mes.
  fieldplot: { color: "#4fd8ff", build: ({ color: c, grid, image, eros, tol = 7, calendar, monthNames, bareText = "no crop", lang }) => {
    const n = grid.n, S = 3.0, M = (n - 1) * 3 + 1, H = 0.55, STEP = 1.2;
    const zmin = Math.min(...grid.elev), relief = Math.max(4, Math.max(...grid.elev) - zmin);
    const hAt = (u, v) => ((bilinear(grid.elev, n, u * (n - 1), v * (n - 1)) - zmin) / relief) * H;   // u: oeste→este, v: norte→sur
    const P = (u, v, lift = 0) => V((u - 0.5) * S, hAt(u, v) + lift, (v - 0.5) * S);
    const field = new THREE.Group();
    field.rotation.x = 0.55;
    field.position.y = -0.5;

    // Superficie: el plano queda con la fila de arriba al norte (z negativo), igual que la grilla.
    const geo = new THREE.PlaneGeometry(S, S, M - 1, M - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / S + 0.5, v = pos.getZ(i) / S + 0.5;
      pos.setY(i, hAt(u, v));
      if (eros) erosionColor(bilinear(eros, n, u * (n - 1), v * (n - 1)) / tol, tmp); else tmp.set("#ffffff");
      cols.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const surfMat = new THREE.MeshBasicMaterial({
      color: eros ? "#ffffff" : c, vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, opacity: eros ? 0.42 : 0.12,
    });
    const surface = new THREE.Mesh(geo, surfMat);
    if (image) {
      new THREE.TextureLoader().setCrossOrigin("anonymous").load(image, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        surfMat.map = tex;
        surfMat.color.set(eros ? "#c9c9c9" : "#9fb0b0");   // algo apagada: el brillo (bloom) la quemaría
        surfMat.userData.base = 0.9;
        surfMat.needsUpdate = true;
      }, undefined, () => {});                             // sin imagen queda el relieve en alambre
    }

    const gl = [], rim = [];
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      for (let j = 0; j < M - 1; j++) {
        const a = j / (M - 1), b = (j + 1) / (M - 1);
        for (const [p, q] of [[P(a, f, 0.004), P(b, f, 0.004)], [P(f, a, 0.004), P(f, b, 0.004)]]) gl.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
    }
    for (let j = 0; j < M; j++) rim.push(P(j / (M - 1), 0, 0.006));
    for (let j = 1; j < M; j++) rim.push(P(1, j / (M - 1), 0.006));
    for (let j = M - 2; j >= 0; j--) rim.push(P(j / (M - 1), 1, 0.006));
    for (let j = M - 2; j > 0; j--) rim.push(P(0, j / (M - 1), 0.006));
    const base = -0.16, posts = [];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const p = P(u, v); posts.push(p.x, p.y, p.z, p.x, base, p.z); }
    const h = S / 2;
    field.add(surface, lines(segs(gl), c, image ? 0.1 : 0.2), line(rim, c, 0.9, true), lines(segs(posts), c, 0.45),
      line([V(-h, base, -h), V(h, base, -h), V(h, base, h), V(-h, base, h)], c, 0.35, true));
    const north = text("N", "#eaffff", 0.16);
    north.position.set(0, hAt(0.5, 0) + 0.16, -h - 0.14);
    field.add(north);
    if (grid.side_m) {
      const scale = text(`${fmt(grid.side_m, lang)} m`, "#9fdcef", 0.12);
      scale.position.set(0, base - 0.1, h + 0.12);
      field.add(scale);
    }

    // Cultivos: una malla instanciada por cultivo del calendario; se ve la del mes en curso.
    const G = 13, spots = [], crops = {};
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      spots.push({ p: P((i + 0.5) / G + rand(-0.02, 0.02), (j + 0.5) / G + rand(-0.02, 0.02)), ry: rand(0, TAU), k: rand(0.4, 0.55) });
    }
    for (const cell of calendar || []) {
      if (!cell || crops[cell.id]) continue;
      const kind = CROP_KIND[cell.id] || "pasture";
      const im = new THREE.InstancedMesh(plantGeo(kind), new THREE.MeshBasicMaterial({ color: KIND_COLOR[kind], opacity: 0.85, ...ADD }), spots.length);
      im.visible = false;
      im.renderOrder = 2;
      crops[cell.id] = im;
      field.add(im);
    }
    const names = monthNames || ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
    const tags = (calendar || []).map((cell, i) => {
      const s = text(`${names[i]} · ${cell ? cell.nombre : bareText}`.slice(0, 36), cell ? "#eaffff" : "#ffb347", 0.17);
      s.position.set(0, H + 0.85, -0.3);
      s.renderOrder = 4;
      s.material.userData.base = 0;
      field.add(s);
      return s;
    });

    // Tierra que el agua arrastra pendiente abajo: más partículas donde hay más erosión.
    const NP = eros ? 240 : 0;
    const wash = NP ? points(new Float32Array(NP * 3), "#ffc58a", 0.07, 0.9) : null;
    const spawn = (q) => {
      for (let k = 0; k < 12; k++) {
        q.u = rand(0.03, 0.97); q.v = rand(0.03, 0.97);
        if (Math.random() < bilinear(eros, n, q.u * (n - 1), q.v * (n - 1)) / (2 * tol)) break;
      }
      q.life = rand(1.5, 3.5);
      return q;
    };
    const parts = Array.from({ length: NP }, () => spawn({}));
    if (wash) { wash.renderOrder = 3; field.add(wash); }

    const g = new THREE.Group();
    g.add(field);
    return { group: g, update: (t, dt) => {
      const idx = calendar ? Math.floor(t / STEP) % 12 : -1;
      const cell = calendar ? calendar[idx] : null;
      if (calendar) {
        const prev = calendar[(idx + 11) % 12];
        const grow = cell && prev && prev.id === cell.id ? 1 : easeOut(((t % STEP) / STEP) / 0.45);
        for (const [id, im] of Object.entries(crops)) im.visible = !!cell && cell.id === id;
        if (cell) {
          const im = crops[cell.id];
          spots.forEach((s, i) => {
            dummy.position.copy(s.p);
            dummy.rotation.set(0, s.ry, Math.sin(t * 1.6 + s.p.x * 1.5) * 0.08);
            dummy.scale.setScalar(Math.max(0.001, s.k * grow));
            dummy.updateMatrix();
            im.setMatrixAt(i, dummy.matrix);
          });
          im.instanceMatrix.needsUpdate = true;
        }
        tags.forEach((s, i) => { s.material.userData.base = i === idx ? 0.95 : 0; });
      }
      if (wash) {
        const a = wash.geometry.attributes.position.array, e = 0.02;
        parts.forEach((q, i) => {
          const gx = (hAt(q.u + e, q.v) - hAt(q.u - e, q.v)) / (2 * e), gz = (hAt(q.u, q.v + e) - hAt(q.u, q.v - e)) / (2 * e);
          q.u -= gx * dt * 0.9; q.v -= gz * dt * 0.9; q.life -= dt;
          if (q.life < 0 || q.u < 0 || q.u > 1 || q.v < 0 || q.v > 1) spawn(q);
          const p = P(q.u, q.v, 0.03);
          a.set([p.x, p.y, p.z], i * 3);
        });
        wash.geometry.attributes.position.needsUpdate = true;
        wash.material.userData.base = !calendar || !cell ? 0.9 : 0.1;   // con cultivo casi no se lava
      }
      field.rotation.y = Math.sin(t * 0.22) * 0.38;
    } };
  } },

  /* ---------------------------------- lluvia contra evapotranspiración */
  // rain[12] y et0[12] en mm; thirsty[12]: meses donde el sol se lleva más agua de la que llueve.
  waterchart: { color: "#5ab8ff", build: ({ color: c, rain = [], et0 = [], initials, thirsty = [], legend = ["Rainfall", "Evapotranspiration"], lang }) => {
    const ET = "#ff8c42";
    const hi = Math.max(1, ...rain, ...et0) * 1.08, step = 3.3 / 12, bw = step * 0.6;
    const Y = (v) => -1.05 + (v / hi) * 2.0, X = (i) => -1.65 + step * (i + 0.5);
    const init = initials || monthInitials(lang);
    const g = new THREE.Group();
    g.rotation.set(0.1, -0.18, 0);
    g.add(line([V(-1.72, Y(0)), V(1.72, Y(0))], c, 0.7));
    const tick = hi > 130 ? 50 : 25, grid = [];
    for (let v = tick; v < hi; v += tick) {
      grid.push(-1.72, Y(v), -0.12, 1.72, Y(v), -0.12);
      const s = text(`${v}`, "#9fdcef", 0.11);
      s.position.set(-1.9, Y(v), 0);
      g.add(s);
    }
    g.add(lines(segs(grid), c, 0.14));
    const bars = rain.slice(0, 12).map((v, i) => {
      const geo = new THREE.BoxGeometry(bw, 1, 0.2);
      geo.translate(0, 0.5, 0);
      const bar = new THREE.Group();
      bar.add(mesh(geo, c, 0.3), edges(geo, c, 0.9));
      bar.position.set(X(i), Y(0), 0);
      bar.scale.y = 0.001;
      const lab = text(init[i], thirsty[i] ? ET : "#9fdcef", 0.13);
      lab.position.set(X(i), Y(0) - 0.15, 0.12);
      g.add(bar, lab);
      let gap = null;
      if (thirsty[i] && et0[i] > v) {                      // el agua que falta ese mes
        const gg = new THREE.BoxGeometry(bw, Y(et0[i]) - Y(v), 0.2);
        gap = new THREE.Group();
        gap.add(mesh(gg, ET, 0.1), edges(gg, ET, 0.6));
        gap.position.set(X(i), (Y(et0[i]) + Y(v)) / 2, 0);
        gap.children.forEach((o) => { o.material.userData.base = 0; });
        g.add(gap);
      }
      return { bar, hgt: Y(v) - Y(0), gap, i };
    });
    const pts = et0.slice(0, 12).map((v, i) => V(X(i), Y(v), 0.16));
    const etLine = line(pts, ET, 0.95);
    const dots = points(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])), ET, 0.13, 0.95);
    const l0 = text(String(legend[0]).slice(0, 26), c, 0.13), l1 = text(String(legend[1]).slice(0, 26), ET, 0.13);
    l0.position.set(-0.95, 1.28, 0); l1.position.set(0.8, 1.28, 0);
    g.add(etLine, dots, l0, l1);
    return { group: g, update: (t) => {
      bars.forEach(({ bar, hgt, gap, i }) => {
        bar.scale.y = Math.max(0.001, hgt * easeOut((t - 0.15 - i * 0.06) / 0.6));
        if (gap) { const k = clamp((t - 2.6 - i * 0.05) / 0.5); gap.children[0].material.userData.base = 0.1 * k; gap.children[1].material.userData.base = 0.6 * k; }
      });
      const k = clamp((t - 1.2) / 1.2);
      etLine.geometry.setDrawRange(0, Math.max(2, Math.ceil(k * pts.length)));
      etLine.material.userData.base = k ? 0.95 : 0;
      dots.material.userData.base = 0.95 * clamp((t - 2.2) / 0.4);
    } };
  } },

  /* ------------------------------------------------- radar de puntajes */
  // axes: nombres de los ejes; series: [{ name, values (0-100, uno por eje), color }].
  radar: { color: "#4fd8ff", build: ({ color: c, axes = [], series = [] }) => {
    const N = axes.length, R = 1.3;
    const dir = (i) => { const a = Math.PI / 2 - (i / N) * TAU; return [Math.cos(a), Math.sin(a)]; };
    const g = new THREE.Group();
    g.rotation.x = -0.2;
    g.position.y = 0.2;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      g.add(line(axes.map((_, i) => V(dir(i)[0] * R * f, dir(i)[1] * R * f)), c, f === 1 ? 0.6 : 0.18, true));
    }
    const spokes = [];
    axes.forEach((name, i) => {
      const [x, y] = dir(i);
      spokes.push(0, 0, 0, x * R, y * R, 0);
      const s = text(String(name).slice(0, 18), "#bfe9f5", 0.14);
      s.position.set(x * (R + 0.38), y * (R + 0.2), 0);
      g.add(s);
    });
    g.add(lines(segs(spokes), c, 0.25));
    for (const v of [50, 100]) { const s = text(`${v}`, "#7fa9b8", 0.1); s.position.set(0.1, (R * v) / 100 - 0.07, 0); g.add(s); }
    const shapes = series.slice(0, 3).map((s, si) => {
      const fillGeo = new THREE.BufferGeometry(), idx = [];
      fillGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((N + 1) * 3), 3));
      for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
      fillGeo.setIndex(idx);
      const fill = mesh(fillGeo, s.color, 0.16);
      const ring = line(axes.map(() => V(0, 0)), s.color, 0.95, true);
      const dots = points(new Float32Array(N * 3), s.color, 0.12, 0.95);
      const name = text(String(s.name).slice(0, 34), s.color, 0.14);
      name.position.set(0, -R - 0.42 - si * 0.24, 0);
      g.add(fill, ring, dots, name);
      return { s, si, fill, ring, dots };
    });
    return { group: g, update: (t) => {
      shapes.forEach(({ s, si, fill, ring, dots }) => {
        const k = easeOut((t - 0.25 - si * 0.5) / 0.9), z = 0.02 * (si + 1);
        const fp = fill.geometry.attributes.position, rp = ring.geometry.attributes.position, dp = dots.geometry.attributes.position;
        fp.setXYZ(0, 0, 0, z);
        for (let i = 0; i < N; i++) {
          const [x, y] = dir(i), r = (clamp((s.values[i] || 0) / 100) * R) * k;
          fp.setXYZ(i + 1, x * r, y * r, z); rp.setXYZ(i, x * r, y * r, z); dp.setXYZ(i, x * r, y * r, z);
        }
        fp.needsUpdate = rp.needsUpdate = dp.needsUpdate = true;
      });
    } };
  } },
};

/* Ejemplos para la galería (tecla V): permiten ver cada visual sin pasar por el modelo. */
export const SAMPLES = [
  { show: "sun", label: "5.2 kWh/m²/day" },
  { show: "rain", label: "1,250 mm/yr" },
  { show: "drought", label: "Dry spell" },
  { show: "frost", label: "Frost risk" },
  { show: "wind", label: "18 km/h" },
  { show: "temperature", value: 31, label: "Summer high" },
  { show: "crops", variant: "wheat", label: "Wheat" },
  { show: "crops", variant: "corn", label: "Corn" },
  { show: "crops", variant: "soy", label: "Soybean" },
  { show: "crops", variant: "pasture", label: "Pasture" },
  { show: "soil", variant: "healthy", label: "Covered soil" },
  { show: "soil", variant: "erosion", label: "Bare soil · erosion" },
  { show: "terrain", label: "Near Young, Río Negro" },
  { show: "chart", values: [110, 95, 105, 90, 85, 75, 80, 75, 90, 115, 105, 100], label: "Sample data (mm)" },
  { show: "chart", values: [100, 67], labels: ["Alt 1", "Alt 2"], label: "Sample comparison" },
  { show: "calendar", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], label: "Soil covered" },
];

/* ============================================================ escenario */
// Muestra un visual a la vez, con fundido y escala de entrada/salida (GSAP global).
export function createStage(parent) {
  const root = new THREE.Group();
  parent.add(root);
  const live = new Set();
  let cur = null;

  const setFade = (e) => e.mats.forEach((m) => { m.opacity = m.userData.base * e.fade.v; });
  function dispose(e) {
    root.remove(e.group);
    e.group.traverse((o) => {
      o.geometry?.dispose();
      [o.material].flat().forEach((m) => { if (!m) return; if (m.map && m.map !== DOT) m.map.dispose(); m.dispose(); });
    });
    live.delete(e);
  }

  function hide() {
    if (!cur) return;
    const e = cur;
    cur = null;
    gsap.killTweensOf([e.fade, e.group.scale]);
    gsap.to(e.fade, { v: 0, duration: 0.45, ease: "power2.in", onComplete: () => dispose(e) });
    gsap.to(e.group.scale, { x: 1.25, y: 1.25, z: 1.25, duration: 0.45, ease: "power2.in" });
  }

  function show(spec) {
    const def = VISUALS[spec?.show];
    if (!def) return false;
    const { label, lang, say, panel, chapter, ...params } = spec;   // lo que no cambia el dibujo queda fuera de la clave
    const key = JSON.stringify(params);
    if (cur?.key === key) return true;                   // mismo visual: se queda
    hide();
    const { group, update } = def.build({ ...params, lang, color: def.color });
    const mats = [];
    group.traverse((o) => [o.material].flat().forEach((m) => {
      if (m && !mats.includes(m)) { m.userData.base ??= m.opacity; mats.push(m); }
    }));
    const e = { key, group, update: update || (() => {}), mats, fade: { v: 0 }, t: 0 };
    root.add(group);
    group.scale.setScalar(0.6);
    gsap.to(e.fade, { v: 1, duration: 0.7, ease: "power2.out" });
    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: "elastic.out(1, 0.6)" });
    live.add(e);
    cur = e;
    e.update(0, 0);
    setFade(e);
    return true;
  }

  function update(dt) {
    live.forEach((e) => { e.t += dt; e.update(e.t, dt); setFade(e); });
  }

  return { root, show, hide, update, get active() { return !!cur; } };
}
