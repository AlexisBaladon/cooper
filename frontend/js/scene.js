/* Cooper · living background. The whole interface sits on a photograph of the field that
 * follows the real sky at the farm: day, sunset/sunrise, night or overcast, chosen from the
 * field's local time, today's sunrise and sunset and the current weather. The sidebar takes
 * the same scene. A light particle layer adds stars, rain or glints. */
(function () {
  "use strict";
  const C = window.Cooper;

  const SCENES = {
    lindo: { img: "assets/scenes/lindo.webp", sm: "assets/scenes/lindo-sm.webp", label: "Clear day" },
    tarde: { img: "assets/scenes/tarde.webp", sm: "assets/scenes/tarde-sm.webp", label: "Sunset" },
    noche: { img: "assets/scenes/noche.webp", sm: "assets/scenes/noche-sm.webp", label: "Night" },
    nub: { img: "assets/scenes/nub.webp", sm: "assets/scenes/nub-sm.webp", label: "Overcast" },
  };
  const CLOUDY = new Set(["cloudy", "fog", "drizzle", "rain", "storm", "snow"]);
  const S = { scene: null, weather: null, layers: [], active: 0, canvas: null, particles: null, timer: 0 };

  /* Minutes since midnight at the field (falls back to the device clock). */
  function fieldMinutes(tz) {
    const now = new Date();
    if (!tz) return now.getHours() * 60 + now.getMinutes();
    try {
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
      const h = Number(p.find((x) => x.type === "hour").value) % 24, m = Number(p.find((x) => x.type === "minute").value);
      return h * 60 + m;
    } catch (_) { return now.getHours() * 60 + now.getMinutes(); }
  }
  const hm = (iso) => { const m = /T(\d\d):(\d\d)/.exec(iso || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  function decide(w) {
    const forced = new URLSearchParams(location.search).get("scene");
    if (forced && SCENES[forced]) return forced;
    const t = fieldMinutes(w?.zona_horaria);
    const rise = hm(w?.diario?.[0]?.amanecer) ?? 6 * 60 + 15;
    const set = hm(w?.diario?.[0]?.atardecer) ?? 19 * 60 + 30;
    const GOLD = 50; // minutes of golden light around sunrise and sunset
    if (t < rise - 25 || t > set + 35) return "noche";
    const golden = Math.abs(t - set) <= GOLD || Math.abs(t - rise) <= GOLD;
    const icon = w?.actual?.icono;
    if (icon && CLOUDY.has(icon)) return "nub";
    if (golden) return "tarde";
    return "lindo";
  }

  function build() {
    const root = document.createElement("div");
    root.id = "scene";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `<div class="scene-layer"></div><div class="scene-layer"></div><div class="scene-scrim"></div><canvas class="scene-fx"></canvas>`;
    document.body.prepend(root);
    S.layers = [...root.querySelectorAll(".scene-layer")];
    S.canvas = root.querySelector("canvas");
    // A slow drift keeps the photograph alive without distracting.
    const g = C.motion.gsap;
    if (g) S.layers.forEach((l) => g.fromTo(l, { scale: 1.04, xPercent: -0.6 }, { scale: 1.1, xPercent: 0.6, duration: 48, ease: "sine.inOut", yoyo: true, repeat: -1 }));
  }

  function load(src) {
    return new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(src); im.onerror = () => resolve(null); im.src = src; });
  }

  async function apply(name) {
    if (name === S.scene) return;
    const first = !S.scene;
    S.scene = name;
    const sc = SCENES[name];
    const root = document.documentElement;
    root.dataset.scene = name;
    if (C.theme.get() === "auto") C.theme.applyAuto();
    const next = S.layers[1 - S.active], cur = S.layers[S.active];
    // Small image first for a fast paint, then the sharp one.
    const sm = await load(sc.sm);
    if (sm) next.style.backgroundImage = `url("${sm}")`;
    const g = C.motion.gsap;
    next.style.zIndex = "1"; cur.style.zIndex = "0";
    if (g && !first) { g.fromTo(next, { opacity: 0 }, { opacity: 1, duration: 1.8, ease: "power2.inOut" }); g.to(cur, { opacity: 0, duration: 1.8, ease: "power2.inOut" }); }
    else { next.style.opacity = "1"; cur.style.opacity = "0"; }
    S.active = 1 - S.active;
    load(sc.img).then((src) => { if (src && S.scene === name) next.style.backgroundImage = `url("${src}"), url("${sm}")`; });
    startFx(name);
    C.emit("scene", name);
  }

  /* ----------------------------------------------------------- particles */
  function startFx(name) {
    const cv = S.canvas, ctx = cv.getContext("2d");
    cancelAnimationFrame(S.fxRaf);
    if (C.reducedMotion()) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    const rain = S.weather?.actual && ["rain", "drizzle", "storm"].includes(S.weather.actual.icono);
    const mode = rain ? "rain" : name === "noche" ? "stars" : name === "lindo" ? "motes" : name === "tarde" ? "motes" : "none";
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    fit(); window.onresize = fit;
    const N = mode === "rain" ? 140 : mode === "stars" ? 90 : mode === "motes" ? 28 : 0;
    const P = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), s: Math.random(), p: Math.random() * 6.28 }));
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const W = cv.width, H = cv.height;
      for (const q of P) {
        if (mode === "rain") {
          q.y += dt * (0.9 + q.s * 0.8); q.x += dt * 0.08;
          if (q.y > 1) { q.y = -0.05; q.x = Math.random(); }
          ctx.strokeStyle = `rgba(210,225,240,${0.18 + q.s * 0.25})`; ctx.lineWidth = dpr;
          ctx.beginPath(); ctx.moveTo(q.x * W, q.y * H); ctx.lineTo(q.x * W - 4 * dpr, q.y * H - (14 + q.s * 10) * dpr); ctx.stroke();
        } else if (mode === "stars") {
          if (q.y > 0.55) q.y *= 0.5;
          q.p += dt * (0.8 + q.s * 1.6);
          const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(q.p));
          ctx.fillStyle = `rgba(255,255,255,${a * (0.4 + q.s * 0.6)})`;
          ctx.beginPath(); ctx.arc(q.x * W, q.y * H, (0.6 + q.s * 1.3) * dpr, 0, 6.28); ctx.fill();
        } else if (mode === "motes") {
          q.y -= dt * 0.012 * (0.5 + q.s); q.x += Math.sin(now / 3000 + q.p) * dt * 0.006;
          if (q.y < -0.02) { q.y = 1.02; q.x = Math.random(); }
          q.p += dt;
          ctx.fillStyle = name === "tarde" ? `rgba(255,214,160,${0.12 + 0.18 * q.s})` : `rgba(255,255,235,${0.1 + 0.16 * q.s})`;
          ctx.beginPath(); ctx.arc(q.x * W, q.y * H, (1.2 + q.s * 2.2) * dpr, 0, 6.28); ctx.fill();
        }
      }
      if (N && !document.hidden) S.fxRaf = requestAnimationFrame(frame);
    };
    if (N) S.fxRaf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && N) { cancelAnimationFrame(S.fxRaf); last = performance.now(); S.fxRaf = requestAnimationFrame(frame); } }, { once: true });
  }

  function update(weather) {
    if (weather) S.weather = weather;
    apply(decide(S.weather));
  }

  function init() {
    build();
    update(null);
    clearInterval(S.timer);
    S.timer = setInterval(() => update(null), 60e3);
  }

  C.scene = { init, update, get current() { return S.scene; }, SCENES, decide };
})();
