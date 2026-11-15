/* Cooper — "Explain it simply" (Explícamelo fácil)
 *
 * Motor de plantillas SIN LLM: convierte el análisis (/api/analyze) en slides con
 * un titular corto, una animación y una narración frase por frase. Cada frase
 * dispara un "beat" de la animación, así la voz y la imagen van sincronizadas.
 *
 * Más adelante un LLM puede reemplazar solo los textos (titular, frases, etiquetas
 * cortas); los números y las animaciones siguen saliendo de los datos.
 */
"use strict";

/* ----------------------------------------------------------- utilidades */
// Los textos de UI y de la voz están en inglés.
const MONTH_FULL = { 1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July",
  8: "August", 9: "September", 10: "October", 11: "November", 12: "December" };
const AG = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4];
const AG_SHORT = ["M", "J", "J", "A", "S", "O", "N", "D", "J", "F", "M", "A"];
const SVGNS = "http://www.w3.org/2000/svg";
const BARE = "#d9d6cc";
const ORANGE = ["#f09a6e", "#e2622e", "#b0441a", "#73280c"];

const nf = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

/* Nombre de rotación apto para leer en voz alta. */
function spoken(name) {
  return name.replace(/\s*→\s*/g, ", then the next year, ").replace(/\s*\/\s*/g, " and ")
    .replace(/\b2nd\b/g, "second-crop").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

/* "from November to March" a partir de una lista de meses consecutivos en orden agrícola. */
function monthSpan(months) {
  if (!months.length) return "";
  return months.length === 1 ? `in ${MONTH_FULL[months[0]]}` : `from ${MONTH_FULL[months[0]]} to ${MONTH_FULL[months[months.length - 1]]}`;
}

function longestRun(flags) {
  let best = [], cur = [];
  flags.forEach((f, i) => { if (f) { cur.push(i); if (cur.length > best.length) best = cur.slice(); } else cur = []; });
  return best;
}

/* Modo estático (?slide=N): todo en su estado final, sin animaciones. */
const isStatic = () => document.documentElement.classList.contains("static");
const later = (fn, ms) => (isStatic() ? fn() : setTimeout(fn, ms));

function animateNumber(el, from, to, decimals = 0, ms = 1200, suffix = "") {
  if (isStatic()) { el.textContent = nf(to, decimals) + suffix; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = nf(from + (to - from) * e, decimals) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* Sector anular: ángulos en radianes, 0 = arriba, sentido horario. */
function arcPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

/* Quita lo que suena mal en voz alta: paréntesis con cifras, "~", unidades abreviadas. */
function speakable(text) {
  return text.replace(/\s*\([^)]*\)/g, "").replace(/~/g, "about ")
    .replace(/t\/ha/g, "tonnes per hectare").replace(/\s+/g, " ").trim();
}

function shortRisk(text) {
  const head = speakable(text).split(/[:;]/)[0].replace(/\.$/, "");
  return head.length > 70 ? head.slice(0, 67).replace(/\s+\S*$/, "") + "…" : head;
}

/* "In exchange, water saving drops (41→22)." → frase clara. */
const TRADEOFF_TEXT = {
  "water saving": "In exchange, this option uses more water.",
  "soil health": "In exchange, it looks after the soil a little less.",
  "income (indicative)": "In exchange, it may bring in less income.",
  "forage": "In exchange, it gives less forage for livestock.",
  "climate resilience": "In exchange, it's more sensitive to drought, heat or frost.",
};
function tradeoffText(r) {
  const m = r.match(/^In exchange, (.+?) drops \(/);
  return (m && TRADEOFF_TEXT[m[1]]) || speakable(r);
}

/* ------------------------------------------------------ piezas visuales */

/* Anillo de 12 meses (mayo→abril) con el cultivo de cada mes. */
function ringCalendar(parent, row, { cx = 200, cy = 200, r0 = 110, r1 = 165, labels = true, idPrefix = "r" } = {}) {
  const g = svg("g", { class: "ring" }, parent);
  const defs = svg("defs", {}, g);
  const pat = svg("pattern", { id: `${idPrefix}-hatch`, width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  svg("rect", { width: 8, height: 8, fill: BARE }, pat);
  svg("line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: "#bdb8a9", "stroke-width": 3 }, pat);
  const seg = (2 * Math.PI) / 12, gap = 0.012;
  const segments = row.map((c, i) => {
    const a0 = i * seg + gap, a1 = (i + 1) * seg - gap;
    const path = svg("path", {
      d: arcPath(cx, cy, r0, r1, a0, a1),
      fill: c ? c.color : `url(#${idPrefix}-hatch)`,
      class: `seg ${c ? "crop" : "bare"}`,
      style: `--d:${i * 70}ms`,
    }, g);
    const title = svg("title", {}, path);
    title.textContent = `${MONTH_FULL[AG[i]]}: ${c ? c.nombre : "no crop"}`;
    if (c && labels) {
      const mid = (a0 + a1) / 2, rr = (r0 + r1) / 2;
      const t = svg("text", { x: cx + rr * Math.sin(mid), y: cy - rr * Math.cos(mid) + 5, class: `seg-label seg ${c ? "crop" : ""}`, style: `--d:${i * 70}ms` }, g);
      t.textContent = c.abrev;
      if (isLight(c.color)) t.classList.add("dark");
    }
    if (labels) {
      const mid = (a0 + a1) / 2, rr = r1 + 18;
      const t = svg("text", { x: cx + rr * Math.sin(mid), y: cy - rr * Math.cos(mid) + 5, class: "month-label" }, g);
      t.textContent = AG_SHORT[i];
    }
    return { path, bare: !c, mid: (a0 + a1) / 2 };
  });
  return { g, segments, cx, cy, r0, r1 };
}

function isLight(hex) {
  const h = hex.replace("#", "");
  const [r, gg, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * gg + 0.114 * b > 170;
}

/* Gotas cayendo sobre los meses sin cultivo del anillo. */
function rainOnBare(parent, ring) {
  const g = svg("g", { class: "rain-drops" }, parent);
  ring.segments.forEach((s, i) => {
    if (!s.bare) return;
    const deg = (s.mid * 180) / Math.PI;
    for (let k = 0; k < 3; k++) {
      const rot = svg("g", { transform: `rotate(${deg + (k - 1) * 6} ${ring.cx} ${ring.cy})` }, g);
      svg("line", {
        x1: ring.cx, y1: ring.cy - ring.r1 - 60, x2: ring.cx, y2: ring.cy - ring.r1 - 48,
        class: "drop", style: `animation-delay:${(i * 130 + k * 260) % 1100}ms`,
      }, rot);
    }
  });
  return g;
}

/* Barra de erosión con la marca de tolerancia. */
function erosionMeter(container, value, tol, label) {
  const max = Math.max(tol * 2, value * 1.25);
  const level = value < tol / 2 ? 0 : value < tol ? 1 : value < 2 * tol ? 2 : 3;
  const wrap = document.createElement("div");
  wrap.className = "meter";
  wrap.innerHTML = `
    <div class="meter-head"><span>${escH(label)}</span><strong><span class="num">0</span> t/ha a year</strong></div>
    <div class="meter-track">
      <div class="meter-fill" style="background:${ORANGE[level]}"></div>
      <div class="meter-tol" style="left:${(tol / max) * 100}%"><span>tolerable: ${nf(tol)}</span></div>
    </div>`;
  container.appendChild(wrap);
  return {
    el: wrap,
    play() {
      wrap.querySelector(".meter-fill").style.width = `${(value / max) * 100}%`;
      animateNumber(wrap.querySelector(".num"), 0, value, 1);
    },
  };
}

/* ------------------------------------------------------------- slides */
function buildSlides(d) {
  const months = d.clima.mensual;
  const trends = d.clima.tendencias.indicadores || d.clima.tendencias;
  const tr = (id) => trends.find((t) => t.id === id);
  const [cur, alt] = d.rotaciones;
  const tol = (d.zonas && d.zonas.tolerancia_t_ha) || 7;
  const hasErosion = cur.indicadores.erosion_t_ha != null;
  const campo = d.campo || "";

  // "Mes de sed": la evaporación supera a la lluvia por más de 10 mm (evita empates).
  const thirsty = longestRun(months.map((m) => m.et0_mm - m.lluvia_mm > 10)).map((i) => months[i].mes);
  const bareIdx = cur.calendario[0].map((c, i) => (c ? null : i)).filter((x) => x !== null);
  const bareWinter = bareIdx.filter((i) => i <= 4).length >= bareIdx.length / 2;
  const rain = tr("lluvia_mm"), heat = tr("dias_calor");
  const ci = cur.indicadores, ai = alt.indicadores;

  const slides = [];

  /* 1 · Portada */
  slides.push({
    key: "intro",
    headline: "Your field in one minute",
    sub: campo,
    narration: [
      campo ? `Hi. Let's take a look at your field ${campo.replace(/\s*\(.*\)/, "").replace(/^\w/, (c) => c.toLowerCase())}.` : "Hi. Let's take a look at your field.",
      `Today you use this rotation: ${spoken(cur.nombre)}.`,
      "I'll tell you what thirty years of NASA data say about your area, and what other options you could consider.",
    ],
    render(stage) {
      stage.innerHTML = `
        <svg viewBox="0 0 800 400" class="scene" aria-hidden="true">
          <circle class="sun" cx="640" cy="120" r="46"/>
          <g class="hills">
            <path d="M0 300 Q 200 230 400 290 T 800 270 V400 H0Z" fill="#cfe3b4"/>
            <path d="M0 330 Q 250 280 500 330 T 800 320 V400 H0Z" fill="#9cc47a"/>
          </g>
          <g class="furrows">${Array.from({ length: 7 }, (_, i) =>
            `<path d="M ${120 + i * 70} 400 Q ${300 + i * 25} 340 ${380 + i * 8} 318" style="--d:${i * 120}ms"/>`).join("")}</g>
          <g class="pin"><path d="M400 190 c-26 0 -46 20 -46 46 c0 34 46 82 46 82 s46 -48 46 -82 c0 -26 -20 -46 -46 -46z" fill="#1b5e20"/>
            <circle cx="400" cy="236" r="16" fill="#fff"/></g>
        </svg>
        <div class="chip-row"><span class="chip big-chip step">Today: ${escH(cur.nombre)}</span></div>`;
      stage.querySelector(".scene").classList.add("on");
      return (b) => { if (b >= 1) stage.querySelector(".chip-row .step").classList.add("on"); };
    },
  });

  /* 2 · Clima: lluvia vs. evapotranspiración */
  slides.push({
    key: "clima",
    headline: thirsty.length ? "In summer, your crops go thirsty" : "Your area has water most of the year",
    narration: [
      "First, your area's climate. The blue bars are each month's rainfall.",
      "The orange line is the water the sun's heat takes away, what agronomists call evapotranspiration.",
      thirsty.length
        ? `${monthSpan(thirsty).replace(/^\w/, (c) => c.toUpperCase())}, the line rises above the bars: in those months crops depend on the water stored in the soil.`
        : "Almost all year it rains more than evaporates.",
    ],
    render(stage) {
      const W = 800, H = 360, L = 50, B = 310, T = 30;
      const maxV = Math.max(...months.map((m) => Math.max(m.lluvia_mm, m.et0_mm))) * 1.1;
      const bw = (W - L - 20) / 12;
      const y = (v) => B - (v / maxV) * (B - T);
      const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Rainfall and evapotranspiration by month" });
      // banda de "sed"
      if (thirsty.length) {
        const i0 = months.findIndex((m) => m.mes === thirsty[0]);
        const band = svg("g", { class: "step thirst" }, s);
        svg("rect", { x: L + i0 * bw, y: T - 10, width: thirsty.length * bw, height: B - T + 10, rx: 10, class: "thirst-band" }, band);
        const tx = svg("text", { x: L + (i0 + thirsty.length / 2) * bw, y: T + 14, class: "thirst-label" }, band);
        tx.textContent = "💧 thirsty months";
      }
      svg("line", { x1: L, x2: W - 20, y1: B, y2: B, class: "axis" }, s);
      months.forEach((m, i) => {
        svg("rect", { x: L + i * bw + bw * 0.18, y: y(m.lluvia_mm), width: bw * 0.64, height: B - y(m.lluvia_mm),
          rx: 5, class: "bar step", style: `--d:${i * 60}ms` }, s);
        const t = svg("text", { x: L + i * bw + bw / 2, y: B + 24, class: "tick" }, s);
        t.textContent = m.nombre;
      });
      const pts = months.map((m, i) => `${L + i * bw + bw / 2},${y(m.et0_mm)}`);
      const line = svg("polyline", { points: pts.join(" "), class: "et-line" }, s);
      const dots = svg("g", { class: "step et-dots" }, s);
      months.forEach((m, i) => svg("circle", { cx: L + i * bw + bw / 2, cy: y(m.et0_mm), r: 5 }, dots));
      const leg = document.createElement("div");
      leg.className = "chart-legend";
      leg.innerHTML = `<span><i class="sw" style="background:#2a78d6"></i>Rainfall</span><span class="step leg-et"><i class="sw" style="background:#eb6834"></i>Water the sun takes away</span>`;
      stage.append(s, leg);
      const len = line.getTotalLength();
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = len;
      return (b) => {
        if (b >= 0) s.querySelectorAll(".bar").forEach((r) => r.classList.add("on"));
        if (b >= 1) { line.classList.add("on"); dots.classList.add("on"); leg.querySelector(".leg-et").classList.add("on"); }
        if (b >= 2) s.querySelector(".thirst")?.classList.add("on");
      };
    },
  });

  /* 3 · Cómo viene cambiando */
  slides.push({
    key: "cambio",
    headline: "The climate is changing",
    narration: [
      `And the climate isn't what it used to be. Between ${rain.periodo_1.replace("–", " and ")}, it rained ${nf(rain.valor_1)} millimeters a year on average; since ${rain.periodo_2.split("–")[0]}, ${nf(rain.valor_2)}.`,
      `That's ${nf(Math.abs(rain.cambio_pct))} percent ${rain.cambio_pct < 0 ? "less" : "more"} rain.`,
      `On top of that, very hot days went from ${nf(heat.valor_1)} to ${nf(heat.valor_2)} a year.`,
    ],
    render(stage) {
      stage.innerHTML = `
        <div class="stats">
          <div class="stat step" data-k="rain">
            <div class="icon">🌧️</div>
            <div class="stat-label">Rainfall per year</div>
            <div class="stat-row"><span class="old">${nf(rain.valor_1)}</span><span class="arrow">→</span><span class="new num">${nf(rain.valor_1)}</span><span class="unit">mm</span></div>
            <div class="delta ${rain.cambio_pct < 0 ? "down" : "up"}">${rain.cambio_pct > 0 ? "+" : ""}${nf(rain.cambio_pct)}%</div>
            <div class="period">${rain.periodo_1} → ${rain.periodo_2}</div>
          </div>
          <div class="stat step" data-k="heat">
            <div class="icon">☀️</div>
            <div class="stat-label">Very hot days per year</div>
            <div class="stat-row"><span class="old">${nf(heat.valor_1)}</span><span class="arrow">→</span><span class="new num">${nf(heat.valor_1)}</span><span class="unit">days</span></div>
            <div class="delta ${heat.cambio_pct > 0 ? "down" : "up"}">${heat.cambio_pct > 0 ? "+" : ""}${nf(heat.cambio_pct)}%</div>
            <div class="period">${heat.periodo_1} → ${heat.periodo_2}</div>
          </div>
        </div>`;
      const show = (k, from, to) => {
        const el = stage.querySelector(`[data-k=${k}]`);
        if (el.classList.contains("on")) return;
        el.classList.add("on");
        later(() => animateNumber(el.querySelector(".num"), from, to), 400);
      };
      return (b) => {
        if (b >= 0) show("rain", rain.valor_1, rain.valor_2);
        if (b >= 2) show("heat", heat.valor_1, heat.valor_2);
      };
    },
  });

  /* 4 · Lo que pasa hoy */
  const curEro = hasErosion ? ci.erosion_t_ha : null;
  slides.push({
    key: "hoy",
    headline: `Today: the soil is bare ${nf(ci.meses_descubiertos)} ${Math.round(ci.meses_descubiertos) === 1 ? "month" : "months"} a year`,
    narration: [
      "Now, your current rotation. This circle is a full year, from May to April, and each color is a crop.",
      `The striped months are soil without a crop: ${nf(ci.meses_descubiertos)} months a year${bareIdx.length && bareWinter ? ", mostly in autumn and winter" : ""}. Rain hits the bare soil and washes fertile soil away.`,
      hasErosion
        ? `We estimate that about ${nf(curEro)} tonnes of soil per hectare are lost each year${curEro > tol ? `, more than the ${nf(tol)} considered tolerable` : ", within the tolerable limit"}.`
        : "The longer the soil stays bare, the more it erodes.",
    ],
    render(stage) {
      stage.innerHTML = `<div class="split"><div class="vis"></div><div class="side"></div></div>`;
      const s = svg("svg", { viewBox: "0 0 400 400", class: "ring-svg", role: "img", "aria-label": "Yearly calendar of the current rotation" });
      stage.querySelector(".vis").appendChild(s);
      const ring = ringCalendar(s, cur.calendario[0], { idPrefix: "cur" });
      const center = svg("text", { x: 200, y: 195, class: "ring-center" }, s);
      center.textContent = "1 year";
      const center2 = svg("text", { x: 200, y: 222, class: "ring-center-sub" }, s);
      center2.textContent = "May → April";
      const drops = rainOnBare(s, ring);
      const side = stage.querySelector(".side");
      side.innerHTML = `<div class="big-fact step"><span class="num">0</span><span class="unit">months without a crop</span></div>`;
      const meter = hasErosion ? erosionMeter(side, curEro, tol, "Soil being lost") : null;
      if (meter) meter.el.classList.add("step");
      return (b) => {
        if (b >= 0) s.querySelectorAll(".seg").forEach((p) => p.classList.add("on"));
        if (b >= 1 && !side.querySelector(".big-fact").classList.contains("on")) {
          s.querySelectorAll(".seg.bare").forEach((p) => p.classList.add("pulse"));
          drops.classList.add("on");
          side.querySelector(".big-fact").classList.add("on");
          animateNumber(side.querySelector(".big-fact .num"), 0, ci.meses_descubiertos, 0, 900);
        }
        if (b >= 2 && meter && !meter.el.classList.contains("on")) { meter.el.classList.add("on"); meter.play(); }
      };
    },
  });

  /* 4b · Diagnóstico: lo bueno y lo flojo de la rotación actual.
     El motor decide niveles, motivos e ideas por reglas; aquí solo se arman las frases. */
  const diag = cur.diagnostico;
  if (diag && diag.items.length) {
    const fuertes = diag.items.filter((i) => i.nivel === "fuerte").slice(0, 2);
    const flojos = diag.items.filter((i) => i.nivel === "flojo").slice(0, 2);
    const medios = diag.items.filter((i) => i.nivel === "medio");
    const aMejorar = flojos.length ? flojos : medios.slice(0, 1);   // sin flojos: el punto más débil
    const idea = (i) => (i.recomendaciones[0] ? ` One idea to improve it: ${i.recomendaciones[0]}.` : "");
    const lines = [{ text: "So how is your current rotation doing? Here's what works and what's weak, based on what matters to you.", areas: [] }];
    if (fuertes.length) {
      lines.push({ text: `What works: ${fuertes.map((i) => `${i.tema}, because ${i.por_que}`).join("; and also ")}.`, areas: fuertes.map((i) => i.area) });
    }
    aMejorar.forEach((i) => lines.push({
      text: `${flojos.length ? "What's weak" : "Room to improve"}: ${i.tema}, because ${i.por_que}.${idea(i)}`, areas: [i.area] }));
    if (!fuertes.length && !aMejorar.length) lines.push({ text: "We don't see any important weak points in what matters to you.", areas: [] });
    const beatOf = (area) => { const k = lines.findIndex((l) => l.areas.includes(area)); return k < 0 ? lines.length - 1 : k; };
    const ICON = { fuerte: "✅", medio: "🟡", flojo: "⚠️" }, WORD = { fuerte: "Good", medio: "Fair", flojo: "Weak" };
    slides.push({
      key: "diagnostico",
      headline: flojos.length ? "What works and what's weak in your rotation" : "Your current rotation, point by point",
      narration: lines.map((l) => l.text),
      render(stage) {
        stage.innerHTML = `<ul class="diag">${diag.items.slice(0, 5).map((i) => `
          <li class="step lvl-${i.nivel}" data-beat="${beatOf(i.area)}">
            <span class="ic" aria-hidden="true">${ICON[i.nivel]}</span>
            <div>
              <strong>${escH(i.etiqueta)} <small>${WORD[i.nivel]} · ${i.puntaje}/100</small></strong>
              <span class="why">${escH(i.por_que.replace(/^\w/, (c) => c.toUpperCase()))}.</span>
              ${i.recomendaciones[0] ? `<em>💡 ${escH(i.recomendaciones[0].replace(/^\w/, (c) => c.toUpperCase()))}.</em>` : ""}
            </div>
          </li>`).join("")}</ul>`;
        const lis = [...stage.querySelectorAll("li")];
        return (b) => lis.forEach((li) => { if (b >= Number(li.dataset.beat)) li.classList.add("on"); });
      },
    });
  }

  /* 5 · Una opción mejor */
  const chips = [];
  if (ai.meses_descubiertos < ci.meses_descubiertos - 0.5) chips.push("🌱 Soil covered almost all year");
  if (hasErosion && ai.erosion_t_ha < ci.erosion_t_ha) chips.push(`⛰️ Erosion: ${nf(ci.erosion_t_ha, 1)} → ${nf(ai.erosion_t_ha, 1)} t/ha`);
  if (ai.familias > ci.familias) chips.push(`🔄 ${ai.familias} plant families: fewer pests`);
  if (ai.anios_doble_cultivo) chips.push("🌾 Two harvests a year");
  slides.push({
    key: "opcion",
    headline: "An option that takes better care of your soil",
    sub: alt.nombre,
    narration: [
      `One option that fits what matters to you is this one: ${spoken(alt.nombre)}.`,
      `Look at the circle: the soil stays covered almost all year${hasErosion ? `, and erosion drops from ${nf(ci.erosion_t_ha)} to about ${nf(ai.erosion_t_ha)} tonnes per hectare` : ""}.`,
      ai.familias > ci.familias
        ? "It also rotates different plant families, which breaks pest and disease cycles."
        : "It also leaves more stubble, which feeds the soil's organic matter.",
    ],
    render(stage) {
      stage.innerHTML = `<div class="compare"><div class="col"><div class="col-title">Today</div></div><div class="vs">→</div><div class="col"><div class="col-title accent">Option</div></div></div><div class="chip-row chips"></div>`;
      const cols = stage.querySelectorAll(".col");
      const mk = (col, row, prefix) => {
        const s = svg("svg", { viewBox: "0 0 400 400", class: "ring-svg small" });
        col.appendChild(s);
        ringCalendar(s, row, { idPrefix: prefix, labels: false, r0: 100, r1: 170 });
        return s;
      };
      const s1 = mk(cols[0], cur.calendario[0], "c1");
      const s2 = mk(cols[1], alt.calendario[0], "c2");
      let m1, m2;
      if (hasErosion) {
        m1 = erosionMeter(cols[0], ci.erosion_t_ha, tol, "Erosion");
        m2 = erosionMeter(cols[1], ai.erosion_t_ha, tol, "Erosion");
        [m1.el, m2.el].forEach((e) => e.classList.add("step"));
      }
      const chipRow = stage.querySelector(".chips");
      chipRow.innerHTML = chips.map((c, i) => `<span class="chip step" style="--d:${i * 180}ms">${escH(c)}</span>`).join("");
      return (b) => {
        if (b >= 0) { s1.querySelectorAll(".seg").forEach((p) => p.classList.add("on")); later(() => s2.querySelectorAll(".seg").forEach((p) => p.classList.add("on")), 600); }
        if (b >= 1 && m1 && !m1.el.classList.contains("on")) { m1.el.classList.add("on"); m2.el.classList.add("on"); m1.play(); m2.play(); }
        if (b >= 2) chipRow.querySelectorAll(".chip").forEach((c) => c.classList.add("on"));
      };
    },
  });

  /* 6 · Qué revisar */
  const generic = /general literature/;
  const risks = alt.explicacion.riesgos.filter((r) => !generic.test(r) && !/^In exchange/.test(r)).slice(0, 2);
  const tradeoff = alt.explicacion.riesgos.find((r) => /^In exchange/.test(r));
  const items = [
    ...risks.map((r) => ({ icon: "⚠️", text: shortRisk(r), say: speakable(r) })),
    ...(tradeoff ? [{ icon: "⚖️", text: tradeoffText(tradeoff), say: tradeoffText(tradeoff) }] : []),
  ];
  slides.push({
    key: "revisar",
    headline: "Before you decide, check this",
    narration: [
      "Before changing anything, there are things to check.",
      ...items.map((it) => it.say),
      "Talk all of this through with your agronomist: this data comes from satellites and a general crop table, and it doesn't know your field like you do.",
    ],
    render(stage) {
      const all = [...items, { icon: "🧑‍🌾", text: "Talk to your agronomist", strong: true }];
      stage.innerHTML = `<ul class="checklist">${all.map((it) =>
        `<li class="step ${it.strong ? "strong" : ""}"><span class="ic">${it.icon}</span><span>${escH(it.text)}</span></li>`).join("")}</ul>`;
      const lis = stage.querySelectorAll("li");
      return (b) => { lis.forEach((li, i) => { if (b >= i + 1 || (i === lis.length - 1 && b >= items.length + 1)) li.classList.add("on"); }); };
    },
  });

  /* 7 · Cierre */
  slides.push({
    key: "cierre",
    headline: "It helps you think. The decision is yours.",
    narration: [
      "This tool helps you think, but the decision is yours.",
      "You can watch this summary again, or explore all the details on the main screen.",
    ],
    render(stage) {
      stage.innerHTML = `
        <div class="closing">
          <div class="hand step">🤝</div>
          <div class="close-actions step">
            <button class="btn" data-act="restart">↺ Watch again</button>
            <a class="btn primary" href="index.html">See the full analysis</a>
          </div>
        </div>`;
      return (b) => {
        stage.querySelector(".hand").classList.add("on");
        if (b >= 1) stage.querySelector(".close-actions").classList.add("on");
      };
    },
  });

  return slides;
}

/* ------------------------------------------------------------- player */
class Player {
  constructor(root, slides) {
    this.root = root;
    this.slides = slides;
    this.i = 0;
    this.sentence = 0;
    this.playing = false;
    this.voiceOn = "speechSynthesis" in window;
    this.token = 0;
    this.rate = 1;
    this.volume = 1;
    this.wps = 2.6; // words per second of the voice at normal speed, learned while it speaks
    this.voice = null;
    // Reloj tipo video: tiempo estimado por frase, para la barra de progreso y saltos de 10 s.
    this.clock = { base: 0, startedAt: 0, cap: 0 };
    this.stage = root.querySelector(".stage-inner");
    this.subs = root.querySelector(".subs");
    this.headline = root.querySelector(".headline");
    this.subhead = root.querySelector(".subhead");
    this.dots = root.querySelector(".dots");
    this.pickVoice();
    if (this.voiceOn) speechSynthesis.onvoiceschanged = () => this.pickVoice();
    this.dots.innerHTML = slides.map((s, k) => `<button aria-label="Go to slide ${k + 1}" data-k="${k}"></button>`).join("");
    this.dots.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) this.go(Number(b.dataset.k)); });
    this.show(0);
  }

  pickVoice() {
    if (!this.voiceOn) return;
    // Voz en inglés (la UI y la narración están en inglés).
    const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith(window.CooperLang?.current || "en"));
    const pref = window.CooperLang?.current === "es" ? ["es-uy", "es-ar", "es-es", "es-mx"] : ["en-us", "en-gb", "en-au", "en-ca", "en-ie", "en-in"];
    vs.sort((a, b) => {
      const ia = pref.indexOf(a.lang.toLowerCase()), ib = pref.indexOf(b.lang.toLowerCase());
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (b.localService - a.localService);
    });
    this.voices = vs;
    if (!this.voice || !vs.includes(this.voice)) this.voice = vs[0] || null;
    this.root.dispatchEvent(new CustomEvent("voices", { detail: vs }));
  }

  show(i) {
    this.i = i;
    this.sentence = 0;
    const s = this.slides[i];
    this.stage.innerHTML = "";
    this.stage.className = `stage-inner slide-${s.key}`;
    this.headline.textContent = s.headline;
    this.subhead.textContent = s.sub || "";
    this.headline.classList.remove("in"); void this.headline.offsetWidth; this.headline.classList.add("in");
    this.beat = s.render(this.stage) || (() => {});
    this.subs.innerHTML = s.narration.map((t, k) => `<span data-k="${k}">${escH(t)} </span>`).join("");
    this.dots.querySelectorAll("button").forEach((b, k) => b.classList.toggle("active", k === i));
    this.root.querySelector(".counter").textContent = `${i + 1} / ${this.slides.length}`;
    this.highlight(-1);
    if (!this.playing) this.beat(0); // vista estática al navegar en pausa
  }

  highlight(k) {
    this.subs.querySelectorAll("span").forEach((sp, j) => {
      sp.classList.toggle("now", j === k);
      sp.classList.toggle("done", j < k);
    });
    const now = this.subs.querySelector(".now");
    if (now) now.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* Speaks one sentence. The timeline is the master clock: the voice follows it, and it
     never holds the clock more than 2.5 s past the sentence's estimated length. Chrome does
     not stop the previous sentence at once after cancel(), so the next one waits a moment. */
  say(text, my) {
    const words = text.split(/\s+/).length;
    const estMs = this.estimate(text) * 1000;
    if (!this.voiceOn || !this.voice) return new Promise((r) => setTimeout(r, estMs));
    return new Promise((resolve) => {
      let done = false, started = 0;
      const finish = (ok) => {
        if (done) return;
        done = true; clearTimeout(guard);
        if (ok && started) {
          const dur = (performance.now() - started) / 1000;
          if (dur > 0.8) {
            const obs = words / (dur * this.rate);
            this.wps = Math.min(4.2, Math.max(1.6, 0.65 * this.wps + 0.35 * obs));
          }
        }
        resolve();
      };
      const guard = setTimeout(() => finish(false), estMs + 2500);
      const go = () => {
        if (my !== undefined && (my !== this.token || !this.playing)) return finish(false);
        const u = new SpeechSynthesisUtterance(text);
        u.voice = this.voice;
        u.lang = this.voice.lang;
        u.rate = this.rate;
        u.volume = this.volume;
        u.onstart = () => { started = performance.now(); if (this.playing && this.clock.startedAt) this.clock.startedAt = started; };
        u.onend = () => finish(true);
        u.onerror = () => finish(false);
        speechSynthesis.speak(u);
      };
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(go, 140); }
      else go();
    });
  }

  async run() {
    const my = ++this.token;
    const alive = () => my === this.token && this.playing;
    while (alive()) {
      const s = this.slides[this.i];
      for (let k = this.sentence; k < s.narration.length; k++) {
        if (!alive()) return;
        this.sentence = k;
        this.beat(k);
        this.highlight(k);
        const seg = this.segmentAt(this.i, k);
        this.clock = { base: seg.start, startedAt: performance.now(), cap: Math.max(0, seg.dur - 0.05) };
        this.emit();
        await this.say(s.narration[k], my);
      }
      if (!alive()) return;
      this.highlight(s.narration.length);
      const last = this.segmentAt(this.i, s.narration.length - 1);
      this.clock = { base: last.start + last.dur, startedAt: performance.now(), cap: Player.GAP };
      await new Promise((r) => setTimeout(r, Player.GAP * 1000));
      if (!alive()) return;
      if (this.i === this.slides.length - 1) {
        this.pause();
        this.clock = { base: this.duration(), startedAt: 0, cap: 0 };
        this.sentence = 0;
        this.ended = true;
        this.emit("ended");
        return;
      }
      this.show(this.i + 1);
    }
  }

  play() {
    if (this.playing) return;
    if (this.ended) { this.ended = false; this.show(0); }
    this.playing = true;
    this.root.classList.add("is-playing");
    this.run();
  }

  pause() {
    const t = this.currentTime();
    this.playing = false;
    this.token++;
    if (this.voiceOn) speechSynthesis.cancel();
    this.root.classList.remove("is-playing");
    // Al reanudar se repite la frase actual desde su inicio.
    const seg = this.segmentAt(this.i, this.sentence);
    this.clock = { base: seg ? Math.min(t, seg.start) : t, startedAt: 0, cap: 0 };
    this.emit();
  }

  /* ---- línea de tiempo (para el reproductor embebido de la página principal) ---- */
  estimate(text) {
    const words = text.split(/\s+/).length;
    return Math.max(2.2, (words / (this.wps || 2.6)) / this.rate);
  }

  timeline() {
    const sig = this.rate + "|" + (this.wps || 2.6).toFixed(1) + "|" + this.slides.map((s) => s.narration.join("\u0001")).join("\u0002");
    if (this._tlSig === sig) return this._tl;
    let t = 0;
    const segs = [], chapters = [];
    this.slides.forEach((s, i) => {
      chapters.push({ i, start: t, title: s.headline, key: s.key });
      s.narration.forEach((text, k) => { const dur = this.estimate(text); segs.push({ i, k, start: t, dur }); t += dur; });
      t += Player.GAP;
    });
    this._tlSig = sig;
    this._tl = { segs, chapters, total: t };
    return this._tl;
  }

  duration() { return this.timeline().total; }

  segmentAt(i, k) {
    const segs = this.timeline().segs;
    return segs.find((x) => x.i === i && x.k === k) || segs[0];
  }

  currentTime() {
    const c = this.clock;
    if (!this.playing || !c.startedAt) return c.base;
    return c.base + Math.min(c.cap, (performance.now() - c.startedAt) / 1000);
  }

  seek(t) {
    const tl = this.timeline();
    t = Math.max(0, Math.min(t, tl.total - 0.01));
    let seg = tl.segs[0];
    for (const x of tl.segs) { if (x.start <= t + 1e-6) seg = x; else break; }
    const wasPlaying = this.playing;
    this.pause();
    this.ended = false;
    this.show(seg.i);
    this.sentence = seg.k;
    this.beat(seg.k);
    this.highlight(seg.k);
    this.clock = { base: seg.start, startedAt: 0, cap: 0 };
    if (wasPlaying) this.play(); else this.emit();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.emit();
  }

  emit(type = "state") {
    this.root.dispatchEvent(new CustomEvent("cooper-player", { detail: { type, playing: this.playing, time: this.currentTime(), duration: this.duration(), slide: this.i } }));
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  go(i) {
    if (i < 0 || i >= this.slides.length) return;
    const wasPlaying = this.playing;
    this.pause();
    this.ended = false;
    this.show(i);
    this.clock = { base: this.segmentAt(i, 0).start, startedAt: 0, cap: 0 };
    if (wasPlaying) this.play(); else this.emit();
  }

  setVoiceEnabled(on) {
    const wasPlaying = this.playing;
    this.pause();
    this.voiceOn = on && "speechSynthesis" in window;
    if (wasPlaying) this.play();
  }
}

Player.GAP = 0.9; // pausa entre slides, en segundos

window.CooperSlides = { buildSlides, Player };
