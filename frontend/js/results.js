/* Cooper · analysis results renderer (charts, risk calendar, zones map, rotations).
 * Renders into any container so "New analysis" and "Analysis history" share it. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  const RAMP_ORANGE = ["#f09a6e", "#e2622e", "#b0441a", "#73280c"];
  const RAMP_BLUE3 = ["#86b6ef", "#2a78d6", "#104281"];
  const RAMP_BLUE4 = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
  const LOW_SPOT = "#6250d6";

  /* ---------------------------------------------------------- zone layers */
  const erosionOf = (z, c, i, rid) => {
    const all = z.erosion_ranking?.[rid];
    return all ? all[i] : c.eros?.[rid];
  };
  const ZONE_LAYERS = {
    erosion: {
      label: "Erosion",
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
      value: (z, c, i, rid) => erosionOf(z, c, i, rid),
    },
    humedad: {
      label: "Relative wetness",
      explain: () => "Based on the shape of the land: where water collects (low spots, drainage lines) and where it dries out first (hilltops). It's relative within your field, not a moisture measurement.",
      classes: () => [
        { label: "Dries out first (hilltops)", color: RAMP_BLUE3[0], test: (v) => v === 0 },
        { label: "Intermediate", color: RAMP_BLUE3[1], test: (v) => v === 1 },
        { label: "Collects water (low spots, drainage lines)", color: RAMP_BLUE3[2], test: () => true },
      ],
      value: (z, c) => c.hum,
      discrete: true,
    },
    bajos: {
      label: "Low spots",
      explain: () => "Areas lower than their surroundings: cold air drains and pools there on frosty nights, and water can pond. Avoid crops that are sensitive to frost at flowering in these spots.",
      classes: () => [
        { label: "Low spot: more frost and waterlogging risk", color: LOW_SPOT, test: (v) => v },
        { label: "Rest of the field", color: null, test: () => true },
      ],
      value: (z, c) => c.bajo,
      discrete: true,
      boolean: true,
    },
    pendiente: {
      label: "Slope",
      explain: () => "Land slope calculated from SRTM elevation. Steeper and longer slopes mean more erosion.",
      classes: () => [
        { label: "< 1 %", color: RAMP_BLUE4[0], test: (v) => v < 1 },
        { label: "1–3 %", color: RAMP_BLUE4[1], test: (v) => v < 3 },
        { label: "3–6 %", color: RAMP_BLUE4[2], test: (v) => v < 6 },
        { label: "> 6 %", color: RAMP_BLUE4[3], test: () => true },
      ],
      value: (z, c) => c.pend,
    },
  };

  function bilinear(grid, n, fx, fy) {
    const x = Math.min(n - 1, Math.max(0, fx)), y = Math.min(n - 1, Math.max(0, fy));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const top = grid[y0 * n + x0] * (1 - tx) + grid[y0 * n + x1] * tx;
    const bot = grid[y1 * n + x0] * (1 - tx) + grid[y1 * n + x1] * tx;
    return top * (1 - ty) + bot * ty;
  }

  /* Smoothed layer image, classified with the legend and shaded by relief (light from NW). */
  function zoneRaster(z, layerKey, rid, size = 420, opaque = false) {
    const layer = ZONE_LAYERS[layerKey];
    const classes = layer.classes(z);
    const n = Math.round(Math.sqrt(z.celdas.length));
    const S = size;
    const vals = z.celdas.map((c, i) => Number(layer.value(z, c, i, rid)));
    const elev = z.celdas.map((c) => c.elev);
    const rgb = classes.map((k) => (k.color ? [1, 3, 5].map((i) => parseInt(k.color.slice(i, i + 2), 16)) : null));
    const E = new Float32Array(S * S);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++)
      E[py * S + px] = bilinear(elev, n, ((px + 0.5) / S) * n - 0.5, ((py + 0.5) / S) * n - 0.5);
    const pix = (z.celda_m * n) / S;
    const exag = 60 / Math.max(4, z.resumen.desnivel_m);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(S, S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        let v = bilinear(vals, n, ((px + 0.5) / S) * n - 0.5, ((py + 0.5) / S) * n - 0.5);
        if (layer.discrete) v = layer.boolean ? v >= 0.5 : Math.round(v);
        const ki = classes.findIndex((k) => k.test(v));
        const xl = Math.max(0, px - 1), xr = Math.min(S - 1, px + 1);
        const yu = Math.max(0, py - 1), yd = Math.min(S - 1, py + 1);
        const dzdx = ((E[py * S + xr] - E[py * S + xl]) / ((xr - xl) * pix)) * exag;
        const dzdn = ((E[yu * S + px] - E[yd * S + px]) / ((yd - yu) * pix)) * exag;
        const len = Math.hypot(dzdx, dzdn, 1);
        const hs = (dzdx - dzdn + 1) / (len * Math.sqrt(3));
        const shade = Math.min(1.3, Math.max(0.45, 1 + (hs - 0.577) * 1.5));
        const o = (py * S + px) * 4;
        const c = rgb[ki];
        if (c) {
          img.data[o] = Math.min(255, c[0] * shade);
          img.data[o + 1] = Math.min(255, c[1] * shade);
          img.data[o + 2] = Math.min(255, c[2] * shade);
          img.data[o + 3] = opaque ? 255 : 215;
        } else if (opaque) {
          const g = Math.min(255, 228 * shade);
          img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g - 8; img.data[o + 3] = 255;
        } else {
          const g = shade < 1 ? 0 : 255;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
          img.data[o + 3] = Math.min(110, Math.abs(shade - 1) * 260);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* ------------------------------------------------------------ sections */
  const legendHTML = (classes) => classes.map((k) =>
    `<span><i class="swatch" style="${k.color ? `background:${k.color}` : "background:transparent;border:1px solid var(--axis)"}"></i>${esc(k.label)}</span>`).join("");

  function calendarTable(r, compact = false) {
    return `<div class="calendar-scroll"><table class="cal-table ${compact ? "compact" : ""}" aria-label="Rotation calendar">
      <thead><tr><th scope="col">Year</th>${C.AG_MONTHS.map((m) => `<th scope="col">${m}</th>`).join("")}</tr></thead>
      <tbody>${r.calendario.map((year, i) => `<tr><th scope="row">${i + 1}</th>` + year.map((c, mi) => c
        ? `<td style="background:${c.color};color:${C.needsDarkText(c.color) ? "#0b0b0b" : "#fff"}" title="${esc(c.nombre)} · ${C.AG_MONTHS[mi]}${c.critico ? " · critical stage" : ""}">${esc(c.abrev)}${c.critico ? "<sup>!</sup>" : ""}</td>`
        : `<td class="bare" title="No crop · ${C.AG_MONTHS[mi]}">–</td>`).join("") + "</tr>").join("")}</tbody>
    </table></div>`;
  }
  C.calendarTable = calendarTable;

  function riskTable(months) {
    const rows = [
      { key: "dias_calor", label: "Hot days", note: "Tmax ≥ 32 °C", d: 1 },
      { key: "dias_helada", label: "Frost-risk days", note: "Tmin ≤ 2 °C", d: 1 },
      { key: "dias_lluvia_fuerte", label: "Heavy-rain days", note: "≥ 40 mm, erosion risk", d: 1 },
      { key: "deficit", label: "Atmospheric water deficit (mm)", note: "ET0 − rain, when positive", d: 0 },
    ];
    const steps = ["--seq-0", "--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5"].map(C.cssVar);
    const value = (d, k) => (k === "deficit" ? Math.max(0, -d.balance_mm) : d[k]);
    const body = rows.map((r) => {
      const vals = months.map((d) => value(d, r.key));
      const max = Math.max(...vals) || 1;
      const cells = vals.map((v, i) => {
        const lvl = v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
        const color = C.needsDarkText(steps[lvl] || "#ffffff") ? "#0b0b0b" : "#fff";
        return `<td class="cell" data-lvl="${lvl}" style="background:${steps[lvl]};color:${color}" title="${months[i].nombre}: ${fmt(v, r.d)}">${v > 0 ? fmt(v, r.d) : "·"}</td>`;
      }).join("");
      return `<tr><th scope="row">${esc(r.label)}<span class="row-note">${esc(r.note)}</span></th>${cells}</tr>`;
    }).join("");
    return `<table class="data risk"><thead><tr><th></th>${months.map((d) => `<th scope="col">${d.nombre}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function waterTable(months) {
    return `<table class="data">
      <thead><tr><th>Month</th><th>Rain (mm)</th><th>Rain, dry year (mm)</th><th>ET0 (mm)</th><th>Balance (mm)</th><th>Tmax (°C)</th><th>Tmin (°C)</th><th>Root-zone moisture</th></tr></thead>
      <tbody>${months.map((d) => `<tr><td>${d.nombre}</td><td>${fmt(d.lluvia_mm)}</td><td>${fmt(d.lluvia_seca_mm)}</td>
        <td>${fmt(d.et0_mm)}</td><td>${fmt(d.balance_mm)}</td><td>${fmt(d.tmax, 1)}</td><td>${fmt(d.tmin, 1)}</td>
        <td>${d.humedad_raiz ?? "–"}</td></tr>`).join("")}</tbody></table>`;
  }

  function trendsHTML(indicators) {
    return indicators.map((t) => {
      const sign = t.cambio_pct > 0 ? "+" : "";
      const dir = t.cambio_pct > 0.5 ? "up" : t.cambio_pct < -0.5 ? "down" : "flat";
      return `<div class="tile trend ${dir}">
        <div class="label">${esc(t.nombre)}</div>
        <div class="value">${sign}${fmt(t.cambio_pct, 0)}%</div>
        <div class="detail">${t.periodo_1}: ${fmt(t.valor_1)} ${t.unidad} → ${t.periodo_2}: ${fmt(t.valor_2)} ${t.unidad}</div>
      </div>`;
    }).join("");
  }

  const LEVEL = { fuerte: ["good", "Good"], medio: ["fair", "Fair"], flojo: ["weak", "Weak"] };
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

  function rotationCard(r, prio, best, labels) {
    const role = r.rol === "actual" ? "Your current rotation" : r.rol === "alternativa_1" ? "Alternative 1" : "Alternative 2";
    const bars = Object.entries(labels).map(([k, label]) => `
      <div class="bar-row" title="${esc(label)}: ${r.puntajes[k]} out of 100 (importance ${prio[k]}/5)">
        <span class="name ${prio[k] >= 4 ? "prio-high" : ""}">${icon(C.SCORES[k].icon)}${esc(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="background:var(${C.SCORES[k].color})" data-w="${r.puntajes[k]}"></span></span>
        <span class="val">${r.puntajes[k]}</span>
      </div>`).join("");
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
    const diag = r.diagnostico ? `<details ${r.rol === "actual" ? "open" : ""}><summary>Strengths and weaknesses</summary><ul class="diag-list">${
      r.diagnostico.items.map((i) => `<li class="lvl-${LEVEL[i.nivel][0]}"><span class="lvl">${LEVEL[i.nivel][1]}</span><strong>${esc(i.etiqueta)}</strong> — ${esc(cap(i.por_que))}.${
        i.recomendaciones.length ? `<span class="idea">${icon("bulb")}${i.recomendaciones.map((a) => esc(cap(a))).join(". ")}.</span>` : ""}</li>`).join("")
    }</ul></details>` : "";
    return `<article class="rot card ${r.rol === "actual" ? "current" : ""} ${r === best ? "best" : ""}" data-rev>
      <div class="rot-head"><span class="badge ${r.rol === "actual" ? "muted" : ""}">${role}</span>${r === best ? `<span class="badge best">${icon("star")}Best score</span>` : ""}</div>
      <h3>${esc(r.nombre)}</h3>
      <p class="desc">${esc(r.descripcion)}</p>
      <div class="total"><span class="big" data-count="${r.total}">${fmt(r.total)}</span><span class="of">/ 100 for your priorities</span></div>
      <div class="bars">${bars}</div>
      ${calendarTable(r)}
      ${kpis}
      ${diag}
      <details ${r.rol !== "actual" ? "open" : ""}><summary>Why we suggest it</summary>${list(ex.por_que)}</details>
      <details><summary>Supporting data</summary>${list(ex.evidencia)}</details>
      <details><summary>Possible benefits</summary>${list(ex.beneficios)}</details>
      <details><summary>What we don't know yet</summary>${list(ex.vacios)}</details>
      <details class="risks"><summary>Risks to review with an agronomist</summary>${list(ex.riesgos)}</details>
    </article>`;
  }

  function rankingTable(ranking, currentId) {
    const keys = Object.keys(C.SCORES);
    return `<div class="scroll-x"><table class="data ranking">
      <thead><tr><th scope="col">#</th><th scope="col">Rotation</th>${keys.map((k) => `<th scope="col" class="num">${icon(C.SCORES[k].icon)}<span>${esc(C.SCORES[k].label)}</span></th>`).join("")}<th scope="col" class="num">Total</th></tr></thead>
      <tbody>${ranking.map((r, i) => `<tr class="${r.id === currentId ? "is-current" : ""}"><td>${i + 1}</td><td>${esc(r.nombre)}${r.id === currentId ? ` <span class="badge muted">Current</span>` : ""}</td>${
        keys.map((k) => `<td class="num"><span class="mini-bar" style="--w:${r.puntajes[k]}%;--c:var(${C.SCORES[k].color})"></span>${r.puntajes[k]}</td>`).join("")}<td class="num strong">${fmt(r.total)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }

  /* --------------------------------------------------------------- render */
  function render(container, analysis, opts = {}) {
    const { result: data, input } = analysis;
    const prio = input.prioridades;
    const labels = window.CooperCatalog?.puntajes || Object.fromEntries(Object.entries(C.SCORES).map(([k, v]) => [k, v.label]));
    const m = data.meta;
    const ranking = data.ranking || data.rotaciones;
    const currentId = data.rotaciones[0].id;
    const best = data.rotaciones.reduce((a, b) => (b.total > a.total ? b : a));
    const crops = new Map();
    for (const r of data.rotaciones) for (const y of r.calendario) for (const c of y) if (c) crops.set(c.id, c);
    const state = { layer: "erosion", rot: currentId, chartCtl: null, radarCtl: null, map: null, group: null };

    container.innerHTML = `
      ${data.advertencias.map((w) => `<div class="notice warn" data-rev>${icon("alert")}<span>${esc(w)}</span></div>`).join("")}
      <section class="card" data-rev>
        <div class="card-head"><div><h2>Your area in numbers</h2>
          <p class="sub">${esc(m.fuente)} · ${esc(m.periodo)} · ${esc(m.resolucion)} grid cell${m.elevacion_m != null ? ` · elevation ${fmt(m.elevacion_m)} m` : ""}</p></div></div>
        <div class="chart-head">
          <div><h3 class="chart-title">Rainfall and atmospheric water demand, by month</h3>
            <p class="hint chart-hint">When the orange line (evapotranspiration) rises above the blue bars (rainfall), crops depend on the water stored in the soil.</p></div>
          <div class="seg chart-views" role="group" aria-label="Chart view">
            <button type="button" data-view="monthly" class="active" aria-pressed="true">Monthly</button>
            <button type="button" data-view="balance" aria-pressed="false">Water balance</button>
            <button type="button" data-view="years" aria-pressed="false">30 years</button>
            <button type="button" data-view="temp" aria-pressed="false">Temperature</button>
          </div>
        </div>
        <label class="check sm dry-toggle"><input type="checkbox" class="show-dry"><span class="box" aria-hidden="true"></span>Show rainfall in a dry year (1 in 5)</label>
        <p class="hint chart-notice" hidden></p>
        <div class="chart-box"><canvas role="img" aria-label="Climate chart"></canvas></div>
        <details class="table-view"><summary>Show as a table</summary><div class="scroll-x">${waterTable(data.clima.mensual)}</div></details>
        <h3>Risk calendar</h3>
        <p class="hint">Values use the units shown in each row. Colour intensity compares months within a row, not different risks.</p>
        <div class="scroll-x risk-wrap">${riskTable(data.clima.mensual)}</div>
        <h3>How is your area changing?</h3>
        <div class="tiles">${trendsHTML(data.clima.tendencias.indicadores)}</div>
      </section>
      ${data.zonas ? `<section class="card zones-card" data-rev>
        <div class="card-head"><div><h2>Zones of your field</h2>
          <p class="sub">${fmt(data.zonas.area_ha)} ha · ${fmt(data.zonas.celda_m)} m grid · NASA SRTM 30 m · R = ${fmt(data.zonas.r_factor)} MJ·mm/ha/h/yr · K = ${data.zonas.k_factor} (typical value, not measured)</p></div></div>
        <div class="zone-controls">
          <div class="seg" role="group" aria-label="Map layer">${Object.entries(ZONE_LAYERS).map(([k, l]) =>
            `<button type="button" data-layer="${k}" aria-pressed="${k === "erosion"}" class="${k === "erosion" ? "active" : ""}">${esc(l.label)}</button>`).join("")}</div>
          <label class="inline zone-rot-wrap">Rotation <select class="zone-rot">${ranking.map((r) =>
            `<option value="${esc(r.id)}">${r.id === currentId ? "Current: " : ""}${esc(r.nombre)}</option>`).join("")}</select></label>
        </div>
        <div class="zones-map" aria-label="Map of zones within the field"></div>
        <div class="legend zone-legend"></div>
        <p class="hint zone-explain"></p>
        <div class="tiles zone-tiles"></div>
      </section>` : ""}
      ${opts.scenarioSlot ? `<div class="scenario-slot"></div>` : ""}
      <section data-rev>
        <div class="section-head"><h2>Three rotations side by side</h2>
          <p class="hint">Scores go from 0 to 100. The total weights each score by what matters to you. Months marked ! are critical crop stages. Scroll each crop calendar sideways to see the full year.</p></div>
        <div class="card profile-card" data-rev>
          <div class="profile-grid">
            <div><h3>Score profile</h3><p class="hint">Each axis is one topic, from 0 at the centre to 100 at the edge. The dashed shape is your current rotation. Click a name in the legend to hide or show it.</p>
              <ul class="profile-list">${data.rotaciones.map((r, i) => `<li><i style="--c:var(${["--muted", "--brand", "--c-ingreso"][i]})"></i><span>${esc(r.nombre)}</span><strong>${fmt(r.total)}</strong></li>`).join("")}</ul></div>
            <div class="radar-box"><canvas role="img" aria-label="Score profile of the three rotations"></canvas></div>
          </div>
        </div>
        <div class="legend crop-legend">${[...crops.values()].map((c) =>
          `<span><i class="swatch" style="background:${c.color}"></i>${esc(c.nombre)}</span>`).join("")}<span><i class="swatch" style="background:var(--bare)"></i>No crop</span></div>
        <div class="rotations">${data.rotaciones.map((r) => rotationCard(r, prio, best, labels)).join("")}</div>
      </section>
      ${data.ranking ? `<section class="card" data-rev><div class="card-head"><div><h2>All options for your field</h2>
        <p class="sub">Every rotation in Cooper's library that fits your farm, ordered by the total for your priorities.</p></div></div>
        ${rankingTable(data.ranking, currentId)}</section>` : ""}
      <section class="card method" data-rev>
        <details><summary><h2>Glossary</h2></summary>
        <dl class="glossary">
          <dt>Evapotranspiration (ET)</dt><dd>The water that leaves the field for the atmosphere: what evaporates from the soil plus what plants transpire. <em>Reference ET</em> (ET0) is the value for well-watered grass; each crop uses a fraction of it.</dd>
          <dt>Water deficit</dt><dd>The water a crop would need but can't find, either in the rain or in the soil.</dd>
          <dt>Cover crop</dt><dd>A crop sown to protect and improve the soil rather than to sell, such as black oat or vetch.</dd>
          <dt>First-crop and second-crop</dt><dd>A first crop is sown on its normal date; a second crop (for example second-crop soybean) is sown later, right after harvesting a winter crop, so one paddock gives two harvests in a year.</dd>
          <dt>Erosion (RUSLE)</dt><dd>A formula used worldwide (and in Uruguay's Erosión 6.0 tool from MGAP) to estimate how many tonnes of soil per hectare are lost each year. It combines rainfall strength, soil type, slope and slope length, and how long the soil stays covered.</dd>
          <dt>Relative wetness (TWI)</dt><dd>An index of where water runs and collects based on the shape of the land: low spots and drainage lines collect water, while hilltops dry out first. It's relative within your field.</dd>
          <dt>Root-zone soil moisture</dt><dd>How full of water the soil is, from 0 (dry) to 1 (saturated). It comes from a NASA model (MERRA-2) that combines satellites and weather stations.</dd>
          <dt>Frost risk</dt><dd>Days when the minimum air temperature is 2 °C or lower. We use 2 °C instead of 0 °C because the ground and leaves get colder than the air 2 m above them.</dd>
          <dt>Dry year</dt><dd>A bad year that comes about once every five. For rainfall, it's the amount exceeded in 4 out of 5 years; for the crops' water deficit, the amount exceeded in only 1 out of 5 years.</dd>
        </dl></details>
        <details><summary><h2>How it works and where the data comes from</h2></summary>
        <ul>
          <li><strong>Climate:</strong> NASA POWER daily data, 1996–2025 (temperature, rainfall corrected with GPM-IMERG, MERRA-2 soil moisture).</li>
          <li><strong>Evapotranspiration:</strong> Hargreaves method (FAO-56), using daily maximum and minimum temperatures.</li>
          <li><strong>Farming year:</strong> May to April, so the winter and summer crops of one season stay together.</li>
          <li><strong>Water balance:</strong> month by month, over every real year in the record: effective rainfall (USDA-SCS method) minus crop water use (ET0 × crop coefficient), with the soil acting as a "bucket" of the size you chose.</li>
          <li><strong>Terrain and erosion:</strong> NASA SRTM 30 m elevation (through OpenTopoData) on a 15 × 15 grid; slope, water flow (D8) and RUSLE with a month-by-month cover factor from each rotation's calendar, assuming no-till.</li>
          <li><strong>Scores:</strong> written, reviewable agronomic rules and thresholds, with no black boxes. No AI makes the decisions.</li>
          <li><strong>Crop table:</strong> built from general literature for Uruguay. A local agronomist should validate it.</li>
        </ul></details>
      </section>`;

    /* charts */
    const VIEWS = {
      monthly: ["Rainfall and atmospheric water demand, by month", "When the orange line (evapotranspiration) rises above the blue bars (rainfall), crops depend on the water stored in the soil."],
      balance: ["Monthly water balance", "Rain minus reference evapotranspiration. Orange months take more water from the soil than the rain brings."],
      years: ["Rainfall in each of the last 30 farming years", "Blue years were wetter than the 30-year average, orange years drier. The dark line is the 5-year average; the dashed line counts hot days."],
      temp: ["Average maximum and minimum temperature", "The shaded band is the daily range. Frost risk starts when the minimum gets close to 2 °C; heat stress above 32 °C."],
    };
    state.view = "monthly";
    const canvas = $(".chart-box canvas", container);
    const buildMain = () => {
      if (state.view === "balance") return C.charts.waterBalance(data);
      if (state.view === "years") return C.charts.annualSeries(data);
      if (state.view === "temp") return C.charts.temperature(data);
      return C.charts.climateMonthly(data, { showDry: $(".show-dry", container)?.checked });
    };
    function drawChart() {
      if (typeof Chart === "undefined") {
        const n = $(".chart-notice", container);
        n.textContent = "The chart could not load. All climate values are available in the table below.";
        n.hidden = false; $(".table-view", container).open = true;
        return;
      }
      if (state.chartCtl) { state.chartCtl.build = buildMain; if (state.chartCtl.chart) { state.chartCtl.chart.destroy(); state.chartCtl.chart = C.charts.make(canvas, buildMain(), true); } return; }
      state.chartCtl = C.charts.lazy(canvas, buildMain);
    }
    drawChart();
    C.on(container, "click", ".chart-views button", (e, b) => {
      state.view = b.dataset.view;
      $$(".chart-views button", container).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      $(".chart-title", container).textContent = VIEWS[state.view][0];
      $(".chart-hint", container).textContent = VIEWS[state.view][1];
      $(".dry-toggle", container).hidden = state.view !== "monthly";
      const box = $(".chart-box", container), g = C.motion.gsap;
      if (g) g.fromTo(box, { opacity: 0.2, y: 6 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" });
      drawChart();
    });
    $(".show-dry", container).addEventListener("change", drawChart);
    const radarCanvas = $(".radar-box canvas", container);
    state.radarCtl = typeof Chart !== "undefined" ? C.charts.lazy(radarCanvas, () => C.charts.radar(data.rotaciones.map((r, i) => ({ ...r, labelPrefix: i === 0 ? "Current" : "" })))) : null;

    /* zones */
    function drawZones() {
      const z = data.zonas;
      if (!z || !state.map) return;
      const layer = ZONE_LAYERS[state.layer];
      const classes = layer.classes(z);
      $(".zone-rot-wrap", container).hidden = state.layer !== "erosion";
      $(".zone-explain", container).textContent = layer.explain(z);
      $(".zone-legend", container).innerHTML = legendHTML(classes);
      state.group.clearLayers();
      const rot = ranking.find((r) => r.id === state.rot) || data.rotaciones[0];
      L.imageOverlay(zoneRaster(z, state.layer, state.rot).toDataURL(), z.bounds, { opacity: 0.8, interactive: false }).addTo(state.group);
      z.celdas.forEach((c, i) => {
        const v = layer.value(z, c, i, state.rot);
        const k = classes.find((x) => x.test(layer.discrete && !layer.boolean ? Math.round(v) : v));
        const tip = `<strong>${esc(C.t(k.label))}</strong><br>${C.t("Elevation")} ${fmt(c.elev, 1)} m · ${C.t("slope")} ${fmt(c.pend, 1)}%` +
          `<br>${C.t("Erosion")} (${esc(C.t(rot.nombre))}): ${fmt(erosionOf(z, c, i, state.rot), 1)} t/ha`;
        L.rectangle(c.b, { stroke: false, fillOpacity: 0 }).bindTooltip(tip, { sticky: true }).addTo(state.group);
      });
      L.rectangle(z.bounds, { color: "#ffffff", weight: 2, fill: false, interactive: false }).addTo(state.group);
      const s = z.resumen, er = rot.indicadores;
      $(".zone-tiles", container).innerHTML = `
        <div class="tile"><div class="label">Height difference within the field</div><div class="value">${fmt(s.desnivel_m)} m</div>
          <div class="detail">from ${fmt(s.elev_min)} to ${fmt(s.elev_max)} m above sea level</div></div>
        <div class="tile"><div class="label">Slope</div><div class="value">${fmt(s.pendiente_media_pct, 1)}%</div>
          <div class="detail">average · maximum ${fmt(s.pendiente_max_pct, 1)}%</div></div>
        <div class="tile"><div class="label">Erosion · ${esc(rot.nombre)}</div><div class="value">${fmt(er.erosion_t_ha, 1)} t/ha a year</div>
          <div class="detail">${fmt(er.erosion_area_alta_pct)}% of the field exceeds ${z.tolerancia_t_ha} t/ha a year</div></div>
        <div class="tile"><div class="label">Low spots</div><div class="value">${fmt(s.area_baja_pct)}%</div>
          <div class="detail">of the field, with more frost and waterlogging risk</div></div>`;
    }
    if (data.zonas) {
      const mapEl = $(".zones-map", container);
      if (typeof L === "undefined") {
        mapEl.innerHTML = `<p class="hint pad">The map is unavailable. Terrain and erosion estimates remain in the comparison below.</p>`;
      } else {
        state.map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: true });
        const base = C.baseLayers();
        base.Satellite.addTo(state.map);
        L.control.layers(base, null, { collapsed: true }).addTo(state.map);
        state.group = L.layerGroup().addTo(state.map);
        state.map.fitBounds(data.zonas.bounds, { padding: [12, 12] });
        drawZones();
      }
      C.on(container, "click", ".zones-card .seg button", (e, b) => {
        state.layer = b.dataset.layer;
        $$(".zones-card .seg button", container).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        drawZones();
      });
      $(".zone-rot", container)?.addEventListener("change", (e) => { state.rot = e.target.value; drawZones(); });
    }

    /* entrance */
    C.motion.reveal($$("[data-rev]", container), { stagger: 0.07 });
    C.motion.bars(container);
    $$("[data-count]", container).forEach((el) => C.motion.count(el, Number(el.dataset.count)));
    const ro = new ResizeObserver(() => state.map?.invalidateSize());
    ro.observe(container);

    return {
      state,
      refresh() { state.chartCtl?.redraw(false); state.radarCtl?.redraw(false); container.querySelectorAll(".risk-wrap").forEach((w) => { w.innerHTML = riskTable(data.clima.mensual); }); },
      relayout() { state.map?.invalidateSize(); if (data.zonas && state.map) state.map.fitBounds(data.zonas.bounds, { padding: [12, 12] }); },
      chartImage() { return state.chartCtl?.chart ? state.chartCtl.chart.toBase64Image("image/png", 1) : null; },
      destroy() { ro.disconnect(); state.chartCtl?.destroy(); state.radarCtl?.destroy(); state.map?.remove(); container.innerHTML = ""; },
    };
  }

  C.results = { render, zoneRaster, ZONE_LAYERS, riskTable, rankingTable, erosionOf };
})();
