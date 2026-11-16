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

  /* ------------------------------------------------ month-by-month guide
   * Shown in the large view of a rotation: rain against the water the air demands (ET0)
   * each month, the crop growing in the field, and what to watch or do that month.
   * Hover or click a month, use the arrows, or play the whole year. */
  const GUIDES = new Map();
  let guideSeq = 0;
  const GUIDE_KEY = (r) => (r.$gk ||= `g${++guideSeq}`);
  const MONTHS_FULL = ["May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March", "April"];
  function cyclesOf(year) {
    const out = [];
    for (let i = 0; i < 12;) {
      const c = year[i];
      if (!c) { i++; continue; }
      let j = i; while (j + 1 < 12 && year[j + 1]?.id === c.id) j++;
      out.push({ c, a: i, b: j }); i = j + 1;
    }
    return out;
  }
  function monthInfo(g, y, i) {
    const year = g.r.calendario[y], c = year[i];
    const m = g.clima.find((x) => x.mes === C.AG_ORDER[i]) || {};
    const cy = c ? cyclesOf(year).find((k) => i >= k.a && i <= k.b) : null;
    const first = cy && i === cy.a, last = cy && i === cy.b;
    const stage = !c ? "Field without a crop" : first ? "Sowing and emergence" : last ? "Harvest or end of cycle" : c.critico ? "Critical stage" : "Growing";
    const bal = Math.round((m.lluvia_mm ?? 0) - (m.et0_mm ?? 0));
    const cover = m.et0_mm ? Math.round(((m.lluvia_mm ?? 0) / m.et0_mm) * 100) : 100;
    const acts = [];
    const add = (ic, text, kind = "") => acts.push({ ic, text, kind });
    if (!c) {
      add("soil", C.t("The field is bare: a cover crop (black oat, ryegrass) protects the soil and feeds it."), "warn");
      if ((m.dias_lluvia_fuerte ?? 0) >= 0.3) add("water", C.t("Heavy rains on bare soil can wash soil away: keep stubble on the surface."), "warn");
    } else {
      if (first) add("sowing", `${C.t("Sow")} ${c.nombre}: ${C.t("check that the soil has moisture before sowing.")}`);
      if (first && (m.dias_helada ?? 0) >= 2) add("climate", C.t("Frost is common this month: avoid sowing frost-sensitive crops too early."), "warn");
      if (c.critico) add("critical", `${C.t("Critical stage of")} ${c.nombre}: ${C.t("it is most sensitive to lack of water now.")}`, "warn");
      if (c.critico && bal < 0) add("water", `${C.t("Rain covers")} ${cover}% ${C.t("of the water demand")} (${fmt(m.lluvia_seca_mm)} mm ${C.t("in a dry year")}): ${C.t("watch soil moisture; irrigate if you can.")}`, "bad");
      if (c.critico && (m.dias_calor ?? 0) >= 2) add("simulation", `${fmt(m.dias_calor, 1)} ${C.t("hot days on average: heat at flowering can cut yield.")}`, "warn");
      if (last) add("harvest", `${C.t("Harvest")} ${c.nombre}: ${C.t("leave the stubble on the surface to protect the soil.")}`);
      if (!first && !last && !c.critico) add(bal >= 0 ? "water" : "weather", bal >= 0 ? C.t("Rain covers the water demand this month: a good month for the crop.") : `${C.t("Water demand exceeds rain by")} ${Math.abs(bal)} mm: ${C.t("the crop uses water stored in the soil.")}`, bal >= 0 ? "good" : "");
    }
    if (!acts.length) add("info", C.t("No special care needed this month."), "good");
    return { c, m, stage, bal, cover, acts, first, last };
  }
  function guideHTML(key) {
    const g = GUIDES.get(key);
    if (!g) return "";
    const years = g.r.calendario.length;
    return `<section class="rg" data-key="${esc(key)}" tabindex="0" aria-label="${esc(C.t("Month-by-month guide"))}">
      <header class="rg-head"><span class="chip-ic">${icon("calendar")}</span><div><small>${esc(C.t("Month-by-month guide"))}</small><h4>${esc(C.t("Your year with this rotation"))}</h4></div>
        <div class="rg-ctrl">${years > 1 ? `<div class="seg rg-years">${g.r.calendario.map((_, y) => `<button type="button" data-y="${y}" aria-pressed="${y === 0}">${C.t("Year")} ${y + 1}</button>`).join("")}</div>` : ""}
          <button type="button" class="btn soft sm rg-play" aria-pressed="false">${C.line("play")}<span>${esc(C.t("Play the year"))}</span></button></div></header>
      <div class="rg-chart"><svg class="rg-svg" viewBox="0 0 720 240" role="img" aria-label="${esc(C.t("Rain and water demand by month"))}"></svg></div>
      <div class="rg-legend"><span><i class="lg-rain"></i>${esc(C.t("Rain"))}</span><span><i class="lg-dry"></i>${esc(C.t("Rain in a dry year"))}</span><span><i class="lg-et"></i>${esc(C.t("Water the air demands (ET0)"))}</span><span><i class="lg-crit"></i>${esc(C.t("Critical stage"))}</span></div>
      <div class="rg-month" aria-live="polite"></div>
    </section>`;
  }
  /* Large view: each key figure with an icon and a comparison with the current rotation. */
  function focusKpis(key) {
    const g = GUIDES.get(key);
    if (!g) return "";
    const a = g.r.indicadores, b = g.cur.indicadores, same = g.r.id === g.cur.id;
    const rows = [
      ["soil", a.meses_descubiertos, b.meses_descubiertos, 1, "", "months without a crop per year"],
      ["water", a.uso_agua_mm, b.uso_agua_mm, 0, " mm", "water used by the crops per year"],
      ["critical", a.deficit_seco_mm, b.deficit_seco_mm, 0, " mm", "water deficit in a dry year"],
      a.erosion_t_ha != null ? ["layers", a.erosion_t_ha, b.erosion_t_ha, 1, " t/ha", "estimated erosion per year"] : ["weather", a.lluvia_suelo_desnudo_mm, b.lluvia_suelo_desnudo_mm, 0, " mm", "rain on bare soil per year"],
    ];
    return `<div class="kpis fk">${rows.map(([ic, v, t, d, u, label]) => {
      const max = Math.max(v, t, 0.0001), better = v < t - 1e-9, worse = v > t + 1e-9;
      return `<div class="kpi fk-item"><div class="fk-top">${icon(ic)}${same ? "" : `<span class="fk-tag ${better ? "good" : worse ? "bad" : ""}">${C.t(better ? "Better than today" : worse ? "Worse than today" : "Same as today")}</span>`}</div>
        <div class="v">${fmt(v, d)}${u}</div><div class="l">${esc(C.t(label))}</div>
        ${same ? `<div class="fk-note">${esc(C.t("This is your current rotation"))}</div>` : `<div class="fk-bars">
          <span><em>${esc(C.t("This option"))}</em><i><b data-w="${Math.round((v / max) * 100)}" style="background:var(--brand)"></b></i></span>
          <span><em>${esc(C.t("Today"))}</em><i><b data-w="${Math.round((t / max) * 100)}" style="background:#8f9ca8"></b></i><small>${fmt(t, d)}${u}</small></span></div>`}</div>`;
    }).join("")}</div>`;
  }
  function bindGuide(el) {
    const g = el && GUIDES.get(el.dataset.key);
    if (!g) return;
    const svg = el.querySelector(".rg-svg"), box = el.querySelector(".rg-month");
    const W = 720, x0 = 40, x1 = W - 8, top = 16, base = 168, colW = (x1 - x0) / 12;
    const max = Math.max(...g.clima.map((m) => Math.max(m.lluvia_mm, m.et0_mm))) * 1.12;
    const yOf = (v) => base - (v / max) * (base - top);
    const xOf = (i) => x0 + colW * (i + 0.5);
    const mm = (i) => g.clima.find((x) => x.mes === C.AG_ORDER[i]) || {};
    let y = 0, sel = Math.max(0, C.AG_ORDER.indexOf(new Date().getMonth() + 1)), timer = null;
    function draw() {
      const year = g.r.calendario[y];
      const ticks = [0, 0.5, 1].map((f) => Math.round((max / 1.12) * f / 10) * 10);
      const etPts = Array.from({ length: 12 }, (_, i) => `${xOf(i).toFixed(1)},${yOf(mm(i).et0_mm).toFixed(1)}`);
      const dryPts = Array.from({ length: 12 }, (_, i) => `${xOf(i).toFixed(1)},${yOf(mm(i).lluvia_seca_mm).toFixed(1)}`);
      svg.innerHTML = `
        ${ticks.map((t) => `<g class="rg-tick"><line x1="${x0}" x2="${x1}" y1="${yOf(t)}" y2="${yOf(t)}"/><text x="${x0 - 6}" y="${yOf(t) + 4}">${t}</text></g>`).join("")}
        <text class="rg-unit" x="${x0 - 6}" y="${top - 4}">mm</text>
        <rect class="rg-sel" x="0" y="${top - 6}" width="${colW}" height="${base - top + 62}" rx="10"/>
        ${Array.from({ length: 12 }, (_, i) => { const v = mm(i).lluvia_mm; const h = base - yOf(v); return `<rect class="rg-bar ${mm(i).balance_mm < 0 ? "short" : ""}" data-i="${i}" x="${(xOf(i) - colW * 0.28).toFixed(1)}" y="${yOf(v).toFixed(1)}" width="${(colW * 0.56).toFixed(1)}" height="${h.toFixed(1)}" rx="4"/>`; }).join("")}
        <polyline class="rg-dry" points="${dryPts.join(" ")}"/>
        <polyline class="rg-et" points="${etPts.join(" ")}"/>
        ${Array.from({ length: 12 }, (_, i) => `<circle class="rg-dot" cx="${xOf(i).toFixed(1)}" cy="${yOf(mm(i).et0_mm).toFixed(1)}" r="3.6"/>`).join("")}
        ${cyclesOf(year).map(({ c, a, b }) => { const x = x0 + a * colW + 2, w = (b - a + 1) * colW - 4; const lab = w > c.nombre.length * 6.6 + 14 ? c.nombre : w > 26 ? c.abrev : ""; const hx = c.color.replace("#", ""), lum = (0.299 * parseInt(hx.slice(0, 2), 16) + 0.587 * parseInt(hx.slice(2, 4), 16) + 0.114 * parseInt(hx.slice(4, 6), 16)) / 255; return `<g class="rg-band ${lum > 0.62 ? "light" : ""}"><rect x="${x}" y="${base + 10}" width="${w}" height="20" rx="10" style="fill:${c.color}"/>${lab ? `<text x="${x + 10}" y="${base + 24}">${esc(lab)}</text>` : ""}</g>`; }).join("")}
        ${year.map((c, i) => (c?.critico ? `<circle class="rg-crit" cx="${xOf(i).toFixed(1)}" cy="${base + 38}" r="3.4"/>` : "")).join("")}
        ${Array.from({ length: 12 }, (_, i) => `<text class="rg-m" data-i="${i}" x="${xOf(i)}" y="${base + 58}">${esc(C.t(C.AG_MONTHS[i]))}</text>`).join("")}
        ${Array.from({ length: 12 }, (_, i) => `<rect class="rg-hit" data-i="${i}" x="${x0 + i * colW}" y="0" width="${colW}" height="240"/>`).join("")}`;
      const gs = C.motion.gsap;
      if (gs) {
        gs.fromTo(svg.querySelectorAll(".rg-bar"), { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: 0.9, ease: "expo.out", stagger: 0.04 });
        const et = svg.querySelector(".rg-et"), len = et.getTotalLength?.() || 900;
        gs.fromTo(et, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: "power2.inOut", delay: 0.2 });
        gs.fromTo(svg.querySelectorAll(".rg-dot"), { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.4, ease: "back.out(3)", stagger: 0.06, delay: 0.5 });
        gs.fromTo(svg.querySelectorAll(".rg-band rect"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.8, ease: "expo.out", stagger: 0.1, delay: 0.3 });
      }
      show(sel, false);
    }
    function show(i, animate = true) {
      sel = (i + 12) % 12;
      const info = monthInfo(g, y, sel), gs = C.motion.gsap;
      const hl = svg.querySelector(".rg-sel");
      if (gs && animate) gs.to(hl, { attr: { x: x0 + sel * colW }, duration: 0.45, ease: "expo.out" }); else hl.setAttribute("x", x0 + sel * colW);
      svg.querySelectorAll(".rg-m").forEach((t) => t.classList.toggle("on", Number(t.dataset.i) === sel));
      svg.querySelectorAll(".rg-bar").forEach((b) => b.classList.toggle("on", Number(b.dataset.i) === sel));
      const m = info.m;
      box.innerHTML = `<div class="rgm-head"><span class="rgm-dot" style="background:${info.c ? info.c.color : "var(--surface-3)"}"></span>
          <div><strong>${esc(C.t(MONTHS_FULL[sel]))}</strong><span>${esc(info.c ? info.c.nombre : C.t("No crop"))} · ${esc(C.t(info.stage))}</span></div>
          <div class="rgm-nav"><button type="button" class="icon-btn rg-prev" aria-label="${esc(C.t("Previous month"))}">${C.line("right", "flip-x")}</button><button type="button" class="icon-btn rg-next" aria-label="${esc(C.t("Next month"))}">${C.line("right")}</button></div></div>
        <div class="rgm-stats">
          <span><em>${esc(C.t("Rain"))}</em><b>${fmt(m.lluvia_mm)} mm</b></span>
          <span><em>${esc(C.t("Demand (ET0)"))}</em><b>${fmt(m.et0_mm)} mm</b></span>
          <span class="${info.bal >= 0 ? "pos" : "neg"}"><em>${esc(C.t("Balance"))}</em><b>${info.bal > 0 ? "+" : ""}${info.bal} mm</b></span>
          <span><em>${esc(C.t("Frost / heat"))}</em><b>${fmt(m.dias_helada, 1)} / ${fmt(m.dias_calor, 1)} d</b></span>
        </div>
        <div class="rgm-cover"><span>${esc(C.t("Rain covers"))} <b>${Math.min(999, info.cover)}%</b> ${esc(C.t("of the water demand"))}</span><i><em style="width:${Math.min(100, info.cover)}%"></em></i></div>
        <ul class="rgm-acts">${info.acts.map((a) => `<li class="${a.kind}">${icon(a.ic)}<span>${esc(a.text)}</span></li>`).join("")}</ul>`;
      if (gs && animate) {
        gs.fromTo(box.querySelectorAll(".rgm-stats span, .rgm-acts li"), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out", stagger: 0.04, clearProps: "transform,opacity" });
        gs.fromTo(box.querySelector(".rgm-cover em"), { width: 0 }, { width: `${Math.min(100, info.cover)}%`, duration: 0.8, ease: "expo.out" });
      }
    }
    const stop = () => { clearInterval(timer); timer = null; const b = el.querySelector(".rg-play"); if (b) { b.setAttribute("aria-pressed", "false"); b.querySelector("span").textContent = C.t("Play the year"); b.querySelector("svg").outerHTML = C.line("play"); } };
    el.addEventListener("click", (e) => {
      const hit = e.target.closest(".rg-hit"); if (hit) { stop(); show(Number(hit.dataset.i)); }
      if (e.target.closest(".rg-prev")) { stop(); show(sel - 1); }
      if (e.target.closest(".rg-next")) { stop(); show(sel + 1); }
      const yb = e.target.closest(".rg-years [data-y]");
      if (yb) { y = Number(yb.dataset.y); el.querySelectorAll(".rg-years [data-y]").forEach((b) => b.setAttribute("aria-pressed", String(b === yb))); draw(); }
      const pb = e.target.closest(".rg-play");
      if (pb) {
        if (timer) { stop(); return; }
        pb.setAttribute("aria-pressed", "true"); pb.querySelector("span").textContent = C.t("Pause"); pb.querySelector("svg").outerHTML = C.line("pause");
        show(sel + 1);
        timer = setInterval(() => { if (!el.isConnected) { stop(); return; } show(sel + 1); }, 1700);
      }
    });
    el.addEventListener("pointerover", (e) => { const hit = e.target.closest(".rg-hit"); if (hit && !timer && Number(hit.dataset.i) !== sel) show(Number(hit.dataset.i)); });
    el.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); stop(); show(sel + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); stop(); show(sel - 1); } });
    draw();
  }

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
    const diag = r.diagnostico ? `<details><summary>Strengths and weaknesses</summary><ul class="diag-list">${
      r.diagnostico.items.map((i) => `<li class="lvl-${LEVEL[i.nivel][0]}"><span class="lvl">${LEVEL[i.nivel][1]}</span><strong>${esc(i.etiqueta)}</strong> — ${esc(cap(i.por_que))}.${
        i.recomendaciones.length ? `<span class="idea">${icon("bulb")}${i.recomendaciones.map((a) => esc(cap(a))).join(". ")}.</span>` : ""}</li>`).join("")
    }</ul></details>` : "";
    return `<article class="rot card ${r.rol === "actual" ? "current" : ""} ${r === best ? "best" : ""}" data-rev tabindex="0" data-guide="${esc(GUIDE_KEY(r))}" aria-label="${esc(r.nombre)}: open details">
      <div class="rot-head"><span class="badge ${r.rol === "actual" ? "muted" : ""}">${role}</span>${r === best ? `<span class="badge best">${icon("star")}Best score</span>` : ""}
        <button type="button" class="icon-btn rot-zoom" data-zoom aria-label="Open ${esc(r.nombre)} in large view" title="Open in large view">${C.line("expand")}</button></div>
      <h3>${esc(r.nombre)}</h3>
      <p class="desc">${esc(r.descripcion)}</p>
      <div class="total"><div class="gauge md">${C.ring(r.total, r.rol === "actual" ? "--muted" : "--brand", 88, 8)}<span class="gv" data-count="${Math.round(r.total)}">${fmt(r.total)}</span></div><span class="of">/ 100<br>for your priorities</span></div>
      <div class="bars">${bars}</div>
      ${calendarTable(r)}
      ${kpis}
      ${diag}
      <details><summary>Why we suggest it</summary>${list(ex.por_que)}</details>
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
  /* Score profile: a large radar next to an ordered score table (topic × rotation). */
  const PF_COLORS = ["#8f9ca8", "var(--brand)", "#e2a93a"];
  function profileHTML(rots) {
    const keys = Object.keys(C.SCORES);
    const who = (i) => (i === 0 ? C.t("Current") : `${C.t("Alternative")} ${i}`);
    const head = rots.map((r, i) => `<button type="button" class="pf-rot" data-ds="${i}" style="--c:${PF_COLORS[i]}" aria-pressed="true" title="${esc(C.t("Show or hide on the chart"))}">
        <i class="${i === 0 ? "dash" : ""}"></i><small>${esc(who(i))}</small><b>${esc(r.nombre)}</b></button>`).join("");
    const rows = keys.map((k, ki) => {
      const vals = rots.map((r) => r.puntajes[k]), top = Math.max(...vals);
      return `<div class="pf-row" data-k="${ki}" role="row"><span class="pf-topic" role="rowheader">${icon(C.SCORES[k].icon)}<span>${esc(C.t(C.SCORES[k].label).replace(" (indicative)", ""))}</span></span>
        ${rots.map((r, i) => `<span class="pf-cell ${vals[i] === top ? "top" : ""}" role="cell" style="--c:${PF_COLORS[i]}"><b data-count="${vals[i]}">${vals[i]}</b><span class="pf-bar"><em data-w="${vals[i]}"></em></span></span>`).join("")}</div>`;
    }).join("");
    const totals = rots.map((r) => r.total), topT = Math.max(...totals);
    return `<div class="pf-head"><h3>${icon("compare")}Score profile</h3>
        <p class="hint">Each axis is one topic: 0 at the centre, 100 at the edge, with a ring every 25 points. The dashed shape is your current rotation. Point at a topic or a rotation to highlight it.</p></div>
      <div class="pf-body">
        <div class="radar-box pf-radar"><canvas role="img" aria-label="Score profile of the three rotations"></canvas><span class="pf-scale"><b>Rings</b><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></span></div>
        <div class="pf-matrix" role="table" aria-label="Scores by topic" style="--n:${rots.length}">
          <div class="pf-row pf-top" role="row"><span class="pf-topic" role="columnheader">${esc(C.t("Topic"))}</span>${head}</div>
          ${rows}
          <div class="pf-row pf-total" role="row"><span class="pf-topic" role="rowheader">${esc(C.t("Total for your priorities"))}</span>
            ${rots.map((r, i) => `<span class="pf-cell ${totals[i] === topT ? "top" : ""}" role="cell" style="--c:${PF_COLORS[i]}"><strong data-count="${Math.round(r.total)}">${fmt(r.total)}</strong></span>`).join("")}</div>
        </div>
      </div>`;
  }
  function bindProfile(card, ctl) {
    const chart = () => ctl?.chart;
    /* the table follows the chart colours (palette menu) */
    card.querySelector("canvas")?.addEventListener("cooper-chart", (e) => {
      e.detail.data.datasets.forEach((d, i) => {
        const c = Array.isArray(d.borderColor) ? d.borderColor[0] : d.borderColor;
        card.querySelectorAll(`.pf-rot[data-ds="${i}"], .pf-row > .pf-cell:nth-child(${i + 2})`).forEach((el) => el.style.setProperty("--c", c));
      });
    });
    card.addEventListener("pointerover", (e) => {
      const row = e.target.closest(".pf-row[data-k]"), ch = chart();
      if (!row || !ch) return;
      const k = Number(row.dataset.k);
      card.querySelectorAll(".pf-row[data-k]").forEach((r) => r.classList.toggle("hl", r === row));
      const els = ch.data.datasets.map((_, d) => ({ datasetIndex: d, index: k })).filter((x) => ch.isDatasetVisible(x.datasetIndex));
      ch.$spot = k;
      ch.setActiveElements(els);
      ch.update("none");
    });
    card.querySelector(".pf-matrix")?.addEventListener("pointerleave", () => {
      const ch = chart();
      card.querySelectorAll(".pf-row.hl").forEach((r) => r.classList.remove("hl"));
      if (!ch) return;
      ch.$spot = null;
      ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 });
      ch.update("none");
    });
    card.addEventListener("click", (e) => {
      const b = e.target.closest(".pf-rot"), ch = chart();
      if (!b || !ch) return;
      const d = Number(b.dataset.ds), on = !ch.isDatasetVisible(d);
      ch.setDatasetVisibility(d, on);
      b.setAttribute("aria-pressed", String(on));
      card.querySelectorAll(`.pf-cell:nth-child(${d + 2})`).forEach((c) => c.classList.toggle("off", !on));
      ch.update();
    });
  }

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
        <div class="card-head"><div class="ch-title"><span class="chip-ic big">${icon("weather")}</span><div><h2>Your area in numbers</h2>
          <p class="sub">${esc(m.fuente)} · ${esc(m.periodo)} · ${esc(m.resolucion)} grid cell${m.elevacion_m != null ? ` · elevation ${fmt(m.elevacion_m)} m` : ""}</p></div></div>
          <button type="button" class="ask-jarvis" data-ask-jarvis="When do my crops run short of water during the year?">${icon("help")}<span>Ask Cooper</span></button></div>
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
        <p class="hint">Hover a month to compare every risk; click a row to focus it. Colour intensity compares months within a row, not different risks.</p>
        <div class="scroll-x risk-wrap">${riskTable(data.clima.mensual)}</div>
        <div class="risk-detail" aria-live="polite"></div>
        <h3>How is your area changing?</h3>
        <div class="tiles">${trendsHTML(data.clima.tendencias.indicadores)}</div>
      </section>
      ${data.zonas ? `<section class="card zones-card" data-rev>
        <div class="card-head"><div class="ch-title"><span class="chip-ic big">${icon("layers")}</span><div><h2>Zones of your field</h2>
          <p class="sub">${fmt(data.zonas.area_ha)} ha · ${fmt(data.zonas.celda_m)} m grid · NASA SRTM 30 m · R = ${fmt(data.zonas.r_factor)} MJ·mm/ha/h/yr · K = ${data.zonas.k_factor} (typical value, not measured)</p></div></div>
          <div class="btn-row"><button type="button" class="btn soft sm" data-3d-local>${C.line("layers")}<span>View in 3D</span></button><button type="button" class="ask-jarvis" data-ask-jarvis="How can I reduce erosion in my field?">${icon("help")}<span>Ask Cooper</span></button></div></div>
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
        <div class="section-head"><span class="chip-ic big">${icon("rotation")}</span><div><h2>Three rotations side by side</h2>
          <p class="hint">Scores go from 0 to 100. The total weights each score by what matters to you. Months marked ! are critical crop stages. Scroll each crop calendar sideways to see the full year.</p></div></div>
        <div class="card profile-card pf" data-rev>${profileHTML(data.rotaciones)}</div>
        <div class="legend crop-legend">${[...crops.values()].map((c) =>
          `<span><i class="swatch" style="background:${c.color}"></i>${esc(c.nombre)}</span>`).join("")}<span><i class="swatch" style="background:var(--bare)"></i>No crop</span></div>
        <div class="rotations" style="--cal-rows:${Math.max(...data.rotaciones.map((r) => r.calendario.length))}">${data.rotaciones.map((r) => { GUIDES.set(GUIDE_KEY(r), { r, clima: data.clima.mensual, cur: data.rotaciones[0] }); return rotationCard(r, prio, best, labels); }).join("")}</div>
      </section>
      ${data.ranking ? `<section class="card method ranking-card" data-rev><details><summary><div class="card-head"><div class="ch-title"><span class="chip-ic big">${icon("compare")}</span><div><h2>All options for your field</h2>
        <p class="sub">Every rotation in Cooper's library that fits your farm, ordered by the total for your priorities.</p></div></div></div>
        </summary>${rankingTable(data.ranking, currentId)}</details></section>` : ""}
      <section class="card method" data-rev>
        <details><summary><h2>${icon("info")}How it works and where the data comes from</h2></summary>
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
    canvas.dataset.rec = analysis.id || ""; canvas.dataset.view = "monthly";
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
      canvas.dataset.view = state.view;
      if (state.chartCtl) { state.chartCtl.build = buildMain; state.chartCtl.redraw(true); return; }
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
    radarCanvas.dataset.rec = analysis.id || "";
    state.radarCtl = typeof Chart !== "undefined" ? C.charts.lazy(radarCanvas, () => {
      const cfg = C.charts.radar(data.rotaciones.map((r, i) => ({ ...r, labelPrefix: i === 0 ? "Current" : "" })), { big: true });
      cfg.data.datasets.forEach((d, i) => { if (i === 1) { const b = C.cssVar("--brand"); d.borderColor = b; d.pointBackgroundColor = b; d.backgroundColor = C.charts.alpha(b.startsWith("#") ? b : "#2c7350", 0.16); } });
      return cfg;
    }, { key: "profile-radar" }) : null;
    bindProfile($(".profile-card", container), state.radarCtl);

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

    /* risk calendar: hover a month, click a row */
    bindRisk(container, data.clima.mensual);
    $("[data-3d-local]", container)?.addEventListener("click", (e) => {
      const f = C.fields.get(analysis.fieldId) || C.fields.active();
      const layer = { erosion: "erosion", humedad: "humedad", bajos: "bajos", pendiente: "pendiente" }[state.layer] || "erosion";
      window.CooperMap3D?.open({ field: { ...f, lat: input.lat, lon: input.lon, area_ha: input.area_ha }, rec: analysis, layer, rot: state.rot, originEl: $(".zones-map", container) });
    });

    /* entrance */
    C.motion.reveal($$("[data-rev]", container), { stagger: 0.07 });
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

  function bindRisk(container, months) {
    const wrap = $(".risk-wrap", container), detail = $(".risk-detail", container);
    if (!wrap || !detail) return;
    const rows = [["dias_calor", "Hot days", "thermo", 1], ["dias_helada", "Frost-risk days", "climate", 1], ["dias_lluvia_fuerte", "Heavy-rain days", "water", 1], ["deficit", "Water deficit", "soil", 0]];
    const val = (d, k) => (k === "deficit" ? Math.max(0, -d.balance_mm) : d[k]);
    const max = Object.fromEntries(rows.map(([k]) => [k, Math.max(...months.map((d) => val(d, k))) || 1]));
    let pinned = null;
    const show = (mi) => {
      const d = months[mi];
      detail.innerHTML = `<strong>${esc(C.t(d.nombre))}</strong>${rows.map(([k, l, ic, dec]) => `<span class="rd" style="--k:${val(d, k) / max[k]}">${icon(ic)}<em>${esc(C.t(l))}</em><b>${fmt(val(d, k), dec)}${k === "deficit" ? " mm" : ""}</b><i></i></span>`).join("")}`;
      $$("td.cell, thead th", wrap).forEach((c) => c.classList.toggle("col-on", c.cellIndex - 1 === mi));
    };
    const miOf = (t) => { const c = t.closest("td.cell, thead th"); return c && c.cellIndex > 0 ? c.cellIndex - 1 : null; };
    wrap.addEventListener("pointerover", (e) => { const mi = miOf(e.target); if (mi != null) show(mi); });
    wrap.addEventListener("pointerleave", () => { if (pinned != null) show(pinned); });
    wrap.addEventListener("click", (e) => {
      const mi = miOf(e.target);
      if (mi != null) { pinned = mi; show(pinned); }
      const th = e.target.closest('tbody th[scope="row"]');
      if (th) { const tr = th.parentElement, on = !tr.classList.contains("row-focus"); $$("tbody tr", wrap).forEach((r) => r.classList.remove("row-focus")); wrap.classList.toggle("has-focus", on); if (on) tr.classList.add("row-focus"); }
    });
    const now = C.AG_ORDER.indexOf(new Date().getMonth() + 1);
    show(now >= 0 ? now : 0);
    /* cells pop in, month by month, when the table comes into view */
    const g = C.motion.gsap;
    if (!g) return;
    let seen = false;
    new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !seen) { seen = true; g.fromTo($$("td.cell", wrap), { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(2)", stagger: { each: 0.012, grid: [4, 12], from: "start", axis: "x" } }); }
      if (!e.isIntersecting && e.intersectionRatio === 0) seen = false;
    }), { threshold: 0.3 }).observe(wrap);
  }

  C.results = { guideHTML, bindGuide, focusKpis, render, zoneRaster, ZONE_LAYERS, riskTable, rankingTable, erosionOf };
})();
