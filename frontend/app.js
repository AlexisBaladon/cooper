/* Cooper — frontend sin frameworks. Fase 2: clima + comparación de rotaciones. UI en inglés. */
"use strict";

const $ = (s) => document.querySelector(s);
const AG_MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
const PRIORITY_HINTS = {
  agua: "Save water",
  suelo: "Look after the soil",
  ingreso: "Earn more (income)",
  forraje: "Have forage for livestock",
  clima: "Less climate risk",
};
const DEFAULT_PRIORITIES = { agua: 3, suelo: 4, ingreso: 4, forraje: 1, clima: 3 };

const state = { catalog: null, lat: -32.62, lon: -57.75, map: null, marker: null, chart: null, analyzed: false };

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
  state.catalog = await fetch("/api/catalog").then((r) => r.json());
  buildForm();
  buildMap();
  applyDemo(state.catalog.campos_demo[0]);
  $("#analyze").addEventListener("click", analyze);
  $("#rotation").addEventListener("change", updateRotationDesc);

  // Simulador de clima: recalcula solo después de un primer análisis.
  let t;
  const onScenario = () => {
    $("#rain-val").textContent = `${Number($("#rain").value) > 0 ? "+" : ""}${$("#rain").value}%`;
    $("#temp-val").textContent = `+${Number($("#temp").value).toFixed(1)} °C`;
    clearTimeout(t);
    if (state.analyzed) t = setTimeout(analyze, 350);
  };
  $("#rain").addEventListener("input", onScenario);
  $("#temp").addEventListener("input", onScenario);
  $("#reset-scenario").addEventListener("click", () => {
    $("#rain").value = 0; $("#temp").value = 0; onScenario();
  });
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
    $(`#p-${k}`).addEventListener("input", (e) => { $(`#o-${k}`).textContent = e.target.value; });
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
  updateRotationDesc();
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.id === f.id));
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
  state.map = L.map("map").setView([-32.8, -56.0], 6);
  const base = baseLayers();
  base["Map"].addTo(state.map);
  L.control.layers(base, null, { collapsed: true }).addTo(state.map);
  state.marker = L.marker([state.lat, state.lon], { draggable: true }).addTo(state.map);
  state.marker.on("dragend", (e) => { const p = e.target.getLatLng(); setPoint(p.lat, p.lng); });
  state.map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
}

function setPoint(lat, lon, recenter = false) {
  state.lat = lat; state.lon = lon;
  state.marker.setLatLng([lat, lon]);
  if (recenter) state.map.setView([lat, lon], 8);
  $("#coords").textContent = `Lat ${lat.toFixed(3)} · Lon ${lon.toFixed(3)}`;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
}

/* --------------------------------------------------------------- analyze */
function readPriorities() {
  return Object.fromEntries(Object.keys(PRIORITY_HINTS).map((k) => [k, Number($(`#p-${k}`).value)]));
}

async function analyze() {
  const body = {
    lat: state.lat,
    lon: state.lon,
    rotacion_actual: $("#rotation").value,
    prioridades: readPriorities(),
    escenario: { lluvia_pct: Number($("#rain").value), temp_delta: Number($("#temp").value) },
    capacidad_suelo_mm: Number($("#soil").value),
    tiene_ganado: $("#livestock").checked,
  };
  $("#empty").hidden = true;
  $("#error").hidden = true;
  $("#loading").hidden = false;
  $("#analyze").disabled = true;
  try {
    const resp = await fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail ? JSON.stringify(data.detail) : resp.statusText);
    render(data, body.prioridades);
    state.analyzed = true;
  } catch (err) {
    $("#error").textContent = `Could not run the analysis: ${err.message}`;
    $("#error").hidden = false;
  } finally {
    $("#loading").hidden = true;
    $("#analyze").disabled = false;
  }
}

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
}

function renderWaterChart(months, base) {
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
    data: { labels: months.map((d) => d.nombre), datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { color: text2, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} mm`,
            afterBody: (items) => {
              const d = months[items[0].dataIndex];
              return `Balance (rain − ET0): ${d.balance_mm > 0 ? "+" : ""}${fmt(d.balance_mm)} mm\nDry year (1 in 5): ${fmt(d.lluvia_seca_mm)} mm of rain`;
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
    <thead><tr><th>Month</th><th>Rain</th><th>Rain, dry year</th><th>ET0</th><th>Balance</th><th>Tmax</th><th>Tmin</th><th>Root-zone moisture</th></tr></thead>
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
      const color = lvl >= 3 ? "#fff" : "inherit";
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
    const cal = `<div class="cal" role="table" aria-label="Rotation calendar">
      <span></span>${AG_MONTHS.map((m) => `<span class="mh">${m}</span>`).join("")}
      ${r.calendario.map((year, i) => `<span class="yl">Year ${i + 1}</span>` + year.map((c, mi) => c
        ? `<span class="c ${needsDarkText(c.color) ? "dark-text" : ""}" style="background:${c.color}" title="${esc(c.nombre)} · ${AG_MONTHS[mi]}${c.critico ? " · critical stage" : ""}">${esc(c.abrev)}${c.critico ? "⚠" : ""}</span>`
        : `<span class="c bare" title="No crop · ${AG_MONTHS[mi]}">—</span>`).join("")).join("")}
    </div>`;
    const ind = r.indicadores;
    const kpis = `<div class="kpis">
      <div class="kpi"><div class="v">${fmt(ind.meses_descubiertos, 1)}</div><div class="l">months without a crop per year</div></div>
      <div class="kpi"><div class="v">${fmt(ind.uso_agua_mm)} mm</div><div class="l">water used by the crops per year</div></div>
      <div class="kpi"><div class="v">${fmt(ind.deficit_seco_mm)} mm</div><div class="l">water deficit in a dry year</div></div>
      <div class="kpi"><div class="v">${fmt(ind.lluvia_suelo_desnudo_mm)} mm</div><div class="l">rain on bare soil per year</div></div>
    </div>`;
    const ex = r.explicacion;
    const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    return `<article class="${cls}">
      <span class="badge">${role}${r === best ? " · best score" : ""}</span>
      <h3>${esc(r.nombre)}</h3>
      <p class="desc">${esc(r.descripcion)}</p>
      <div class="total"><span class="big">${fmt(r.total)}</span><span class="of">/ 100 for your priorities</span></div>
      <div class="bars">${bars}</div>
      ${cal}
      ${kpis}
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
});
