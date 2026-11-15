/* Cooper · Home ("Inicio"): decision cards first, then the narrated explanation. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  /* What each characteristic shows: only its own indicators, compared with the current rotation. */
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
      { key: "dias_calor_critico", label: "Hot days at flowering per year", unit: "days", lower: true, d: 1, extra: "dias_helada_critico" },
    ],
  };
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

  function bestBy(ranking, k) {
    return [...ranking].sort((a, b) => b.puntajes[k] - a.puntajes[k] || b.total - a.total);
  }

  function ring(value, colorVar, size = 64) {
    const r = size / 2 - 5, c = 2 * Math.PI * r;
    return `<svg class="ring-gauge" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="track"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fill" style="stroke:var(${colorVar})"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-ring="${c * (1 - value / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }

  function strip(r, mode) {
    const year = r.calendario[0];
    return `<div class="crop-strip ${mode || ""}" aria-hidden="true">${year.map((c, i) => c
      ? `<i style="background:${c.color}" class="${c.critico ? "crit" : ""}" title="${esc(c.nombre)} · ${C.AG_MONTHS[i]}"></i>`
      : `<i class="bare" title="No crop · ${C.AG_MONTHS[i]}"></i>`).join("")}</div>
      <div class="strip-axis" aria-hidden="true"><span>May</span><span>Aug</span><span>Nov</span><span>Feb</span><span>Apr</span></div>`;
  }

  function metricRows(k, best, current) {
    return METRICS[k].map((mt) => {
      const useAlt = mt.alt && best.indicadores[mt.key] == null;
      const key = useAlt ? mt.alt : mt.key;
      const label = useAlt ? mt.altLabel : mt.label;
      const unit = useAlt ? mt.altUnit : mt.unit;
      const b = best.indicadores[key], c = current.indicadores[key];
      const fmtV = (v, r) => mt.ratio ? `${fmt(v)} / ${fmt(r.indicadores[mt.ratio])}` : `${fmt(v, mt.d || 0)}${unit ? " " + unit : ""}`;
      const max = Math.max(Math.abs(b ?? 0), Math.abs(c ?? 0), 0.0001);
      const better = b == null || c == null || b === c ? "same" : (mt.lower ? b < c : b > c) ? "better" : "worse";
      const extra = mt.extra ? ` <small>· frost ${fmt(best.indicadores[mt.extra], 1)}</small>` : "";
      return `<div class="metric ${better}">
        <div class="m-label">${esc(label)}</div>
        <div class="m-bars">
          <div class="m-row"><span class="who">This option</span><span class="m-track"><span class="m-fill" data-w="${Math.round(((b ?? 0) / max) * 100)}"></span></span><strong>${fmtV(b, best)}${extra}</strong></div>
          ${best.id === current.id ? "" : `<div class="m-row now"><span class="who">Today</span><span class="m-track"><span class="m-fill" data-w="${Math.round(((c ?? 0) / max) * 100)}"></span></span><span>${fmtV(c, current)}</span></div>`}
        </div>
      </div>`;
    }).join("");
  }

  function optionCard(k, ranking, current, livestock) {
    const meta = C.SCORES[k];
    const sorted = bestBy(ranking, k);
    const best = sorted[0], more = sorted.slice(1, 3);
    const delta = best.puntajes[k] - current.puntajes[k];
    const p = best.perfil?.[k];
    const isCurrent = best.id === current.id;
    const idea = p && p.nivel !== "fuerte" && p.recomendaciones?.length ? p.recomendaciones[0] : null;
    return `<article class="card opt" data-score="${k}" style="--c:var(${meta.color})" data-rev>
      <header class="opt-head">
        <span class="chip-ic">${icon(meta.icon)}</span>
        <div><small>Best option in</small><h3>${esc(meta.label)}</h3></div>
      </header>
      <div class="opt-score">
        <div class="gauge">${ring(best.puntajes[k], meta.color)}<span class="gv" data-count="${best.puntajes[k]}">${best.puntajes[k]}</span></div>
        <div class="opt-name">
          <strong>${esc(best.nombre)}</strong>
          ${isCurrent ? `<span class="delta same">Your current rotation</span>` : `<span class="delta ${delta > 0 ? "up" : delta < 0 ? "down" : "same"}">${delta > 0 ? "+" : ""}${delta} vs today (${current.puntajes[k]})</span>`}
        </div>
      </div>
      ${strip(best, k === "suelo" ? "show-bare" : k === "clima" ? "show-crit" : "")}
      <div class="metrics">${metricRows(k, best, current)}</div>
      ${p ? `<p class="why">${icon("info")}<span>${esc(cap(p.por_que))}.</span></p>` : ""}
      ${idea ? `<p class="idea">${icon("bulb")}<span>${esc(cap(idea))}.</span></p>` : ""}
      ${k === "forraje" && !livestock ? `<p class="note">${icon("alert")}<span>You said you have no livestock, so pasture and forage rotations are not suggested.</span></p>` : ""}
      <div class="more" hidden>
        ${more.map((r, i) => `<div class="more-row">
          <span class="rank">${i + 2}</span>
          <div class="more-main"><span class="more-name">${esc(r.nombre)}${r.id === current.id ? ` <em class="badge muted">Current</em>` : ""}</span>
            <span class="m-track"><span class="m-fill" style="width:${r.puntajes[k]}%"></span></span></div>
          <strong class="more-score">${r.puntajes[k]}</strong>
        </div>`).join("") || `<p class="hint">No other options for your farm.</p>`}
      </div>
      <button type="button" class="btn soft more-btn" aria-expanded="false" ${more.length ? "" : "disabled"}>
        <span>See more options</span>${icon("chevron")}</button>
    </article>`;
  }

  function overallCard(ranking, current, prio) {
    const best = ranking[0];
    const same = best.id === current.id;
    return `<section class="card overall" data-rev>
      <div class="overall-head">
        <div class="ov-title"><span class="chip-ic brand">${icon("overall")}</span>
          <div><small>Overall analysis</small><h2>${same ? "Your current rotation is the best fit" : "Best overall option for your priorities"}</h2></div></div>
        <button type="button" class="btn soft sm" data-go="analysis">${icon("analysis")}<span>Open full analysis</span></button>
      </div>
      <div class="ov-body">
        <div class="ov-best">
          <div class="ov-total"><span class="big" data-count="${best.total}">${fmt(best.total)}</span><span>/ 100<br><small>for your priorities</small></span></div>
          <strong class="ov-name">${esc(best.nombre)}</strong>
          <p class="ov-desc">${esc(best.descripcion)}</p>
          ${same ? "" : `<p class="ov-vs">Your current rotation, <strong>${esc(current.nombre)}</strong>, scores <strong>${fmt(current.total)}</strong>.</p>`}
          ${strip(best)}
        </div>
        <div class="ov-chart">
          <div class="ov-radar"><canvas role="img" aria-label="Score profile: best option compared with your current rotation"></canvas></div>
          <div class="legend ov-legend"><span><i class="swatch" style="background:var(--brand)"></i>Best option</span>${same ? "" : `<span><i class="swatch" style="background:var(--muted)"></i>Your current rotation</span>`}</div>
        </div>
        <div class="ov-scores">
          ${Object.entries(C.SCORES).map(([k, s]) => {
            const v = best.puntajes[k], d = v - current.puntajes[k];
            return `<div class="ov-score" style="--c:var(${s.color})">
              <span class="chip-ic sm">${icon(s.icon)}</span>
              <div class="ov-s-main"><div class="ov-s-top"><span>${esc(s.label)}</span>
                <span class="ov-s-val"><strong data-count="${v}">${v}</strong>${same ? "" : `<em class="delta ${d > 0 ? "up" : d < 0 ? "down" : "same"}">${d > 0 ? "+" : ""}${d}</em>`}</span></div>
                <span class="m-track"><span class="m-fill" data-w="${v}"></span></span>
                <small class="imp">Importance ${prio[k]}/5</small></div>
            </div>`;
          }).join("")}
        </div>
      </div>
    </section>`;
  }

  /* Upcoming events from the current rotation's calendar (year 1), from this month on. */
  function upcoming(current) {
    const now = new Date();
    const startIdx = C.AG_ORDER.indexOf(now.getMonth() + 1);
    const year = current.calendario[0];
    const out = [];
    const seen = new Set();
    for (let s = 0; s < 12 && out.length < 4; s++) {
      const i = (startIdx + s) % 12, prev = (i + 11) % 12, next = (i + 1) % 12;
      const c = year[i];
      if (c && (!year[prev] || year[prev].id !== c.id) && !seen.has("s" + c.id)) { out.push({ t: "Sowing", c, i, kind: "sow" }); seen.add("s" + c.id); }
      if (c && c.critico && !(year[prev]?.critico && year[prev].id === c.id) && !seen.has("k" + c.id)) { out.push({ t: "Critical stage", c, i, kind: "crit" }); seen.add("k" + c.id); }
      if (c && (!year[next] || year[next].id !== c.id) && !seen.has("h" + c.id)) { out.push({ t: "Harvest or end of cycle", c, i, kind: "end" }); seen.add("h" + c.id); }
    }
    return out.slice(0, 4);
  }

  function eventsCard(current) {
    const ev = upcoming(current);
    return `<section class="card events" data-rev>
      <div class="card-head"><div><h2>${icon("calendar")}Coming up in your rotation</h2>
        <p class="sub">${esc(current.nombre)} · year 1 of the calendar</p></div></div>
      <ol class="timeline">${ev.map((e) => `<li class="${e.kind}"><i></i><div><strong>${esc(e.t)}</strong><span>${esc(e.c.nombre)}</span></div><time>${esc(C.AG_MONTHS[e.i])}</time></li>`).join("") ||
        `<li><div><span>No crop changes in the next months.</span></div></li>`}</ol>
    </section>`;
  }

  function weatherCard() {
    return `<section class="card weather-card" data-rev>
      <div class="card-head"><div><h2>${icon("partly")}Weather at your field</h2><p class="sub wc-sub">Loading forecast…</p></div></div>
      <div class="wc-body"><div class="skeleton" style="height:120px"></div></div>
    </section>`;
  }

  function fillWeather(root, w) {
    const card = $(".weather-card", root);
    if (!card) return;
    if (!w) {
      $(".wc-sub", card).textContent = "Forecast unavailable right now.";
      $(".wc-body", card).innerHTML = `<p class="hint">The weather service did not respond. Your analysis is not affected.</p>`;
      return;
    }
    const a = w.actual;
    $(".wc-sub", card).textContent = `${w.fuente} · ${C.t(a.estado)}`;
    const maxRain = Math.max(5, ...w.diario.map((d) => d.lluvia_mm || 0));
    $(".wc-body", card).innerHTML = `
      <div class="wc-now">${icon(a.icono, "big")}<div><span class="wc-t">${fmt(a.temp, 0)}°</span><span>${esc(C.t(a.estado))}</span></div>
        <ul class="wc-facts"><li>${icon("thermo")}Feels ${fmt(a.sensacion, 0)}°</li><li>${icon("humidity")}${fmt(a.humedad)}%</li><li>${icon("wind")}${fmt(a.viento)} km/h</li></ul></div>
      <div class="wc-days">${w.diario.map((d) => `<div class="wc-day" title="${esc(C.t(d.estado))}">
        <span class="wd">${esc(C.dateLabel(d.fecha + "T12:00", { weekday: "short" }))}</span>${icon(d.icono)}
        <span class="wt"><strong>${fmt(d.tmax, 0)}°</strong> ${fmt(d.tmin, 0)}°</span>
        <span class="wr" style="--h:${Math.round(((d.lluvia_mm || 0) / maxRain) * 100)}%"><i></i></span>
        <span class="wmm">${fmt(d.lluvia_mm, 0)} mm</span></div>`).join("")}</div>
      <p class="hint">Daily evapotranspiration this week: ${fmt(w.diario.reduce((s, d) => s + (d.et0_mm || 0), 0), 0)} mm · rain forecast: ${fmt(w.diario.reduce((s, d) => s + (d.lluvia_mm || 0), 0), 0)} mm.</p>`;
    C.motion.reveal($$(".wc-day", card), { y: 10, stagger: 0.04 });
  }

  function mapCard(field) {
    return `<section class="card map-card" data-rev>
      <div class="card-head"><div><h2>${icon("pin")}Your field on the map</h2><p class="sub">${fmt(field.area_ha)} ha · ${field.lat.toFixed(3)}, ${field.lon.toFixed(3)}</p></div>
        <button type="button" class="btn soft sm" data-go="field">${icon("field")}<span>My field</span></button></div>
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

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 19 ? "Good afternoon" : "Good evening";
  }

  let ctl = { map: null, relief: null, radar: null };
  function destroy() {
    ctl.map?.remove(); ctl.relief?.destroy?.(); ctl.radar?.destroy();
    ctl = { map: null, relief: null, radar: null };
  }

  async function render(root, { field, rec, catalog }) {
    destroy();
    const head = `<div class="page-head" data-rev>
      <div><h1><span class="greet">${esc(greeting())}</span></h1>
        <p class="lead">Smarter decisions for <strong class="notranslate">${esc(field.nombre)}</strong>, with 30 years of NASA data.</p></div>
      <p class="pill-note">${icon("info")}<span>Cooper <strong>helps you think, it doesn't decide</strong>. Review every result with your agronomist.</span></p>
    </div>`;

    if (!rec) {
      root.innerHTML = `${head}
        <section class="card hero-empty" data-rev>
          <div class="he-art" aria-hidden="true"></div>
          <div class="he-text"><small>Start here</small><h2>Run the first analysis for this field</h2>
            <p>Cooper downloads 30 years of NASA climate data and the terrain of your field, then compares every rotation in its library with the one you use today.</p>
            <button type="button" class="btn primary lg" data-go="analysis">${icon("analysis")}<span>New analysis</span></button></div>
        </section>
        <div class="grid-3">${mapCard(field)}${weatherCard()}<section class="card events" data-rev><div class="card-head"><div><h2>${icon("calendar")}Coming up in your rotation</h2></div></div><p class="hint">Run an analysis to see sowing, critical stages and harvest for your rotation.</p></section></div>`;
    } else {
      const data = rec.result;
      const ranking = data.ranking || data.rotaciones;
      const current = data.rotaciones[0];
      const currentRanked = ranking.find((r) => r.id === current.id) || current;
      const prio = rec.input.prioridades;
      root.innerHTML = `${head}
        ${data.escenario?.activo ? `<div class="notice info" data-rev>${icon("info")}<span>What-if simulation: rainfall ${data.escenario.lluvia_pct > 0 ? "+" : ""}${data.escenario.lluvia_pct}%, temperature +${data.escenario.temp_delta} °C. This is not a forecast.</span></div>` : ""}
        ${rec.saved ? "" : `<div class="notice subtle" data-rev>${icon("save")}<span>This analysis is not saved in your history yet.</span><button type="button" class="link" data-act="save-current">Save analysis</button></div>`}
        ${overallCard(ranking, currentRanked, prio)}
        <div class="section-head" data-rev><h2>${icon("star")}Your best options</h2>
          <p class="hint">The best rotation for each topic on its own, with the next two behind “See more options”.</p></div>
        <div class="options">${Object.keys(C.SCORES).map((k) => optionCard(k, ranking, currentRanked, rec.input.tiene_ganado)).join("")}</div>
        ${explainCard(rec)}
        <div class="grid-3">${mapCard(field)}${eventsCard(current)}${weatherCard()}</div>`;
    }

    /* behaviour */
    C.on(root, "click", ".more-btn", (e, b) => {
      const card = b.closest(".opt"), more = $(".more", card);
      const open = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", String(open));
      $("span", b).textContent = C.t(open ? "Hide options" : "See more options");
      const g = C.motion.gsap;
      if (open) {
        more.hidden = false;
        if (g) g.fromTo(more, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.5, ease: "expo.out" });
        if (g) g.fromTo($$(".more-row", more), { x: -10, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.06, duration: 0.4, delay: 0.1 });
      } else if (g) g.to(more, { height: 0, opacity: 0, duration: 0.3, ease: "power2.in", onComplete: () => { more.hidden = true; more.style.height = ""; } });
      else more.hidden = true;
    });

    /* motion */
    C.motion.reveal($$("[data-rev]", root), { stagger: 0.06 });
    C.motion.bars(root);
    $$("[data-count]", root).forEach((el) => C.motion.count(el, Number(el.dataset.count), { decimals: 0 }));
    const g = C.motion.gsap;
    $$("[data-ring]", root).forEach((c) => {
      if (g) g.to(c, { attr: { "stroke-dashoffset": c.dataset.ring }, duration: 1.4, ease: "expo.out", delay: 0.3 });
      else c.setAttribute("stroke-dashoffset", c.dataset.ring);
    });

    /* score profile radar */
    const rc = $(".ov-radar canvas", root);
    if (rc && rec && C.charts) {
      const ranking = rec.result.ranking || rec.result.rotaciones;
      const cur = ranking.find((r) => r.id === rec.result.rotaciones[0].id) || rec.result.rotaciones[0];
      const list = ranking[0].id === cur.id ? [ranking[0]] : [cur, ranking[0]];
      ctl.radar = C.charts.lazy(rc, () => {
        const cfg = C.charts.radar(list.map((r, i) => ({ ...r, labelPrefix: list.length > 1 && i === 0 ? "Current" : "" })), { compact: true });
        if (list.length === 1) { const d = cfg.data.datasets[0]; d.borderColor = C.cssVar("--brand"); d.pointBackgroundColor = d.borderColor; d.borderDash = []; d.backgroundColor = C.charts.alpha(C.cssVar("--brand"), 0.16); }
        return cfg;
      });
    }

    /* mini map */
    const mm = $(".mini-map", root);
    if (mm && typeof L !== "undefined") {
      const b = C.fieldBounds(field.lat, field.lon, field.area_ha);
      ctl.map = L.map(mm, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
      C.baseLayers().Satellite.addTo(ctl.map);
      const z = rec?.result?.zonas;
      if (z) {
        const cur = rec.result.rotaciones[0].id;
        L.imageOverlay(C.results.zoneRaster(z, "erosion", cur, 180).toDataURL(), z.bounds, { opacity: 0.75 }).addTo(ctl.map);
      }
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
    C.weather.get(field).then((w) => fillWeather(root, w)).catch(() => fillWeather(root, null));
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

  C.home = { render, destroy, upcoming, bestBy };
})();
