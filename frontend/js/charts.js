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
  function lazy(canvas, build) {
    const ctl = { chart: null, canvas, build, destroy() { io.disconnect(); this.chart?.destroy(); this.chart = null; live.delete(this); }, redraw(anim = false) {
      if (!this.chart || !canvas.isConnected) return;
      this.chart.destroy(); this.chart = make(canvas, build(), anim);
    } };
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      if (!ctl.chart && canvas.isConnected) ctl.chart = make(canvas, build(), true);
    }, { threshold: 0.25 });
    if (typeof Chart === "undefined") return null;
    io.observe(canvas);
    live.add(ctl);
    return ctl;
  }
  function make(canvas, config, animate = true) {
    theme();
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
    const palette = [v("--muted"), v("--brand"), v("--c-ingreso"), v("--c-agua")];
    return {
      type: "radar",
      data: { labels: keys.map((k) => T(C.SCORES[k].label).replace(" (indicative)", "")), datasets: rotations.map((r, i) => ({
        label: (r.labelPrefix ? T(r.labelPrefix) + ": " : "") + T(r.nombre),
        data: keys.map((k) => r.puntajes[k]),
        borderColor: palette[i % palette.length], backgroundColor: alpha(palette[i % palette.length].startsWith("#") ? palette[i % palette.length] : "#1f5a3e", i === 0 ? 0.08 : 0.16),
        borderWidth: i === 0 ? 2 : 2.5, borderDash: i === 0 ? [5, 4] : [], pointRadius: compact ? 2.5 : 3.5, pointHoverRadius: 6,
        pointBackgroundColor: palette[i % palette.length], pointBorderColor: v("--surface"), pointBorderWidth: 1.5,
      })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: C.reducedMotion() ? 0 : 1200, easing: "easeOutQuart" },
        animations: { r: { from: 0, duration: 1200, easing: "easeOutBack", delay: (ctx) => (ctx.type === "data" ? ctx.datasetIndex * 180 + ctx.dataIndex * 40 : 0) } },
        plugins: { cooperCrosshair: false, legend: { display: !compact, position: "bottom" },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.r} / 100` } } },
        scales: { r: { min: 0, max: 100, beginAtZero: true, angleLines: { color: v("--grid") }, grid: { color: v("--grid") },
          ticks: { display: !compact, stepSize: 25, z: 2, showLabelBackdrop: true, backdropColor: alpha(v("--surface").startsWith("#") ? v("--surface") : "#ffffff", 0.92),
            backdropPadding: { x: 4, y: 2 }, color: v("--text-2"), font: { size: 10.5, weight: "600" } },
          pointLabels: { color: v("--text"), padding: compact ? 6 : 12, font: { size: compact ? 11 : 13, weight: "600" } } } },
        layout: { padding: compact ? 4 : 10 },
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

  C.charts = { theme, lazy, make, climateMonthly, waterBalance, annualSeries, radar, temperature, alpha };
})();
