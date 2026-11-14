/* Cooper — frontend sin frameworks. Fase 1: clima de la zona. */
"use strict";

const $ = (s) => document.querySelector(s);

const state = { catalog: null, lat: -32.62, lon: -57.75, map: null, marker: null, chart: null };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (n, d = 0) => Number(n).toLocaleString("es-UY", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ------------------------------------------------------------------ init */
async function init() {
  state.catalog = await fetch("/api/catalog").then((r) => r.json());
  buildDemoFields();
  buildMap();
  applyDemo(state.catalog.campos_demo[0]);
  $("#analyze").addEventListener("click", analyze);
}

function buildDemoFields() {
  $("#demo-fields").innerHTML = state.catalog.campos_demo
    .map((f) => `<button class="chip" data-id="${esc(f.id)}">${esc(f.nombre)}</button>`).join("");
  $("#demo-fields").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) applyDemo(state.catalog.campos_demo.find((f) => f.id === b.dataset.id));
  });
}

function applyDemo(f) {
  setPoint(f.lat, f.lon, true);
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.id === f.id));
}

function baseLayers() {
  return {
    "Mapa": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap" }),
    "Satélite": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 17, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" }),
  };
}

function buildMap() {
  state.map = L.map("map").setView([-32.8, -56.0], 6);
  const base = baseLayers();
  base["Mapa"].addTo(state.map);
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
async function analyze() {
  $("#empty").hidden = true;
  $("#error").hidden = true;
  $("#loading").hidden = false;
  $("#analyze").disabled = true;
  try {
    const resp = await fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: state.lat, lon: state.lon }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail ? JSON.stringify(data.detail) : resp.statusText);
    render(data);
  } catch (err) {
    $("#error").textContent = `No se pudo analizar: ${err.message}`;
    $("#error").hidden = false;
  } finally {
    $("#loading").hidden = true;
    $("#analyze").disabled = false;
  }
}

/* ---------------------------------------------------------------- render */
function render(data) {
  $("#content").hidden = false;
  $("#warnings").innerHTML = data.advertencias.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join("");
  const m = data.meta;
  $("#meta-line").textContent =
    `${m.fuente} · ${m.periodo} · celda de ${m.resolucion}` + (m.elevacion_m != null ? ` · altitud ${fmt(m.elevacion_m)} m` : "");
  renderWaterChart(data.clima.mensual);
  renderWaterTable(data.clima.mensual);
  renderRiskTable(data.clima.mensual);
  renderTrends(data.clima.tendencias.indicadores);
}

function renderWaterChart(months) {
  const text2 = cssVar("--text-2"), muted = cssVar("--muted");
  const datasets = [
    {
      type: "bar", label: "Lluvia promedio (mm)", data: months.map((d) => d.lluvia_mm),
      backgroundColor: cssVar("--series-1"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom",
      barPercentage: 0.7, categoryPercentage: 0.85, order: 2,
    },
    {
      type: "line", label: "Evapotranspiración de referencia (mm)", data: months.map((d) => d.et0_mm),
      borderColor: cssVar("--series-2"), backgroundColor: cssVar("--series-2"), borderWidth: 2,
      pointRadius: 4, pointHoverRadius: 6, pointBorderColor: cssVar("--surface"), pointBorderWidth: 2,
      tension: 0.3, order: 1,
    },
  ];
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
              return `Balance (lluvia − ET0): ${d.balance_mm > 0 ? "+" : ""}${fmt(d.balance_mm)} mm\nAño seco (1 de cada 5): ${fmt(d.lluvia_seca_mm)} mm de lluvia`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text2 }, border: { color: cssVar("--axis") } },
        y: {
          beginAtZero: true, grid: { color: cssVar("--grid") }, border: { display: false },
          ticks: { color: muted }, title: { display: true, text: "mm por mes", color: muted },
        },
      },
    },
  });
}

function renderWaterTable(months) {
  $("#water-table").innerHTML = `<table class="data">
    <thead><tr><th>Mes</th><th>Lluvia</th><th>Lluvia año seco</th><th>ET0</th><th>Balance</th><th>Tmáx</th><th>Tmín</th><th>Humedad raíz</th></tr></thead>
    <tbody>${months.map((d) => `<tr><td>${d.nombre}</td><td>${fmt(d.lluvia_mm)}</td><td>${fmt(d.lluvia_seca_mm)}</td>
      <td>${fmt(d.et0_mm)}</td><td>${fmt(d.balance_mm)}</td><td>${fmt(d.tmax, 1)}</td><td>${fmt(d.tmin, 1)}</td>
      <td>${d.humedad_raiz ?? "–"}</td></tr>`).join("")}</tbody></table>`;
}

function renderRiskTable(months) {
  const rows = [
    { key: "dias_calor", label: "Días de calor", note: "Tmáx ≥ 32 °C", d: 1 },
    { key: "dias_helada", label: "Días con riesgo de helada", note: "Tmín ≤ 2 °C", d: 1 },
    { key: "dias_lluvia_fuerte", label: "Días de lluvia fuerte", note: "≥ 40 mm, riesgo de erosión", d: 1 },
    { key: "deficit", label: "Déficit atmosférico (mm)", note: "ET0 − lluvia, si es positivo", d: 0 },
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
      <div class="value">${sign}${fmt(t.cambio_pct, 0)} %</div>
      <div class="detail">${t.periodo_1}: ${fmt(t.valor_1)} ${t.unidad} → ${t.periodo_2}: ${fmt(t.valor_2)} ${t.unidad}</div>
    </div>`;
  }).join("");
}

init().catch((err) => {
  $("#empty").hidden = true;
  $("#error").textContent = `No se pudo cargar la aplicación: ${err.message}`;
  $("#error").hidden = false;
});
