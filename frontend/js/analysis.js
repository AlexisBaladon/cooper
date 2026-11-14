/* Cooper · "Analysis" view: New analysis (form → results → save) and the history tab. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  const S = {
    root: null, map: null, marker: null, rect: null, catalog: null,
    queue: new CooperWorkflow.AnalysisQueue(), rec: null, ctl: null, lat: null, lon: null, fieldId: null, tab: "new",
  };

  const STEPS = [
    "Downloading 30 years of daily NASA POWER climate",
    "Reading NASA SRTM elevation for your field",
    "Simulating the water balance of every rotation",
    "Estimating erosion with RUSLE",
    "Writing the explanations",
  ];

  function shell() {
    return `<div class="page-head compact" data-rev>
        <div><h1>Analysis</h1><p class="lead">Compare your rotation with every option in Cooper's library, using NASA data for your field.</p></div>
      </div>
      <div class="tabs" role="tablist" aria-label="Analysis sections" data-rev>
        <button role="tab" id="tab-new" aria-controls="panel-new" aria-selected="true" data-tab="new">${icon("plus")}<span>New analysis</span></button>
        <button role="tab" id="tab-history" aria-controls="panel-history" aria-selected="false" data-tab="history" tabindex="-1">${icon("history")}<span>Analysis history</span><em class="count" id="history-count"></em></button>
        <span class="tab-ink" aria-hidden="true"></span>
      </div>
      <div class="tab-panel" id="panel-new" role="tabpanel" aria-labelledby="tab-new">
        <div class="an-layout">
          <aside class="card an-form" aria-label="Your field">
            <section class="step">
              <h2><span class="step-num">1</span>Mark your field</h2>
              <label class="field">Field <select id="an-field"></select></label>
              <p class="field-context" id="an-context" role="status"></p>
              <div id="an-map" class="an-map" aria-label="Map to locate the field"></div>
              <p class="hint">Click the map or drag the marker. Crop calendars are designed for Uruguay.</p>
              <div class="chips" id="an-demos" aria-label="Sample fields"></div>
              <p class="coords" id="an-coords"></p>
              <details class="coordinate-entry"><summary>Enter coordinates instead of using the map</summary>
                <form id="an-coords-form" class="coords-form">
                  <label class="field">Latitude <input id="an-lat" type="number" min="-90" max="90" step="any" required inputmode="decimal"></label>
                  <label class="field">Longitude <input id="an-lon" type="number" min="-180" max="180" step="any" required inputmode="decimal"></label>
                  <button type="submit" class="btn ghost sm">Use these coordinates</button>
                </form>
              </details>
              <label class="field">Approximate field size
                <select id="an-area"><option value="25">25 ha</option><option value="50">50 ha</option><option value="100">100 ha</option><option value="200">200 ha</option><option value="500">500 ha</option></select>
              </label>
              <p class="hint">For now the field is approximated by a square around the point.</p>
            </section>
            <section class="step">
              <h2><span class="step-num">2</span>Which rotation do you use today?</h2>
              <select id="an-rotation" aria-label="Current crop rotation" aria-describedby="an-rotation-desc"></select>
              <p class="hint" id="an-rotation-desc"></p>
            </section>
            <section class="step">
              <h2><span class="step-num">3</span>Your farm</h2>
              <label class="check"><input type="checkbox" id="an-livestock"><span class="box" aria-hidden="true"></span>I have livestock (fences and water points)</label>
              <label class="field">How much water does your soil hold?
                <select id="an-soil">
                  <option value="80">Little: shallow or sandy soil (~80 mm)</option>
                  <option value="120">Medium (~120 mm)</option>
                  <option value="170">A lot: deep, clayey soil (~170 mm)</option>
                </select>
              </label>
            </section>
            <section class="step">
              <h2><span class="step-num">4</span>What matters most to you?</h2>
              <p class="hint">0 = not important · 5 = very important</p>
              <div id="an-priorities" class="priorities"></div>
            </section>
            <button id="an-run" class="btn primary lg block" type="button" disabled>Loading crop options…</button>
            <p class="hint center">Start with the comparison, then discuss the trade-offs with your agronomist.</p>
          </aside>
          <div class="an-results" id="an-results" aria-live="polite">
            <div class="results-bar card" id="an-bar" hidden>
              <div class="rb-title"><h2 id="an-results-title" tabindex="-1">Your comparison</h2><p class="sub" id="an-results-sub"></p></div>
              <div class="rb-actions">
                <button type="button" class="btn ghost" id="an-explain">${icon("play")}<span>Explain it simply</span></button>
                <button type="button" class="btn ghost" id="an-pdf">${icon("file")}<span>Export PDF</span></button>
                <button type="button" class="btn primary" id="an-save">${icon("save")}<span>Save analysis</span></button>
              </div>
            </div>
            <div id="an-stale" class="notice warn" role="status" hidden>${icon("alert")}<span>Settings changed. Run the analysis again to update these results.</span></div>
            <div class="empty-state card" id="an-empty">
              <div class="es-art" aria-hidden="true"></div>
              <h2>Your comparison will appear here</h2>
              <p>Mark your field, choose your current rotation and your priorities, then press <strong>Analyze my field</strong>.</p>
            </div>
            <div class="loading card" id="an-loading" role="status" hidden>
              <div class="ld-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
              <h2>Comparing rotations with historical NASA data…</h2>
              <ol class="ld-steps">${STEPS.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
              <p class="hint">A new location can take up to a few minutes. You can change settings; we will use the latest ones.</p>
            </div>
            <div id="an-error" class="notice error" role="alert" hidden></div>
            <div id="an-body"></div>
          </div>
        </div>
      </div>
      <div class="tab-panel" id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden></div>`;
  }

  function scenarioCard() {
    return `<section class="card scenario" data-rev>
      <div class="card-head"><div><h2>${icon("thermo")}What if the climate changes?</h2>
        <p class="hint">Move the sliders to recalculate everything with less rain or more heat, over the same 30-year record. These are hypothetical changes, not a prediction of future weather.</p></div></div>
      <div class="scenario-controls">
        <label class="range"><span>Rainfall <strong id="an-rain-val">0%</strong></span>
          <input type="range" id="an-rain" min="-40" max="20" step="5" value="0"></label>
        <label class="range"><span>Temperature <strong id="an-temp-val">+0.0 °C</strong></span>
          <input type="range" id="an-temp" min="0" max="3" step="0.5" value="0"></label>
        <button id="an-reset" type="button" class="btn ghost sm">Back to the historical climate</button>
      </div>
    </section>`;
  }

  /* ------------------------------------------------------------- form */
  function fillForm(field) {
    S.fieldId = field.id;
    $("#an-field").innerHTML = C.fields.list().map((f) => `<option value="${esc(f.id)}" ${f.id === field.id ? "selected" : ""} class="notranslate">${esc(f.nombre)}</option>`).join("") +
      `<option value="__new">+ Add a new field…</option>`;
    $("#an-rotation").value = field.rotacion_actual;
    $("#an-livestock").checked = !!field.tiene_ganado;
    $("#an-soil").value = String(field.capacidad_suelo_mm || 120);
    $("#an-area").value = String(field.area_ha || 100);
    const pr = { ...C.DEFAULT_PRIORITIES, ...(field.prioridades || {}) };
    for (const k of Object.keys(C.PRIORITY_HINTS)) { $(`#an-p-${k}`).value = pr[k]; $(`#an-o-${k}`).textContent = pr[k]; paintRange($(`#an-p-${k}`)); }
    setPoint(field.lat, field.lon, true, false);
    updateRotationDesc();
    $$("#an-demos .chip").forEach((c) => { const on = field.id === "sample-" + c.dataset.id; c.classList.toggle("active", on); c.setAttribute("aria-pressed", String(on)); });
  }

  function paintRange(input) {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty("--p", `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function updateRotationDesc() {
    const r = S.catalog.rotaciones.find((x) => x.id === $("#an-rotation").value);
    $("#an-rotation-desc").textContent = r ? r.descripcion + (r.requiere_ganado ? " Requires livestock." : "") : "";
  }

  function setPoint(lat, lon, recenter = false, changed = true) {
    S.lat = lat; S.lon = lon;
    if (S.marker) S.marker.setLatLng([lat, lon]);
    if (recenter && S.map) S.map.setView([lat, lon], 12);
    $("#an-lat").value = lat.toFixed(5); $("#an-lon").value = lon.toFixed(5);
    $("#an-coords").textContent = `Lat ${lat.toFixed(3)} · Lon ${lon.toFixed(3)}`;
    updateRect();
    $("#an-context").textContent = C.inUruguay(lat, lon) ? "" : "Outside Uruguay: crop calendars may not apply.";
    $("#an-context").hidden = C.inUruguay(lat, lon);
    if (changed) markChanged();
  }

  function updateRect() {
    if (!S.map) return;
    const b = C.fieldBounds(S.lat, S.lon, Number($("#an-area").value));
    if (S.rect) S.rect.setBounds(b);
    else S.rect = L.rectangle(b, { color: "#ffffff", weight: 2, fill: true, fillOpacity: 0.08, interactive: false }).addTo(S.map);
  }

  function readRequest() {
    return {
      lat: S.lat, lon: S.lon, rotacion_actual: $("#an-rotation").value,
      prioridades: Object.fromEntries(Object.keys(C.PRIORITY_HINTS).map((k) => [k, Number($(`#an-p-${k}`).value)])),
      escenario: { lluvia_pct: Number($("#an-rain")?.value || 0), temp_delta: Number($("#an-temp")?.value || 0) },
      capacidad_suelo_mm: Number($("#an-soil").value), tiene_ganado: $("#an-livestock").checked,
      area_ha: Number($("#an-area").value),
    };
  }
  const current = () => !!S.rec && JSON.stringify(readRequest()) === JSON.stringify(S.rec.input);

  function markChanged() {
    S.queue.invalidate();
    updateStale();
  }
  /* Only the visual state: never touches the analysis queue. */
  function updateStale() {
    const ok = current();
    $("#an-stale").hidden = !S.rec || ok;
    for (const id of ["#an-save", "#an-explain", "#an-pdf"]) { const b = $(id); if (b) b.disabled = !ok; }
    if (S.rec && ok) $("#an-save").disabled = !!S.rec.saved;
  }

  /* -------------------------------------------------------------- run */
  let stepTimer = null;
  function showLoading(on) {
    $("#an-loading").hidden = !on;
    clearInterval(stepTimer);
    const lis = $$("#an-loading .ld-steps li");
    lis.forEach((li) => li.classList.remove("done", "now"));
    if (!on) return;
    let i = 0;
    const tick = () => { lis.forEach((li, k) => { li.classList.toggle("done", k < i); li.classList.toggle("now", k === i); }); i = Math.min(i + 1, lis.length - 1); };
    tick(); stepTimer = setInterval(tick, 2600);
    C.motion.reveal($("#an-loading"), { y: 10 });
  }

  async function run() {
    if (S.queue.active) { S.queue.queued = true; return; }
    const body = readRequest();
    try { CooperWorkflow.validate(body); } catch (err) { showError(err.message); return; }
    const field = C.fields.get(S.fieldId);
    // The field keeps the settings of its latest analysis.
    C.fields.upsert({ id: field.id, lat: body.lat, lon: body.lon, area_ha: body.area_ha, rotacion_actual: body.rotacion_actual,
      tiene_ganado: body.tiene_ganado, capacidad_suelo_mm: body.capacidad_suelo_mm, prioridades: body.prioridades });
    const runTok = S.queue.begin();
    const context = { field: field.nombre, generatedAt: new Date().toISOString() };
    $("#an-empty").hidden = true; $("#an-error").hidden = true;
    const first = !S.rec;
    if (first) showLoading(true); else $("#an-results").classList.add("is-busy");
    $("#an-run").disabled = true; $("#an-run").textContent = C.t("Comparing rotations…");
    $("#an-results").setAttribute("aria-busy", "true");
    try {
      const resp = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(185000) });
      const data = await CooperWorkflow.readResponse(resp);
      if (!S.queue.isCurrent(runTok)) return;
      const rec = { id: C.uid(), fieldId: field.id, fecha: context.generatedAt, input: body, context, result: data, saved: false };
      await C.db.put("drafts", rec);
      showResult(rec, true);
      C.emit("analysis", rec);
      if (matchMedia("(max-width: 1080px)").matches && first) { $("#an-results-title").focus({ preventScroll: true }); $("#an-bar").scrollIntoView({ behavior: C.reducedMotion() ? "auto" : "smooth", block: "start" }); }
    } catch (err) {
      if (!S.queue.isCurrent(runTok)) return;
      showError(err.name === "TimeoutError" ? "This analysis took too long. Please try again; downloaded data may already be cached." : `Could not run the analysis: ${err.message}`);
      if (!S.rec) $("#an-empty").hidden = false;
    } finally {
      showLoading(false);
      $("#an-results").classList.remove("is-busy");
      $("#an-run").disabled = false; $("#an-run").textContent = C.t("Analyze my field");
      $("#an-results").setAttribute("aria-busy", "false");
      if (S.queue.finish()) setTimeout(run, 500);
    }
  }

  function showError(msg) { const e = $("#an-error"); e.innerHTML = `${icon("alert")}<span>${esc(msg)}</span>`; e.hidden = false; }

  function showResult(rec, live) {
    const keepScenario = $("#an-rain") ? { r: $("#an-rain").value, t: $("#an-temp").value } : null;
    S.rec = rec;
    S.ctl?.destroy();
    $("#an-empty").hidden = true;
    $("#an-bar").hidden = false;
    $("#an-results-sub").textContent = `${rec.context.field} · ${C.dateLabel(rec.fecha)}${rec.result.escenario.activo ? " · What-if simulation, not a forecast" : " · Historical comparison, not a forecast"}`;
    S.ctl = C.results.render($("#an-body"), rec, { scenarioSlot: true });
    const slot = $("#an-body .scenario-slot");
    if (slot) {
      slot.outerHTML = scenarioCard();
      const sc = rec.input.escenario;
      $("#an-rain").value = keepScenario ? keepScenario.r : sc.lluvia_pct;
      $("#an-temp").value = keepScenario ? keepScenario.t : sc.temp_delta;
      bindScenario();
    }
    updateStale();
    if (live) C.motion.reveal($("#an-bar"), { y: 8 });
  }

  function bindScenario() {
    let t;
    const on = () => {
      const r = Number($("#an-rain").value), tt = Number($("#an-temp").value);
      $("#an-rain-val").textContent = `${r > 0 ? "+" : ""}${r}%`;
      $("#an-temp-val").textContent = `+${tt.toFixed(1)} °C`;
      paintRange($("#an-rain")); paintRange($("#an-temp"));
      clearTimeout(t); markChanged();
      if (S.rec) t = setTimeout(run, 380);
    };
    $("#an-rain").addEventListener("input", on);
    $("#an-temp").addEventListener("input", on);
    $("#an-reset").addEventListener("click", () => { $("#an-rain").value = 0; $("#an-temp").value = 0; on(); });
    const r = Number($("#an-rain").value), tt = Number($("#an-temp").value);
    $("#an-rain-val").textContent = `${r > 0 ? "+" : ""}${r}%`; $("#an-temp-val").textContent = `+${tt.toFixed(1)} °C`;
    paintRange($("#an-rain")); paintRange($("#an-temp"));
  }

  async function save() {
    if (!S.rec || !current()) return;
    const rec = { ...S.rec, saved: true };
    await C.db.put("analyses", rec);
    await C.db.put("drafts", rec);
    S.rec = rec;
    $("#an-save").disabled = true;
    C.toast(C.t("Analysis saved in your history."));
    C.emit("history-changed");
    C.emit("analysis", rec);
    const b = $("#an-save");
    C.motion.gsap?.fromTo(b, { scale: 0.94 }, { scale: 1, duration: 0.6, ease: "elastic.out(1,0.4)" });
  }

  /* ------------------------------------------------------------- tabs */
  function selectTab(name, focus = false) {
    S.tab = name;
    $$(".tabs [role=tab]", S.root).forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    const pNew = $("#panel-new"), pHist = $("#panel-history");
    const show = name === "new" ? pNew : pHist, hide = name === "new" ? pHist : pNew;
    hide.hidden = true; show.hidden = false;
    moveInk();
    if (name === "history") C.history.render(pHist);
    else setTimeout(() => { S.map?.invalidateSize(); S.ctl?.relayout(); }, 30);
    C.motion.reveal(show, { y: 12, duration: 0.5 });
    history.replaceState(null, "", name === "history" ? "#analysis/history" : "#analysis");
  }
  function moveInk() {
    const sel = $(".tabs [aria-selected=true]", S.root), ink = $(".tab-ink", S.root);
    if (!sel || !ink) return;
    const x = sel.offsetLeft, w = sel.offsetWidth;
    const g = C.motion.gsap;
    if (g) g.to(ink, { x, width: w, duration: 0.55, ease: "expo.out" }); else { ink.style.transform = `translateX(${x}px)`; ink.style.width = w + "px"; }
  }

  async function updateCount() {
    const n = (await C.db.all("analyses")).length;
    const el = $("#history-count");
    if (el) el.textContent = n ? String(n) : "";
  }

  /* ------------------------------------------------------------- init */
  function mount(root, catalog) {
    S.root = root; S.catalog = catalog;
    root.innerHTML = shell();
    $("#an-rotation").innerHTML = catalog.rotaciones.map((r) => `<option value="${esc(r.id)}">${esc(r.nombre)}</option>`).join("");
    $("#an-priorities").innerHTML = Object.entries(C.PRIORITY_HINTS).map(([k, label]) => `
      <div class="prio" style="--c:var(${C.SCORES[k].color})">
        <label for="an-p-${k}">${icon(C.SCORES[k].icon)}<span>${esc(label)}</span></label>
        <output id="an-o-${k}" for="an-p-${k}">${C.DEFAULT_PRIORITIES[k]}</output>
        <input type="range" id="an-p-${k}" min="0" max="5" step="1" value="${C.DEFAULT_PRIORITIES[k]}">
      </div>`).join("");
    $("#an-demos").innerHTML = `<span class="chips-label">Explore a sample:</span>` + catalog.campos_demo.map((f) =>
      `<button type="button" class="chip" data-id="${esc(f.id)}" aria-pressed="false">${esc(f.nombre)}</button>`).join("");

    if (typeof L !== "undefined") {
      S.map = L.map("an-map", { scrollWheelZoom: false }).setView([-32.8, -56.0], 6);
      const base = C.baseLayers();
      base.Satellite.addTo(S.map);
      L.control.layers(base, null, { collapsed: true }).addTo(S.map);
      S.marker = L.marker([-32.62, -57.75], { draggable: true, keyboard: true, title: "Field location" }).addTo(S.map);
      S.marker.on("dragend", (e) => { const p = e.target.getLatLng(); setPoint(p.lat, p.lng); });
      S.map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
    } else {
      $("#an-map").innerHTML = `<p class="hint pad">The map could not load. Enter coordinates below or use a sample field.</p>`;
    }

    for (const k of Object.keys(C.PRIORITY_HINTS)) {
      const inp = $(`#an-p-${k}`);
      inp.addEventListener("input", () => { $(`#an-o-${k}`).textContent = inp.value; paintRange(inp); markChanged(); });
    }
    $("#an-rotation").addEventListener("change", () => { updateRotationDesc(); markChanged(); });
    for (const id of ["#an-livestock", "#an-soil"]) $(id).addEventListener("change", markChanged);
    $("#an-area").addEventListener("change", () => { updateRect(); markChanged(); });
    $("#an-coords-form").addEventListener("submit", (e) => { e.preventDefault(); setPoint(Number($("#an-lat").value), Number($("#an-lon").value), true); });
    $("#an-field").addEventListener("change", async (e) => {
      if (e.target.value === "__new") { e.target.value = S.fieldId; const f = await C.fieldEditor(); if (f) C.fields.setActive(f.id); return; }
      C.fields.setActive(e.target.value);
    });
    $("#an-demos").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      const d = catalog.campos_demo.find((x) => x.id === b.dataset.id);
      const id = "sample-" + d.id;
      if (!C.fields.get(id)) C.fields.upsert({ id, nombre: d.nombre, muestra: true, lat: d.lat, lon: d.lon, area_ha: 100,
        rotacion_actual: d.rotacion, tiene_ganado: d.tiene_ganado, capacidad_suelo_mm: 120, prioridades: { ...C.DEFAULT_PRIORITIES } });
      C.fields.setActive(id);
    });
    $("#an-run").addEventListener("click", run);
    $("#an-save").addEventListener("click", save);
    $("#an-pdf").addEventListener("click", () => S.rec && C.exporter.pdf(S.rec, S.ctl));
    $("#an-explain").addEventListener("click", () => S.rec && C.player.open(S.rec, $("#an-explain")));
    const tabs = $(".tabs", root);
    tabs.addEventListener("click", (e) => { const t = e.target.closest("[role=tab]"); if (t) selectTab(t.dataset.tab); });
    tabs.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      selectTab(S.tab === "new" ? "history" : "new", true);
    });
    window.addEventListener("resize", C.debounce(moveInk, 120));
    C.listen("history-changed", updateCount);
    updateCount();
    $("#an-run").disabled = false; $("#an-run").textContent = "Analyze my field";
  }

  /* Called when the active field changes or the view is shown. */
  async function load(field) {
    if (!field || !S.root) return;
    const sameField = S.fieldId === field.id;
    fillForm(field);
    if (sameField && S.rec) { updateStale(); return; }
    S.rec = null; S.ctl?.destroy(); S.ctl = null;
    $("#an-bar").hidden = true; $("#an-stale").hidden = true; $("#an-error").hidden = true;
    const draft = await C.db.get("drafts", field.id);
    if (draft && C.fields.activeId() === field.id) showResult(draft, false);
    else $("#an-empty").hidden = false;
  }

  function onShow(sub) {
    selectTab(sub === "history" ? "history" : "new");
    setTimeout(() => { S.map?.invalidateSize(); moveInk(); }, 60);
  }

  C.analysis = { mount, load, onShow, run, save, get rec() { return S.rec; }, selectTab, refresh() { S.ctl?.refresh(); } };
})();
