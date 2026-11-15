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
    const steps = [
      ["field", "Your field", "Location and size"],
      ["rotation", "Current rotation", "What you sow today"],
      ["profile", "Your farm", "Livestock and soil"],
      ["star", "Priorities", "What matters most"],
    ];
    return `<div class="page-head compact" data-rev>
        <div><h1>${icon("analysis", "h1-ic")}Analysis</h1><p class="lead">Compare your rotation with every option in Cooper's library, using NASA data for your field.</p></div>
      </div>
      <div class="tabs" role="tablist" aria-label="Analysis sections" data-rev>
        <button role="tab" id="tab-new" aria-controls="panel-new" aria-selected="true" data-tab="new">${icon("simulation")}<span>New analysis</span></button>
        <button role="tab" id="tab-history" aria-controls="panel-history" aria-selected="false" data-tab="history" tabindex="-1">${icon("reports")}<span>Analysis history</span><em class="count" id="history-count"></em></button>
        <span class="tab-ink" aria-hidden="true"></span>
      </div>
      <div class="tab-panel" id="panel-new" role="tabpanel" aria-labelledby="tab-new">
        <section class="card wizard" id="an-wizard" aria-label="New analysis">
          <ol class="wz-steps">
            <span class="wz-line" aria-hidden="true"><i></i></span>
            ${steps.map(([ic, t, d], i) => `<li><button type="button" class="wz-step ${i === 0 ? "active" : ""}" data-step="${i}" aria-current="${i === 0 ? "step" : "false"}">
              <span class="wz-node">${icon(ic)}<em>${i + 1}</em></span><span class="wz-txt"><strong>${esc(t)}</strong><small>${esc(d)}</small></span></button></li>`).join("")}
          </ol>
          <div class="wz-panels">
            <section class="wz-panel active" data-step="0">
              <div class="wz-grid map-grid">
                <div class="an-map-wrap"><div id="an-map" class="an-map" aria-label="Map to locate the field"></div>
                  <p class="coords" id="an-coords"></p></div>
                <div class="wz-side">
                  <h2 class="wz-title">Where is your field?</h2>
                  <p class="hint">Click the map or drag the marker. Crop calendars are designed for Uruguay.</p>
                  <label class="field">Field <select id="an-field"></select></label>
                  <p class="field-context" id="an-context" role="status" hidden></p>
                  <div class="field">Approximate field size
                    <div class="seg pills" id="an-area-pills" role="group" aria-label="Approximate field size">${[25, 50, 100, 200, 500].map((v) => `<button type="button" data-v="${v}" aria-pressed="false">${v} ha</button>`).join("")}</div>
                    <select id="an-area" hidden aria-hidden="true" tabindex="-1">${[25, 50, 100, 200, 500].map((v) => `<option value="${v}">${v} ha</option>`).join("")}</select>
                  </div>
                  <div class="chips" id="an-demos" aria-label="Sample fields"></div>
                  <details class="coordinate-entry"><summary>Enter coordinates instead of using the map</summary>
                    <form id="an-coords-form" class="coords-form">
                      <label class="field">Latitude <input id="an-lat" type="number" min="-90" max="90" step="any" required inputmode="decimal"></label>
                      <label class="field">Longitude <input id="an-lon" type="number" min="-180" max="180" step="any" required inputmode="decimal"></label>
                      <button type="submit" class="btn ghost sm">Use these coordinates</button>
                    </form>
                  </details>
                  <p class="hint">For now the field is approximated by a square around the point.</p>
                </div>
              </div>
            </section>
            <section class="wz-panel" data-step="1" hidden>
              <h2 class="wz-title">Which rotation do you use today?</h2>
              <p class="hint" id="an-rotation-desc">Choose the sequence of crops you sow in this field now. Cooper compares it with every other option.</p>
              <select id="an-rotation" hidden aria-hidden="true" tabindex="-1"></select>
              <div class="choice-grid rot-choices" id="an-rot-cards" role="radiogroup" aria-label="Current crop rotation"></div>
            </section>
            <section class="wz-panel" data-step="2" hidden>
              <div class="wz-grid two">
                <div><h2 class="wz-title">Do you have livestock?</h2>
                  <p class="hint">Pasture and forage rotations are only suggested to farms with fences and water points.</p>
                  <input type="checkbox" id="an-livestock" hidden aria-hidden="true" tabindex="-1">
                  <div class="choice-grid two" id="an-live-cards" role="radiogroup" aria-label="Livestock">
                    <button type="button" class="choice" role="radio" data-v="1"><span class="choice-ic">${icon("forage")}</span><strong>Yes, I have livestock</strong><small>Fences and water points</small></button>
                    <button type="button" class="choice" role="radio" data-v="0"><span class="choice-ic">${icon("harvest")}</span><strong>No, only crops</strong><small>Forage rotations are left out</small></button>
                  </div></div>
                <div><h2 class="wz-title">How much water does your soil hold?</h2>
                  <p class="hint">Choose what best describes the paddock. A soil test is always more accurate.</p>
                  <select id="an-soil" hidden aria-hidden="true" tabindex="-1"><option value="80">80</option><option value="120">120</option><option value="170">170</option></select>
                  <div class="choice-grid three" id="an-soil-cards" role="radiogroup" aria-label="Soil water storage">
                    ${[["80", "Little", "Shallow or sandy soil", 1], ["120", "Medium", "Most paddocks", 2], ["170", "A lot", "Deep, clayey soil", 3]].map(([v, t, d, n]) => `<button type="button" class="choice" role="radio" data-v="${v}">
                      <span class="soil-gauge" aria-hidden="true">${[1, 2, 3].map((x) => `<i class="${x <= n ? "on" : ""}"></i>`).join("")}</span><strong>${t}</strong><small>${d} · ~${v} mm</small></button>`).join("")}
                  </div></div>
              </div>
            </section>
            <section class="wz-panel" data-step="3" hidden>
              <h2 class="wz-title">What matters most to you?</h2>
              <p class="hint">0 = not important · 5 = very important. The total of each rotation weighs its scores with these values.</p>
              <div id="an-priorities" class="priorities"></div>
            </section>
          </div>
          <footer class="wz-foot">
            <button type="button" class="btn ghost" id="wz-back" hidden>${icon("right", "flip-x")}<span>Back</span></button>
            <span class="wz-count" id="wz-count">Step 1 of 4</span>
            <button type="button" class="btn primary" id="wz-next"><span>Next</span>${icon("right")}</button>
            <button id="an-run" class="btn primary lg" type="button" disabled hidden>Loading crop options…</button>
          </footer>
        </section>
        <section class="card an-summary" id="an-summary" hidden>
          <div class="sum-items" id="an-sum-items"></div>
          <button type="button" class="btn ghost" id="an-edit">${icon("edit")}<span>Edit settings</span></button>
        </section>
        <div class="an-results" id="an-results" aria-live="polite">
          <div class="results-bar card" id="an-bar" hidden>
            <div class="rb-title"><span class="chip-ic big">${icon("overall")}</span><div><h2 id="an-results-title" tabindex="-1">Your comparison</h2><p class="sub" id="an-results-sub"></p></div></div>
            <div class="rb-actions">
              <button type="button" class="btn ghost" id="an-explain">${icon("play")}<span>Explain it simply</span></button>
              <button type="button" class="btn ghost" id="an-pdf">${icon("reports")}<span>Export PDF</span></button>
              <button type="button" class="btn primary" id="an-save">${icon("save")}<span>Save analysis</span></button>
            </div>
          </div>
          <div id="an-stale" class="notice warn" role="status" hidden>${icon("alert")}<span>Settings changed. Run the analysis again to update these results.</span></div>
          <div class="loading card" id="an-loading" role="status" hidden>
            <div class="ld-orbit" aria-hidden="true"><img src="assets/icons/satellite.webp" alt=""><i></i><i></i></div>
            <h2>Comparing rotations with historical NASA data…</h2>
            <ol class="ld-steps">${STEPS.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
            <p class="hint">A new location can take up to a few minutes. You can change settings; we will use the latest ones.</p>
          </div>
          <div id="an-error" class="notice error" role="alert" hidden></div>
          <div id="an-empty" hidden></div>
          <div id="an-body"></div>
        </div>
      </div>
      <div class="tab-panel" id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden></div>`;
  }

  /* ----------------------------------------------------------- wizard */
  function goStep(n, focus = true) {
    const prev = S.step ?? 0;
    n = Math.max(0, Math.min(3, n));
    S.step = n;
    const panels = $$(".wz-panel", S.root);
    const from = panels[prev], to = panels[n];
    $$(".wz-step", S.root).forEach((b, i) => {
      b.classList.toggle("active", i === n); b.classList.toggle("done", i < n);
      b.setAttribute("aria-current", i === n ? "step" : "false");
    });
    const line = $(".wz-line i", S.root), g = C.motion.gsap;
    if (g) g.to(line, { scaleX: n / 3, duration: 0.7, ease: "expo.out" }); else line.style.transform = `scaleX(${n / 3})`;
    if (from !== to) {
      const dir = n > prev ? 1 : -1;
      if (g) {
        g.to(from, { opacity: 0, x: -30 * dir, duration: 0.22, ease: "power2.in", onComplete: () => { from.hidden = true; from.classList.remove("active"); g.set(from, { clearProps: "all" }); } });
        to.hidden = false; to.classList.add("active");
        g.fromTo(to, { opacity: 0, x: 40 * dir }, { opacity: 1, x: 0, duration: 0.55, ease: "expo.out", delay: 0.18 });
        g.fromTo($$(".choice, .prio, .field, .an-map-wrap", to), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.03, ease: "expo.out", delay: 0.25, clearProps: "opacity,transform" });
      } else { from.hidden = true; from.classList.remove("active"); to.hidden = false; to.classList.add("active"); }
    }
    $("#wz-back").hidden = n === 0;
    $("#wz-next").hidden = n === 3;
    $("#an-run").hidden = n !== 3;
    $("#wz-count").textContent = `${C.t("Step")} ${n + 1} ${C.t("of")} 4`;
    if (n === 0) setTimeout(() => S.map?.invalidateSize(), 60);
    if (focus) setTimeout(() => (to.querySelector(".choice[aria-checked=true], select, input[type=range], .choice, button") || to).focus?.({ preventScroll: true }), 300);
  }

  function rotationCards() {
    const crops = Object.fromEntries((S.catalog.cultivos || []).map((c) => [c.id, c]));
    $("#an-rot-cards").innerHTML = S.catalog.rotaciones.map((r) => `<button type="button" class="choice rot" role="radio" data-v="${esc(r.id)}">
      <span class="rot-years">${(r.anios || []).map((y, i) => `<span class="ry"><em>Y${i + 1}</em>${y.map((cid) => `<i style="--cc:${crops[cid]?.color || "#999"}" title="${esc(crops[cid]?.nombre || cid)}">${esc(crops[cid]?.abrev || "")}</i>`).join("")}</span>`).join("")}</span>
      <strong>${esc(r.nombre)}</strong><small>${esc(r.descripcion)}</small>
      ${r.requiere_ganado ? `<span class="badge muted">Needs livestock</span>` : ""}</button>`).join("");
  }
  function syncChoices() {
    const set = (sel, v) => $$(`${sel} .choice`).forEach((b) => { const on = b.dataset.v === String(v); b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
    set("#an-rot-cards", $("#an-rotation").value);
    set("#an-live-cards", $("#an-livestock").checked ? "1" : "0");
    set("#an-soil-cards", $("#an-soil").value);
    $$("#an-area-pills button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === $("#an-area").value)));
  }
  function bindChoices() {
    const radio = (sel, apply) => {
      const box = $(sel);
      box.addEventListener("click", (e) => { const b = e.target.closest(".choice"); if (!b) return; apply(b.dataset.v); syncChoices(); markChanged();
        C.motion.gsap?.fromTo(b, { scale: 0.97 }, { scale: 1, duration: 0.5, ease: "elastic.out(1,0.5)" }); });
      box.addEventListener("keydown", (e) => {
        if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        const items = $$(".choice", box), i = items.indexOf(document.activeElement);
        const n = items[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        n.focus(); n.click();
      });
    };
    radio("#an-rot-cards", (v) => { $("#an-rotation").value = v; updateRotationDesc(); });
    radio("#an-live-cards", (v) => { $("#an-livestock").checked = v === "1"; });
    radio("#an-soil-cards", (v) => { $("#an-soil").value = v; });
    $("#an-area-pills").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $("#an-area").value = b.dataset.v; syncChoices(); updateRect(); markChanged(); });
  }

  /* After an analysis the wizard folds into a one-line summary; "Edit settings" brings it back. */
  function summaryHTML(input) {
    const rot = S.catalog.rotaciones.find((r) => r.id === input.rotacion_actual);
    const field = C.fields.get(S.fieldId);
    const top = Object.entries(input.prioridades).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => C.SCORES[k].label).join(" · ");
    return `<span class="sum-item">${icon("field")}<span><small>Field</small><strong class="notranslate">${esc(field?.nombre || "")}</strong></span></span>
      <span class="sum-item">${icon("map")}<span><small>Size</small><strong>${fmt(input.area_ha)} ha</strong></span></span>
      <span class="sum-item">${icon("rotation")}<span><small>Current rotation</small><strong>${esc(rot?.nombre || "")}</strong></span></span>
      <span class="sum-item">${icon(input.tiene_ganado ? "forage" : "harvest")}<span><small>Livestock</small><strong>${input.tiene_ganado ? "Yes" : "No"}</strong></span></span>
      <span class="sum-item">${icon("soil")}<span><small>Soil water</small><strong>${fmt(input.capacidad_suelo_mm)} mm</strong></span></span>
      <span class="sum-item">${icon("star")}<span><small>Top priorities</small><strong>${esc(top)}</strong></span></span>`;
  }
  function foldWizard(fold, animate = true) {
    const wz = $("#an-wizard"), sum = $("#an-summary"), g = animate ? C.motion.gsap : null;
    if (fold) {
      if (S.rec) $("#an-sum-items").innerHTML = summaryHTML(S.rec.input);
      if (wz.hidden) { sum.hidden = !S.rec; return; }
      const done = () => { wz.hidden = true; wz.style.cssText = ""; sum.hidden = false; if (g) g.fromTo(sum, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }); };
      if (g) g.to(wz, { height: 0, opacity: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, duration: 0.6, ease: "expo.inOut", onComplete: done }); else done();
    } else {
      sum.hidden = true; wz.hidden = false;
      if (g) g.fromTo(wz, { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.6, ease: "expo.out", clearProps: "all" });
      setTimeout(() => S.map?.invalidateSize(), 80);
      wz.scrollIntoView({ behavior: C.reducedMotion() ? "auto" : "smooth", block: "start" });
    }
  }

  function scenarioCard() {
    return `<section class="card scenario" data-rev>
      <div class="card-head"><div class="ch-title"><span class="chip-ic big">${icon("simulation")}</span><div><h2>What if the climate changes?</h2>
        <p class="hint">Move the sliders to recalculate everything with less rain or more heat, over the same 30-year record. These are hypothetical changes, not a prediction of future weather.</p></div></div></div>
      <div class="scenario-controls">
        <label class="range"><span>Rainfall <strong id="an-rain-val">0%</strong></span>
          <input type="range" id="an-rain" min="-40" max="20" step="5" value="0"></label>
        <label class="range"><span>Temperature <strong id="an-temp-val">+0.0 °C</strong></span>
          <input type="range" id="an-temp" min="0" max="3" step="0.5" value="0"></label>
        <button id="an-reset" type="button" class="btn ghost sm">${icon("reset")}<span>Back to the historical climate</span></button>
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
    syncChoices();
    $$("#an-demos .chip").forEach((c) => { const on = field.id === "sample-" + c.dataset.id; c.classList.toggle("active", on); c.setAttribute("aria-pressed", String(on)); });
  }

  function paintRange(input) {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty("--p", `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function updateRotationDesc() {
    const r = S.catalog.rotaciones.find((x) => x.id === $("#an-rotation").value);
    $("#an-rotation-desc").textContent = r ? `${C.t("Selected:")} ${r.nombre}. ${r.descripcion}${r.requiere_ganado ? " " + C.t("Requires livestock.") : ""}` : "";
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
    clearTimeout(S.autoTimer);
    if (S.rec && !S.rec.saved) S.autoTimer = setTimeout(run, 650);
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
    $("#an-error").hidden = true;
    const first = !S.rec;
    foldWizard(true);
    if (first) showLoading(true); else $("#an-results").classList.add("is-busy");
    $("#an-run").disabled = true; $("#an-run").textContent = C.t("Comparing rotations…");
    $("#an-results").setAttribute("aria-busy", "true");
    try {
      const resp = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(185000) });
      const data = await CooperWorkflow.readResponse(resp);
      if (!S.queue.isCurrent(runTok)) return;
      const rec = { id: C.uid(), fieldId: field.id, fecha: context.generatedAt, input: body, context, result: data, saved: false };
      { const m = clearedIds(); delete m[field.id]; C.storage.set("cooper-cleared", m); }
      await C.db.put("drafts", rec);
      showResult(rec, true);
      C.emit("analysis", rec);
      if (first) { $("#an-results-title").focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: C.reducedMotion() ? "auto" : "smooth" }); }
    } catch (err) {
      if (!S.queue.isCurrent(runTok)) return;
      showError(err.name === "TimeoutError" ? "This analysis took too long. Please try again; downloaded data may already be cached." : `Could not run the analysis: ${err.message}`);
      if (!S.rec) foldWizard(false);
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
    foldWizard(true, live);
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
    C.toast(C.t("Analysis saved in your history. It stays on Home; this screen is ready for a new analysis."), "ok", 5200);
    C.emit("history-changed");
    C.emit("analysis", rec);
    markCleared(rec);
    clearScreen();
  }
  /* After saving, this screen starts clean (Home keeps the saved analysis). */
  function clearedIds() { return C.storage.get("cooper-cleared", {}); }
  function markCleared(rec) { const m = clearedIds(); m[rec.fieldId] = rec.id; C.storage.set("cooper-cleared", m); }
  function clearScreen() {
    clearTimeout(S.autoTimer);
    const g = C.motion.gsap, body = $("#an-results");
    const done = () => {
      S.rec = null; S.ctl?.destroy(); S.ctl = null;
      $("#an-bar").hidden = true; $("#an-stale").hidden = true; $("#an-error").hidden = true;
      $("#an-summary").hidden = true; $("#an-wizard").hidden = false;
      body.style.opacity = "";
      const f = C.fields.get(S.fieldId);
      if (f) fillForm(f);
      goStep(0, false);
      if (g) g.fromTo("#an-wizard", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: "expo.out", clearProps: "all" });
      window.scrollTo({ top: 0, behavior: C.reducedMotion() ? "auto" : "smooth" });
    };
    if (g) g.to(body, { opacity: 0, duration: 0.35, onComplete: done }); else done();
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
    rotationCards();
    bindChoices();
    S.step = 0;
    $$(".wz-step", root).forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.step))));
    $("#wz-next").addEventListener("click", () => goStep(S.step + 1));
    $("#wz-back").addEventListener("click", () => goStep(S.step - 1));
    $("#an-edit").addEventListener("click", () => { foldWizard(false); goStep(0, false); });
    $("#an-priorities").innerHTML = Object.entries(C.PRIORITY_HINTS).map(([k, label]) => `
      <div class="prio" style="--c:var(${C.SCORES[k].color})">
        <span class="prio-ic">${icon(C.SCORES[k].icon)}</span>
        <label for="an-p-${k}"><strong>${esc(label)}</strong><small>${esc(C.SCORES[k].label)}</small></label>
        <output id="an-o-${k}" for="an-p-${k}">${C.DEFAULT_PRIORITIES[k]}</output>
        <input type="range" id="an-p-${k}" min="0" max="5" step="1" value="${C.DEFAULT_PRIORITIES[k]}">
      </div>`).join("");
    $("#an-demos").innerHTML = `<span class="chips-label">Or explore a sample field:</span>` + catalog.campos_demo.map((f) =>
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
    $("#an-summary").hidden = true; $("#an-wizard").hidden = false;
    const draft = await C.db.get("drafts", field.id);
    if (draft && C.fields.activeId() === field.id && clearedIds()[field.id] !== draft.id) showResult(draft, false);
    else goStep(0, false);
  }

  function onShow(sub) {
    selectTab(sub === "history" ? "history" : "new");
    setTimeout(() => { S.map?.invalidateSize(); moveInk(); }, 60);
  }

  C.analysis = { mount, load, onShow, run, save, get rec() { return S.rec; }, selectTab, refresh() { S.ctl?.refresh(); } };
})();
