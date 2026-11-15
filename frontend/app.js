/* Cooper — frontend sin frameworks. Fases 1-4: clima, rotaciones, zonas y "Explain it simply". UI en inglés. */
"use strict";

const $ = (s) => document.querySelector(s);
const AG_MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
const PRIORITY_HINTS = {
  agua: "Save water",
  suelo: "Look after the soil",
  ingreso: "Income potential (relative)",
  forraje: "Have forage for livestock",
  clima: "Less climate risk",
};
const DEFAULT_PRIORITIES = { agua: 3, suelo: 4, ingreso: 4, forraje: 1, clima: 3 };

const state = {
  catalog: null, lat: -32.62, lon: -57.75, map: null, marker: null, fieldRect: null, chart: null, analyzed: false,
  zonesMap: null, zonesLayer: null, zones: null, rotations: null, zoneLayer: "erosion", zoneRot: null, lastCurrent: null,
  queue: new CooperWorkflow.AnalysisQueue(), result: null, resultInput: null, sampleId: null,
};

/* Rampas ordinales validadas con validate_palette.js --ordinal (modo claro). */
const RAMP_ORANGE = ["#f09a6e", "#e2622e", "#b0441a", "#73280c"];
const RAMP_BLUE3 = ["#86b6ef", "#2a78d6", "#104281"];
const RAMP_BLUE4 = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
const LOW_SPOT = "#6250d6";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/* Texto oscuro sobre fondos claros (p. ej. amarillo), blanco sobre oscuros. */
function needsDarkText(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

/* ------------------------------------------------------------------ init */
async function init() {
  state.catalog = await fetch("/api/catalog", { signal: AbortSignal.timeout(20000) }).then(CooperWorkflow.readResponse);
  buildForm();
  buildMap();
  applyDemo(state.catalog.campos_demo[0]);
  $("#analyze").addEventListener("click", analyze);
  $("#rotation").addEventListener("change", updateRotationDesc);

  // Keep modal focus inside the dialog and return it to its opener.
  const closeExplain = () => {
    $("#explain-modal").hidden = true;
    $("#explain-frame").src = "about:blank";
    $("main").inert = false;
    document.body.style.overflow = "";
    $("#explain").focus();
  };
  const openExplain = (url) => {
    if (!resultsCurrent()) return;
    $("#explain-frame").title = url.startsWith("slides-3d") ? "Explain it simply, 3D" : "Explain it simply, charts";
    $(".modal-box").setAttribute("aria-label", $("#explain-frame").title);
    $("#explain-frame").src = url;
    $("#explain-modal").hidden = false;
    $("main").inert = true;
    document.body.style.overflow = "hidden";
    $("#explain-close").focus();
  };
  $("#explain").addEventListener("click", () => openExplain(state.result.zonas ? "slides-3d.html?analysis=1" : "slides.html?analysis=1"));
  $("#explain-close").addEventListener("click", closeExplain);
  $("#modal-end").addEventListener("focus", () => $("#explain-close").focus());
  $("#explain-modal").addEventListener("click", (e) => { if (e.target.id === "explain-modal") closeExplain(); });
  document.addEventListener("keydown", (e) => {
    if ($("#explain-modal").hidden) return;
    if (e.key === "Escape") closeExplain();
    if (e.key === "Tab" && e.target === $("#explain-close") && e.shiftKey) {
      e.preventDefault();
      const frame = $("#explain-frame");
      const controls = [...(frame.contentDocument?.querySelectorAll('a[href], button:not([disabled]), input, select') || [])].filter((el) => el.getClientRects().length);
      if (controls.length) controls[controls.length - 1].focus(); else frame.focus();
    }
  });
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.source === $("#explain-frame").contentWindow && e.data?.type === "cooper-close") closeExplain();
  });
  $("#print-report").addEventListener("click", () => { if (resultsCurrent()) window.print(); });
  $("#coordinates-form").addEventListener("submit", (e) => {
    e.preventDefault();
    setPoint(Number($("#latitude").value), Number($("#longitude").value), true);
  });
  for (const id of ["rotation", "livestock", "soil", "area"]) $("#" + id).addEventListener("change", markChanged);
  $("#area").addEventListener("change", updateFieldRect);
  $("#zone-layers").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.zoneLayer = b.dataset.layer;
    document.querySelectorAll("#zone-layers button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    drawZones();
  });
  $("#zone-rot").addEventListener("change", (e) => { state.zoneRot = e.target.value; drawZones(); });

  // Simulador de clima: recalcula solo después de un primer análisis.
  let t;
  const onScenario = () => {
    $("#rain-val").textContent = `${Number($("#rain").value) > 0 ? "+" : ""}${$("#rain").value}%`;
    $("#temp-val").textContent = `+${Number($("#temp").value).toFixed(1)} °C`;
    clearTimeout(t);
    markChanged();
    if (state.analyzed) t = setTimeout(analyze, 350);
  };
  $("#rain").addEventListener("input", onScenario);
  $("#temp").addEventListener("input", onScenario);
  $("#reset-scenario").addEventListener("click", () => {
    $("#rain").value = 0; $("#temp").value = 0; onScenario();
  });
  $("#analyze").disabled = false;
  $("#analyze").textContent = "Analyze my field";
}

