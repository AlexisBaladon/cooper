/* Cooper — "Explain it simply" en 3D (Three.js, paisaje con relieve real). UI en inglés.
 *
 * Todo lo que se ve sale de los datos del análisis:
 *  - Relieve del campo = grilla real de elevación SRTM (exagerada verticalmente).
 *  - Forma de cada planta = tipo de cultivo; altura = etapa; color = follaje natural teñido con el color del cultivo.
 *  - Color del suelo = erosión RUSLE de cada celda para la rotación mostrada.
 *  - Cantidad de partículas de tierra que corren ladera abajo = toneladas perdidas.
 *  - Columnas del anillo del año = mm de lluvia y de evapotranspiración de cada mes.
 *  - Tamaño de nubes y soles = lluvia anual y días de calor de cada período.
 *
 * Reutiliza el reproductor (voz + subtítulos) y los textos de slides.js.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const { buildSlides, Player } = window.CooperSlides;
const AGM = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
const S = 10; // lado del campo en unidades de escena
const CROP_KIND = {
  soja: "leg", soja2: "leg", vicia: "leg", maiz: "maiz", sorgo: "sorgo", trigo: "cereal", cebada: "cereal",
  avena_negra: "grass", raigras: "grass", pradera: "pasture", colza: "colza",
};
const FOLIAGE = { leg: "#5f9a3a", cereal: "#7fae45", grass: "#4f9440", maiz: "#5c9a3c", sorgo: "#5f9440", pasture: "#4c8f3c", colza: "#8fb53a" };
const C = (hex) => new THREE.Color(hex);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const staticMode = () => document.documentElement.classList.contains("static");

/* Generador pseudoaleatorio con semilla: la maqueta se ve igual en cada carga. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Textura de detalle del suelo (grano fino), que multiplica el color de los datos. */
function soilTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d"), rnd = seeded(3);
  ctx.fillStyle = "#e9e9e9";
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 9000; k++) {
    const v = rnd() < 0.5 ? 255 : 90;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.1})`;
    const r = 0.6 + rnd() * 2.2;
    ctx.fillRect(rnd() * 256, rnd() * 256, r, r);
  }
  for (let k = 0; k < 60; k++) {   // manchones suaves
    const x = rnd() * 256, y = rnd() * 256, r = 14 + rnd() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? 255 : 120;
    g.addColorStop(0, `rgba(${v},${v},${v},0.10)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* Color del paisaje fuera del campo: camino de tierra en el borde y chacras vecinas (decorativo). */
const PADDOCKS = ["#8fae62", "#7f9f57", "#9bb86b", "#86a65c", "#a3b86e", "#c9b77a", "#8a6f50", "#6f9450", "#94ad66"];
function landColor(x, z, rnd) {
  const d = Math.hypot(x - clamp(x, -S / 2, S / 2), z - clamp(z, -S / 2, S / 2));
  const px = Math.floor((x + 200) / 12.5), pz = Math.floor((z + 200) / 9.5);
  const c = C(PADDOCKS[(px * 7 + pz * 13 + px * pz) % PADDOCKS.length]);
  if (d < 0.5) c.lerp(C("#b29a76"), clamp(1.4 - d * 2.4, 0, 1));   // camino perimetral
  return c.multiplyScalar(0.93 + rnd() * 0.14);
}

/* Formas de las plantas: pequeñas matas compuestas, una por tipo de cultivo. */
function plantGeometries() {
  const rnd = seeded(11);
  const merge = (gs) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)));
  const blade = (h, r, tilt, ang, spread) => new THREE.ConeGeometry(r, h, 4).translate(0, h / 2, 0)
    .rotateZ(tilt).rotateY(ang).translate(Math.cos(ang) * spread, 0, -Math.sin(ang) * spread);
  const tuft = (nb, h, r, tilt, spread) => merge(Array.from({ length: nb }, (_, k) =>
    blade(h * (0.75 + rnd() * 0.4), r, -tilt * (0.4 + rnd() * 0.8), (k / nb) * 6.283 + rnd(), spread * rnd())));
  const ball = (r, x, y, z, sy = 0.85) => new THREE.IcosahedronGeometry(r, 1).scale(1, sy, 1).translate(x, y, z);
  const leaf = (len, hgt, ang) => new THREE.ConeGeometry(0.04, len, 4).translate(0, len / 2, 0).scale(1, 1, 0.3)
    .rotateZ(-1.05).rotateY(ang).translate(0, hgt, 0);
  const stalk = (h, nl) => merge([new THREE.CylinderGeometry(0.02, 0.03, h, 5).translate(0, h / 2, 0),
    ...Array.from({ length: nl }, (_, k) => leaf(0.3 + rnd() * 0.14, h * (0.25 + (0.6 * k) / nl), k * 2.4 + rnd()))]);
  return {
    leg: merge([ball(0.115, 0, 0.1, 0), ball(0.09, 0.08, 0.13, 0.03), ball(0.085, -0.07, 0.12, -0.05), ball(0.07, 0.01, 0.19, 0.04)]),
    cereal: tuft(8, 0.5, 0.017, 0.22, 0.07),
    grass: tuft(8, 0.3, 0.022, 0.45, 0.08),
    maiz: stalk(0.95, 6),
    sorgo: stalk(0.62, 5),
    pasture: tuft(10, 0.15, 0.022, 0.6, 0.15),
    colza: merge([tuft(5, 0.4, 0.02, 0.3, 0.05), ball(0.05, 0.05, 0.42, 0, 1), ball(0.045, -0.05, 0.38, 0.04, 1), ball(0.045, 0, 0.45, -0.05, 1)]),
  };
}

/* Copa de árbol redondeada (tipo eucalipto u ombú), para instanciar. */
function crownGeometry() {
  const b = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 2).scale(1, 1.15, 1).translate(x, y, z);
  return mergeGeometries([b(0.55, 0, 1.25, 0), b(0.42, 0.3, 1.0, 0.12), b(0.4, -0.28, 1.05, -0.1), b(0.36, 0.05, 1.7, 0.05)]);
}

