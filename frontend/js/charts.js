/* Cooper · charts. Chart.js themed with the interface tokens: styled tooltips, a crosshair,
 * progressive line drawing, staggered bars, and animation that starts when a chart scrolls
 * into view. Every chart is re-themed when light/dark mode changes. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { fmt } = C;
  const live = new Set();

  const v = (n) => C.cssVar(n);
  const alpha = (hex, a) => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return hex;
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  };

  /* Vertical guide at the hovered month. */
  const crosshair = {
    id: "cooperCrosshair",
    afterDatasetsDraw(chart, _a, opts) {
      if (opts === false || !chart.tooltip?.getActiveElements?.().length) return;
      const x = chart.tooltip.getActiveElements()[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = v("--axis"); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.restore();
    },
  };

  /* Ring values (25…100) drawn between two axes, where no data point can cover them. */
  const ringLabels = {
    id: "cooperRings",
    afterDatasetsDraw(chart, _a, opts) {
      if (!opts || opts.display === false) return;
      const sc = chart.scales.r;
      if (!sc) return;
      const ctx = chart.ctx, n = chart.data.labels.length;
      const ang = sc.getIndexAngle(0) - Math.PI / 2 + Math.PI / n;
      ctx.save();
      ctx.font = "600 10.5px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const v of [25, 50, 75, 100]) {
        const r = sc.getDistanceFromCenterForValue(v);
        const x = sc.xCenter + Math.cos(ang) * r, y = sc.yCenter + Math.sin(ang) * r;
        const t = String(v), w = ctx.measureText(t).width + 8;
        ctx.fillStyle = opts.bg; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 8, w, 16, 5); else ctx.rect(x - w / 2, y - 8, w, 16);
        ctx.fill();
        ctx.fillStyle = opts.color; ctx.fillText(t, x, y + 0.5);
      }
      ctx.restore();
    },
  };

  function theme() {
    if (typeof Chart === "undefined") return false;
    const d = Chart.defaults;
    d.font.family = "IBM Plex Sans, Segoe UI, system-ui, sans-serif";
    d.font.size = 12;
    d.color = v("--text-2");
    d.borderColor = v("--grid");
    d.animation.duration = C.reducedMotion() ? 0 : 900;
    d.animation.easing = "easeOutQuart";
    d.plugins.legend.labels.usePointStyle = true;
    d.plugins.legend.labels.boxWidth = 8;
    d.plugins.legend.labels.boxHeight = 8;
    d.plugins.legend.labels.padding = 14;
    const t = d.plugins.tooltip;
    t.backgroundColor = v("--surface");
    t.titleColor = v("--text");
    t.bodyColor = v("--text-2");
    t.footerColor = v("--muted");
    t.borderColor = v("--line-2");
    t.borderWidth = 1;
    t.padding = 12;
    t.cornerRadius = 10;
    t.boxPadding = 5;
    t.usePointStyle = true;
    t.titleFont = { weight: "600", size: 13 };
    t.footerFont = { weight: "400", size: 11 };
    t.caretSize = 6;
    t.displayColors = true;
    if (!Chart.registry.plugins.get("cooperCrosshair")) Chart.register(crosshair);
    if (!Chart.registry.plugins.get("cooperRings")) Chart.register(ringLabels);
    return true;
  }

  /* Bars rise one after another; lines draw from left to right. */
  const barDelay = (step = 45) => ({
    delay: (ctx) => (ctx.type === "data" && ctx.mode === "default" ? ctx.dataIndex * step + ctx.datasetIndex * 120 : 0),
  });
  function progressive(n, total = 1300) {
    const each = total / Math.max(1, n);
    const prevY = (ctx) => {
      if (ctx.index === 0) return ctx.chart.scales.y.getPixelForValue(0);
      return ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(["y"], true).y;
    };
    return {
      x: { type: "number", easing: "linear", duration: each, from: NaN, delay: (ctx) => { if (ctx.type !== "data" || ctx.xStarted) return 0; ctx.xStarted = true; return ctx.index * each + 250; } },
      y: { type: "number", easing: "linear", duration: each, from: prevY, delay: (ctx) => { if (ctx.type !== "data" || ctx.yStarted) return 0; ctx.yStarted = true; return ctx.index * each + 250; } },
    };
  }

  /* Creates the chart when it enters the viewport, so its animation is actually seen. */
  /* ------------------------------------------------ palettes and notes
   * Every chart can be recoloured, annotated with notes pinned to data points, opened
   * large and saved as an image. Choices are remembered per chart in this browser. */
  const PALETTES = {
    cooper: { label: "Cooper", colors: null },
    vivid: { label: "Vivid", colors: ["#2f80ed", "#f2994a", "#27ae60", "#eb5757", "#9b51e0", "#00b8a9"] },
    earth: { label: "Earth", colors: ["#6b8e23", "#c08a3e", "#4f7a8a", "#a0522d", "#8f9779", "#d4a017"] },
    contrast: { label: "High contrast", colors: ["#0072b2", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#56b4e9"] },
  };
  const prefs = () => C.storage.get("cooper-chart-prefs", {});
  const setPref = (key, patch) => { const all = prefs(); all[key] = { ...(all[key] || {}), ...patch }; C.storage.set("cooper-chart-prefs", all); };
  const notesOf = (key) => C.storage.get("cooper-chart-notes", {})[key] || [];
  const saveNotes = (key, list) => { const all = C.storage.get("cooper-chart-notes", {}); all[key] = list; C.storage.set("cooper-chart-notes", all); };

  function applyPalette(cfg, name) {
    const pal = PALETTES[name]?.colors;
    if (!pal) return cfg;
    const map = new Map();
    const pick = (c) => { if (typeof c !== "string") return c; const base = c.replace(/rgba?\(([^)]+)\)/, (m, inner) => inner.split(",").slice(0, 3).join(",")); if (!map.has(base)) map.set(base, pal[map.size % pal.length]); return map.get(base); };
    cfg.data.datasets.forEach((d) => {
      const fill = cfg.type === "radar" || d.fill;
      const col = pick(Array.isArray(d.borderColor) ? d.borderColor[0] : d.borderColor || (Array.isArray(d.backgroundColor) ? d.backgroundColor[0] : d.backgroundColor));
      if (Array.isArray(d.backgroundColor)) { d.backgroundColor = d.backgroundColor.map((c) => alpha(pick(c), 0.85)); d.hoverBackgroundColor = d.backgroundColor.map((c) => c.replace(/,0\.85\)$/, ",1)")); }
      else if (d.type === "bar" || cfg.type === "bar") { d.backgroundColor = alpha(col, 0.88); d.hoverBackgroundColor = col; }
      else d.backgroundColor = fill ? alpha(col, 0.18) : col;
      if (d.borderColor) d.borderColor = col;
      if (d.pointBackgroundColor) d.pointBackgroundColor = col;
    });
    return cfg;
  }

  const notesPlugin = {
    id: "cooperNotes",
    afterDatasetsDraw(chart) {
      const key = chart.$cooperKey;
      if (!key) return;
      const ctx = chart.ctx;
      chart.$noteHits = [];
      notesOf(key).forEach((n, idx) => {
        const meta = chart.getDatasetMeta(n.d);
        const el = meta?.data?.[n.i];
        if (!el || meta.hidden) return;
        const { x, y } = el.getProps(["x", "y"], true);
        ctx.save();
        ctx.fillStyle = n.color || "#e8a33d"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = "600 11px IBM Plex Sans, sans-serif";
        const t = n.text.length > 34 ? n.text.slice(0, 33) + "…" : n.text;
        const w = ctx.measureText(t).width + 14;
        const bx = Math.min(chart.width - w - 4, Math.max(4, x - w / 2)), by = Math.max(4, y - 34);
        ctx.fillStyle = "rgba(14,22,17,.88)";
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, w, 20, 6); else ctx.rect(bx, by, w, 20); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(t, bx + 7, by + 10.5);
        ctx.restore();
        chart.$noteHits.push({ idx, x, y, bx, by, w });
      });
    },
  };

  function noteDialog(text = "") {
    return C.dialog({
      title: C.t("Note on this point"),
      body: `<label class="field">${C.t("Your note")}<textarea id="note-text" rows="3" maxlength="140" autofocus>${C.esc(text)}</textarea></label>
        <div class="note-colors">${["#e8a33d", "#2f80ed", "#27ae60", "#eb5757", "#9b51e0"].map((c, i) => `<label><input type="radio" name="note-c" value="${c}" ${i === 0 ? "checked" : ""}><i style="background:${c}"></i></label>`).join("")}</div>`,
      actions: [...(text ? [{ label: C.t("Delete note"), kind: "ghost danger", value: { del: true } }] : []), { label: C.t("Cancel"), value: null },
        { label: C.t("Save note"), kind: "primary", handler: (b) => ({ text: b.querySelector("#note-text").value.trim(), color: b.querySelector("input[name=note-c]:checked")?.value }) }],
    });
  }

  function toolbar(ctl) {
    const box = ctl.canvas.parentElement;
    if (!box || box.querySelector(".chart-tools")) return;
    box.classList.add("has-tools");
    const bar = document.createElement("div");
    bar.className = "chart-tools";
    bar.innerHTML = `<button type="button" data-ct="palette" title="${C.t("Change colours")}" aria-label="${C.t("Change colours")}">${C.line("sun")}</button>
      <button type="button" data-ct="note" title="${C.t("Add a note: then click a point")}" aria-label="${C.t("Add a note")}" aria-pressed="false">${C.line("edit")}</button>
      <button type="button" data-ct="clear" title="${C.t("Remove notes")}" aria-label="${C.t("Remove notes")}">${C.line("trash")}</button>
      <button type="button" data-ct="expand" title="${C.t("Open large")}" aria-label="${C.t("Open large")}">${C.line("expand")}</button>
      <button type="button" data-ct="png" title="${C.t("Save as image")}" aria-label="${C.t("Save as image")}">${C.line("download")}</button>`;
    box.appendChild(bar);
    bar.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ct]"); if (!b || !ctl.chart) return;
      const a = b.dataset.ct;
      if (a === "palette") {
        const names = Object.keys(PALETTES), cur = prefs()[ctl.key]?.palette || "cooper";
        const next = names[(names.indexOf(cur) + 1) % names.length];
        setPref(ctl.key, { palette: next });
        ctl.redraw(true);
        C.toast(`${C.t("Colours")}: ${C.t(PALETTES[next].label)}`, "info", 1400);
      }
      if (a === "note") { ctl.noteMode = !ctl.noteMode; b.setAttribute("aria-pressed", String(ctl.noteMode)); box.classList.toggle("note-mode", ctl.noteMode); if (ctl.noteMode) C.toast(C.t("Click a point of the chart to pin a note."), "info", 2200); }
      if (a === "clear") { saveNotes(ctl.key, []); ctl.chart.update("none"); }
      if (a === "png") {
        const link = document.createElement("a");
        link.href = ctl.chart.toBase64Image("image/png", 1); link.download = `cooper-chart-${Date.now()}.png`; link.click();
      }
      if (a === "expand") openLarge(ctl);
    });
    ctl.canvas.addEventListener("click", async (e) => {
      const ch = ctl.chart; if (!ch) return;
      const r = ctl.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = (ch.$noteHits || []).find((h) => Math.hypot(h.x - x, h.y - y) < 10 || (x >= h.bx && x <= h.bx + h.w && y >= h.by && y <= h.by + 20));
      if (hit) {
        const list = notesOf(ctl.key), n = list[hit.idx];
        const res = await noteDialog(n.text);
        if (res?.del) list.splice(hit.idx, 1); else if (res?.text) Object.assign(n, res);
        saveNotes(ctl.key, list); ch.update("none");
        return;
      }
      if (!ctl.noteMode) return;
      const els = ch.getElementsAtEventForMode(e, ch.config.type === "radar" ? "nearest" : "nearest", { intersect: false }, true);
      if (!els.length) return;
      const res = await noteDialog();
      if (res?.text) { const list = notesOf(ctl.key); list.push({ d: els[0].datasetIndex, i: els[0].index, ...res }); saveNotes(ctl.key, list); ch.update("none"); }
      ctl.noteMode = false; box.classList.remove("note-mode"); bar.querySelector('[data-ct="note"]').setAttribute("aria-pressed", "false");
    });
  }

  function openLarge(ctl) {
    const host = document.createElement("div");
    host.className = "chart-large";
    host.innerHTML = `<div class="chart-box xl"><canvas role="img" aria-label="${C.esc(ctl.canvas.getAttribute("aria-label") || "Chart")}"></canvas></div>`;
    let big = null;
    C.fx.openFocus(ctl.canvas.closest(".card, .opt-face, .focus-card") || ctl.canvas.parentElement, host, { cls: "wide chart-focus", label: ctl.canvas.getAttribute("aria-label") || "Chart",
      onOpen: (b) => setTimeout(() => { big = lazy(b.querySelector("canvas"), ctl.build, { key: ctl.key }); }, 60) });
  }

  /* Creates the chart when it enters the viewport and replays its entrance when it comes back. */
  function lazy(canvas, build, opts = {}) {
    if (typeof Chart === "undefined") return null;
    const key = opts.key || [canvas.dataset.rec || "", canvas.getAttribute("aria-label") || "", canvas.dataset.view || ""].join("|");
    const ctl = { chart: null, canvas, build, key, noteMode: false,
      destroy() { io.disconnect(); this.chart?.destroy(); this.chart = null; live.delete(this); },
      redraw(anim = false) { if (!this.chart || !canvas.isConnected) return; this.chart.destroy(); this.chart = makeKeyed(this, anim); } };
    Object.defineProperty(ctl, "key", { get: () => opts.key || [canvas.dataset.rec || "", canvas.getAttribute("aria-label") || "", canvas.dataset.view || ""].join("|") });
    let away = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          if (!ctl.chart && canvas.isConnected) ctl.chart = makeKeyed(ctl, true);
          else if (away && ctl.chart && !C.reducedMotion()) { ctl.chart.reset(); ctl.chart.update(); }
          away = false;
        } else if (e.intersectionRatio === 0) away = true;
      }
    }, { threshold: 0.25 });
    io.observe(canvas);
    live.add(ctl);
    toolbar(ctl);
    return ctl;
  }
  function makeKeyed(ctl, animate) {
    const cfg = applyPalette(ctl.build(), prefs()[ctl.key]?.palette || "cooper");
    const ch = make(ctl.canvas, cfg, animate);
    ch.$cooperKey = ctl.key;
    return ch;
  }
  function make(canvas, config, animate = true) {
    theme();
    if (!Chart.registry.plugins.get("cooperNotes")) Chart.register(notesPlugin);
    if (!animate) config.options = { ...config.options, animation: false, animations: {} };
    return new Chart(canvas, config);
  }

  /* --------------------------------------------------------------- builders */
  const T = (s) => C.t(s);
  const axes = (yTitle, extra = {}) => ({
    x: { grid: { display: false }, border: { color: v("--axis") }, ticks: { color: v("--text-2") } },
    y: { beginAtZero: true, grid: { color: v("--grid") }, border: { display: false }, ticks: { color: v("--muted"), padding: 6 },
      title: yTitle ? { display: true, text: T(yTitle), color: v("--muted") } : { display: false } },
    ...extra,
  });

  function climateMonthly(result, { showDry = false } = {}) {
    const months = result.clima.mensual;
    const base = result.escenario?.activo ? result.clima.mensual_base : null;
    const rain = v("--series-1"), et = v("--series-2");
    const ds = [
      { type: "bar", label: T("Average rainfall (mm)"), data: months.map((d) => d.lluvia_mm), backgroundColor: alpha(rain, 0.88), hoverBackgroundColor: rain,
        borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: "bottom", barPercentage: 0.72, categoryPercentage: 0.86, order: 3, animations: { y: barDelay(55) } },
      { type: "line", label: T("Reference evapotranspiration (mm)"), data: months.map((d) => d.et0_mm), borderColor: et, backgroundColor: et,
        borderWidth: 3, pointRadius: 4, pointHoverRadius: 7, pointBorderColor: v("--surface"), pointBorderWidth: 2, tension: 0.35, order: 1, animations: progressive(12) },
    ];
    if (showDry) ds.push({ type: "line", label: T("Rain, dry year (mm)"), data: months.map((d) => d.lluvia_seca_mm), borderColor: alpha(rain, 0.9), borderDash: [6, 5],
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.35, order: 2, animations: progressive(12, 1100) });
    if (base) ds.push({ type: "line", label: T("Historical rainfall (no scenario)"), data: base.map((d) => d.lluvia_mm), borderColor: v("--muted"), borderDash: [4, 4],
      borderWidth: 2, pointRadius: 0, tension: 0.35, order: 0 });
    return {
      data: { labels: months.map((d) => T(d.nombre)), datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start" },
          tooltip: { callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} mm`,
            footer: (items) => { const d = months[items[0].dataIndex]; return [`${T("Balance (rain − ET0):")} ${d.balance_mm > 0 ? "+" : ""}${fmt(d.balance_mm)} mm`, `${T("Dry year (1 in 5):")} ${fmt(d.lluvia_seca_mm)} mm ${T("of rain")}`]; },
          } },
        },
        scales: axes("mm per month"),
      },
    };
  }

  function waterBalance(result) {
    const months = result.clima.mensual;
    const pos = v("--series-1"), neg = v("--series-2");
    return {
      type: "bar",
      data: { labels: months.map((d) => T(d.nombre)), datasets: [{
        label: T("Balance (rain − ET0)"), data: months.map((d) => d.balance_mm),
        backgroundColor: months.map((d) => alpha(d.balance_mm >= 0 ? pos : neg, 0.85)), hoverBackgroundColor: months.map((d) => (d.balance_mm >= 0 ? pos : neg)),
        borderRadius: 6, borderSkipped: false, barPercentage: 0.7, animations: { y: barDelay(60) },
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (c) => ` ${c.parsed.y >= 0 ? T("Surplus") : T("Deficit")}: ${c.parsed.y > 0 ? "+" : ""}${fmt(c.parsed.y)} mm`,
          footer: (items) => { const d = months[items[0].dataIndex]; return `${T("Rain")} ${fmt(d.lluvia_mm)} mm · ET0 ${fmt(d.et0_mm)} mm`; },
        } } },
        scales: { ...axes("mm per month"), y: { ...axes("mm per month").y, beginAtZero: false, grid: { color: (c) => (c.tick.value === 0 ? v("--axis") : v("--grid")), lineWidth: (c) => (c.tick.value === 0 ? 2 : 1) } } },
      },
    };
  }

  function annualSeries(result) {
    const s = result.clima.tendencias.serie_anual || [];
    const rain = s.map((d) => d.lluvia_mm);
    const avg = rain.reduce((a, b) => a + b, 0) / Math.max(1, rain.length);
    const ma = rain.map((_, i) => { const w = rain.slice(Math.max(0, i - 4), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
    const blue = v("--series-1"), orange = v("--series-2");
    return {
      data: { labels: s.map((d) => String(d.anio)), datasets: [
        { type: "bar", label: T("Rainfall per farming year (mm)"), data: rain, order: 2,
          backgroundColor: rain.map((r) => alpha(r >= avg ? blue : orange, 0.78)), hoverBackgroundColor: rain.map((r) => (r >= avg ? blue : orange)),
          borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9, animations: { y: barDelay(28) } },
        { type: "line", label: T("5-year average"), data: ma, borderColor: v("--text"), borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0.4, order: 1, animations: progressive(s.length, 1600) },
        { type: "line", label: T("Hot days (≥32 °C)"), data: s.map((d) => d.dias_calor), yAxisID: "y2", borderColor: v("--c-ingreso"), borderWidth: 1.5, borderDash: [3, 3],
          pointRadius: 2, pointHoverRadius: 5, tension: 0.3, order: 0, hidden: false, animations: progressive(s.length, 1600) },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "start" }, tooltip: { callbacks: {
          label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}${c.dataset.yAxisID === "y2" ? "" : " mm"}`,
          footer: (items) => { const r = rain[items[0].dataIndex]; return `${r >= avg ? "+" : ""}${fmt(r - avg)} mm ${T("vs the 30-year average")} (${fmt(avg)} mm)`; },
        } } },
        scales: { ...axes("mm per year"), x: { ...axes().x, ticks: { color: v("--text-2"), maxRotation: 0, autoSkip: true, autoSkipPadding: 10 } },
          y2: { position: "right", beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { color: v("--c-ingreso") }, title: { display: true, text: T("hot days"), color: v("--c-ingreso") } } },
      },
    };
  }

  function radar(rotations, { compact = false } = {}) {
    const keys = Object.keys(C.SCORES);
    const palette = ["#9aa6a0", v("--brand"), "#e2a93a", v("--c-agua")];
    const solid = (c) => (c.startsWith("#") ? c : "#2c7350");
    const gridC = alpha(solid(v("--text")).length === 7 ? solid(v("--text")) : "#888888", 0.16);
    return {
      type: "radar",
      data: { labels: keys.map((k) => T(C.SCORES[k].label).replace(" (indicative)", "")), datasets: rotations.map((r, i) => ({
        label: (r.labelPrefix ? T(r.labelPrefix) + ": " : "") + T(r.nombre),
        data: keys.map((k) => r.puntajes[k]),
        borderColor: palette[i % palette.length], backgroundColor: alpha(solid(palette[i % palette.length]), i === 0 ? 0.10 : 0.2),
        borderWidth: i === 0 ? 2.5 : 3.2, borderDash: i === 0 ? [6, 5] : [], pointRadius: compact ? 4 : 6, pointHoverRadius: 9,
        pointBackgroundColor: palette[i % palette.length], pointBorderColor: "#ffffff", pointBorderWidth: 2, order: rotations.length - i,
      })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: C.reducedMotion() ? 0 : 1400, easing: "easeOutQuart" },
        animations: { r: { from: 0, duration: 1500, easing: "easeOutElastic", delay: (ctx) => (ctx.type === "data" ? ctx.datasetIndex * 260 + ctx.dataIndex * 70 : 0) } },
        interaction: { mode: "nearest", intersect: false },
        plugins: { cooperCrosshair: false, cooperRings: compact ? { display: false } : { bg: alpha(v("--surface").startsWith("#") ? v("--surface") : "#ffffff", 0.92), color: v("--text-2") },
          legend: { display: !compact, position: "bottom", labels: { color: v("--text"), font: { size: 12.5, weight: "500" }, padding: 16 } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.r} / 100` } } },
        scales: { r: { min: 0, max: 100, beginAtZero: true, angleLines: { color: gridC, lineWidth: 1.2 }, grid: { color: gridC, lineWidth: 1.2, circular: false },
          ticks: { display: false, stepSize: 25 },
          pointLabels: { color: v("--text"), padding: compact ? 8 : 14, font: { size: compact ? 11.5 : 14, weight: "600" } } } },
        layout: { padding: compact ? 6 : 14 },
      },
    };
  }

  function temperature(result) {
    const months = result.clima.mensual;
    const hot = v("--series-2"), cold = v("--series-1");
    return {
      type: "line",
      data: { labels: months.map((d) => T(d.nombre)), datasets: [
        { label: T("Average maximum (°C)"), data: months.map((d) => d.tmax), borderColor: hot, backgroundColor: alpha(hot, 0.14), fill: "+1", borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, tension: 0.4, animations: progressive(12) },
        { label: T("Average minimum (°C)"), data: months.map((d) => d.tmin), borderColor: cold, backgroundColor: alpha(cold, 0.1), fill: false, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, tension: 0.4, animations: progressive(12) },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "start" }, tooltip: { callbacks: {
          label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)} °C`,
          footer: (items) => { const d = months[items[0].dataIndex]; return `${T("Hot days")} ${fmt(d.dias_calor, 1)} · ${T("Frost-risk days")} ${fmt(d.dias_helada, 1)}`; },
        } } },
        scales: { ...axes("°C"), y: { ...axes("°C").y, beginAtZero: false } },
      },
    };
  }

  C.listen("theme", () => setTimeout(() => { theme(); for (const c of [...live]) { if (!c.canvas.isConnected) { live.delete(c); continue; } c.redraw(false); } }, 60));
  C.listen("language", () => { for (const c of [...live]) { if (!c.canvas.isConnected) { live.delete(c); continue; } c.redraw(false); } });

  C.charts = { theme, lazy, make, PALETTES, climateMonthly, waterBalance, annualSeries, radar, temperature, alpha };
})();