function buildForm() {
  $("#rotation").innerHTML = state.catalog.rotaciones
    .map((r) => `<option value="${esc(r.id)}">${esc(r.nombre)}</option>`).join("");

  $("#priorities").innerHTML = Object.entries(PRIORITY_HINTS).map(([k, label]) => `
    <div class="prio">
      <label for="p-${k}">${esc(label)}</label>
      <output id="o-${k}">${DEFAULT_PRIORITIES[k]}</output>
      <input type="range" id="p-${k}" min="0" max="5" step="1" value="${DEFAULT_PRIORITIES[k]}">
    </div>`).join("");
  for (const k of Object.keys(PRIORITY_HINTS)) {
    $(`#p-${k}`).addEventListener("input", (e) => {  $(`#o-${k}`).textContent = e.target.value; markChanged(); });
  }

  $("#demo-fields").innerHTML = state.catalog.campos_demo
    .map((f) => `<button class="chip" data-id="${esc(f.id)}">${esc(f.nombre)}</button>`).join("");
  $("#demo-fields").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) applyDemo(state.catalog.campos_demo.find((f) => f.id === b.dataset.id));
  });
}

function updateRotationDesc() {
  const r = state.catalog.rotaciones.find((x) => x.id === $("#rotation").value);
  $("#rotation-desc").textContent = r ? r.descripcion : "";
}

function applyDemo(f) {
  setPoint(f.lat, f.lon, true);
  $("#rotation").value = f.rotacion;
  $("#livestock").checked = f.tiene_ganado;
  state.sampleId = f.id;
  updateRotationDesc();
  document.querySelectorAll(".chip").forEach((c) => { c.classList.toggle("active", c.dataset.id === f.id); c.setAttribute("aria-pressed", String(c.dataset.id === f.id)); });
  updateFieldContext();
  markChanged();
}

function baseLayers() {
  return {
    "Map": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap" }),
    "Satellite": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 17, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }),
  };
}

function buildMap() {
  if (typeof L === "undefined") {
    $("#map").innerHTML = '<p class="hint">The map could not load. Enter coordinates below or use a sample field.</p>';
    return;
  }
  state.map = L.map("map").setView([-32.8, -56.0], 6);
  const base = baseLayers();
  base["Map"].addTo(state.map);
  L.control.layers(base, null, { collapsed: true }).addTo(state.map);
  state.marker = L.marker([state.lat, state.lon], { draggable: true }).addTo(state.map);
  state.marker.on("dragend", (e) => { const p = e.target.getLatLng(); setPoint(p.lat, p.lng); });
  state.map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
}

function setPoint(lat, lon, recenter = false) {
  state.lat = lat; state.lon = lon; state.sampleId = null;
  if (state.marker) state.marker.setLatLng([lat, lon]);
  if (recenter && state.map) state.map.setView([lat, lon], 8);
  $("#latitude").value = lat.toFixed(5); $("#longitude").value = lon.toFixed(5);
  $("#coords").textContent = `Lat ${lat.toFixed(3)} · Lon ${lon.toFixed(3)}`;
  document.querySelectorAll(".chip").forEach((c) => { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); });
  updateFieldRect();
  updateFieldContext();
  markChanged();
}

/* Mismo cuadrado que usa el backend (terrain.field_grid). */
function fieldBounds(lat, lon, ha) {
  const side = Math.sqrt(ha * 10000);
  const dlat = side / 111320;
  const dlon = side / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[lat - dlat / 2, lon - dlon / 2], [lat + dlat / 2, lon + dlon / 2]];
}

function updateFieldRect() {
  if (!state.map) return;
  const b = fieldBounds(state.lat, state.lon, Number($("#area").value));
  if (state.fieldRect) state.fieldRect.setBounds(b);
  else state.fieldRect = L.rectangle(b, { color: cssVar("--accent"), weight: 2, fill: false, interactive: false }).addTo(state.map);
}

/* --------------------------------------------------------------- analyze */
function readPriorities() {
  return Object.fromEntries(Object.keys(PRIORITY_HINTS).map((k) => [k, Number($(`#p-${k}`).value)]));
}