/* ------------------------------------------------------------------ escena */
class FieldScene {
  constructor(container, data) {
    this.data = data;
    this.tol = (data.zonas && data.zonas.tolerancia_t_ha) || 7;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.container = container;

    this.scene = new THREE.Scene();
    this.skyDay = C("#cfe6f2");
    this.skySunset = C("#f3b98a");
    this.scene.background = this.skyDay.clone();
    this.scene.fog = new THREE.Fog(this.scene.background, 24, 58);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
    this.camPos = new THREE.Vector3(14, 11, 16);
    this.camTarget = new THREE.Vector3(0, 0.5, 0);
    this.view = { pos: this.camPos.clone(), target: this.camTarget.clone(), orbit: 0 };
    this.orbitAngle = 0;

    this.hemi = new THREE.HemisphereLight(0xdff1ff, 0x8a7350, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.position.set(10, 16, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.mood = { sky: this.skyDay.clone(), sun: C("#fff1d6"), zenith: C("#5b9bd5") };

    this.groups = {};
    this.buildIsland();
    this.buildTerrain();
    this.buildPlants();
    this.buildRain();
    this.buildErosion();
    this.buildProps();
    this.buildPeople();
    this.buildRing();
    this.buildCompare();

    this.clock = new THREE.Clock();
    this.cycle = null;          // ciclo de meses en el campo
    this.raining = false;
    this.erosionOn = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- cielo en degradé ---------------- */
  buildIsland() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { horizon: { value: this.skyDay.clone() }, zenith: { value: C("#5b9bd5") } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; varying vec3 vP;
        void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizon, zenith, pow(h, 0.6)), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), this.skyMat));
    this.groups.island = new THREE.Group(); // (antes: isla flotante) se conserva la clave para setMode
    this.scene.add(this.groups.island);
  }

  /* ---------------- relieve real (SRTM) dentro de un paisaje continuo ---------------- */
  buildTerrain() {
    const t = this.data.terreno;
    const n = t ? t.n : 15;
    let elev = t ? t.elev : null;
    if (!elev) { // sin SRTM: lomada suave sintética
      elev = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) elev.push(10 * Math.sin(i / 4) + 6 * Math.cos(j / 5));
    }
    const min = Math.min(...elev), max = Math.max(...elev), relief = max - min || 1;
    const visRelief = clamp(relief / 12, 0.5, 2.2);
    this.n = n;
    this.reliefM = relief;
    this.h = (i, j) => ((elev[i * n + j] - min) / relief) * visRelief + 0.05;
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum += this.h(i, j);
    this.meanH = sum / (n * n);

    // Grilla no uniforme: fina dentro del campo (datos SRTM), cada vez más gruesa hacia el horizonte.
    const F = 96, outs = [];
    for (let pos = S / 2, d = 0.22; pos < 48; d *= 1.2) { pos += d; outs.push(pos); }
    const lines = [...outs.slice().reverse().map((v) => -v),
      ...Array.from({ length: F + 1 }, (_, k) => -S / 2 + (k * S) / F), ...outs];
    const L = lines.length;
    const posArr = new Float32Array(L * L * 3), uv = new Float32Array(L * L * 2);
    this.landCol = new Float32Array(L * L * 3);
    this.fieldVerts = [];
    const rnd = seeded(7);
    for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) {
      const x = lines[b], z = lines[a], vi = a * L + b;
      posArr.set([x, this.groundH(x, z), z], vi * 3);
      uv.set([x * 0.42, z * 0.42], vi * 2);
      if (Math.abs(x) <= S / 2 + 1e-6 && Math.abs(z) <= S / 2 + 1e-6) {
        // vértice del campo: su color se interpola de las celdas de datos
        const u = clamp((x / S + 0.5) * (n - 1), 0, n - 1.0001), v = clamp((z / S + 0.5) * (n - 1), 0, n - 1.0001);
        const j = Math.floor(u), i = Math.floor(v), fu = u - j, fv = v - i;
        this.fieldVerts.push({ vi, k: [i * n + j, i * n + j + 1, (i + 1) * n + j, (i + 1) * n + j + 1],
          w: [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv], f: 0.93 + rnd() * 0.14 });
      } else {
        const c = landColor(x, z, rnd);
        this.landCol.set([c.r, c.g, c.b], vi * 3);
      }
    }
    const idx = [];
    for (let a = 0; a < L - 1; a++) for (let b = 0; b < L - 1; b++) {
      const p = a * L + b;
      idx.push(p, p + L, p + 1, p + 1, p + L, p + L + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(this.landCol, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.colCur = new Float32Array(n * n * 3);     // color por celda de datos (se anima)
    this.colTarget = new Float32Array(n * n * 3);
    this.noise = Array.from({ length: n * n }, () => 0.94 + rnd() * 0.12);
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: soilTexture() }));
    this.terrain.receiveShadow = true;

    // Alambrado alrededor del campo.
    const fence = new THREE.Group(), off = S / 2 + 0.14, pts = [];
    for (let s = -off; s < off; s += 0.5) pts.push([s, -off]);
    for (let s = -off; s < off; s += 0.5) pts.push([off, s]);
    for (let s = off; s > -off; s -= 0.5) pts.push([s, off]);
    for (let s = off; s > -off; s -= 0.5) pts.push([-off, s]);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.026, 0.34, 5).translate(0, 0.17, 0),
      new THREE.MeshStandardMaterial({ color: "#6e5a44", roughness: 1 }), pts.length);
    const d0 = new THREE.Object3D();
    pts.forEach(([x, z], k) => { d0.position.set(x, this.groundH(x, z), z); d0.updateMatrix(); posts.setMatrixAt(k, d0.matrix); });
    posts.castShadow = true;
    fence.add(posts);
    for (const hgt of [0.16, 0.29]) {
      const wire = pts.concat([pts[0]]).map(([x, z]) => new THREE.Vector3(x, this.groundH(x, z) + hgt, z));
      fence.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: "#8d8d8d" })));
    }

    // Dirección "agua abajo" por celda (para las partículas de erosión).
    this.down = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const dx = this.h(i, Math.min(n - 1, j + 1)) - this.h(i, Math.max(0, j - 1));
      const dz = this.h(Math.min(n - 1, i + 1), j) - this.h(Math.max(0, i - 1), j);
      const len = Math.hypot(dx, dz) || 1;
      this.down.push([-dx / len, -dz / len, Math.hypot(dx, dz)]);
    }

    const g = new THREE.Group();
    g.add(this.terrain, fence);
    this.scene.add(g);
    this.groups.field = g;
    this.setGroundCover(C("#7d9b4c"));
    this.colCur.set(this.colTarget);
    this.applyFieldColors();
  }

  /* Pinta los vértices del campo interpolando el color de las celdas de datos. */
  applyFieldColors() {
    const c = this.colCur, out = this.landCol;
    for (const v of this.fieldVerts) {
      for (let ch = 0; ch < 3; ch++) {
        out[v.vi * 3 + ch] = (c[v.k[0] * 3 + ch] * v.w[0] + c[v.k[1] * 3 + ch] * v.w[1]
          + c[v.k[2] * 3 + ch] * v.w[2] + c[v.k[3] * 3 + ch] * v.w[3]) * v.f;
      }
    }
    this.terrain.geometry.attributes.color.needsUpdate = true;
  }

  /* Altura dentro del campo: interpolación curva (Catmull-Rom) de la grilla SRTM. */
  heightAt(x, z) {
    const n = this.n;
    const u = clamp((x / S + 0.5) * (n - 1), 0, n - 1), v = clamp((z / S + 0.5) * (n - 1), 0, n - 1);
    const j = Math.min(n - 2, Math.floor(u)), i = Math.min(n - 2, Math.floor(v)), fu = u - j, fv = v - i;
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    const H = (a, b) => this.h(clamp(a, 0, n - 1), clamp(b, 0, n - 1));
    const rows = [];
    for (let a = -1; a <= 2; a++) rows.push(cr(H(i + a, j - 1), H(i + a, j), H(i + a, j + 1), H(i + a, j + 2), fu));
    return Math.max(0.02, cr(rows[0], rows[1], rows[2], rows[3], fv));
  }

  /* Altura del paisaje: el campo real y, fuera de él, lomadas que continúan su borde. */
  groundH(x, z) {
    const cx = clamp(x, -S / 2, S / 2), cz = clamp(z, -S / 2, S / 2);
    const base = this.heightAt(cx, cz), d = Math.hypot(x - cx, z - cz);
    if (d === 0) return base;
    const t = clamp(d / 16, 0, 1), w = t * t * (3 - 2 * t);
    return base * (1 - w) + this.meanH * w
      + w * (0.55 * Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17) + 0.3 * Math.sin(z * 0.38 + x * 0.11));
  }


  cellAt(x, z) {
    const n = this.n;
    const j = Math.round((x / S + 0.5) * (n - 1)), i = Math.round((z / S + 0.5) * (n - 1));
    return clamp(i, 0, n - 1) * n + clamp(j, 0, n - 1);
  }

  setGroundCover(color) {
    for (let k = 0; k < this.n * this.n; k++) {
      const f = this.noise[k];
      this.colTarget[k * 3] = color.r * f; this.colTarget[k * 3 + 1] = color.g * f; this.colTarget[k * 3 + 2] = color.b * f;
    }
  }

  /* Color por erosión de cada celda: verde sano → naranja (tolerancia) → marrón oscuro (2× tolerancia). */
  setErosionColors(values) {
    const ok = C("#8fb35e"), mid = C("#e2622e"), bad = C("#6b2508"), tmp = new THREE.Color();
    for (let k = 0; k < values.length; k++) {
      const r = values[k] / this.tol;
      if (r < 1) tmp.copy(ok).lerp(mid, r);
      else tmp.copy(mid).lerp(bad, clamp(r - 1, 0, 1));
      this.colTarget[k * 3] = tmp.r; this.colTarget[k * 3 + 1] = tmp.g; this.colTarget[k * 3 + 2] = tmp.b;
    }
  }

  /* ---------------- plantas (forma según cultivo) ---------------- */
  buildPlants() {
    const geos = plantGeometries();
    // Detalle superior para maíz (penacho) y sorgo (panoja rojiza).
    const tops = {
      maiz: new THREE.ConeGeometry(0.07, 0.18, 4).translate(0, 1.0, 0),
      sorgo: new THREE.IcosahedronGeometry(0.075, 1).scale(1, 1.5, 1).translate(0, 0.7, 0),
    };
    this.plantPos = [];
    // Sembrado en surcos (hileras este-oeste), como en una chacra real.
    const ROWS = 25, PER = 48, rnd = seeded(23);
    for (let a = 0; a < ROWS; a++) for (let b = 0; b < PER; b++) {
      const x = ((b + 0.5) / PER - 0.5) * S * 0.96 + (rnd() - 0.5) * 0.06;
      const z = ((a + 0.5) / ROWS - 0.5) * S * 0.96 + (rnd() - 0.5) * 0.04;
      this.plantPos.push({ x, z, y: this.heightAt(x, z) - 0.01, yaw: rnd() * 6.28, j: 0.8 + rnd() * 0.4 });
    }
    this.plants = {};
    const g = new THREE.Group();
    const tint = new THREE.Color();
    for (const [kind, geo] of Object.entries(geos)) {
      const mat = new THREE.MeshStandardMaterial({ color: "#6c9a3c", roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(geo, mat, this.plantPos.length);
      // Variación de tono planta a planta (multiplica el color del cultivo).
      this.plantPos.forEach((_, k) => mesh.setColorAt(k, tint.setScalar(0.82 + rnd() * 0.36)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      g.add(mesh);
      let top = null;
      if (tops[kind]) {
        top = new THREE.InstancedMesh(tops[kind], new THREE.MeshStandardMaterial({ color: kind === "sorgo" ? "#9c3b1e" : "#e8d27a", roughness: 0.9 }), this.plantPos.length);
        top.visible = false;
        g.add(top);
      }
      this.plants[kind] = { mesh, top, scale: 0, target: 0 };
    }
    this.groups.field.add(g);
    this.dummy = new THREE.Object3D();
  }

  updatePlants(dt) {
    for (const p of Object.values(this.plants)) {
      const before = p.scale;
      p.scale = staticMode() ? p.target : damp(p.scale, p.target, 5, dt);
      if (p.scale < 0.01 && p.target === 0) { p.mesh.visible = false; if (p.top) p.top.visible = false; continue; }
      p.mesh.visible = true;
      if (p.top) p.top.visible = p.scale > 0.6;
      if (Math.abs(before - p.scale) < 0.0005 && p.drawn) continue;
      p.drawn = true;
      this.plantPos.forEach((q, k) => {
        this.dummy.position.set(q.x, q.y, q.z);
        this.dummy.rotation.set(0, q.yaw, 0);
        const s = p.scale * q.j;
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        p.mesh.setMatrixAt(k, this.dummy.matrix);
        if (p.top) p.top.setMatrixAt(k, this.dummy.matrix);
      });
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.top) p.top.instanceMatrix.needsUpdate = true;
    }
  }

  /* Muestra el mes `idx` de un calendario (12 celdas May→Abr). */
  showMonth(row, idx) {
    const cell = row[idx];
    let kind = null;
    for (const p of Object.values(this.plants)) p.target = 0;
    if (cell) {
      kind = CROP_KIND[cell.id] || "leg";
      // etapa: posición dentro del tramo continuo del mismo cultivo
      let s = idx, e = idx;
      while (s > 0 && row[s - 1] && row[s - 1].id === cell.id) s--;
      while (e < 11 && row[e + 1] && row[e + 1].id === cell.id) e++;
      const len = e - s + 1, stage = (idx - s + 1) / len;
      const p = this.plants[kind];
      p.target = kind === "pasture" ? 1 : 0.35 + 0.65 * stage;
      const ripe = len > 2 && idx === e && kind !== "pasture";
      // Verde natural del follaje, teñido con el color de leyenda del cultivo; dorado al madurar.
      p.mesh.material.color.copy(C(FOLIAGE[kind] || "#5f9a3a")).lerp(C(cell.color), kind === "colza" ? 0.6 : 0.22)
        .lerp(C("#c9a54a"), ripe ? 0.6 : 0);
    }
    if (!this.erosionOn) this.setGroundCover(cell ? C("#6f8f45") : C("#9a7651"));
    return cell;
  }

  startCycle(row, onMonth, ms = 750, fixedIdx = null) {
    // En modo estático (capturas) se muestra un mes con cultivo: enero si hay, si no el primero.
    if (fixedIdx == null && staticMode()) {
      const jan = AGM.indexOf("Jan");
      fixedIdx = row[jan] ? jan : Math.max(0, row.findIndex((c) => c));
    }
    this.cycle = { row, onMonth, ms, idx: -1, t: 0, fixedIdx };
    this.advanceCycle();
  }

  advanceCycle() {
    const c = this.cycle;
    if (!c) return;
    c.idx = c.fixedIdx != null ? c.fixedIdx : (c.idx + 1) % 12;
    const cell = this.showMonth(c.row, c.idx);
    c.onMonth && c.onMonth(c.idx, cell);
  }

  stopCycle() { this.cycle = null; for (const p of Object.values(this.plants)) p.target = 0; }

  /* ---------------- lluvia ---------------- */
  buildRain() {
    const N = 900;
    this.rainData = new Float32Array(N * 6);
    for (let k = 0; k < N; k++) this.resetDrop(k, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.rainData, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#4a8fe0", transparent: true, opacity: 0.7 }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  resetDrop(k, anyHeight) {
    const x = (Math.random() - 0.5) * S * 1.05, z = (Math.random() - 0.5) * S * 1.05;
    const y = anyHeight ? Math.random() * 9 : 8 + Math.random() * 2;
    this.rainData.set([x, y, z, x, y + 0.32, z], k * 6);
  }

  updateRain(dt) {
    if (!this.rain.visible) return;
    const d = this.rainData;
    for (let k = 0; k < d.length / 6; k++) {
      const o = k * 6;
      d[o + 1] -= 9 * dt; d[o + 4] -= 9 * dt;
      if (d[o + 1] < this.heightAt(d[o], d[o + 2])) this.resetDrop(k, false);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------------- tierra que corre ladera abajo ---------------- */
  buildErosion() {
    this.erosionPool = 320;
    this.ero = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 0),
      new THREE.MeshStandardMaterial({ color: "#6b4423", flatShading: true }), this.erosionPool);
    this.ero.visible = false;
    this.eroParticles = Array.from({ length: this.erosionPool }, () => ({ x: 0, z: 0, life: -1 }));
    this.groups.field.add(this.ero);
  }

  setErosion(values) {
    // Más toneladas → más partículas; las celdas que más pierden emiten más.
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    this.eroActive = Math.round(this.erosionPool * clamp(mean / (2 * this.tol), 0.06, 1));
    let acc = 0;
    this.eroCdf = values.map((v) => (acc += Math.max(0.01, v)));
    this.eroTotal = acc;
    // Arrancan escalonadas: cada una con una vida restante distinta.
    this.eroParticles.forEach((p) => { this.spawnParticle(p); p.life *= Math.random(); });
  }

  spawnParticle(p) {
    const r = Math.random() * this.eroTotal;
    let k = this.eroCdf.findIndex((c) => c >= r);
    if (k < 0) k = 0;
    const n = this.n, i = Math.floor(k / n), j = k % n;
    p.x = (j / (n - 1) - 0.5) * S + (Math.random() - 0.5) * 0.6;
    p.z = (i / (n - 1) - 0.5) * S + (Math.random() - 0.5) * 0.6;
    p.life = 1.5 + Math.random() * 2;
  }

  updateErosion(dt) {
    if (!this.ero.visible) return;
    this.eroParticles.forEach((p, idx) => {
      if (idx >= this.eroActive) { this.dummy.scale.set(0, 0, 0); }
      else {
        p.life -= dt;
        if (p.life <= 0) this.spawnParticle(p);
        const [dx, dz, slope] = this.down[this.cellAt(p.x, p.z)];
        const v = 0.35 + slope * 3;
        p.x += dx * v * dt; p.z += dz * v * dt;
        if (Math.abs(p.x) > S / 2 || Math.abs(p.z) > S / 2) this.spawnParticle(p);
        this.dummy.position.set(p.x, this.heightAt(p.x, p.z) + 0.05, p.z);
        const s = clamp(p.life, 0, 1);
        this.dummy.scale.set(s, s, s);
      }
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.ero.setMatrixAt(idx, this.dummy.matrix);
    });
    this.ero.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- casa, silo, molino, árboles, nubes, satélite ---------------- */
  buildProps() {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
    const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    // casa
    const house = new THREE.Group();
    const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.2), mat("#f3ead8")));
    body.position.y = 0.5;
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.8, 4), mat("#b5523b")));
    roof.position.y = 1.4; roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.02), mat("#6b4a2b"));
    door.position.set(0.3, 0.25, 0.61);
    house.add(body, roof, door);
    house.position.set(-8.2, this.groundH(-8.2, -3.5) - 0.03, -3.5);
    house.rotation.y = 0.5;
    // galpón
    const shed = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.1), mat("#c9cfd6")));
    shed.position.set(-7.8, this.groundH(-7.8, -6) + 0.4, -6);
    // silo
    const silo = new THREE.Group();
    const sb = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2, 10), mat("#d9dde2")));
    sb.position.y = 1;
    const st = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 10), mat("#9aa3ad")));
    st.position.y = 2.25;
    silo.add(sb, st);
    silo.position.set(-6.4, this.groundH(-6.4, -6.6) - 0.03, -6.6);
    // molino de viento
    const mill = new THREE.Group();
    const tower = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.32, 3.2, 4), mat("#8e9399")));
    tower.position.y = 1.6;
    this.rotor = new THREE.Group();
    for (let k = 0; k < 8; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.02), mat("#c7ccd1"));
      blade.position.y = 0.38;
      const arm = new THREE.Group();
      arm.add(blade);
      arm.rotation.z = (k / 8) * Math.PI * 2;
      this.rotor.add(arm);
    }
    this.rotor.position.set(0, 3.25, 0.2);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 0.6), mat("#c7ccd1"));
    tail.position.set(0, 3.25, -0.4);
    mill.add(tower, this.rotor, tail);
    mill.position.set(-5.8, this.groundH(-5.8, 6.8) - 0.03, 6.8);
    mill.rotation.y = -0.6;
    // árboles: cortina de abrigo al norte, monte junto a la casa y algunos sueltos
    const trees = new THREE.Group(), rndT = seeded(41), spots = [];
    for (let x = -4.5; x <= 5.5; x += 0.95) spots.push([x + (rndT() - 0.5) * 0.3, -7.4 + (rndT() - 0.5) * 0.4]);
    for (let k = 0; k < 7; k++) spots.push([-9.6 + rndT() * 2.2, -1.5 + rndT() * 5.5]);
    [[7.8, -6.5], [8.6, -4.8], [6.9, 7.4], [8.4, 5.9], [2.5, 8.9], [-3, 8.2], [12, 1.5], [-13, -9], [14, -11], [-12, 10], [10, 13]].forEach((q) => spots.push(q));
    const crowns = new THREE.InstancedMesh(crownGeometry(), mat("#ffffff"), spots.length);
    crowns.material.flatShading = false;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.1, 1.0, 6).translate(0, 0.5, 0), mat("#5e4630"), spots.length);
    const dT = new THREE.Object3D(), greens = ["#3f6f35", "#4a7d3c", "#35622f", "#567f3f"];
    spots.forEach(([x, z], k) => {
      const sc = 0.5 + rndT() * 0.45;
      dT.position.set(x, this.groundH(x, z) - 0.03, z);
      dT.rotation.set(0, rndT() * 6.28, 0);
      dT.scale.set(sc, sc * (0.9 + rndT() * 0.4), sc);
      dT.updateMatrix();
      crowns.setMatrixAt(k, dT.matrix);
      trunks.setMatrixAt(k, dT.matrix);
      crowns.setColorAt(k, C(greens[k % greens.length]).multiplyScalar(0.85 + rndT() * 0.3));
    });
    crowns.castShadow = trunks.castShadow = true;
    crowns.receiveShadow = true;
    trees.add(crowns, trunks);
    // nubes (cúmulos suaves y achatados)
    this.clouds = new THREE.Group();
    const rndC = seeded(5);
    const cloudMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, emissive: "#8f98a3", emissiveIntensity: 0.35 });
    for (let k = 0; k < 5; k++) {
      const c = new THREE.Group();
      for (let b = 0; b < 7; b++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + rndC() * 0.5, 2), cloudMat);
        s.position.set(b * 0.55 - 1.6, rndC() * 0.3, (rndC() - 0.5) * 0.9);
        s.scale.y = 0.6;
        c.add(s);
      }
      c.position.set(-12 + k * 6, 8 + (k % 2) * 1.2, -8 + (k % 3) * 5);
      this.clouds.add(c);
    }
    // satélite + haz de escaneo
    this.sat = new THREE.Group();
    const satBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.7), mat("#d8b45a"));
    const panelMat = new THREE.MeshStandardMaterial({ color: "#2b4c8c", metalness: 0.4, roughness: 0.4, flatShading: true });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.5), panelMat); p1.position.x = 1.1;
    const p2 = p1.clone(); p2.position.x = -1.1;
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: "#9fd3ff", transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    this.beam.position.y = -4.6;
    this.sat.add(satBody, p1, p2, this.beam);
    this.sat.position.set(0, 10, 0);

    g.add(house, shed, silo, mill, trees, this.clouds, this.sat);
    this.scene.add(g);
    this.groups.props = g;
  }

  /* ---------------- productor y agrónomo ---------------- */
  buildPeople() {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
    const person = (shirt, hat, clipboard) => {
      const p = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.6, 6), mat("#3b4a6b")); legs.position.y = 0.3;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 3, 8), mat(shirt)); body.position.y = 0.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat("#d9a77c")); head.position.y = 1.45;
      p.add(legs, body, head);
      if (hat) {
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 12), mat(hat)); brim.position.y = 1.56;
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.16, 10), mat(hat)); crown.position.y = 1.65;
        p.add(brim, crown);
      }
      if (clipboard) {
        const cb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.32, 0.03), mat("#f5f1e6"));
        cb.position.set(0.18, 0.95, 0.24); cb.rotation.x = -0.5;
        p.add(cb);
      }
      p.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      return p;
    };
    const farmer = person("#3f7d4e", "#c9a25a", false);
    // Parados sobre el pasto, en el borde este del campo (sin árboles delante).
    farmer.position.set(6.1, this.groundH(6.1, 0.7) - 0.02, 0.7);
    farmer.rotation.y = 1.2;
    const agro = person("#2a78d6", null, true);
    agro.position.set(6.3, this.groundH(6.3, -0.6) - 0.02, -0.6);
    agro.rotation.y = 1.9;
    g.add(farmer, agro);
    g.visible = false;
    this.scene.add(g);
    this.groups.people = g;
  }

  /* ---------------- anillo del año (lluvia vs. evapotranspiración) ---------------- */
  buildRing() {
    const months = this.data.clima.mensual;
    const g = new THREE.Group();
    const R = 4.2, step = (Math.PI * 2) / 12;
    const maxV = Math.max(...months.map((m) => Math.max(m.lluvia_mm, m.et0_mm)));
    const k = 3.2 / maxV;
    this.ringSectors = [];
    this.ringRain = [];
    this.ringEt = [];
    const wet = C("#7fb069"), dry = C("#c98b4f"), parched = C("#9b5a2e");
    months.forEach((m, i) => {
      const bal = m.lluvia_mm - m.et0_mm;
      const col = bal >= 0 ? wet.clone() : dry.clone().lerp(parched, clamp(-bal / 80, 0, 1));
      const sector = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, 0.3, 6, 1, false, i * step + 0.02, step - 0.04),
        new THREE.MeshStandardMaterial({ color: "#a9c77f", flatShading: true }));
      sector.position.y = 0.15;
      sector.receiveShadow = true;
      sector.userData = { baseColor: C("#a9c77f"), dataColor: col, deficit: bal < -10 };
      g.add(sector);
      this.ringSectors.push(sector);

      const a = i * step + step / 2;
      const rain = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1, 10),
        new THREE.MeshStandardMaterial({ color: "#2a78d6", transparent: true, opacity: 0.85, roughness: 0.3 }));
      rain.position.set(Math.sin(a - 0.1) * 3.1, 0.3, Math.cos(a - 0.1) * 3.1);
      rain.userData = { h: m.lluvia_mm * k, cur: 0.001, on: false };
      rain.castShadow = true;
      const et = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 10),
        new THREE.MeshStandardMaterial({ color: "#eb6834", transparent: true, opacity: 0.75, roughness: 0.4 }));
      et.position.set(Math.sin(a + 0.12) * 3.1, 0.3, Math.cos(a + 0.12) * 3.1);
      et.userData = { h: m.et0_mm * k, cur: 0.001, on: false };
      et.castShadow = true;
      g.add(rain, et);
      this.ringRain.push(rain);
      this.ringEt.push(et);

      const label = textSprite(AGM[i], "#4a4842");
      label.position.set(Math.sin(a) * (R + 0.8), 0.5, Math.cos(a) * (R + 0.8));
      g.add(label);
    });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 16), new THREE.MeshStandardMaterial({ color: "#f3ead8", flatShading: true }));
    hub.position.y = 0.25;
    const hubLabel = textSprite("1 year", "#1d1d1b", 1.4);
    hubLabel.position.y = 1.1;
    g.add(hub, hubLabel);
    g.visible = false;
    this.scene.add(g);
    this.groups.ring = g;
  }

  updateRing(dt) {
    if (!this.groups.ring.visible) return;
    for (const m of [...this.ringRain, ...this.ringEt]) {
      const u = m.userData;
      const target = u.on ? u.h : 0.001;
      u.cur = staticMode() ? target : damp(u.cur, target, 3.5, dt);
      m.scale.y = Math.max(0.001, u.cur);
      m.position.y = 0.3 + u.cur / 2;
    }
    this.ringSectors.forEach((s, i) => {
      const u = s.userData;
      const want = this.ringDry ? u.dataColor : u.baseColor;
      s.material.color.lerp(want, staticMode() ? 1 : 1 - Math.exp(-4 * dt));
      const lift = this.ringDry && u.deficit && this.ringFocus === i ? 0.35 : 0;
      s.position.y = damp(s.position.y, 0.15 + lift, 6, dt);
    });
  }

  /* ---------------- antes / ahora (nubes y soles según datos) ---------------- */
  buildCompare() {
    const trends = this.data.clima.tendencias.indicadores || this.data.clima.tendencias;
    const rain = trends.find((t) => t.id === "lluvia_mm"), heat = trends.find((t) => t.id === "dias_calor");
    const g = new THREE.Group();
    const mat = (c, e) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, emissive: e || 0x000000 });
    const maxRain = Math.max(rain.valor_1, rain.valor_2), maxHeat = Math.max(heat.valor_1, heat.valor_2);
    this.cmp = [];
    [[rain.valor_1, heat.valor_1, -3.2, "1996–2010"], [rain.valor_2, heat.valor_2, 3.2, "2011–2025"]].forEach(([r, h, x, lab]) => {
      const side = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.4, 14), mat("#a9c77f"));
      base.receiveShadow = true;
      side.add(base);
      const cloud = new THREE.Group();
      for (let b = 0; b < 6; b++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mat("#f4f7fa", "#5d6670"));
        s.position.set(Math.cos(b) * 0.7, Math.sin(b * 2) * 0.2, Math.sin(b) * 0.5);
        cloud.add(s);
      }
      cloud.position.y = 3.6;
      const rs = (r / maxRain) ** 2; // la diferencia se nota más en volumen
      cloud.userData = { target: rs, cur: 0.001 };
      side.add(cloud);
      // gotas: cantidad proporcional a la lluvia
      const nDrops = Math.round(70 * (r / maxRain) ** 3);
      const dropsData = new Float32Array(nDrops * 6);
      for (let k = 0; k < nDrops; k++) {
        const dx = (Math.random() - 0.5) * 1.6, dz = (Math.random() - 0.5) * 1.2, y = Math.random() * 3;
        dropsData.set([dx, y, dz, dx, y + 0.25, dz], k * 6);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute("position", new THREE.BufferAttribute(dropsData, 3));
      const drops = new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: "#4a8fe0" }));
      drops.visible = false;
      side.add(drops);
      // sol: tamaño según días de calor
      const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), mat("#f6c445", "#f08a24"));
      sun.material.emissiveIntensity = 0.35 + 0.65 * (h / maxHeat);
      sun.position.set(1.5, 5.2, -0.6);
      sun.userData = { target: 0.55 + 0.75 * (h / maxHeat) ** 2, cur: 0.001 };
      side.add(sun);
      const label = textSprite(lab, "#1d1d1b", 1.2);
      label.position.set(0, 0.9, 2.4);
      side.add(label);
      side.position.x = x;
      g.add(side);
      this.cmp.push({ cloud, drops, sun, dropsData, show: { cloud: false, sun: false } });
    });
    g.visible = false;
    this.scene.add(g);
    this.groups.compare = g;
  }

  updateCompare(dt) {
    if (!this.groups.compare.visible) return;
    this.cmp.forEach((c) => {
      for (const [obj, on] of [[c.cloud, c.show.cloud], [c.sun, c.show.sun]]) {
        const u = obj.userData, t = on ? u.target : 0.001;
        u.cur = staticMode() ? t : damp(u.cur, t, 3, dt);
        obj.scale.setScalar(Math.max(0.001, u.cur));
      }
      c.drops.visible = c.show.cloud;
      if (c.show.cloud && !staticMode()) {
        const d = c.dropsData;
        for (let o = 0; o < d.length; o += 6) {
          d[o + 1] -= 4 * dt; d[o + 4] -= 4 * dt;
          if (d[o + 1] < 0.2) { d[o + 1] += 3.1; d[o + 4] += 3.1; }
        }
        c.drops.geometry.attributes.position.needsUpdate = true;
      }
      c.sun.rotation.y += dt * 0.4;
    });
  }

  /* ---------------- modos, cámara y clima ---------------- */
  setMode(mode) {
    const show = {
      diorama: ["island", "field", "props"],
      field: ["island", "field", "props"],
      people: ["island", "field", "props", "people"],
      ring: ["ring"],
      compare: ["compare"],
    }[mode];
    for (const [k, g] of Object.entries(this.groups)) g.visible = show.includes(k);
    this.sat.visible = mode === "diorama";
    this.rain.visible = false;
    this.ero.visible = false;
    this.raining = false;
    this.erosionOn = false;
    this.ringDry = false;
    this.stopCycle();
  }

  setView(pos, target, orbit = 0) {
    this.view = { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target), orbit };
    this.orbitAngle = 0;
    if (staticMode()) { this.camPos.copy(this.view.pos); this.camTarget.copy(this.view.target); }
  }

  setMood(name) {
    this.mood = name === "sunset"
      ? { sky: this.skySunset.clone(), sun: C("#ffb070"), zenith: C("#6f6aa8") }
      : { sky: this.skyDay.clone(), sun: C("#fff1d6"), zenith: C("#5b9bd5") };
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    // cámara con suavizado y órbita lenta opcional
    this.orbitAngle += this.view.orbit * dt;
    const rel = this.view.pos.clone().sub(this.view.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitAngle);
    const desired = this.view.target.clone().add(rel);
    const k = staticMode() ? 1 : 1 - Math.exp(-2.2 * dt);
    this.camPos.lerp(desired, k);
    this.camTarget.lerp(this.view.target, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    // clima de la escena
    this.scene.background.lerp(this.mood.sky, staticMode() ? 1 : 1 - Math.exp(-1.5 * dt));
    this.scene.fog.color.copy(this.scene.background);
    this.skyMat.uniforms.horizon.value.copy(this.scene.background);
    this.skyMat.uniforms.zenith.value.lerp(this.mood.zenith, staticMode() ? 1 : 1 - Math.exp(-1.5 * dt));
    this.sun.color.lerp(this.mood.sun, 1 - Math.exp(-1.5 * dt));
    // ciclo de meses
    if (this.cycle && this.cycle.fixedIdx == null && !staticMode()) {
      this.cycle.t += dt * 1000;
      if (this.cycle.t >= this.cycle.ms) { this.cycle.t = 0; this.advanceCycle(); }
    }
    // color del suelo
    const f = staticMode() ? 1 : 1 - Math.exp(-3 * dt);
    for (let i = 0; i < this.colCur.length; i++) this.colCur[i] += (this.colTarget[i] - this.colCur[i]) * f;
    this.applyFieldColors();
    // animaciones
    if (this.rotor) this.rotor.rotation.z += dt * 2.2;
    this.clouds.children.forEach((c, i) => { c.position.x += dt * 0.25; if (c.position.x > 13) c.position.x = -13; c.position.y += Math.sin(t + i) * 0.002; });
    if (this.sat.visible) {
      const a = t * 0.25;
      this.sat.position.set(Math.sin(a) * 6, 9.5, Math.cos(a) * 2 - 1);
      this.sat.rotation.y = -a;
      this.beam.material.opacity = 0.1 + 0.08 * Math.sin(t * 3);
    }
    this.updatePlants(dt);
    this.updateRain(dt);
    this.updateErosion(dt);
    this.updateRing(dt);
    this.updateCompare(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

/* Etiqueta de texto como sprite. */
function textSprite(text, color = "#1d1d1b", scale = 1) {
  const font = "bold 64px system-ui, Segoe UI, sans-serif";
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const w = Math.max(256, Math.ceil(probe.measureText(text).width + 40)); // el ancho se adapta al texto
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.font = font;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.6 * scale * (w / 256), 0.8 * scale, 1);
  return sp;
}

/* ------------------------------------------------------------- slides 3D */
function build3DSlides(d, scene) {
  const base = buildSlides(d);
  const by = Object.fromEntries(base.map((s) => [s.key, s]));
  const [cur, alt] = d.rotaciones;
  const tol = (d.zonas && d.zonas.tolerancia_t_ha) || 7;
  const area = (d.zonas && d.zonas.area_ha) || 100;
  const eroCur = d.terreno ? d.terreno.eros[cur.id] : new Array(225).fill(cur.indicadores.erosion_t_ha || 5);
  const eroAlt = d.terreno ? d.terreno.eros[alt.id] : new Array(225).fill(alt.indicadores.erosion_t_ha || 4);
  const ci = cur.indicadores, ai = alt.indicadores;
  const hasEro = ci.erosion_t_ha != null;
  const trucks = (t) => Math.round((t * area) / 30); // camión de ~30 t
  const months = d.clima.mensual;
  const thirsty = months.map((m) => m.et0_mm - m.lluvia_mm > 10);
  const firstThirsty = thirsty.indexOf(true), lastThirsty = thirsty.lastIndexOf(true);

  const hud = (stage, cls, html) => {
    const el = document.createElement("div");
    el.className = `hud ${cls}`;
    el.innerHTML = html;
    stage.appendChild(el);
    return el;
  };
  const monthHud = (stage) => hud(stage, "hud-month", `<span class="m">May</span><span class="c">—</span>`);
  const setMonthHud = (el, idx, cell) => {
    el.querySelector(".m").textContent = AGM[idx];
    el.querySelector(".c").textContent = cell ? cell.nombre : "No crop";
    el.classList.toggle("bare", !cell);
  };
  const truckHud = (stage, label, t) => {
    const n = trucks(t), shown = Math.min(n, 48);
    return hud(stage, "hud-trucks step", `
      <div class="t-label">${escH(label)}</div>
      <div class="t-icons">${Array.from({ length: shown }, (_, k) => `<span style="--d:${k * 35}ms">🚚</span>`).join("")}${n > shown ? `<b>+${n - shown}</b>` : ""}</div>
      <div class="t-num"><strong>${nf(n)}</strong> truckloads of soil a year <small>(${nf(t, 1)} t/ha × ${nf(area)} ha)</small></div>`);
  };

  return [
    { ...by.intro, render(stage) {
        scene.setMode("diorama");
        scene.setMood("day");
        scene.setView([15, 10, 17], [0, 0.6, 0], 0.05);
        scene.startCycle(cur.calendario[0], null, 1100);
        hud(stage, "hud-bottom", `<span class="chip big-chip step">Today: ${escH(cur.nombre)}</span>`);
        hud(stage, "hud-tag", `🛰️ Data from NASA satellites`);
        return (b) => { if (b >= 1) stage.querySelector(".hud-bottom .step").classList.add("on"); };
      } },

    { ...by.clima,
      narration: [
        "First, your area's climate. This ring is one year: each slice is a month, and the blue columns are rainfall.",
        "The orange columns are the water the sun's heat takes away, what agronomists call evapotranspiration.",
        firstThirsty >= 0
          ? `The slices that dry out and change color are the months when more water leaves than falls: from ${MONTH_FULL[months[firstThirsty].mes]} to ${MONTH_FULL[months[lastThirsty].mes]} your crops go thirsty.`
          : "Almost all year, more water falls than leaves.",
      ],
      render(stage) {
        scene.setMode("ring");
        scene.setMood("day");
        scene.setView([0, 10.5, 13.5], [0, 0.4, 0], 0);
        hud(stage, "hud-bottom", `<div class="legend3d"><span><i style="background:#2a78d6"></i>Rainfall</span><span class="step" data-k="et"><i style="background:#eb6834"></i>Water the sun takes away</span><span class="step" data-k="dry"><i style="background:#c98b4f"></i>Thirsty months</span></div>`);
        const mh = hud(stage, "hud-month step", `<span class="m">—</span><span class="c">month</span>`);
        let loop = null;
        return (b) => {
          if (b >= 0) scene.ringRain.forEach((m, i) => setTimeout(() => (m.userData.on = true), staticMode() ? 0 : i * 90));
          if (b >= 1) { scene.ringEt.forEach((m, i) => setTimeout(() => (m.userData.on = true), staticMode() ? 0 : i * 90)); stage.querySelector('[data-k="et"]').classList.add("on"); }
          if (b >= 2 && !loop) {
            scene.ringDry = true;
            stage.querySelector('[data-k="dry"]').classList.add("on");
            mh.classList.add("on");
            scene.setView([0, 10.5, 13.5], [0, 0.4, 0], 0.35);
            let i = 0;
            const stepFn = () => {
              if (!mh.isConnected) { clearInterval(loop); return; }
              scene.ringFocus = i;
              mh.querySelector(".m").textContent = AGM[i];
              mh.querySelector(".c").textContent = thirsty[i] ? "water runs short" : "enough water";
              mh.classList.toggle("bare", thirsty[i]);
              i = (i + 1) % 12;
            };
            if (staticMode()) { i = months.findIndex((m) => m.mes === 1); stepFn(); loop = 1; }
            else { stepFn(); loop = setInterval(stepFn, 700); }
          }
        };
      } },

    { ...by.cambio, render(stage) {
        scene.setMode("compare");
        scene.setMood("day");
        scene.setView([0, 4.8, 12.5], [0, 2.4, 0], 0);
        const tr = d.clima.tendencias.indicadores || d.clima.tendencias;
        const rain = tr.find((t) => t.id === "lluvia_mm"), heat = tr.find((t) => t.id === "dias_calor");
        hud(stage, "hud-bottom", `
          <div class="cmp-nums">
            <div class="step" data-k="r">🌧️ Rainfall: <s>${nf(rain.valor_1)}</s> → <strong>${nf(rain.valor_2)} mm</strong> <em class="down">${nf(rain.cambio_pct)}%</em></div>
            <div class="step" data-k="h">☀️ Hot days: <s>${nf(heat.valor_1)}</s> → <strong>${nf(heat.valor_2)}</strong> <em class="down">+${nf(heat.cambio_pct)}%</em></div>
          </div>`);
        return (b) => {
          if (b >= 0) { scene.cmp[0].show.cloud = true; setTimeout(() => (scene.cmp[1].show.cloud = true), staticMode() ? 0 : 900); stage.querySelector('[data-k="r"]').classList.add("on"); }
          if (b >= 2) { scene.cmp.forEach((c, i) => setTimeout(() => (c.show.sun = true), staticMode() ? 0 : i * 700)); stage.querySelector('[data-k="h"]').classList.add("on"); }
        };
      } },

    { ...by.hoy,
      narration: [
        "Now, your field. This is its real terrain, measured by NASA's SRTM mission, and this is how its cover changes month by month with your current rotation.",
        `The soil is bare ${nf(ci.meses_descubiertos)} months a year. When it rains, water carries soil down to the low spots: the darker colors show where the most soil is lost.`,
        hasEro
          ? `On average about ${nf(ci.erosion_t_ha)} tonnes per hectare are lost each year: across your ${nf(area)} hectares, that's like ${nf(trucks(ci.erosion_t_ha))} truckloads of fertile soil a year.`
          : "The longer the soil stays bare, the more soil is lost.",
      ],
      render(stage) {
        scene.setMode("field");
        scene.setMood("day");
        scene.setView([9.5, 9, 11], [0, 0.6, 0], 0.04);
        const mh = monthHud(stage);
        const bareFirst = cur.calendario[0].findIndex((c) => !c);
        scene.startCycle(cur.calendario[0], (i, c) => setMonthHud(mh, i, c), 800, staticMode() && bareFirst >= 0 ? bareFirst : null);
        const th = hasEro ? truckHud(stage, "Soil being lost", ci.erosion_t_ha) : null;
        return (b) => {
          if (b >= 1 && !scene.erosionOn) {
            scene.erosionOn = true;
            scene.setErosionColors(eroCur);
            scene.setErosion(eroCur);
            scene.rain.visible = true;
            scene.ero.visible = true;
            scene.setView([8, 7.5, 10], [0, 0.5, 0], 0.04);
          }
          if (b >= 2 && th) th.classList.add("on");
        };
      } },

    ...(by.diagnostico ? [{ ...by.diagnostico, render(stage) {
        scene.setMode("field");
        scene.setMood("day");
        // El campo queda a la izquierda; las tarjetas del diagnóstico ocupan la derecha.
        scene.setView([-2.5, 8.5, 14.5], [3.2, 0.4, 0], 0.03);
        scene.startCycle(cur.calendario[0], null, 900);
        if (hasEro) { scene.erosionOn = true; scene.setErosionColors(eroCur); }
        const panel = hud(stage, "hud-panel", "");
        return by.diagnostico.render(panel);
      } }] : []),

    { ...by.opcion,
      narration: [
        `Now look at the same field with an option that fits what matters to you: ${spoken(alt.nombre)}.`,
        hasEro
          ? `The soil stays covered almost all year, water carries away less soil, and the loss drops from ${nf(trucks(ci.erosion_t_ha))} to about ${nf(trucks(ai.erosion_t_ha))} truckloads a year.`
          : "The soil stays covered almost all year and water carries away less soil.",
        by.opcion.narration[2],
      ],
      render(stage) {
        scene.setMode("field");
        scene.setMood("day");
        scene.setView([2.5, 10.5, 12.5], [0, 0.4, 0], 0.03);
        scene.erosionOn = true;
        scene.setErosionColors(eroCur);
        scene.colCur.set(scene.colTarget);
        const mh = monthHud(stage);
        hud(stage, "hud-tag", `With the option: <strong>${escH(alt.nombre)}</strong>`);
        const coveredIdx = alt.calendario[0].findIndex((c, i) => c && !cur.calendario[0][i]);
        const th = hasEro ? truckHud(stage, `${nf(trucks(ci.erosion_t_ha))} → ${nf(trucks(ai.erosion_t_ha))} truckloads`, ai.erosion_t_ha) : null;
        const chips = [];
        if (ai.meses_descubiertos < ci.meses_descubiertos - 0.5) chips.push("🌱 Soil covered almost all year");
        if (ai.familias > ci.familias) chips.push(`🔄 ${ai.familias} plant families`);
        if (ai.anios_doble_cultivo) chips.push("🌾 Two harvests a year");
        const chipEl = hud(stage, "hud-chips", chips.map((c, i) => `<span class="chip step" style="--d:${i * 160}ms">${escH(c)}</span>`).join(""));
        return (b) => {
          if (b >= 0 && !scene.cycle) {
            scene.startCycle(alt.calendario[0], (i, c) => setMonthHud(mh, i, c), 800, staticMode() && coveredIdx >= 0 ? coveredIdx : null);
            setTimeout(() => { scene.setErosionColors(eroAlt); scene.setErosion(eroAlt); scene.rain.visible = true; scene.ero.visible = true; }, staticMode() ? 0 : 1200);
          }
          if (b >= 1 && th) th.classList.add("on");
          if (b >= 2) chipEl.querySelectorAll(".chip").forEach((c) => c.classList.add("on"));
        };
      } },

    { ...by.revisar, render(stage) {
        scene.setMode("people");
        scene.setMood("day");
        // Las personas quedan a la izquierda; la lista ocupa la derecha.
        const gy = scene.groundH(6.2, 0);
        scene.setView([11.8, gy + 3, 1.4], [5.2, gy + 1.1, -2.4], 0);
        scene.startCycle(alt.calendario[0], null, 1100);
        const panel = hud(stage, "hud-panel", "");
        return by.revisar.render(panel);
      } },

    { ...by.cierre, render(stage) {
        scene.setMode("diorama");
        scene.setMood("sunset");
        scene.sat.visible = false;
        scene.setView([16, 7, 15], [0, 0.6, 0], 0.08);
        scene.startCycle(alt.calendario[0], null, 1100);
        const panel = hud(stage, "hud-closing", "");
        return by.cierre.render(panel);
      } },
  ];
}

/* ---------------------------------------------------------------- arranque */
function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }
  catch (e) { return false; }
}

export function start3D(root, data) {
  if (!webglOk()) {
    root.querySelector(".start").hidden = true;
    root.querySelector(".stage-inner").innerHTML =
      `<p class="no3d">Your browser can't display 3D. <a href="slides.html?analysis=1">See the charts for this analysis</a>.</p>`;
    return null;
  }
  const scene = new FieldScene(root.querySelector(".canvas3d"), data);
  const player = new Player(root, build3DSlides(data, scene));
  window.cooperScene = scene;
  return player;
}
