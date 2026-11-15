/* Cooper · Analysis history: saved analyses by date and time, full breakdown and exports. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  const open = new Map(); // id → results controller
  let filter = "all", query = "";

  function exportMenu(id) {
    return `<div class="menu-wrap">
      <button type="button" class="btn ghost sm" data-act="menu" aria-haspopup="menu" aria-expanded="false">${icon("download")}<span>Export</span>${icon("chevron")}</button>
      <div class="menu" role="menu" hidden>
        <button role="menuitem" type="button" data-export="pdf" data-id="${esc(id)}">${icon("file")}<span>PDF report</span><small>.pdf</small></button>
        <button role="menuitem" type="button" data-export="xlsx" data-id="${esc(id)}">${icon("analysis")}<span>Excel workbook</span><small>.xlsx</small></button>
        <button role="menuitem" type="button" data-export="csv" data-id="${esc(id)}">${icon("layers")}<span>CSV tables</span><small>.csv</small></button>
        <button role="menuitem" type="button" data-export="json" data-id="${esc(id)}">${icon("file")}<span>Full data</span><small>.json</small></button>
      </div></div>`;
  }

  function item(rec) {
    const r = rec.result;
    const cur = r.rotaciones[0];
    const ranking = r.ranking || r.rotaciones;
    const best = ranking[0];
    const d = new Date(rec.fecha);
    return `<article class="card h-item" data-id="${esc(rec.id)}" data-rev>
      <div class="h-row">
        <div class="h-date"><span class="h-day">${esc(C.dateLabel(rec.fecha, { day: "2-digit" }))}</span><span class="h-mon">${esc(C.dateLabel(rec.fecha, { month: "short", year: "numeric" }))}</span></div>
        <div class="h-main">
          <h3><span class="notranslate">${esc(rec.context?.field || "Field")}</span></h3>
          <p class="h-meta"><span>${icon("calendar")}${esc(C.dateLabel(rec.fecha, { dateStyle: "full" }))}</span><span>${icon("history")}${esc(C.dateLabel(rec.fecha, { timeStyle: "short" }))}</span>
            <span>${icon("pin")}${rec.input.lat.toFixed(3)}, ${rec.input.lon.toFixed(3)} · ${fmt(rec.input.area_ha)} ha</span></p>
          <p class="h-sum">Today: <strong>${esc(cur.nombre)}</strong> (${fmt(cur.total)}) · Best for your priorities: <strong>${esc(best.nombre)}</strong> (${fmt(best.total)})
            ${r.escenario?.activo ? `<span class="badge warn">What-if: rain ${r.escenario.lluvia_pct}%, +${r.escenario.temp_delta} °C</span>` : `<span class="badge muted">Historical climate</span>`}</p>
        </div>
        <div class="h-actions">
          <button type="button" class="btn soft sm" data-act="toggle" aria-expanded="false">${icon("eye")}<span>View analysis</span></button>
          ${exportMenu(rec.id)}
          <button type="button" class="icon-btn" data-act="home" title="Show on Home" aria-label="Show on Home">${icon("home")}</button>
          <button type="button" class="icon-btn danger" data-act="delete" title="Delete" aria-label="Delete">${icon("trash")}</button>
        </div>
      </div>
      <div class="h-detail" hidden></div>
    </article>`;
  }

  async function render(root) {
    for (const ctl of open.values()) ctl.destroy();
    open.clear();
    const all = (await C.db.all("analyses")).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const fields = C.fields.list();
    const list = all.filter((a) => (filter === "all" || a.fieldId === filter) &&
      (!query || JSON.stringify([a.context?.field, a.result.rotaciones.map((r) => r.nombre)]).toLowerCase().includes(query)));
    root.innerHTML = `
      <div class="h-toolbar card" data-rev>
        <label class="field inline">Field <select id="h-filter"><option value="all">All fields</option>${fields.map((f) =>
          `<option value="${esc(f.id)}" ${filter === f.id ? "selected" : ""} class="notranslate">${esc(f.nombre)}</option>`).join("")}</select></label>
        <label class="field inline grow"><span class="sr-only">Search</span><input id="h-search" type="search" placeholder="Search by field or rotation" value="${esc(query)}"></label>
        <span class="h-total">${list.length} of ${all.length} saved</span>
      </div>
      ${list.length ? `<div class="h-list">${list.map(item).join("")}</div>` : `<div class="empty-state card" data-rev>
        <div class="es-art hist" aria-hidden="true"></div>
        <h2>${all.length ? "No analyses match this filter" : "No saved analyses yet"}</h2>
        <p>${all.length ? "Try another field or search." : "Run a new analysis and press Save analysis to keep it here with its date and time."}</p>
        ${all.length ? "" : `<button type="button" class="btn primary" data-act="new">${icon("plus")}<span>New analysis</span></button>`}</div>`}`;
    C.motion.reveal($$("[data-rev]", root), { stagger: 0.05 });

    $("#h-filter", root).addEventListener("change", (e) => { filter = e.target.value; render(root); });
    $("#h-search", root).addEventListener("input", C.debounce((e) => { query = e.target.value.trim().toLowerCase(); render(root).then(() => { const s = $("#h-search", root); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }, 300));

    root.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      const card = b.closest(".h-item");
      const id = card?.dataset.id;
      if (b.dataset.act === "new") return C.analysis.selectTab("new");
      if (b.dataset.export) {
        closeMenus(root);
        const rec = all.find((a) => a.id === b.dataset.id);
        return C.exporter[b.dataset.export](rec, open.get(rec.id));
      }
      if (b.dataset.act === "menu") {
        const menu = b.nextElementSibling, was = !menu.hidden;
        closeMenus(root);
        if (!was) { menu.hidden = false; b.setAttribute("aria-expanded", "true"); C.motion.reveal(menu, { y: -6, duration: 0.3 }); menu.querySelector("button").focus(); }
        return;
      }
      const rec = all.find((a) => a.id === id);
      if (!rec) return;
      if (b.dataset.act === "toggle") toggle(card, rec, b);
      if (b.dataset.act === "home") {
        await C.db.put("drafts", { ...rec });
        if (C.fields.get(rec.fieldId)) C.fields.setActive(rec.fieldId);
        C.emit("analysis", rec);
        C.go("home");
        C.toast(C.t("This analysis is now shown on Home."), "info");
      }
      if (b.dataset.act === "delete") {
        const ok = await C.confirm(C.t("Delete this analysis?"), C.t("It will be removed from this browser's history. This cannot be undone."), C.t("Delete"));
        if (!ok) return;
        await C.db.del("analyses", id);
        open.get(id)?.destroy(); open.delete(id);
        const g = C.motion.gsap;
        const done = () => { C.emit("history-changed"); render(root); };
        if (g) g.to(card, { height: 0, opacity: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, duration: 0.4, ease: "power2.inOut", onComplete: done }); else done();
      }
    };
    root.onkeydown = (e) => { if (e.key === "Escape") closeMenus(root); };
    document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(root); }, { once: true, capture: true });
  }

  function closeMenus(root) {
    $$(".menu", root).forEach((m) => { m.hidden = true; m.previousElementSibling?.setAttribute("aria-expanded", "false"); });
  }

  function toggle(card, rec, btn) {
    const det = $(".h-detail", card);
    const opening = det.hidden;
    btn.setAttribute("aria-expanded", String(opening));
    $("span", btn).textContent = C.t(opening ? "Hide analysis" : "View analysis");
    const g = C.motion.gsap;
    if (opening) {
      det.hidden = false;
      det.innerHTML = `<div class="h-inputs">${inputsSummary(rec)}</div><div class="h-results"></div>`;
      open.set(rec.id, C.results.render($(".h-results", det), rec, {}));
      if (g) g.fromTo(det, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" });
    } else {
      const done = () => { open.get(rec.id)?.destroy(); open.delete(rec.id); det.hidden = true; det.innerHTML = ""; };
      if (g) g.to(det, { opacity: 0, duration: 0.25, onComplete: done }); else done();
    }
  }

  function inputsSummary(rec) {
    const i = rec.input;
    const rot = window.CooperCatalog?.rotaciones.find((r) => r.id === i.rotacion_actual)?.nombre || i.rotacion_actual;
    return `<dl class="kv">
      <div><dt>Current rotation</dt><dd>${esc(rot)}</dd></div>
      <div><dt>Field size</dt><dd>${fmt(i.area_ha)} ha</dd></div>
      <div><dt>Soil water storage</dt><dd>${fmt(i.capacidad_suelo_mm)} mm</dd></div>
      <div><dt>Livestock</dt><dd>${i.tiene_ganado ? "Livestock available" : "No livestock"}</dd></div>
      <div><dt>Scenario</dt><dd>Rainfall ${i.escenario.lluvia_pct}%, temperature +${i.escenario.temp_delta} °C</dd></div>
      <div class="wide"><dt>Priorities</dt><dd>${Object.entries(i.prioridades).map(([k, v]) => `${esc(C.SCORES[k].label)} ${v}/5`).join(" · ")}</dd></div>
    </dl>`;
  }

  C.history = { render, inputsSummary };
})();