function readRequest() {
  return {
    lat: state.lat, lon: state.lon, rotacion_actual: $("#rotation").value,
    prioridades: readPriorities(),
    escenario: { lluvia_pct: Number($("#rain").value), temp_delta: Number($("#temp").value) },
    capacidad_suelo_mm: Number($("#soil").value), tiene_ganado: $("#livestock").checked,
    area_ha: Number($("#area").value),
  };
}
function resultsCurrent() {
  return !!state.resultInput && JSON.stringify(readRequest()) === JSON.stringify(state.resultInput);
}
function fieldLabel() {
  const sample = state.catalog?.campos_demo.find((f) => f.id === state.sampleId);
  return sample ? `Sample field: ${sample.nombre}` : "Your selected field";
}
function updateFieldContext() {
  const outside = state.lat < -35.1 || state.lat > -30 || state.lon < -58.6 || state.lon > -53;
  $("#field-context").textContent = fieldLabel() + (outside ? " · Outside Uruguay: crop calendars may not apply." : "");
}
function markChanged() {
  state.queue.invalidate();
  const current = resultsCurrent();
  $("#stale-results").hidden = !state.result || current;
  $("#explain").disabled = !current;
  $("#print-report").disabled = !current;
}
async function analyze() {
  if (state.queue.active) { state.queue.queued = true; return; }
  const body = readRequest();
  try { CooperWorkflow.validate(body); } catch (err) {
    $("#error").textContent = err.message; $("#error").hidden = false; return;
  }
  const run = state.queue.begin();
  const context = { field: fieldLabel(), generatedAt: new Date().toISOString() };
  $("#empty").hidden = true; $("#error").hidden = true;
  $("#loading").hidden = false; $("#analyze").disabled = true;
  $("#results").setAttribute("aria-busy", "true");
  $("#analyze").textContent = "Comparing rotations…";
  try {
    const resp = await fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(185000),
    });
    const data = await CooperWorkflow.readResponse(resp);
    if (!state.queue.isCurrent(run)) return;
    state.result = data; state.resultInput = body; state.context = context;
    render(data, body.prioridades);
    updateReportContext(data, body, context);
    state.analyzed = true;
    $("#stale-results").hidden = true; $("#explain").disabled = false; $("#print-report").disabled = false;
    // Reach results on a phone without scrolling past the complete input form.
    if (matchMedia("(max-width: 900px)").matches) { $("#results-title").focus(); $("#results-title").scrollIntoView({ block: "start" }); }
    // Para "Ask Cooper": el último análisis y lo que pidió el productor.
    window.cooperAnalysis = { data, request: body, campo: context.field };
    window.dispatchEvent(new Event("cooper:analysis"));
  } catch (err) {
    if (!state.queue.isCurrent(run)) return;
    $("#error").textContent = err.name === "TimeoutError"
      ? "This analysis took too long. Please try again; downloaded data may already be cached."
      : `Could not run the analysis: ${err.message}`;
    $("#error").hidden = false;
  } finally {
    $("#loading").hidden = true; $("#analyze").disabled = false;
    $("#results").setAttribute("aria-busy", "false");
    $("#analyze").textContent = "Analyze my field";
    if (state.queue.finish()) setTimeout(analyze, 500);
  }
}
function updateReportContext(data, body, context) {
  $("#analysis-mode").hidden = !data.escenario.activo;
  $("#analysis-mode").textContent = "What-if simulation · not a forecast";
  const priorities = Object.entries(body.prioridades).map(([key, value]) => `${PRIORITY_HINTS[key]} ${value}/5`).join(" · ");
  const lines = [
    [context.field, `${body.lat.toFixed(4)}, ${body.lon.toFixed(4)} · ${body.area_ha} ha`],
    ["Field settings", `Soil water storage ${body.capacidad_suelo_mm} mm · ${body.tiene_ganado ? "Livestock available" : "No livestock"}`],
    ["Your priorities", priorities],
    ["Climate scenario", `Rainfall ${body.escenario.lluvia_pct}%, temperature +${body.escenario.temp_delta} °C. ${data.escenario.activo ? "What-if simulation, not a forecast." : "Historical comparison, not a forecast."}`],
    ["Analysis created", new Date(context.generatedAt).toLocaleString(CooperLang.current === "es" ? "es-UY" : "en-GB")],
  ];
  $("#input-summary").innerHTML = lines.map(([label, value]) => `<p><strong>${esc(label)}</strong><span>${esc(value)}</span></p>`).join("");
  if (new URLSearchParams(location.search).get("preview") === "print") {
    document.documentElement.classList.add("report-preview");
    $("#report-styles").media = "all";
    preparePrint();
    requestAnimationFrame(() => { state.zonesMap?.invalidateSize(); state.chart?.resize(); });
  }
}
let printTableWasOpen = null;
function preparePrint() {
  document.documentElement.classList.add("printing");
  if (printTableWasOpen === null) printTableWasOpen = $(".table-view").open;
  $(".table-view").open = true;
  CooperLang.refresh();
  if (state.result) {
    renderWaterChart(state.result.clima.mensual, state.result.escenario.activo ? state.result.clima.mensual_base : null);
    state.chart?.resize(680, 240);
    state.chart?.update("none");
  }
}
window.addEventListener("beforeprint", preparePrint);
window.addEventListener("afterprint", () => {
  if (document.documentElement.classList.contains("report-preview")) return;
  document.documentElement.classList.remove("printing");
  if (printTableWasOpen !== null) $(".table-view").open = printTableWasOpen;
  printTableWasOpen = null;
  if (state.result) renderWaterChart(state.result.clima.mensual, state.result.escenario.activo ? state.result.clima.mensual_base : null);
});

