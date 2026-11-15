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
        <div class="legend ov-legend"><span><i class="swatch" style="background:var(--brand)"></i>Best option</span>${same ? "" : `<span><i class="swatch" style="background:#8f9ca8"></i>Your current rotation</span>`}</div>
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
  /* Large view of ONE option at a time: best option, Alternative 1 or Alternative 2,
     with a switcher that animates from one to the next. */
  function optionPanel(k, r, n, current) {
    const meta = C.SCORES[k], p = r.perfil?.[k];
    const idea = p && p.nivel !== "fuerte" && p.recomendaciones?.length ? p.recomendaciones[0] : null;
    const d = r.puntajes[k] - current.puntajes[k];
    const others = Object.keys(C.SCORES).filter((x) => x !== k);
    return `<article class="fz-one" data-n="${n}">
      <div class="fz-left">
        <span class="alt-tag big">${n === 0 ? "Best option" : `Alternative ${n}`}</span>
        <div class="fz-ring">${C.ring(r.puntajes[k], meta.color, 220, 16, "big")}
          <div class="fz-ring-in"><span class="big" data-count="${r.puntajes[k]}">${r.puntajes[k]}</span><span>/ 100</span><small>${esc(meta.label)}</small></div></div>
        <h3 class="fz-name">${esc(r.nombre)}</h3>
        ${r.id === current.id ? `<span class="delta same">Your current rotation</span>` : `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : "same"} big">${d > 0 ? "+" : ""}${d} ${C.t("points vs today")} (${current.puntajes[k]})</span>`}
        <p class="fz-desc">${esc(r.descripcion || "")}</p>
      </div>
      <div class="fz-right">
        <h4>${C.t("Crop calendar")}</h4>
        ${strip(r, k === "suelo" ? "show-bare" : k === "clima" ? "show-crit" : "")}
        <h4>${C.t("What changes for")} ${esc(meta.label)}</h4>
        <div class="metrics big">${metricRows(k, r, current)}</div>
        ${p ? `<p class="why">${icon("info")}<span>${esc(cap(p.por_que))}.</span></p>` : ""}
        ${idea ? `<p class="idea">${icon("bulb")}<span>${esc(cap(idea))}.</span></p>` : ""}
        <h4>${C.t("Its other scores")}</h4>
        <div class="fz-others">${others.map((o) => `<span style="--c:var(${C.SCORES[o].color})">${icon(C.SCORES[o].icon)}<em>${esc(C.SCORES[o].label)}</em><b data-count="${r.puntajes[o]}">${r.puntajes[o]}</b><i class="m-track"><i class="m-fill" data-w="${r.puntajes[o]}"></i></i></span>`).join("")}</div>
      </div>
    </article>`;
  }
  function focusHTML(k, n = 0) {
    if (!last) return null;
    const { ranking, current } = last;
    const meta = C.SCORES[k];
    const sorted = bestBy(ranking, k).slice(0, 3);
    n = Math.min(n, sorted.length - 1);
    return `<header class="fz-head"><span class="chip-ic big">${icon(meta.icon)}</span><div><small>Your best options in</small><h2>${esc(meta.label)}</h2>
        <p class="sub">Compared with your current rotation, ${esc(current.nombre)} (${current.puntajes[k]} points).</p></div>${askBtn(ASK[k])}</header>
      <nav class="fz-switch" aria-label="Options">
        <button type="button" class="icon-btn fz-prev" aria-label="Previous option">${C.line("right", "flip-x")}</button>
        <div class="seg">${sorted.map((r, i) => `<button type="button" data-n="${i}" aria-pressed="${i === n}">${i === 0 ? "Best option" : `Alternative ${i}`}<small>${r.puntajes[k]}</small></button>`).join("")}</div>
        <button type="button" class="icon-btn fz-next" aria-label="Next option">${C.line("right")}</button>
      </nav>
      <div class="fz-stage" data-k="${k}" data-n="${n}">${optionPanel(k, sorted[n], n, current)}</div>`;
  }
  /* Switch between options inside the large view, one at a time. */
  function bindFocus(body, k) {
    const stage = body.querySelector(".fz-stage");
    if (!stage || !last) return;
    const sorted = bestBy(last.ranking, k).slice(0, 3);
    /* A sliding pill under the option names follows the choice. */
    const seg = body.querySelector(".fz-switch .seg");
    let ink = null;
    if (seg) { ink = document.createElement("span"); ink.className = "fz-ink"; ink.setAttribute("aria-hidden", "true"); seg.prepend(ink); seg.classList.add("has-ink"); }
    const moveInk = (n, animate) => {
      const btn = seg?.querySelector(`[data-n="${n}"]`); if (!btn || !ink) return;
      const to = { x: btn.offsetLeft, width: btn.offsetWidth, height: btn.offsetHeight, y: btn.offsetTop };
      const g = C.motion.gsap;
      if (g && animate) g.to(ink, { ...to, duration: 0.6, ease: "expo.out", overwrite: true }); else if (g) g.set(ink, to);
      else Object.assign(ink.style, { transform: `translate(${to.x}px, ${to.y}px)`, width: to.width + "px", height: to.height + "px" });
    };
    requestAnimationFrame(() => moveInk(Number(stage.dataset.n), false));
    let busy = null;
    /* Real carousel: the current option slides out while the next one slides in beside it,
       both moving together; the stage height morphs between them. */
    const go = (n, dir) => {
      busy?.progress(1);
      const cur = Number(stage.dataset.n);
      n = (n + sorted.length) % sorted.length;
      if (n === cur) return;
      dir = dir || (n > cur ? 1 : -1);
      stage.dataset.n = n;
      body.querySelectorAll(".fz-switch [data-n]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === n)));
      moveInk(n, true);
      const old = stage.firstElementChild;
      stage.insertAdjacentHTML("beforeend", optionPanel(k, sorted[n], n, last.current));
      const nu = stage.lastElementChild;
      const g = C.motion.gsap;
      if (!g) { old.remove(); C.fx.liven(nu); return; }
      const h0 = old.offsetHeight;
      stage.style.height = h0 + "px";
      stage.classList.add("sliding");
      g.set(nu, { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 });
      requestAnimationFrame(() => {
        const h1 = nu.offsetHeight;
        /* The current option steps back and fades where it is; the next one comes in from
           the side it was asked from and settles into place. */
        busy = g.timeline({ onComplete: () => { old.remove(); g.set(nu, { clearProps: "all" }); stage.style.height = ""; stage.classList.remove("sliding"); busy = null; } })
          .to(old, { opacity: 0, scale: 0.96, duration: 0.28, ease: "power2.in" }, 0)
          .fromTo(nu, { x: 140 * dir, opacity: 0, rotationY: 10 * dir, scale: 0.97, transformPerspective: 1400 },
            { x: 0, opacity: 1, rotationY: 0, scale: 1, duration: 0.8, ease: "back.out(1.15)" }, 0.12)
          .to(stage, { height: h1, duration: 0.6, ease: "power3.inOut" }, 0)
          .add(() => C.fx.liven(nu), 0.35);
      });
    };
    body.addEventListener("click", (e) => {
      const b = e.target.closest(".fz-switch [data-n]"); if (b) go(Number(b.dataset.n));
      if (e.target.closest(".fz-prev")) go(Number(stage.dataset.n) - 1, -1);
      if (e.target.closest(".fz-next")) go(Number(stage.dataset.n) + 1, 1);
    });
    body.closest(".focus-wrap")?.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea")) return;
      if (e.key === "ArrowRight") go(Number(stage.dataset.n) + 1, 1);
      if (e.key === "ArrowLeft") go(Number(stage.dataset.n) - 1, -1);
    });
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

  /* Four moments of this analysis, each one a door into its chapter of the explanation. */
  function moments(rec) {
    const r = rec.result, months = r.clima.mensual;
    const thirsty = months.filter((m) => m.et0_mm - m.lluvia_mm > 10);
    const rain = r.clima.tendencias.indicadores.find((t) => t.id === "lluvia_mm");
    const cur = r.rotaciones[0], ranking = r.ranking || r.rotaciones, best = ranking[0];
    const er = cur.indicadores.erosion_t_ha;
    const tol = r.zonas?.tolerancia_t_ha || 7;
    return [
      { ch: 1, ic: "weather", v: `${thirsty.length}`, unit: thirsty.length === 1 ? "month" : "months", l: "with more evaporation than rain", tone: thirsty.length >= 5 ? "warn" : "" },
      { ch: 2, ic: "water", v: rain ? `${rain.cambio_pct > 0 ? "+" : ""}${fmt(rain.cambio_pct)}%` : "–", unit: "", l: "rainfall, 1996–2010 vs 2011–2025", tone: "" },
      { ch: 3, ic: "soil", v: er != null ? fmt(er, 1) : fmt(cur.indicadores.meses_descubiertos, 1), unit: er != null ? "t/ha" : "months", l: er != null ? `erosion a year today · tolerance ${tol}` : "without a crop a year today", tone: er != null && er > tol ? "warn" : "" },
      { ch: 5, ic: "best", v: fmt(best.total), unit: "/100", l: best.id === cur.id ? "your rotation is already the best fit" : `best option: ${best.nombre}`, tone: "good" },
    ];
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
        <div class="ex-title"><div><small>Explain it simply</small><h2>Your analysis, explained</h2></div></div>
        <p>A narrated summary of this whole analysis over a 3D model of your field, in eight short chapters.</p>
        <div class="ex-timeline" role="list" aria-label="Chapters">${chapters.map((c, i) => `<button type="button" role="listitem" data-chapter="${i}" style="--i:${i}"><i></i><span><em>${String(i + 1).padStart(2, "0")}</em>${esc(c)}</span></button>`).join("")}</div>
        <h3 class="ex-sub">Key moments in your explanation</h3>
        <div class="ex-moments">${moments(rec).map((m) => `<button type="button" class="ex-moment ${m.tone}" data-chapter="${m.ch}">
          <span class="exm-ic">${icon(m.ic)}</span>
          <span class="exm-v"><b data-count-text="${esc(m.v)}">${esc(m.v)}</b>${m.unit ? `<small>${esc(m.unit)}</small>` : ""}</span>
          <span class="exm-l">${esc(m.l)}</span>
          <span class="exm-go">${C.line("play")}<em>${esc(C.t(chapters[m.ch]))}</em></span>
        </button>`).join("")}</div>
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
        if (list.length > 1) { const d = cfg.data.datasets[0]; d.borderColor = "#8f9ca8"; d.pointBackgroundColor = "#8f9ca8"; d.backgroundColor = "rgba(154,166,160,.10)"; }
        return cfg;
      }, { key: "home-radar" });
      /* A slow guided pulse over the five scores (no tooltip: that only appears under the
         pointer), synced with the score list; it pauses while the farmer explores. */
      let k = 0, paused = false;
      const clear = () => {
        const ch2 = ctl.radar?.chart; if (!ch2) return;
        ch2.setActiveElements([]); ch2.tooltip.setActiveElements([], { x: 0, y: 0 }); ch2.update("none");
      };
      rc.addEventListener("pointerenter", () => { paused = true; if (ctl.radar?.chart) ctl.radar.chart.$spot = null; });
      rc.addEventListener("pointerleave", () => { paused = false; clear(); });
      const step = () => {
        const ch2 = ctl.radar?.chart;
        if (!ch2 || paused || document.hidden) return;
        ch2.$spot = k % 5;
        $$(".ov-score", root).forEach((el, i) => el.classList.toggle("tour", i === k % 5));
        k++;
      };
      ctl.tour = setInterval(step, 2200);
      $$(".ov-score", root).forEach((el, i) => {
        el.addEventListener("pointerenter", () => { paused = true; const ch2 = ctl.radar?.chart; if (ch2) ch2.$spot = i; $$(".ov-score", root).forEach((o) => o.classList.toggle("tour", o === el)); });
        el.addEventListener("pointerleave", () => { paused = false; });
      });
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

  C.home = { render, destroy, upcoming, bestBy, focusHTML, bindFocus };
})();
