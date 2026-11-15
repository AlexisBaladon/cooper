/* Cooper · "My field": the farmer's fields, imagery (satellite, NDVI, erosion, crops),
 * soil, climate, crop and terrain data. Each field is independent. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  let maps = [], relief = null, soilCache = new Map();

  const WORLDCOVER = [
    ["Tree cover", "#006400"], ["Shrubland", "#ffbb22"], ["Grassland", "#ffff4c"], ["Cropland", "#f096ff"],
    ["Built-up", "#fa0000"], ["Bare / sparse vegetation", "#b4b4b4"], ["Water", "#0064c8"], ["Herbaceous wetland", "#0096a0"],
  ];
  const NDVI_STEPS = [["< 0.1", "#a5875a"], ["0.2", "#d2c27c"], ["0.4", "#a6c45a"], ["0.6", "#5f9e36"], ["> 0.8", "#1f5f1c"]];

  const ndviDate = () => { const d = new Date(Date.now() - 16 * 864e5); return d.toISOString().slice(0, 10); };

  let fchart = null;
  function destroy() { maps.forEach((m) => m.remove()); maps = []; relief?.destroy?.(); relief = null; fchart?.destroy(); fchart = null; }

  /* ---------------------------------------------------------- field editor */
  C.fieldEditor = (field = null) => {
    const cat = window.CooperCatalog;
    const f = field || { nombre: "", lat: -32.62, lon: -57.75, area_ha: 100, rotacion_actual: cat.rotaciones[0].id, tiene_ganado: false, capacidad_suelo_mm: 120 };
    let lat = f.lat, lon = f.lon, map = null, marker = null, rect = null;
    const body = `<form class="fe" id="fe-form" novalidate>
      <label class="field">Field name <input id="fe-name" required maxlength="60" value="${esc(f.nombre)}" placeholder="e.g. South paddock" autofocus></label>
      <div class="fe-map" id="fe-map" aria-label="Map to locate the field"></div>
      <p class="hint" id="fe-coords"></p>
      <div class="fe-grid">
        <label class="field">Approximate field size <select id="fe-area">${[25, 50, 100, 200, 500].map((v) => `<option value="${v}" ${Number(f.area_ha) === v ? "selected" : ""}>${v} ha</option>`).join("")}</select></label>
        <label class="field">How much water does your soil hold? <select id="fe-soil">
          <option value="80" ${f.capacidad_suelo_mm == 80 ? "selected" : ""}>Little: shallow or sandy soil (~80 mm)</option>
          <option value="120" ${f.capacidad_suelo_mm == 120 ? "selected" : ""}>Medium (~120 mm)</option>
          <option value="170" ${f.capacidad_suelo_mm == 170 ? "selected" : ""}>A lot: deep, clayey soil (~170 mm)</option></select></label>
      </div>
      <label class="field">Which rotation do you use today? <select id="fe-rot">${cat.rotaciones.map((r) => `<option value="${esc(r.id)}" ${r.id === f.rotacion_actual ? "selected" : ""}>${esc(r.nombre)}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" id="fe-live" ${f.tiene_ganado ? "checked" : ""}><span class="box" aria-hidden="true"></span>I have livestock (fences and water points)</label>
      <p class="notice error" id="fe-err" hidden></p>
    </form>`;
    const setP = (a, b) => {
      lat = a; lon = b;
      marker?.setLatLng([a, b]);
      const bb = C.fieldBounds(a, b, Number($("#fe-area")?.value || f.area_ha));
      if (rect) rect.setBounds(bb); else if (map) rect = L.rectangle(bb, { color: "#fff", weight: 2, fillOpacity: 0.08 }).addTo(map);
      const el = $("#fe-coords"); if (el) el.textContent = `Lat ${a.toFixed(4)} · Lon ${b.toFixed(4)}${C.inUruguay(a, b) ? "" : " · Outside Uruguay: crop calendars may not apply."}`;
    };
    return C.dialog({
      title: field ? "Edit field" : "Add a field", wide: true, body,
      actions: [{ label: "Cancel", value: null }, { label: field ? "Save changes" : "Add field", kind: "primary", handler: (b) => {
        const name = $("#fe-name", b).value.trim();
        if (!name) { const e = $("#fe-err", b); e.textContent = C.t("Give the field a name."); e.hidden = false; $("#fe-name", b).focus(); return false; }
        const saved = C.fields.upsert({ ...(field || {}), id: field?.id, nombre: name, lat, lon, area_ha: Number($("#fe-area", b).value),
          capacidad_suelo_mm: Number($("#fe-soil", b).value), rotacion_actual: $("#fe-rot", b).value, tiene_ganado: $("#fe-live", b).checked,
          prioridades: field?.prioridades || { ...C.DEFAULT_PRIORITIES }, muestra: false });
        C.toast(C.t(field ? "Field updated." : "Field added."));
        return saved;
      } }],
      onOpen: (b) => {
        if (typeof L === "undefined") { $("#fe-map", b).innerHTML = `<p class="hint pad">The map could not load.</p>`; setP(lat, lon); return; }
        map = L.map($("#fe-map", b), { scrollWheelZoom: false }).setView([lat, lon], 12);
        C.baseLayers().Satellite.addTo(map);
        marker = L.marker([lat, lon], { draggable: true }).addTo(map);
        marker.on("dragend", (e) => { const p = e.target.getLatLng(); setP(p.lat, p.lng); });
        map.on("click", (e) => setP(e.latlng.lat, e.latlng.lng));
        $("#fe-area", b).addEventListener("change", () => setP(lat, lon));
        setP(lat, lon);
        setTimeout(() => map.invalidateSize(), 250);
      },
    });
  };

  /* --------------------------------------------------------------- panels */
  function imageryPanel(id, title, source, legend, note) {
    return `<figure class="card img-panel" data-rev>
      <figcaption class="ip-head"><div><h3>${esc(title)}</h3><small>${esc(source)}</small></div></figcaption>
      <div class="ip-map" id="${id}"><div class="ip-empty" hidden>${icon("satellite")}<strong>Image not available</strong><span>This space is ready for the image source. It will appear here when the provider responds.</span></div></div>
      ${legend ? `<div class="legend ip-legend">${legend}</div>` : ""}
      ${note ? `<p class="hint">${note}</p>` : ""}
    </figure>`;
  }
  const swatches = (pairs) => pairs.map(([l, c]) => `<span><i class="swatch" style="background:${c}"></i>${esc(l)}</span>`).join("");

  function makeMap(el, field, opts = {}) {
    const m = L.map(el, { scrollWheelZoom: false, attributionControl: true, zoomControl: true });
    const b = C.fieldBounds(field.lat, field.lon, field.area_ha);
    m.fitBounds(b, { padding: [24, 24] });
    if (opts.base !== false) C.baseLayers().Satellite.addTo(m);
    maps.push(m);
    return { m, b };
  }
  /* Show the placeholder when an image source fails (no tiles at all). */
  function watchTiles(layer, panel) {
    let ok = 0, bad = 0;
    layer.on("tileload", () => { ok++; $(".ip-empty", panel).hidden = true; });
    layer.on("tileerror", () => { bad++; if (!ok && bad >= 2) $(".ip-empty", panel).hidden = false; });
  }

  function kpi(label, value, detail, ic) {
    return `<div class="tile kpi-tile">${ic ? icon(ic) : ""}<div class="label">${esc(label)}</div><div class="value">${value}</div>${detail ? `<div class="detail">${esc(detail)}</div>` : ""}</div>`;
  }

  /* --------------------------------------------------------------- render */
  async function render(root, { field, rec, catalog }) {
    destroy();
    const fields = C.fields.list();
    const data = rec?.result;
    const rot = catalog.rotaciones.find((r) => r.id === field.rotacion_actual);
    const curRot = data?.ranking?.find((r) => r.id === field.rotacion_actual) || data?.rotaciones?.[0];
    const months = data?.clima?.mensual;
    const sum = (k) => months ? months.reduce((s, m) => s + (m[k] || 0), 0) : null;
    const nowIdx = C.AG_ORDER.indexOf(new Date().getMonth() + 1);
    const nowCrop = curRot?.calendario?.[0]?.[nowIdx];

    root.innerHTML = `
      <div class="page-head compact" data-rev>
        <div><h1>My field</h1><p class="lead">Each field keeps its own location, rotation, analyses and notes.</p></div>
        <button type="button" class="btn primary" data-act="add-field">${icon("plus")}<span>Add a field</span></button>
      </div>
      <div class="field-tabs" role="tablist" aria-label="Your fields" data-rev>
        ${fields.map((f) => `<button type="button" role="tab" class="ftab ${f.id === field.id ? "active" : ""}" aria-selected="${f.id === field.id}" data-field="${esc(f.id)}">
          <span class="ft-ic">${icon("field")}</span><span class="ft-txt"><strong class="notranslate">${esc(f.nombre)}</strong><small>${fmt(f.area_ha)} ha${f.muestra ? " · sample" : ""}</small></span></button>`).join("")}
      </div>

      <section class="card field-hero" data-rev>
        <div class="fh-info">
          <small>${field.muestra ? "Sample field" : "Your field"}</small>
          <h2 class="notranslate">${esc(field.nombre)}</h2>
          <dl class="kv">
            <div><dt>Location</dt><dd>${field.lat.toFixed(4)}, ${field.lon.toFixed(4)}</dd></div>
            <div><dt>Field size</dt><dd>${fmt(field.area_ha)} ha</dd></div>
            <div><dt>Current rotation</dt><dd>${esc(rot?.nombre || "")}</dd></div>
            <div><dt>Livestock</dt><dd>${field.tiene_ganado ? "Livestock available" : "No livestock"}</dd></div>
            <div><dt>Soil water storage</dt><dd>${fmt(field.capacidad_suelo_mm)} mm</dd></div>
            <div><dt>Last analysis</dt><dd>${rec ? esc(C.dateLabel(rec.fecha)) : "Not analysed yet"}</dd></div>
          </dl>
          ${C.inUruguay(field.lat, field.lon) ? "" : `<p class="notice warn">${icon("alert")}<span>This point is outside Uruguay. Cooper's crop calendars are designed for Uruguay, so some results may not apply.</span></p>`}
          <div class="fh-actions">
            <button type="button" class="btn primary" data-go="analysis">${icon("analysis")}<span>Analyze this field</span></button>
            <button type="button" class="btn ghost" data-act="edit-field">${icon("edit")}<span>Edit</span></button>
            <button type="button" class="btn ghost danger" data-act="delete-field" ${fields.length < 2 ? "disabled title=\"Keep at least one field\"" : ""}>${icon("trash")}<span>Delete</span></button>
          </div>
        </div>
        <div class="fh-visual"><div class="fh-relief" aria-hidden="true"></div>
          <span class="fh-tag">${data?.zonas ? "Real SRTM terrain · erosion of your rotation" : "Run an analysis to see the 3D terrain"}</span></div>
      </section>

      <div class="tiles kpi-row" data-rev>
        ${kpi("Annual rainfall", months ? fmt(sum("lluvia_mm")) + " mm" : "–", months ? "Average 1996–2025" : "Needs an analysis", "agua")}
        ${kpi("Reference evapotranspiration", months ? fmt(sum("et0_mm")) + " mm" : "–", "Per year", "clear")}
        ${kpi("Hot days (≥32 °C)", months ? fmt(sum("dias_calor"), 1) : "–", "Per year", "thermo")}
        ${kpi("Frost-risk days", months ? fmt(sum("dias_helada"), 1) : "–", "Per year", "snow")}
        ${kpi("Height difference", data?.zonas ? fmt(data.zonas.resumen.desnivel_m) + " m" : "–", data?.zonas ? `Slope ${fmt(data.zonas.resumen.pendiente_media_pct, 1)}% average` : "", "field")}
        ${kpi("Estimated erosion", curRot?.indicadores?.erosion_t_ha != null ? fmt(curRot.indicadores.erosion_t_ha, 1) + " t/ha" : "–", "Current rotation, per year", "suelo")}
      </div>

      <div class="section-head" data-rev><h2>${icon("satellite")}Images of your field</h2>
        <p class="hint">Satellite imagery, vegetation index, estimated erosion and land cover around the field outline.</p></div>
      <div class="imagery">
        ${imageryPanel("ip-sat", "Satellite image", "Esri World Imagery (Maxar, Earthstar Geographics)", "", "Most recent cloud-free mosaic available from the provider.")}
        ${imageryPanel("ip-ndvi", "Vegetation index (NDVI)", `NASA GIBS · MODIS Terra 8-day NDVI, 250 m · ${ndviDate()}`, swatches(NDVI_STEPS), "Greener means more active vegetation. At 250 m it describes the area around the field rather than each paddock.")}
        ${imageryPanel("ip-ero", "Erosion map", data?.zonas ? "Cooper · RUSLE with NASA SRTM 30 m" : "Cooper · needs an analysis", data?.zonas ? swatches(C.results.ZONE_LAYERS.erosion.classes(data.zonas).map((k) => [k.label, k.color])) : "",
          data?.zonas ? `Estimated soil loss for ${esc(curRot?.nombre || "")}. Reference tolerance: ${data.zonas.tolerancia_t_ha} t/ha a year.` : "Run an analysis of this field to draw its erosion map.")}
        ${imageryPanel("ip-crop", "Crop and land cover map", "ESA WorldCover 10 m · crop of the month from your rotation", swatches(WORLDCOVER),
          nowCrop ? `This month (${C.AG_MONTHS[nowIdx]}), your rotation calendar has <strong>${esc(nowCrop.nombre)}</strong> in year 1.` : "Cropland is shown in pink. The crop of the month comes from your rotation calendar.")}
      </div>

      <div class="grid-2">
        <section class="card soil-card" data-rev>
          <div class="card-head"><div><h2>${icon("suelo")}Soil</h2><p class="sub soil-src">ISRIC SoilGrids 2.0 · modelled at 250 m</p></div></div>
          <div class="soil-body"><div class="skeleton" style="height:180px"></div></div>
          <dl class="kv compact">
            <div><dt>Water your soil holds (your choice)</dt><dd>${fmt(field.capacidad_suelo_mm)} mm</dd></div>
            <div><dt>Erodibility used for RUSLE (K)</dt><dd>${data?.zonas ? data.zonas.k_factor : "0.035"} · typical value, not measured</dd></div>
            <div><dt>Root-zone soil moisture (NASA MERRA-2)</dt><dd>${months ? months.map((m) => m.humedad_raiz).filter((v) => v != null).length ? `${fmt(Math.min(...months.map((m) => m.humedad_raiz ?? 1)), 2)}–${fmt(Math.max(...months.map((m) => m.humedad_raiz ?? 0)), 2)} (0 dry · 1 saturated)` : "–" : "Needs an analysis"}</dd></div>
          </dl>
          <p class="hint">Modelled values are a reference, not a laboratory test. A soil analysis of your paddock is always more accurate.</p>
        </section>
        <section class="card climate-card" data-rev>
          <div class="card-head"><div><h2>${icon("partly")}Climate</h2><p class="sub">${months ? `${esc(data.meta.fuente)} · ${esc(data.meta.periodo)}` : "Run an analysis to see 30 years of climate"}</p></div></div>
          ${months ? `<div class="seg fc-views" role="group" aria-label="Climate chart"><button type="button" class="active" aria-pressed="true" data-fc="rain">Rain and ET0</button><button type="button" aria-pressed="false" data-fc="temp">Temperature</button><button type="button" aria-pressed="false" data-fc="years">30 years</button></div>
          <div class="chart-box sm"><canvas role="img" aria-label="Climate of your field"></canvas></div>
          <div class="tiles compact">${data.clima.tendencias.indicadores.map((t) => `<div class="tile"><div class="label">${esc(t.nombre)}</div><div class="value">${t.cambio_pct > 0 ? "+" : ""}${fmt(t.cambio_pct)}%</div><div class="detail">${t.periodo_1} → ${t.periodo_2}</div></div>`).join("")}</div>` :
            `<p class="hint">The climate summary appears after the first analysis of this field.</p>`}
          <div class="fc-weather"><div class="skeleton" style="height:56px"></div></div>
        </section>
      </div>

      <section class="card crops-card" data-rev>
        <div class="card-head"><div><h2>${icon("leaf")}Crops in your rotation</h2><p class="sub">${esc(rot?.nombre || "")} · ${esc(rot?.descripcion || "")}</p></div></div>
        ${curRot?.calendario ? C.calendarTable(curRot) : ""}
        <div class="crop-list">${cropsOf(rot, catalog).map((c) => `<article class="crop" style="--c:${c.color}">
          <header><i class="swatch" style="background:${c.color}"></i><strong>${esc(c.nombre)}</strong><small>${esc(c.tipo)} · ${esc(c.familia)}</small></header>
          <dl class="kv compact">
            <div><dt>Critical months</dt><dd>${c.meses_criticos.length ? c.meses_criticos.map((m) => C.AG_MONTHS[C.AG_ORDER.indexOf(m)]).join(", ") : "–"}${c.critico_por ? ` · ${esc(c.critico_por)}` : ""}</dd></div>
            <div><dt>Drought tolerance</dt><dd>${dots(c.tolerancia_sequia)}</dd></div>
            <div><dt>Nitrogen supply</dt><dd>${dots(c.aporte_n)}</dd></div>
            <div><dt>Stubble left</dt><dd>${dots(c.residuo)}</dd></div>
          </dl>
          ${c.riesgos?.length ? `<details><summary>Risks</summary><ul>${c.riesgos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
        </article>`).join("")}</div>
      </section>

      <div class="grid-2">
        <section class="card terrain-card" data-rev>
          <div class="card-head"><div><h2>${icon("layers")}Terrain</h2><p class="sub">NASA SRTM 30 m · 15 × 15 grid over the field</p></div></div>
          ${data?.zonas ? `<div class="tiles compact">
            ${kpi("Elevation", `${fmt(data.zonas.resumen.elev_min)}–${fmt(data.zonas.resumen.elev_max)} m`, "above sea level")}
            ${kpi("Average slope", fmt(data.zonas.resumen.pendiente_media_pct, 1) + "%", `maximum ${fmt(data.zonas.resumen.pendiente_max_pct, 1)}%`)}
            ${kpi("Low spots", fmt(data.zonas.resumen.area_baja_pct) + "%", "more frost and waterlogging risk")}
            ${kpi("Collects water", fmt((data.zonas.celdas.filter((c) => c.hum === 2).length / data.zonas.celdas.length) * 100) + "%", "of the field, by relative wetness")}
          </div>` : `<p class="hint">Run an analysis to read the slope, low spots and wetness of this field.</p>`}
        </section>
        <section class="card notes-card" data-rev>
          <div class="card-head"><div><h2>${icon("edit")}Field notes</h2><p class="sub">Saved in this browser, only for this field.</p></div></div>
          <label class="sr-only" for="field-notes">Field notes</label>
          <textarea id="field-notes" rows="6" placeholder="Rain gauge records, soil test results, what you sowed and when…">${esc(field.notas || "")}</textarea>
          <p class="hint notes-state" aria-live="polite"></p>
        </section>
      </div>`;

    C.motion.reveal($$("[data-rev]", root), { stagger: 0.05 });

    /* actions */
    root.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.field) { C.fields.setActive(b.dataset.field); return; }
      if (b.dataset.act === "add-field") { const f = await C.fieldEditor(); if (f) C.fields.setActive(f.id); }
      if (b.dataset.act === "edit-field") { const f = await C.fieldEditor(field); if (f) C.fields.setActive(f.id); }
      if (b.dataset.act === "delete-field") {
        const ok = await C.confirm(C.t("Delete this field?"), C.t("The field, its saved analyses and its notes will be removed from this browser. This cannot be undone."), C.t("Delete"));
        if (ok) { await C.fields.remove(field.id); C.emit("history-changed"); C.toast(C.t("Field deleted."), "info"); }
      }
    };
    const notes = $("#field-notes", root);
    notes.addEventListener("input", C.debounce(() => { C.fields.upsert({ id: field.id, notas: notes.value }); $(".notes-state", root).textContent = C.t("Saved."); }, 600));

    /* 3D relief */
    const rEl = $(".fh-relief", root);
    if (data?.zonas && window.CooperRelief) relief = window.CooperRelief.mount(rEl, C.reliefData(data), { spin: true });
    else if (data?.zonas) C.listen("relief-ready", () => { if (rEl.isConnected && !relief) relief = window.CooperRelief.mount(rEl, C.reliefData(data), { spin: true }); });
    else rEl.classList.add("flat");

    /* imagery */
    if (typeof L !== "undefined") {
      const sat = makeMap($("#ip-sat", root), field);
      L.rectangle(sat.b, { color: "#fff", weight: 2, fill: false }).addTo(sat.m);
      watchTiles(sat.m._layers[Object.keys(sat.m._layers)[0]], $("#ip-sat", root).closest(".img-panel"));

      const nd = makeMap($("#ip-ndvi", root), field);
      const ndvi = L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${ndviDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
        { maxNativeZoom: 9, maxZoom: 18, opacity: 0.82, attribution: "NASA GIBS · MODIS" }).addTo(nd.m);
      watchTiles(ndvi, $("#ip-ndvi", root).closest(".img-panel"));
      L.rectangle(nd.b, { color: "#fff", weight: 2, fill: false }).addTo(nd.m);

      const er = makeMap($("#ip-ero", root), field);
      if (data?.zonas) {
        L.imageOverlay(C.results.zoneRaster(data.zonas, "erosion", curRot.id).toDataURL(), data.zonas.bounds, { opacity: 0.85 }).addTo(er.m);
        er.m.fitBounds(data.zonas.bounds, { padding: [16, 16] });
      } else {
        const p = $("#ip-ero .ip-empty", root); p.hidden = false;
        p.innerHTML = `${icon("suelo")}<strong>No erosion map yet</strong><span>Run an analysis of this field to estimate soil loss in each zone.</span><button type="button" class="btn soft sm" data-go="analysis">${C.t("New analysis")}</button>`;
      }
      L.rectangle(er.b, { color: "#fff", weight: 2, fill: false }).addTo(er.m);

      const cr = makeMap($("#ip-crop", root), field);
      const wc = L.tileLayer("https://services.terrascope.be/wmts/v2?layer=WORLDCOVER_2021_MAP&style=&tilematrixset=EPSG:3857&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=EPSG:3857:{z}&TileCol={x}&TileRow={y}",
        { maxZoom: 18, maxNativeZoom: 15, opacity: 0.7, attribution: "ESA WorldCover 2021" }).addTo(cr.m);
      watchTiles(wc, $("#ip-crop", root).closest(".img-panel"));
      const fr = L.rectangle(cr.b, { color: nowCrop?.color || "#fff", weight: 3, fill: !!nowCrop, fillColor: nowCrop?.color, fillOpacity: 0.35 }).addTo(cr.m);
      if (nowCrop) fr.bindTooltip(`${C.t(nowCrop.nombre)} · ${C.t(C.AG_MONTHS[nowIdx])}`, { permanent: true, direction: "center", className: "crop-label" });
      setTimeout(() => maps.forEach((m) => m.invalidateSize()), 350);
    } else {
      $$(".ip-empty", root).forEach((p) => { p.hidden = false; });
    }

    /* climate chart */
    const fcv = $(".climate-card .chart-box canvas", root);
    if (fcv && C.charts) {
      let view = "rain";
      const build = () => (view === "temp" ? C.charts.temperature(data) : view === "years" ? C.charts.annualSeries(data) : C.charts.climateMonthly(data));
      fchart = C.charts.lazy(fcv, build);
      $(".fc-views", root).addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b || !fchart) return;
        view = b.dataset.fc;
        $$(".fc-views button", root).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        fchart.build = build;
        if (fchart.chart) { fchart.chart.destroy(); fchart.chart = C.charts.make(fcv, build(), true); }
      });
    }

    /* soil */
    loadSoil(field).then((s) => fillSoil(root, s)).catch(() => fillSoil(root, null));
    /* weather */
    C.weather.get(field).then((w) => fillWeather(root, w)).catch(() => fillWeather(root, null));
  }

  const dots = (n) => `<span class="dots" aria-label="${n} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
  function cropsOf(rot, catalog) {
    const ids = rot?.anios ? [...new Set(rot.anios.flat())] : [];
    const byId = Object.fromEntries((catalog.cultivos || []).map((c) => [c.id, c]));
    return ids.map((i) => byId[i]).filter(Boolean);
  }

  async function loadSoil(field) {
    const key = `${field.lat.toFixed(3)},${field.lon.toFixed(3)}`;
    if (soilCache.has(key)) return soilCache.get(key);
    const r = await fetch(`/api/soil?lat=${field.lat}&lon=${field.lon}`, { signal: AbortSignal.timeout(35000) });
    if (!r.ok) throw new Error(r.status);
    const s = await r.json();
    soilCache.set(key, s);
    return s;
  }
  function fillSoil(root, s) {
    const el = $(".soil-body", root);
    if (!el) return;
    if (!s) { el.innerHTML = `<div class="ip-empty static">${icon("suelo")}<strong>Soil data not available right now</strong><span>This space is ready for SoilGrids or a laboratory soil test. Cooper keeps working with the soil values you chose.</span></div>`; return; }
    const order = ["clay", "silt", "sand", "soc", "phh2o", "cec", "nitrogen", "bdod"];
    const sand = s.propiedades.sand?.por_profundidad["0-5cm"], silt = s.propiedades.silt?.por_profundidad["0-5cm"], clay = s.propiedades.clay?.por_profundidad["0-5cm"];
    el.innerHTML = `${s.textura_superficial ? `<div class="texture"><div class="tex-bar" aria-label="Texture">
        <span style="--w:${clay}%;--c:#8b5a3c">Clay ${fmt(clay)}%</span><span style="--w:${silt}%;--c:#b58b5c">Silt ${fmt(silt)}%</span><span style="--w:${sand}%;--c:#dcc08d">Sand ${fmt(sand)}%</span></div>
        <p>Surface texture: <strong>${esc(s.textura_superficial)}</strong></p></div>` : ""}
      <div class="scroll-x"><table class="data"><thead><tr><th>Property</th>${s.profundidades.map((d) => `<th class="num">${esc(d)}</th>`).join("")}</tr></thead>
      <tbody>${order.filter((k) => s.propiedades[k]).map((k) => { const p = s.propiedades[k];
        return `<tr><td>${esc(p.nombre)}${p.unidad ? ` <small>(${esc(p.unidad)})</small>` : ""}</td>${s.profundidades.map((d) => `<td class="num">${fmt(p.por_profundidad[d], k === "phh2o" || k === "bdod" ? 1 : 0)}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div>`;
    C.motion.reveal(el, { y: 8 });
  }
  function fillWeather(root, w) {
    const el = $(".fc-weather", root);
    if (!el) return;
    if (!w) { el.innerHTML = `<p class="hint">Live weather is unavailable right now.</p>`; return; }
    const a = w.actual;
    el.innerHTML = `<div class="fcw">${icon(a.icono, "big")}<div><strong>${fmt(a.temp, 0)}° · ${esc(C.t(a.estado))}</strong><span>Now at the field · humidity ${fmt(a.humedad)}% · wind ${fmt(a.viento)} km/h</span></div>
      <span class="fcw-rain">${icon("rain")}${fmt(w.diario.reduce((s, d) => s + (d.lluvia_mm || 0), 0), 0)} mm forecast this week</span></div>`;
  }

  C.fieldView = { render, destroy };
})();