/* ---------------------------------------------------------------- render */
function render(data, prio) {
  $("#content").hidden = false;
  $("#warnings").innerHTML = data.advertencias.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join("");
  const m = data.meta;
  $("#meta-line").textContent =
    `${m.fuente} · ${m.periodo} · ${m.resolucion} grid cell` + (m.elevacion_m != null ? ` · elevation ${fmt(m.elevacion_m)} m` : "");
  renderWaterChart(data.clima.mensual, data.escenario.activo ? data.clima.mensual_base : null);
  renderWaterTable(data.clima.mensual);
  renderRiskTable(data.clima.mensual);
  renderTrends(data.clima.tendencias.indicadores);
  renderRotations(data.rotaciones, prio);
  renderZones(data.zonas, data.rotaciones);
  saveForSlides(data);
}

/* Guarda una versión liviana del análisis para "Explain it simply" (slides*.html). */
function saveForSlides(data) {
  const slim = {
    campo: state.context?.field || "Your selected field",
    context: state.context,
    escenario: data.escenario,
    meta: data.meta,
    clima: { mensual: data.clima.mensual, tendencias: data.clima.tendencias.indicadores },
    rotaciones: data.rotaciones.map(({ id, nombre, rol, total, puntajes, indicadores, calendario, explicacion, diagnostico }) =>
      ({ id, nombre, rol, total, puntajes, indicadores, calendario, explicacion, diagnostico })),
    zonas: data.zonas ? { resumen: data.zonas.resumen, tolerancia_t_ha: data.zonas.tolerancia_t_ha, area_ha: data.zonas.area_ha } : null,
    // Grilla SRTM y erosión por celda: la usa la versión 3D para modelar el relieve real.
    terreno: data.zonas ? {
      n: Math.round(Math.sqrt(data.zonas.celdas.length)),
      elev: data.zonas.celdas.map((c) => c.elev),
      eros: Object.fromEntries(data.rotaciones.map((r) => [r.id, data.zonas.celdas.map((c) => c.eros[r.id])])),
    } : null,
  };
  window.CooperAnalysis = slim;
  try { localStorage.setItem("cooper-analysis", JSON.stringify(slim)); } catch (e) { /* iframe uses the current in-memory result */ }
}

/* ------------------------------------------------------------- zonas */
const ZONE_LAYERS = {
  erosion: {
    explain: (z) => `Soil loss estimated with RUSLE for the selected rotation. The reference tolerance is ${z.tolerancia_t_ha} t/ha a year. Change the rotation to see how the map changes.`,
    classes: (z) => {
      const t = z.tolerancia_t_ha;
      return [
        { label: `Low (< ${t / 2} t/ha a year)`, color: RAMP_ORANGE[0], test: (v) => v < t / 2 },
        { label: `Medium (${t / 2}–${t})`, color: RAMP_ORANGE[1], test: (v) => v < t },
        { label: `High (${t}–${2 * t}): above tolerance`, color: RAMP_ORANGE[2], test: (v) => v < 2 * t },
        { label: `Very high (> ${2 * t})`, color: RAMP_ORANGE[3], test: () => true },
      ];
    },
    value: (c) => c.eros[state.zoneRot],
  },
  humedad: {
    explain: () => "Based on the shape of the land: where water collects (low spots, drainage lines) and where it dries out first (hilltops). It's relative within your field, not a moisture measurement.",
    classes: () => [
      { label: "Dries out first (hilltops)", color: RAMP_BLUE3[0], test: (v) => v === 0 },
      { label: "Intermediate", color: RAMP_BLUE3[1], test: (v) => v === 1 },
      { label: "Collects water (low spots, drainage lines)", color: RAMP_BLUE3[2], test: () => true },
    ],
    value: (c) => c.hum,
  },
  bajos: {
    explain: () => "Areas lower than their surroundings: cold air drains and pools there on frosty nights, and water can pond. Avoid crops that are sensitive to frost at flowering in these spots.",
    classes: () => [
      { label: "Low spot: more frost and waterlogging risk", color: LOW_SPOT, test: (v) => v },
      { label: "Rest of the field", color: null, test: () => true },
    ],
    value: (c) => c.bajo,
  },
  pendiente: {
    explain: () => "Land slope calculated from SRTM elevation. Steeper and longer slopes mean more erosion.",
    classes: () => [
      { label: "< 1 %", color: RAMP_BLUE4[0], test: (v) => v < 1 },
      { label: "1–3 %", color: RAMP_BLUE4[1], test: (v) => v < 3 },
      { label: "3–6 %", color: RAMP_BLUE4[2], test: (v) => v < 6 },
      { label: "> 6 %", color: RAMP_BLUE4[3], test: () => true },
    ],
    value: (c) => c.pend,
  },
};

