/* Cooper · Home: greeting and live weather, the overall decision, the narrated explanation,
 * the best option for each topic (cards turn over to show Alternative 1 and 2), the field
 * on the map and what comes next in the rotation. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  /* Only each topic's own indicators, always compared with the current rotation. */
  const METRICS = {
    agua: [
      { key: "deficit_seco_mm", label: "Water deficit in a dry year", unit: "mm", lower: true },
      { key: "uso_agua_mm", label: "Water used by the crops per year", unit: "mm", lower: true },
    ],
    suelo: [
      { key: "erosion_t_ha", alt: "lluvia_suelo_desnudo_mm", label: "Estimated erosion per year", altLabel: "Rain on bare soil per year", unit: "t/ha", altUnit: "mm", lower: true, d: 1 },
      { key: "meses_descubiertos", label: "Months without a crop per year", unit: "months", lower: true, d: 1 },
    ],
    ingreso: [
      { key: "ingreso_anual", label: "Relative income index per year", unit: "pts", lower: false, d: 1 },
      { key: "anios_doble_cultivo", label: "Years with two cash crops", unit: "", lower: false, ratio: "duracion_anios" },
    ],
    forraje: [
      { key: "forraje_anual", label: "Forage index per year", unit: "pts", lower: false, d: 1 },
      { key: "meses_descubiertos", label: "Months without a crop per year", unit: "months", lower: true, d: 1 },
    ],
    clima: [
      { key: "deficit_critico_seco_mm", label: "Dry-year water shortage at critical stages", unit: "mm", lower: true },
      { key: "dias_calor_critico", label: "Hot days at flowering per year", unit: "days", lower: true, d: 1 },
    ],
  };
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
  const bestBy = (ranking, k) => [...ranking].sort((a, b) => b.puntajes[k] - a.puntajes[k] || b.total - a.total);

  function ring(value, colorVar, size = 64, stroke = 7) {
    if (C.ring) return C.ring(value, colorVar, size, stroke);
    const r = size / 2 - stroke / 2 - 1, c = 2 * Math.PI * r;
    return `<svg class="ring-gauge" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="track" style="stroke-width:${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fill" style="stroke:var(${colorVar});stroke-width:${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-ring="${c * (1 - value / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }

  function strip(r, mode) {
    return `<div class="crop-strip ${mode || ""}" aria-hidden="true">${r.calendario[0].map((c, i) => c
      ? `<i style="background:${c.color}" class="${c.critico ? "crit" : ""}" title="${esc(c.nombre)} · ${C.AG_MONTHS[i]}"></i>`
      : `<i class="bare" title="No crop · ${C.AG_MONTHS[i]}"></i>`).join("")}</div>
      <div class="strip-axis" aria-hidden="true"><span>May</span><span>Aug</span><span>Nov</span><span>Feb</span><span>Apr</span></div>`;
  }

  function metricValue(mt, r) {
    const useAlt = mt.alt && r.indicadores[mt.key] == null;
    const key = useAlt ? mt.alt : mt.key, unit = useAlt ? mt.altUnit : mt.unit;
    const v = r.indicadores[key];
    return { key, label: useAlt ? mt.altLabel : mt.label, v, text: mt.ratio ? `${fmt(v)} / ${fmt(r.indicadores[mt.ratio])}` : `${fmt(v, mt.d || 0)}${unit ? " " + unit : ""}` };
  }

  function metricRows(k, opt, current) {
    return METRICS[k].map((mt) => {
      const b = metricValue(mt, opt), c = metricValue(mt, current);
      const max = Math.max(Math.abs(b.v ?? 0), Math.abs(c.v ?? 0), 0.0001);
      const better = b.v == null || c.v == null || b.v === c.v ? "same" : (mt.lower ? b.v < c.v : b.v > c.v) ? "better" : "worse";
      return `<div class="metric ${better}">
        <div class="m-label">${esc(b.label)}</div>
        <div class="m-row"><span class="who">This option</span><span class="m-track"><span class="m-fill" data-w="${Math.round(((b.v ?? 0) / max) * 100)}"></span></span><strong>${b.text}</strong></div>
        ${opt.id === current.id ? "" : `<div class="m-row now"><span class="who">Today</span><span class="m-track"><span class="m-fill" data-w="${Math.round(((c.v ?? 0) / max) * 100)}"></span></span><span>${c.text}</span></div>`}
      </div>`;
    }).join("");
  }

  const delta = (k, opt, current) => {
    if (opt.id === current.id) return `<span class="delta same">Your current rotation</span>`;
    const d = opt.puntajes[k] - current.puntajes[k];
    return `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : "same"}">${d > 0 ? "+" : ""}${d} vs today (${current.puntajes[k]})</span>`;
  };

  function altBlock(k, opt, current, n) {
    const meta = C.SCORES[k];
    const lines = METRICS[k].map((mt) => {
      const b = metricValue(mt, opt), c = metricValue(mt, current);
      const better = b.v == null || c.v == null || b.v === c.v ? "" : (mt.lower ? b.v < c.v : b.v > c.v) ? "better" : "worse";
      return `<li class="${better}"><span>${esc(b.label)}</span><strong>${b.text}${opt.id === current.id ? "" : `<em>today ${c.text}</em>`}</strong></li>`;
    }).join("");
    return `<div class="alt">
      <div class="alt-head"><span class="alt-tag">Alternative ${n}</span></div>
      <div class="alt-score">
        <div class="gauge sm">${ring(opt.puntajes[k], meta.color, 48, 6)}<span class="gv">${opt.puntajes[k]}</span></div>
        <div class="opt-name"><strong>${esc(opt.nombre)}</strong>${delta(k, opt, current)}</div>
      </div>
      <ul class="alt-lines">${lines}</ul>
    </div>`;
  }

  function optionCard(k, ranking, current, livestock) {
    const meta = C.SCORES[k];
    const sorted = bestBy(ranking, k);
    const best = sorted[0], alts = sorted.slice(1, 3);
    const p = best.perfil?.[k];
    const idea = p && p.nivel !== "fuerte" && p.recomendaciones?.length ? p.recomendaciones[0] : null;
    return `<article class="opt-card" data-score="${k}" style="--c:var(${meta.color})" data-rev tabindex="0" aria-label="${esc(meta.label)}: open details">
      <div class="opt-inner">
        <div class="opt-face front">
          <header class="opt-head"><span class="chip-ic big">${icon(meta.icon)}</span>
            <div><small>Best option in</small><h3>${esc(meta.label)}</h3></div></header>
          <div class="opt-score">
            <div class="gauge">${ring(best.puntajes[k], meta.color)}<span class="gv" data-count="${best.puntajes[k]}">${best.puntajes[k]}</span></div>
            <div class="opt-name"><strong>${esc(best.nombre)}</strong>${delta(k, best, current)}</div>
          </div>
          ${strip(best, k === "suelo" ? "show-bare" : k === "clima" ? "show-crit" : "")}
          <div class="metrics">${metricRows(k, best, current)}</div>
          ${p ? `<p class="why">${icon("info")}<span>${esc(cap(p.por_que))}.</span></p>` : ""}
          ${idea ? `<p class="idea">${icon("bulb")}<span>${esc(cap(idea))}.</span></p>` : ""}
          ${k === "forraje" && !livestock ? `<p class="note">${icon("alert")}<span>No livestock: pasture and forage rotations are not suggested.</span></p>` : ""}
          <div class="opt-foot">${askBtn(ASK[k])}<button type="button" class="opt-zoom icon-btn" aria-label="Open ${esc(meta.label)} in large view" title="Open in large view">${C.line("expand")}</button></div>
          <button type="button" class="btn soft more-btn" ${alts.length ? "" : "disabled"} aria-label="See more options for ${esc(meta.label)}">
            <span>${alts.length ? "See more options" : "No other options"}</span>${icon("right")}</button>
        </div>
        <div class="opt-face back" aria-hidden="true">
          <header class="opt-head"><span class="chip-ic big">${icon(meta.icon)}</span>
            <div><small>More options in</small><h3>${esc(meta.label)}</h3></div></header>
          <div class="alts">${alts.map((a, i) => altBlock(k, a, current, i + 1)).join("")}</div>
          <button type="button" class="btn soft less-btn" tabindex="-1">${icon("right", "flip-x")}<span>Back to the best option</span></button>
        </div>
      </div>
    </article>`;
  }

  const ASK = {
    agua: "Which option saves the most water, and why?",
    suelo: "How can I reduce erosion and improve soil health in my field?",
    ingreso: "Which option has the best income and what does it depend on?",
    forraje: "Which option gives the most forage for my livestock?",
    clima: "Which option has the best climate resilience to heat and frost?",
    overall: "Explain my best option and how it compares with my current rotation.",
  };
  C.ASK = ASK;
  const askBtn = (q, label = "Ask Jarvis") => `<button type="button" class="ask-jarvis" data-ask-jarvis="${esc(q)}">${icon("help")}<span>${esc(label)}</span></button>`;

  function overallCard(ranking, current, prio) {
    const best = ranking[0];
    const same = best.id === current.id;
    return `<section class="card overall" data-rev>
      <svg class="ov-border" aria-hidden="true"><rect class="ob-base"/><rect class="ob-run a"/><rect class="ob-run b"/></svg>
      <div class="card-head">
        <div class="ov-title"><span class="chip-ic big brand">${icon("overall")}</span>
          <div><small>Overall analysis</small><h2>${same ? "Your current rotation is the best fit" : "Best overall option for your priorities"}</h2></div></div>
      </div>
      <div class="ov-hero">
        <div class="ov-ring">${C.ring(best.total, "--brand", 168, 13, "big")}
          <div class="ov-ring-in"><span class="big" data-count="${Math.round(best.total)}">${fmt(best.total)}</span><span class="of">/ 100</span><small>for your priorities</small></div></div>
        <div class="ov-best">
          <strong class="ov-name">${esc(best.nombre)}</strong>
          <p class="ov-desc">${esc(best.descripcion)}</p>
          ${same ? "" : `<p class="ov-vs">Your current rotation, <strong>${esc(current.nombre)}</strong>, scores <strong>${fmt(current.total)}</strong>.</p>`}
        </div>
      </div>
      ${strip(best)}
      <div class="ov-chart">
        <div class="ov-radar"><canvas role="img" aria-label="Score profile: best option compared with your current rotation"></canvas></div>
        <div class="legend ov-legend"><span><i class="swatch" style="background:var(--brand)"></i>Best option</span>${same ? "" : `<span><i class="swatch" style="background:#9aa6a0"></i>Your current rotation</span>`}</div>
      </div>
      <div class="ov-scores">
        ${Object.entries(C.SCORES).map(([k, s]) => {
          const v = best.puntajes[k], d = v - current.puntajes[k];
          return `<div class="ov-score" style="--c:var(${s.color})" data-k="${k}">
            <span class="chip-ic">${icon(s.icon)}</span>
            <div class="ov-s-main"><div class="ov-s-top"><span>${esc(s.label)}</span>
              <span class="ov-s-val"><strong data-count="${v}">${v}</strong>${same ? "" : `<em class="delta ${d > 0 ? "up" : d < 0 ? "down" : "same"}">${d > 0 ? "+" : ""}${d}</em>`}</span></div>
              <span class="m-track"><span class="m-fill" data-w="${v}"></span></span>
              <small class="imp">Importance ${prio[k]}/5</small></div>
          </div>`;
        }).join("")}
      </div>
      <div class="ov-actions">
        <button type="button" class="btn primary sm" data-act="open-analysis">${icon("analysis")}<span>Open full analysis</span></button>
        ${askBtn(ASK.overall)}
      </div>
    </section>`;
  }

  /* Large, ordered view of one topic: best option and the two alternatives side by side. */
  let last = null;
  function focusHTML(k) {
    if (!last) return null;
    const { ranking, current } = last;
    const meta = C.SCORES[k];
    const sorted = bestBy(ranking, k).slice(0, 3);
    const col = (r, n) => {
      const p = r.perfil?.[k];
      const idea = p && p.nivel !== "fuerte" && p.recomendaciones?.length ? p.recomendaciones[0] : null;
      return `<article class="fz-col ${n === 0 ? "best" : ""}">
        <span class="alt-tag">${n === 0 ? "Best option" : `Alternative ${n}`}</span>
        <div class="opt-score"><div class="gauge">${C.ring(r.puntajes[k], meta.color, 92, 9)}<span class="gv" data-count="${r.puntajes[k]}">${r.puntajes[k]}</span></div>
          <div class="opt-name"><strong>${esc(r.nombre)}</strong>${delta(k, r, current)}</div></div>
        ${strip(r, k === "suelo" ? "show-bare" : k === "clima" ? "show-crit" : "")}
        <div class="metrics">${metricRows(k, r, current)}</div>
        ${p ? `<p class="why">${icon("info")}<span>${esc(cap(p.por_que))}.</span></p>` : ""}
        ${idea ? `<p class="idea">${icon("bulb")}<span>${esc(cap(idea))}.</span></p>` : ""}
      </article>`;
    };
    return `<header class="fz-head"><span class="chip-ic big">${icon(meta.icon)}</span><div><small>Your best options in</small><h2>${esc(meta.label)}</h2>
        <p class="sub">Compared with your current rotation, ${esc(current.nombre)} (${current.puntajes[k]} points).</p></div>${askBtn(ASK[k])}</header>
      <div class="fz-cols">${sorted.map(col).join("")}</div>`;
  }

  /* Next sowing, critical stage and harvest in the current rotation (year 1), from this month. */
  function upcoming(current) {
    const startIdx = C.AG_ORDER.indexOf(new Date().getMonth() + 1);
    const year = current.calendario[0];
    const out = [], seen = new Set();
    for (let s = 0; s < 12 && out.length < 4; s++) {
      const i = (startIdx + s) % 12, prev = (i + 11) % 12, next = (i + 1) % 12;
      const c = year[i];
      if (c && (!year[prev] || year[prev].id !== c.id) && !seen.has("s" + c.id)) { out.push({ t: "Sowing", c, i, kind: "sowing" }); seen.add("s" + c.id); }
      if (c && c.critico && !(year[prev]?.critico && year[prev].id === c.id) && !seen.has("k" + c.id)) { out.push({ t: "Critical stage", c, i, kind: "critical" }); seen.add("k" + c.id); }
      if (c && (!year[next] || year[next].id !== c.id) && !seen.has("h" + c.id)) { out.push({ t: "Harvest or end of cycle", c, i, kind: "harvest" }); seen.add("h" + c.id); }
    }
    return out.slice(0, 4);
  }

  function eventsCard() {
    return `<section class="card events" data-rev>
      <div class="card-head"><div class="ch-title"><span class="chip-ic big">${icon("calendar")}</span>
        <div><h2>Coming up in your rotation</h2><p class="sub cal-sub"></p></div></div></div>
      <div class="cal-host"></div>
    </section>`;
  }

  function mapCard(field) {
    return `<section class="card map-card" data-rev>
      <div class="card-head"><div class="ch-title"><span class="chip-ic big">${icon("map")}</span>
        <div><h2>Your field on the map</h2><p class="sub">${fmt(field.area_ha)} ha · ${field.lat.toFixed(3)}, ${field.lon.toFixed(3)}</p></div></div>
        <div class="btn-row"><button type="button" class="btn soft sm" data-3d="satellite">${C.line("layers")}<span>View in 3D</span></button>
        <button type="button" class="btn soft sm" data-go="field">${icon("field")}<span>My field</span></button></div></div>
      <div class="mini-map"></div>
    </section>`;
  }

  function explainCard(rec) {
    const chapters = ["Introduction", "Climate", "How it changed", "Your rotation today", "Strengths and weaknesses", "A better option", "What to check", "Closing"];
    return `<section class="card explain" data-rev>
      <div class="ex-poster" data-player-anchor>
        <div class="ex-relief" aria-hidden="true"></div>
        <button type="button" class="ex-play" aria-label="Play the explanation of your analysis">${icon("play")}</button>
        <span class="ex-badge">${icon("volume")}Narrated · 8 chapters</span>
      </div>
      <div class="ex-info">
        <small>Explain it simply</small>
        <h2>Your analysis, explained</h2>
        <p>A narrated summary of this whole analysis over a 3D model of your field: climate, how it changed, your rotation today, its strengths and weaknesses, a better option and what to check with your agronomist.</p>
        <ol class="chapters">${chapters.map((c, i) => `<li><button type="button" data-chapter="${i}"><span>${String(i + 1).padStart(2, "0")}</span>${esc(c)}</button></li>`).join("")}</ol>
        <p class="hint">${esc(rec.context?.field || "")} · ${esc(C.dateLabel(rec.fecha))}. Keeps playing while you use the rest of the app.</p>
      </div>
    </section>`;
  }

  function topGrid(field, rec, ranking, current) {
    if (!rec) return `<div class="home-top empty">
      <section class="card hero-empty" data-rev>
        <div class="he-art" aria-hidden="true"></div>
        <div class="he-text"><small>Start here</small><h2>Run the first analysis for this field</h2>
          <p>Cooper downloads 30 years of NASA climate data and the terrain of your field, then compares every rotation in its library with the one you use today.</p>
          <button type="button" class="btn primary lg" data-go="analysis">${icon("analysis")}<span>New analysis</span></button></div>
      </section>
      ${C.wx.card(field)}
    </div>`;
    return `<div class="home-top">
      ${overallCard(ranking, current, rec.input.prioridades)}
      ${C.wx.card(field)}
      ${explainCard(rec)}
    </div>`;
  }

  let ctl = { map: null, relief: null, radar: null, cal: null, tour: 0, ro: null };
  function destroy() {
    ctl.map?.remove(); ctl.relief?.destroy?.(); ctl.radar?.destroy(); ctl.cal?.destroy(); clearInterval(ctl.tour); ctl.ro?.disconnect();
    ctl = { map: null, relief: null, radar: null, cal: null, tour: 0, ro: null };
  }

  function flip(card, toBack) {
    const inner = $(".opt-inner", card), front = $(".front", card), back = $(".back", card);
    card.classList.toggle("flipped", toBack);
    front.setAttribute("aria-hidden", String(toBack)); back.setAttribute("aria-hidden", String(!toBack));
    $$("button", front).forEach((b) => { b.tabIndex = toBack ? -1 : 0; });
    $$("button", back).forEach((b) => { b.tabIndex = toBack ? 0 : -1; });
    const g = C.motion.gsap;
    if (g) {
      card.classList.add("flipping");
      g.set(card, { rotationX: 0, rotationY: 0, y: 0 });
      g.to(inner, { rotationY: toBack ? 180 : 0, duration: 0.9, ease: "expo.inOut", onComplete: () => card.classList.remove("flipping") });
      g.fromTo(card, { scale: 1 }, { scale: 1.03, duration: 0.45, yoyo: true, repeat: 1, ease: "power2.inOut" });
      if (toBack) { $$("[data-ring]", back).forEach((c) => g.fromTo(c, { attr: { "stroke-dashoffset": c.getAttribute("stroke-dasharray") } }, { attr: { "stroke-dashoffset": c.dataset.ring }, duration: 1.2, ease: "expo.out", delay: 0.35 })); }
    } else {
      inner.style.transform = toBack ? "rotateY(180deg)" : "";
      if (toBack) { $$("[data-ring]", back).forEach((c) => c.setAttribute("stroke-dashoffset", c.dataset.ring)); }
    }
    setTimeout(() => (toBack ? $(".less-btn", back) : $(".more-btn", front))?.focus({ preventScroll: true }), 450);
  }

  async function render(root, { field, rec, catalog }) {
    destroy();
    if (!rec) {
      last = null;
      root.innerHTML = `${topGrid(field, null)}
        <div class="home-bottom">${eventsCard()}${mapCard(field)}</div>`;
    } else {
      const data = rec.result;
      const ranking = data.ranking || data.rotaciones;
      const current = data.rotaciones[0];
      const currentRanked = ranking.find((r) => r.id === current.id) || current;
      last = { ranking, current: currentRanked, rec };
      root.innerHTML = `
        ${data.escenario?.activo ? `<div class="notice info" data-rev>${icon("simulation")}<span>What-if simulation: rainfall ${data.escenario.lluvia_pct > 0 ? "+" : ""}${data.escenario.lluvia_pct}%, temperature +${data.escenario.temp_delta} °C. This is not a forecast.</span></div>` : ""}
        ${rec.saved ? "" : `<div class="notice subtle" data-rev>${icon("reports")}<span>This analysis is not saved in your history yet.</span><button type="button" class="link" data-act="save-current">Save analysis</button></div>`}
        ${topGrid(field, rec, ranking, currentRanked)}
        <div class="section-head" data-rev><span class="chip-ic big">${icon("star")}</span><div><h2>Your best options</h2>
          <p class="hint">The best rotation for each topic on its own. Click a card to see it large, or turn it with “See more options” to see Alternative 1 and Alternative 2.</p></div></div>
        <div class="options">${Object.keys(C.SCORES).map((k) => optionCard(k, ranking, currentRanked, rec.input.tiene_ganado)).join("")}</div>
        <div class="home-bottom">${eventsCard()}${mapCard(field)}</div>`;
    }

    C.on(root, "click", ".more-btn", (e, b) => flip(b.closest(".opt-card"), true));
    C.on(root, "click", ".less-btn", (e, b) => flip(b.closest(".opt-card"), false));
    C.on(root, "click", ".opt-zoom", (e, b) => { const card = b.closest(".opt-card"); C.fx.openFocus && card && card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });

    C.motion.reveal($$("[data-rev]", root), { stagger: 0.06 });

    /* overall: light running along the border */
    const ov = $(".overall", root);
    if (ov) {
      const svgB = $(".ov-border", ov);
      const size = () => {
        const w = ov.offsetWidth, h = ov.offsetHeight;
        svgB.setAttribute("viewBox", `0 0 ${w} ${h}`);
        $$("rect", svgB).forEach((r) => { r.setAttribute("x", 1.5); r.setAttribute("y", 1.5); r.setAttribute("width", Math.max(0, w - 3)); r.setAttribute("height", Math.max(0, h - 3)); r.setAttribute("rx", 26); r.setAttribute("pathLength", 1000); });
      };
      size();
      ctl.ro = new ResizeObserver(size); ctl.ro.observe(ov);
    }

    /* calendar */
    const ch = $(".cal-host", root);
    if (ch) {
      ctl.cal = C.calendar.render(ch, rec);
      const sub = $(".cal-sub", root);
      if (sub) sub.textContent = rec ? `${C.t(rec.result.rotaciones[0].nombre)} · ${C.t("farming year, May to April")}` : C.t("Run an analysis to see your calendar");
    }

    /* radar */
    const rc = $(".ov-radar canvas", root);
    if (rc && rec && C.charts) {
      const ranking = rec.result.ranking || rec.result.rotaciones;
      const cur = ranking.find((r) => r.id === rec.result.rotaciones[0].id) || rec.result.rotaciones[0];
      const list = ranking[0].id === cur.id ? [ranking[0]] : [cur, ranking[0]];
      ctl.radar = C.charts.lazy(rc, () => {
        const cfg = C.charts.radar(list.map((r, i) => ({ ...r, labelPrefix: list.length > 1 && i === 0 ? "Current" : "" })), { compact: true });
        const bestD = cfg.data.datasets[list.length - 1];
        bestD.borderColor = C.cssVar("--brand"); bestD.pointBackgroundColor = bestD.borderColor; bestD.borderDash = []; bestD.borderWidth = 3;
        bestD.backgroundColor = C.charts.alpha(C.cssVar("--brand").startsWith("#") ? C.cssVar("--brand") : "#2c7350", 0.2);
        if (list.length > 1) { const d = cfg.data.datasets[0]; d.borderColor = "#9aa6a0"; d.pointBackgroundColor = "#9aa6a0"; d.backgroundColor = "rgba(154,166,160,.10)"; }
        return cfg;
      }, { key: "home-radar" });
      /* a slow guided tour over the five scores until the farmer takes over */
      let k = 0, paused = false;
      rc.addEventListener("pointerenter", () => { paused = true; });
      rc.addEventListener("pointerleave", () => { paused = false; });
      ctl.tour = setInterval(() => {
        const ch2 = ctl.radar?.chart;
        if (!ch2 || paused || document.hidden || C.reducedMotion()) return;
        const di = ch2.data.datasets.length - 1;
        const els = [{ datasetIndex: di, index: k % 5 }];
        ch2.setActiveElements(els);
        ch2.tooltip.setActiveElements(els, { x: 0, y: 0 });
        ch2.update();
        $$(".ov-score", root).forEach((el, i) => el.classList.toggle("tour", i === k % 5));
        k++;
      }, 2600);
    }

    /* mini map */
    const mm = $(".mini-map", root);
    if (mm && typeof L !== "undefined") {
      const b = C.fieldBounds(field.lat, field.lon, field.area_ha);
      ctl.map = L.map(mm, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
      C.baseLayers().Satellite.addTo(ctl.map);
      const z = rec?.result?.zonas;
      if (z) L.imageOverlay(C.results.zoneRaster(z, "erosion", rec.result.rotaciones[0].id, 180).toDataURL(), z.bounds, { opacity: 0.75 }).addTo(ctl.map);
      L.rectangle(b, { color: "#ffffff", weight: 2, fill: false }).addTo(ctl.map);
      ctl.map.fitBounds(b, { padding: [26, 26] });
      setTimeout(() => ctl.map?.invalidateSize(), 400);
    } else if (mm) mm.innerHTML = `<p class="hint pad">The map could not load.</p>`;

    /* 3D relief behind the play button */
    const reliefEl = $(".ex-relief", root);
    if (reliefEl && rec?.result?.zonas) {
      const mount = () => { if (reliefEl.isConnected && !ctl.relief) ctl.relief = window.CooperRelief.mount(reliefEl, reliefData(rec.result), { spin: true }); };
      if (window.CooperRelief) mount(); else C.listen("relief-ready", mount);
    } else if (reliefEl) reliefEl.classList.add("flat");

    /* weather */
    C.weather.get(field).then((w) => C.wx.fillCard(root, field, w)).catch(() => C.wx.fillCard(root, field, null));
  }

  function reliefData(result) {
    const z = result.zonas;
    const cur = result.rotaciones[0].id;
    return {
      n: Math.round(Math.sqrt(z.celdas.length)),
      elev: z.celdas.map((c) => c.elev),
      eros: z.celdas.map((c, i) => C.results.erosionOf(z, c, i, cur)),
      tol: z.tolerancia_t_ha,
      calendario: result.rotaciones[0].calendario[0],
    };
  }
  C.reliefData = reliefData;
  C.listen("scene", () => { $$(".wx-card-bg").forEach((el) => { el.style.backgroundImage = `url('${C.scene.SCENES[C.scene.current].sm}')`; }); });

  C.home = { render, destroy, upcoming, bestBy, focusHTML };
})();