/* Interpolación bilineal de una grilla n×n (fila 0 = norte) en coordenadas de celda. */
function bilinear(grid, n, fx, fy) {
  const x = Math.min(n - 1, Math.max(0, fx)), y = Math.min(n - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const top = grid[y0 * n + x0] * (1 - tx) + grid[y0 * n + x1] * tx;
  const bot = grid[y1 * n + x0] * (1 - tx) + grid[y1 * n + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

/* Imagen de la capa: valores suavizados, clasificados con la misma leyenda,
   y oscurecidos/aclarados con el sombreado del relieve (luz desde el noroeste). */
function zoneRaster(z, layer, classes) {
  const n = Math.round(Math.sqrt(z.celdas.length));
  const S = 420;
  const vals = z.celdas.map((c) => Number(layer.value(c)));
  const elev = z.celdas.map((c) => c.elev);
  const rgb = classes.map((k) => (k.color
    ? [1, 3, 5].map((i) => parseInt(k.color.slice(i, i + 2), 16)) : null));
  // Las clases discretas (0/1/2, sí/no) se interpolan y se redondean: bordes curvos.
  const discrete = state.zoneLayer === "humedad" || state.zoneLayer === "bajos";

  const E = new Float32Array(S * S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      E[py * S + px] = bilinear(elev, n, ((px + 0.5) / S) * n - 0.5, ((py + 0.5) / S) * n - 0.5);
    }
  }
  const pix = (z.celda_m * n) / S;      // metros por píxel
  const relief = Math.max(4, z.resumen.desnivel_m);
  const exag = 60 / relief;             // exagera el relieve en campos llanos

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(S, S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let v = bilinear(vals, n, ((px + 0.5) / S) * n - 0.5, ((py + 0.5) / S) * n - 0.5);
      if (discrete) v = state.zoneLayer === "bajos" ? v >= 0.5 : Math.round(v);
      const ki = classes.findIndex((k) => k.test(v));

      const xl = Math.max(0, px - 1), xr = Math.min(S - 1, px + 1);
      const yu = Math.max(0, py - 1), yd = Math.min(S - 1, py + 1);
      const dzdx = ((E[py * S + xr] - E[py * S + xl]) / ((xr - xl) * pix)) * exag;      // hacia el este
      const dzdn = ((E[yu * S + px] - E[yd * S + px]) / ((yd - yu) * pix)) * exag;      // hacia el norte
      const len = Math.hypot(dzdx, dzdn, 1);
      const hs = (dzdx * 1 + dzdn * -1 + 1) / (len * Math.sqrt(3));   // luz desde el NO, 35° de altura
      const shade = Math.min(1.3, Math.max(0.45, 1 + (hs - 0.577) * 1.5));

      const o = (py * S + px) * 4;
      const c = rgb[ki];
      if (c) {
        img.data[o] = Math.min(255, c[0] * shade);
        img.data[o + 1] = Math.min(255, c[1] * shade);
        img.data[o + 2] = Math.min(255, c[2] * shade);
        img.data[o + 3] = 215;
      } else {
        // Sin color de clase: solo el sombreado, muy tenue, para que se lea el relieve.
        const g = shade < 1 ? 0 : 255;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
        img.data[o + 3] = Math.min(110, Math.abs(shade - 1) * 260);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function renderZones(z, rots) {
  state.zones = z;
  state.rotations = rots;
  $("#zones-card").hidden = !z;
  if (!z) return;
  if (typeof L === "undefined") { $("#zones-meta").textContent = "The map is unavailable. Terrain and erosion estimates remain in the comparison below."; return; }
  // Al cambiar la rotación actual, el mapa vuelve a mostrarla; si no, se respeta la elección.
  if (state.lastCurrent !== rots[0].id || !rots.some((r) => r.id === state.zoneRot)) state.zoneRot = rots[0].id;
  state.lastCurrent = rots[0].id;
  $("#zone-rot").innerHTML = rots.map((r) =>
    `<option value="${esc(r.id)}" ${r.id === state.zoneRot ? "selected" : ""}>${r.rol === "actual" ? "Current: " : ""}${esc(r.nombre)}</option>`).join("");
  $("#zones-meta").textContent =
    `${fmt(z.area_ha)} ha · ${fmt(z.celda_m)} m grid · NASA SRTM 30 m · R = ${fmt(z.r_factor)} MJ·mm/ha/h/yr · K = ${z.k_factor} (typical value, not measured)`;

  if (!state.zonesMap) {
    state.zonesMap = L.map("zones-map", { scrollWheelZoom: false });
    const base = baseLayers();
    base["Satellite"].addTo(state.zonesMap);
    L.control.layers(base, null, { collapsed: false }).addTo(state.zonesMap);
    state.zonesLayer = L.layerGroup().addTo(state.zonesMap);
  }
  state.zonesMap.invalidateSize();
  state.zonesMap.fitBounds(z.bounds, { padding: [10, 10] });
  drawZones();
}

function drawZones() {
  const z = state.zones;
  if (!z) return;
  const layer = ZONE_LAYERS[state.zoneLayer];
  const classes = layer.classes(z);
  $("#zone-rot-wrap").hidden = state.zoneLayer !== "erosion";
  $("#zone-explain").textContent = layer.explain(z);
  $("#zone-legend").innerHTML = classes.map((k) =>
    `<span><i class="swatch" style="${k.color ? `background:${k.color}` : "background:transparent;border:1px solid var(--axis)"}"></i>${esc(k.label)}</span>`).join("");

  state.zonesLayer.clearLayers();
  const rotName = state.rotations.find((r) => r.id === state.zoneRot)?.nombre ?? "";
  // Superficie suavizada + sombreado del relieve, sobre la imagen satelital.
  L.imageOverlay(zoneRaster(z, layer, classes), z.bounds, { opacity: 0.78, interactive: false }).addTo(state.zonesLayer);
  // Celdas invisibles: solo sirven para el tooltip al pasar el mouse.
  for (const c of z.celdas) {
    const k = classes.find((x) => x.test(layer.value(c)));
    const tip = `<strong>${esc(k.label)}</strong><br>Elevation ${fmt(c.elev, 1)} m · slope ${fmt(c.pend, 1)}%` +
      `<br>Erosion (${esc(rotName)}): ${fmt(c.eros[state.zoneRot], 1)} t/ha a year`;
    L.rectangle(c.b, { stroke: false, fillOpacity: 0 }).bindTooltip(tip, { sticky: true }).addTo(state.zonesLayer);
  }
  L.rectangle(z.bounds, { color: "#ffffff", weight: 2, fill: false, interactive: false }).addTo(state.zonesLayer);

  const s = z.resumen;
  const rot = state.rotations.find((r) => r.id === state.zoneRot);
  const er = rot.indicadores;
  $("#zone-tiles").innerHTML = `
    <div class="tile"><div class="label">Height difference within the field</div><div class="value">${fmt(s.desnivel_m)} m</div>
      <div class="detail">from ${fmt(s.elev_min)} to ${fmt(s.elev_max)} m above sea level</div></div>
    <div class="tile"><div class="label">Slope</div><div class="value">${fmt(s.pendiente_media_pct, 1)}%</div>
      <div class="detail">average · maximum ${fmt(s.pendiente_max_pct, 1)}%</div></div>
    <div class="tile"><div class="label">Erosion · ${esc(rot.nombre)}</div><div class="value">${fmt(er.erosion_t_ha, 1)} t/ha a year</div>
      <div class="detail">${fmt(er.erosion_area_alta_pct)}% of the field exceeds ${z.tolerancia_t_ha} t/ha a year</div></div>
    <div class="tile"><div class="label">Low spots</div><div class="value">${fmt(s.area_baja_pct)}%</div>
      <div class="detail">of the field, with more frost and waterlogging risk</div></div>`;
}

function renderWaterChart(months, base) {
  if (typeof Chart === "undefined") {
    $("#chart-notice").textContent = "The chart could not load. All climate values are available in the table below.";
    $("#chart-notice").hidden = false; $(".table-view").open = true;
    return;
  }
  $("#chart-notice").hidden = true;
  const text2 = cssVar("--text-2"), muted = cssVar("--muted");
  const datasets = [
    {
      type: "bar", label: "Average rainfall (mm)", data: months.map((d) => d.lluvia_mm),
      backgroundColor: cssVar("--series-1"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom",
      barPercentage: 0.7, categoryPercentage: 0.85, order: 2,
    },
    {
      type: "line", label: "Reference evapotranspiration (mm)", data: months.map((d) => d.et0_mm),
      borderColor: cssVar("--series-2"), backgroundColor: cssVar("--series-2"), borderWidth: 2,
      pointRadius: 4, pointHoverRadius: 6, pointBorderColor: cssVar("--surface"), pointBorderWidth: 2,
      tension: 0.3, order: 1,
    },
  ];
  if (base) {
    datasets.push({
      type: "line", label: "Historical rainfall (no scenario)", data: base.map((d) => d.lluvia_mm),
      borderColor: muted, borderWidth: 2, pointRadius: 0, tension: 0.3, order: 0,
    });
  }
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($("#water-chart"), {
    data: { labels: months.map((d) => CooperLang.t(d.nombre)), datasets: datasets.map((d) => ({...d, label: CooperLang.t(d.label)})) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: document.documentElement.classList.contains("printing") ? false : { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { color: text2, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} mm`,
            afterBody: (items) => {
              const d = months[items[0].dataIndex];
              return CooperLang.t(`Balance (rain − ET0): ${d.balance_mm > 0 ? "+" : ""}${fmt(d.balance_mm)} mm\nDry year (1 in 5): ${fmt(d.lluvia_seca_mm)} mm of rain`);
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text2 }, border: { color: cssVar("--axis") } },
        y: {
          beginAtZero: true, grid: { color: cssVar("--grid") }, border: { display: false },
          ticks: { color: muted }, title: { display: true, text: "mm per month", color: muted },
        },
      },
    },
  });
}

function renderWaterTable(months) {
  $("#water-table").innerHTML = `<table class="data">
    <thead><tr><th>Month</th><th>Rain (mm)</th><th>Rain, dry year (mm)</th><th>ET0 (mm)</th><th>Balance (mm)</th><th>Tmax (°C)</th><th>Tmin (°C)</th><th>Root-zone moisture</th></tr></thead>
    <tbody>${months.map((d) => `<tr><td>${d.nombre}</td><td>${fmt(d.lluvia_mm)}</td><td>${fmt(d.lluvia_seca_mm)}</td>
      <td>${fmt(d.et0_mm)}</td><td>${fmt(d.balance_mm)}</td><td>${fmt(d.tmax, 1)}</td><td>${fmt(d.tmin, 1)}</td>
      <td>${d.humedad_raiz ?? "–"}</td></tr>`).join("")}</tbody></table>`;
}

function renderRiskTable(months) {
  const rows = [
    { key: "dias_calor", label: "Hot days", note: "Tmax ≥ 32 °C", d: 1 },
    { key: "dias_helada", label: "Frost-risk days", note: "Tmin ≤ 2 °C", d: 1 },
    { key: "dias_lluvia_fuerte", label: "Heavy-rain days", note: "≥ 40 mm, erosion risk", d: 1 },
    { key: "deficit", label: "Atmospheric water deficit (mm)", note: "ET0 − rain, when positive", d: 0 },
  ];
  const steps = ["--seq-0", "--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5"].map(cssVar);
  const value = (d, k) => (k === "deficit" ? Math.max(0, -d.balance_mm) : d[k]);
  const body = rows.map((r) => {
    const vals = months.map((d) => value(d, r.key));
    const max = Math.max(...vals) || 1;
    const cells = vals.map((v, i) => {
      const lvl = v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
      const color = needsDarkText(steps[lvl]) ? "#0b0b0b" : "#fff";
      return `<td class="cell" style="background:${steps[lvl]};color:${color}" title="${months[i].nombre}: ${fmt(v, r.d)}">${v > 0 ? fmt(v, r.d) : "·"}</td>`;
    }).join("");
    return `<tr><td>${esc(r.label)}<span class="row-note">${esc(r.note)}</span></td>${cells}</tr>`;
  }).join("");
  $("#risk-table").innerHTML = `<table class="data risk"><thead><tr><th></th>${months.map((d) => `<th>${d.nombre}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderTrends(indicators) {
  $("#trends").innerHTML = indicators.map((t) => {
    const sign = t.cambio_pct > 0 ? "+" : "";
    return `<div class="tile">
      <div class="label">${esc(t.nombre)}</div>
      <div class="value">${sign}${fmt(t.cambio_pct, 0)}%</div>
      <div class="detail">${t.periodo_1}: ${fmt(t.valor_1)} ${t.unidad} → ${t.periodo_2}: ${fmt(t.valor_2)} ${t.unidad}</div>
    </div>`;
  }).join("");
}

function renderRotations(rots, prio) {
  const labels = state.catalog.puntajes;
  const best = rots.reduce((a, b) => (b.total > a.total ? b : a));
  const used = new Map();
  for (const r of rots) for (const y of r.calendario) for (const c of y) if (c) used.set(c.id, c);
  $("#crop-legend").innerHTML = [...used.values()].map((c) =>
    `<span><i class="swatch" style="background:${c.color};${needsDarkText(c.color) ? "color:#0b0b0b" : ""}">${esc(c.abrev)}</i>${esc(c.nombre)}</span>`).join("")
    + `<span><i class="swatch" style="background:var(--bare);color:var(--muted)">—</i>No crop</span>`;

  $("#rotations").innerHTML = rots.map((r) => {
    const role = r.rol === "actual" ? "Your current rotation" : r.rol === "alternativa_1" ? "Alternative 1" : "Alternative 2";
    const cls = ["rot", r.rol === "actual" ? "current" : "", r === best ? "best" : ""].join(" ");
    const bars = Object.entries(labels).map(([k, label]) => `
      <div class="bar-row" title="${esc(label)}: ${r.puntajes[k]} out of 100 (importance ${prio[k]}/5)">
        <span class="name ${prio[k] >= 4 ? "prio-high" : ""}">${esc(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${r.puntajes[k]}%"></span></span>
        <span class="val">${r.puntajes[k]}</span>
      </div>`).join("");
    const cal = `<div class="calendar-scroll"><table class="cal-table" aria-label="Rotation calendar">
      <thead><tr><th scope="col">Year</th>${AG_MONTHS.map((m) => `<th scope="col">${m}</th>`).join("")}</tr></thead>
      <tbody>${r.calendario.map((year, i) => `<tr><th scope="row">${i + 1}</th>` + year.map((c, mi) => c
        ? `<td style="background:${c.color};color:${needsDarkText(c.color) ? "#0b0b0b" : "#fff"}" aria-label="${esc(c.nombre)} · ${AG_MONTHS[mi]}${c.critico ? " · critical stage" : ""}" title="${esc(c.nombre)} · ${AG_MONTHS[mi]}${c.critico ? " · critical stage" : ""}">${esc(c.abrev)}${c.critico ? "⚠" : ""}</td>`
        : `<td class="bare" aria-label="No crop · ${AG_MONTHS[mi]}">—</td>`).join("") + "</tr>").join("")}</tbody>
    </table></div>`;
    const ind = r.indicadores;
    const kpis = `<div class="kpis">
      <div class="kpi"><div class="v">${fmt(ind.meses_descubiertos, 1)}</div><div class="l">months without a crop per year</div></div>
      <div class="kpi"><div class="v">${fmt(ind.uso_agua_mm)} mm</div><div class="l">water used by the crops per year</div></div>
      <div class="kpi"><div class="v">${fmt(ind.deficit_seco_mm)} mm</div><div class="l">water deficit in a dry year</div></div>
      ${ind.erosion_t_ha != null
        ? `<div class="kpi"><div class="v">${fmt(ind.erosion_t_ha, 1)} t/ha</div><div class="l">estimated erosion per year (${fmt(ind.erosion_area_alta_pct)}% of the field above tolerance)</div></div>`
        : `<div class="kpi"><div class="v">${fmt(ind.lluvia_suelo_desnudo_mm)} mm</div><div class="l">rain on bare soil per year</div></div>`}
    </div>`;
    const ex = r.explicacion;
    const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const LEVEL = { fuerte: "✅ Good", medio: "🟡 Fair", flojo: "⚠️ Weak" };
    const diag = r.diagnostico ? `<details ${r.rol === "actual" ? "open" : ""}><summary>Strengths and weaknesses</summary><ul class="diag-list">${
      r.diagnostico.items.map((i) => `<li><strong>${LEVEL[i.nivel]} · ${esc(i.etiqueta)}</strong> — ${esc(cap(i.por_que))}.${
        i.recomendaciones.length ? `<br><span class="idea">💡 ${i.recomendaciones.map((a) => esc(cap(a))).join(". ")}.</span>` : ""}</li>`).join("")
    }</ul></details>` : "";
    return `<article class="${cls}">
      <span class="badge">${role}${r === best ? " · best score" : ""}</span>
      <h3>${esc(r.nombre)}</h3>
      <p class="desc">${esc(r.descripcion)}</p>
      <div class="total"><span class="big">${fmt(r.total)}</span><span class="of">/ 100 for your priorities</span></div>
      <div class="bars">${bars}</div>
      ${cal}
      ${kpis}
      ${diag}
      <details ${r.rol !== "actual" ? "open" : ""}><summary>Why we suggest it</summary>${list(ex.por_que)}</details>
      <details><summary>Supporting data</summary>${list(ex.evidencia)}</details>
      <details><summary>Possible benefits</summary>${list(ex.beneficios)}</details>
      <details><summary>What we don't know yet</summary>${list(ex.vacios)}</details>
      <details class="risks"><summary>Risks to review with an agronomist</summary>${list(ex.riesgos)}</details>
    </article>`;
  }).join("");
}

init().catch((err) => {
  $("#empty").hidden = true;
  $("#error").textContent = `Could not load the app: ${err.message}`;
  $("#error").hidden = false;
  $("#retry-load").hidden = false;
});
$("#retry-load").addEventListener("click", () => location.reload());

window.addEventListener("cooper-language", () => {
  if (state.result) {
    renderWaterChart(state.result.clima.mensual, state.result.escenario.activo ? state.result.clima.mensual_base : null);
    updateReportContext(state.result, state.resultInput, state.context);
  }
  if (!$("#explain-modal").hidden) $("#explain-frame").src = $("#explain-frame").src;
});
