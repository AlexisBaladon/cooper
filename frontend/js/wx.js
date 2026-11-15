/* Cooper · weather. Animated weather drawings (sun rays turn, clouds drift, rain falls,
 * stars twinkle, lightning flashes), the "Weather at your field" card, the matching chip in
 * the top bar, and an expanded view that grows out of the card. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  /* ------------------------------------------------------- animated icons */
  const CLOUD = "M20 46h26a10 10 0 0 0 1.4-19.9A14 14 0 0 0 20.6 22 11 11 0 0 0 20 46Z";
  const sun = (cx = 32, cy = 32, r = 10, small = false) => `
    <g class="wx-sun" transform="translate(${cx} ${cy})">
      <g class="wx-rays">${Array.from({ length: 8 }, (_, i) => `<rect x="-1.6" y="${-r - (small ? 7 : 9)}" width="3.2" height="${small ? 5 : 6.5}" rx="1.6" transform="rotate(${i * 45})"/>`).join("")}</g>
      <circle r="${r}" class="wx-sun-core"/><circle r="${r}" class="wx-sun-shine"/>
    </g>`;
  const moon = (cx = 32, cy = 30, r = 11) => `
    <g class="wx-moon" transform="translate(${cx} ${cy})"><path d="M${r * 0.35} ${-r}A${r} ${r} 0 1 0 ${r} ${r * 0.45} ${r * 0.8} ${r * 0.8} 0 0 1 ${r * 0.35} ${-r}Z"/></g>
    <g class="wx-stars"><path d="M12 14l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/><path d="M50 12l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z"/><circle cx="54" cy="26" r="1.1"/></g>`;
  const cloud = (dx = 0, dy = 0, cls = "") => `<g class="wx-cloud ${cls}" transform="translate(${dx} ${dy})"><path class="wx-cloud-shade" d="${CLOUD}" transform="translate(1.5 2)"/><path class="wx-cloud-body" d="${CLOUD}"/></g>`;
  const drops = (n = 3, small = false) => `<g class="wx-drops">${Array.from({ length: n }, (_, i) => `<path class="wx-drop" style="--i:${i}" d="M${22 + i * 9} ${50}l-${small ? 1.5 : 2.4} ${small ? 4 : 6}a${small ? 1.6 : 2.4} ${small ? 1.6 : 2.4} 0 0 0 ${small ? 3 : 4.8} 0Z"/>`).join("")}</g>`;
  const flakes = () => `<g class="wx-flakes">${[22, 32, 42].map((x, i) => `<g class="wx-flake" style="--i:${i}" transform="translate(${x} 54)"><path d="M0-3v6M-2.6-1.5l5.2 3M-2.6 1.5l5.2-3"/></g>`).join("")}</g>`;

  function svg(kind, isDay = true, opts = {}) {
    const k = kind || "cloudy";
    let body;
    if (k === "clear") body = isDay ? sun(32, 32, 12) : moon();
    else if (k === "partly") body = (isDay ? sun(24, 22, 8.5, true) : `<g transform="translate(-8 -6) scale(.85)">${moon(32, 30, 10)}</g>`) + cloud(4, 6);
    else if (k === "cloudy") body = cloud(-6, -4, "back") + cloud(2, 4);
    else if (k === "fog") body = cloud(0, -6) + `<g class="wx-fog"><rect x="12" y="46" width="34" height="3" rx="1.5"/><rect x="18" y="53" width="30" height="3" rx="1.5"/></g>`;
    else if (k === "drizzle") body = cloud(0, -6) + drops(3, true);
    else if (k === "rain") body = cloud(0, -6) + drops(3);
    else if (k === "storm") body = cloud(0, -8) + `<path class="wx-bolt" d="M33 40l-7 11h6l-3 9 9-13h-6l3-7z"/>` + drops(2, true);
    else if (k === "snow") body = cloud(0, -6) + flakes();
    else body = cloud(0, 0);
    return `<svg class="wx-icon ${opts.cls || ""} ${C.reducedMotion() ? "still" : ""}" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  const day = (iso, style = "short") => C.dateLabel(iso + "T12:00", { weekday: style });
  const hour = (iso) => (iso || "").slice(11, 16);
  const sceneImg = () => (C.scene?.SCENES[C.scene.current || "lindo"] || C.scene.SCENES.lindo).sm;

  /* ------------------------------------------------------------ the card */
  function card(field) {
    return `<section class="card wx-card" data-rev aria-label="Weather at your field">
      <div class="wx-card-bg" style="background-image:url('${sceneImg()}')"></div>
      <div class="wx-card-in">
        <div class="wx-head"><span class="wx-title">${icon("weather")}<span>Weather at your field</span></span>
          <button type="button" class="wx-expand" aria-label="Open the full weather view" title="Open the full weather view">${icon("expand")}</button></div>
        <div class="wx-body"><div class="skeleton dark" style="height:150px"></div></div>
      </div>
    </section>`;
  }

  function fillCard(root, field, w) {
    const el = $(".wx-card", root);
    if (!el) return;
    const body = $(".wx-body", el);
    if (!w) {
      body.innerHTML = `<div class="wx-off">${svg("cloudy")}<p>Live weather is unavailable right now. Your analysis is not affected.</p></div>`;
      return;
    }
    const a = w.actual;
    body.innerHTML = `
      <div class="wx-now">
        <div class="wx-place"><strong class="notranslate">${esc(field.nombre)}</strong><span>${esc(C.t(a.estado))} · feels ${fmt(a.sensacion, 0)}°${w.guardado ? ` · ${esc(C.t("Saved"))} ${esc(C.dateLabel(w.guardado))}` : ""}</span></div>
        ${svg(a.icono, a.es_dia, { cls: "wx-big" })}
        <div class="wx-temp"><span data-count="${Math.round(a.temp)}">${fmt(a.temp, 0)}</span><sup>°C</sup></div>
      </div>
      <div class="wx-days">${w.diario.map((d, i) => `<div class="wx-day ${i === 0 ? "today" : ""}">
        <span class="wd">${i === 0 ? C.t("Today") : esc(day(d.fecha))}</span>
        ${svg(d.icono, true, { cls: "wx-sm" })}
        <span class="wt">${fmt(d.tmax, 0)}°</span><span class="wl">${fmt(d.tmin, 0)}°</span></div>`).join("")}</div>`;
    C.motion.reveal($$(".wx-day", el), { y: 12, stagger: 0.05, delay: 0.1 });
    $(".wx-card-bg", el).style.backgroundImage = `url('${sceneImg()}')`;
  }

  /* -------------------------------------------------------- top bar chip */
  function chip(el, w) {
    if (!w) {
      el.innerHTML = `${svg("cloudy", true, { cls: "wx-chip-ic" })}<span class="wp-txt"><strong>Weather</strong><small>Unavailable right now</small></span>`;
      el.classList.add("is-off"); return;
    }
    const a = w.actual, d0 = w.diario[0];
    el.classList.remove("is-off");
    el.style.setProperty("--wx-bg", `url('${sceneImg()}')`);
    el.innerHTML = `${svg(a.icono, a.es_dia, { cls: "wx-chip-ic" })}<span class="wp-t">${fmt(a.temp, 0)}°</span>
      <span class="wp-txt"><strong>${esc(C.t(a.estado))}</strong><small>${w.guardado ? `${esc(C.t("Saved"))} ${esc(C.dateLabel(w.guardado, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}` : `H ${fmt(d0?.tmax, 0)}° · L ${fmt(d0?.tmin, 0)}° · ${fmt(d0?.prob_lluvia ?? 0)}% rain`}</small></span>`;
  }

  /* ------------------------------------------------------- expanded view */
  let openEl = null;
  function expand(originEl, field, w) {
    if (!w || openEl) return;
    const a = w.actual, d0 = w.diario[0];
    const wrap = document.createElement("div");
    wrap.className = "wx-modal-wrap";
    const tmin = Math.min(...w.diario.map((d) => d.tmin)), tmax = Math.max(...w.diario.map((d) => d.tmax));
    const rise = hmin(d0?.amanecer), set = hmin(d0?.atardecer), now = nowMin(w.zona_horaria);
    const k = rise != null && set != null ? Math.min(1, Math.max(0, (now - rise) / (set - rise))) : 0.5;
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    wrap.innerHTML = `<div class="wx-modal" role="dialog" aria-modal="true" aria-label="Weather at your field">
      <div class="wx-hero" style="background-image:url('${(C.scene.SCENES[C.scene.current] || C.scene.SCENES.lindo).img}')">
        <canvas class="wx-hero-fx" aria-hidden="true"></canvas>
        <div class="wx-hero-in">
          <div class="wx-hero-top"><span class="wx-title">${icon("weather")}<span>Weather at your field</span></span>
            <button type="button" class="wx-close" aria-label="Close">${icon("close")}</button></div>
          <div class="wx-hero-main">
            ${svg(a.icono, a.es_dia, { cls: "wx-huge" })}
            <div><div class="wx-temp xl"><span>${fmt(a.temp, 0)}</span><sup>°C</sup></div>
              <p class="wx-cond">${esc(C.t(a.estado))}</p><p class="wx-sub notranslate">${esc(field.nombre)}</p></div>
          </div>
          <ul class="wx-facts">
            <li><span>Feels like</span><strong>${fmt(a.sensacion, 0)}°</strong></li>
            <li><span>Humidity</span><strong>${fmt(a.humedad)}%</strong></li>
            <li><span>Wind</span><strong><i class="wx-arrow" style="--deg:${(a.viento_dir || 0) + 180}deg">${icon("right")}</i>${fmt(a.viento)} km/h ${dirs[Math.round(((a.viento_dir || 0) % 360) / 45) % 8]}</strong></li>
            <li><span>Gusts</span><strong>${fmt(a.rafagas)} km/h</strong></li>
            <li><span>Rain now</span><strong>${fmt(a.lluvia_mm, 1)} mm</strong></li>
          </ul>
        </div>
      </div>
      <div class="wx-modal-body">
        <section class="wx-sec wx-sunarc">
          <h3>Sun today</h3>
          <svg viewBox="0 0 220 110" class="arc" aria-hidden="true"><path d="M10 100a100 100 0 0 1 200 0" class="arc-track"/><path d="M10 100a100 100 0 0 1 200 0" class="arc-done" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:${1 - k}"/>
            <circle r="7" class="arc-sun" cx="${110 - 100 * Math.cos(Math.PI * k)}" cy="${100 - 100 * Math.sin(Math.PI * k)}"/></svg>
          <div class="arc-times"><span>Sunrise <strong>${hour(d0?.amanecer)}</strong></span><span>Sunset <strong>${hour(d0?.atardecer)}</strong></span></div>
        </section>
        <section class="wx-sec wx-today">
          <h3>Today at the field</h3>
          <div class="tiles">
            <div class="tile"><div class="label">Rain forecast</div><div class="value">${fmt(d0?.lluvia_mm, 1)} mm</div><div class="detail">${fmt(d0?.prob_lluvia ?? 0)}% chance</div></div>
            <div class="tile"><div class="label">Evapotranspiration</div><div class="value">${fmt(d0?.et0_mm, 1)} mm</div><div class="detail">Water the crops can lose today</div></div>
            <div class="tile"><div class="label">Max wind</div><div class="value">${fmt(d0?.viento_max)} km/h</div><div class="detail">Check before spraying</div></div>
            <div class="tile"><div class="label">Maximum</div><div class="value">${fmt(d0?.tmax, 0)}°</div><div class="detail">${d0?.tmax >= 32 ? "Heat stress risk" : "No heat stress"}</div></div>
            <div class="tile"><div class="label">Minimum</div><div class="value">${fmt(d0?.tmin, 0)}°</div><div class="detail">${d0?.tmin <= 2 ? "Frost risk" : "No frost risk"}</div></div>
            <div class="tile"><div class="label">Water balance</div><div class="value">${fmt((d0?.lluvia_mm || 0) - (d0?.et0_mm || 0), 1)} mm</div><div class="detail">Rain minus evapotranspiration</div></div>
          </div>
        </section>
        <section class="wx-sec wx-hours">
          <h3>Next 24 hours</h3>
          <div class="wx-hour-strip">${(w.horas || []).map((h) => `<div class="wx-hour"><span>${hour(h.hora)}</span>${svg(h.icono, h.es_dia, { cls: "wx-sm" })}<strong>${fmt(h.temp, 0)}°</strong>
            <span class="prob" style="--p:${h.prob_lluvia || 0}%"><i></i></span><small>${fmt(h.prob_lluvia || 0)}%</small></div>`).join("") || `<p class="hint">Hourly forecast unavailable.</p>`}</div>
        </section>
        <section class="wx-sec wx-week">
          <h3>7 days</h3>
          ${w.diario.map((d, i) => {
            const l = ((d.tmin - tmin) / Math.max(1, tmax - tmin)) * 100, r = ((d.tmax - tmin) / Math.max(1, tmax - tmin)) * 100;
            return `<div class="wx-row"><span class="wd">${i === 0 ? C.t("Today") : esc(day(d.fecha, "long"))}</span>${svg(d.icono, true, { cls: "wx-sm" })}
              <span class="rp">${fmt(d.prob_lluvia ?? 0)}%</span><span class="lo">${fmt(d.tmin, 0)}°</span>
              <span class="range"><i style="left:${l}%;right:${100 - r}%"></i></span><span class="hi">${fmt(d.tmax, 0)}°</span>
              <span class="mm">${fmt(d.lluvia_mm, 1)} mm · ET0 ${fmt(d.et0_mm, 1)}</span></div>`;
          }).join("")}
          <p class="hint">${esc(w.fuente)} · local time ${esc(w.zona_horaria || "")}. Forecasts are for planning, not part of Cooper's analysis.</p>
        </section>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("has-dialog");
    openEl = wrap;
    const box = $(".wx-modal", wrap);
    const from = originEl?.getBoundingClientRect();
    const g = C.motion.gsap;
    const fx = heroFx($(".wx-hero-fx", wrap), a.icono, a.es_dia);
    if (g && from?.width) {
      const to = box.getBoundingClientRect();
      g.fromTo(wrap, { backgroundColor: "rgba(6,12,8,0)", backdropFilter: "blur(0px)" }, { backgroundColor: "rgba(6,12,8,.5)", backdropFilter: "blur(12px)", duration: 0.6 });
      g.fromTo(box, { x: from.left - to.left, y: from.top - to.top, scaleX: from.width / to.width, scaleY: from.height / to.height, transformOrigin: "0 0", borderRadius: 26 },
        { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.85, ease: "expo.inOut" });
      g.fromTo($$(".wx-hero-main, .wx-facts li, .wx-sec", wrap), { opacity: 0, y: 18 }, { opacity: 1, y: 0, stagger: 0.05, duration: 0.6, ease: "expo.out", delay: 0.45 });
      g.fromTo($(".arc-sun", wrap), { attr: { cx: 10, cy: 100 } }, { attr: { cx: 110 - 100 * Math.cos(Math.PI * k), cy: 100 - 100 * Math.sin(Math.PI * k) }, duration: 1.6, ease: "power3.out", delay: 0.6 });
      g.fromTo($(".arc-done", wrap), { strokeDashoffset: 1 }, { strokeDashoffset: 1 - k, duration: 1.6, ease: "power3.out", delay: 0.6 });
    }
    const close = () => {
      if (!openEl) return;
      const done = () => { fx?.stop(); wrap.remove(); openEl = null; if (!$(".dlg-wrap")) document.body.classList.remove("has-dialog"); originEl?.focus?.(); };
      const r = originEl?.getBoundingClientRect(), to = box.getBoundingClientRect();
      if (g && r?.width) {
        g.to($$(".wx-modal-body, .wx-hero-in", wrap), { opacity: 0, duration: 0.2 });
        g.to(box, { x: r.left - to.left, y: r.top - to.top, scaleX: r.width / to.width, scaleY: r.height / to.height, transformOrigin: "0 0", duration: 0.6, ease: "expo.inOut" });
        g.to(wrap, { backgroundColor: "rgba(6,12,8,0)", backdropFilter: "blur(0px)", duration: 0.6, onComplete: done });
      } else done();
    };
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest(".wx-close")) close(); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    setTimeout(() => $(".wx-close", wrap)?.focus(), 60);
  }

  /* Expanded view: the photograph stays still, except real weather: rain or snow when it
     rains or snows, a lightning flash in storms, and stars only in the night sky. */
  function heroFx(cv, kind, isDay) {
    if (!cv || C.reducedMotion()) return null;
    const mode = ["rain", "drizzle", "storm"].includes(kind) ? "rain" : kind === "snow" ? "snow" : !isDay ? "stars" : null;
    if (!mode) return null;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    let raf = 0, alive = true;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    // The hero shows the photograph with cover at 45% height and a 1.0 zoom.
    const limit = (C.skyLimit ? C.skyLimit(cv.clientWidth, cv.clientHeight, 0.45, 0, 1) : cv.clientHeight * 0.4) * dpr;
    const P = Array.from({ length: mode === "rain" ? 160 : mode === "snow" ? 90 : 110 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random(), p: Math.random() * 6.3 }));
    let flash = 0, last = performance.now();
    const frame = (t) => {
      if (!alive) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      for (const q of P) {
        if (mode === "rain") {
          q.y += dt * (1.2 + q.s); q.x += dt * 0.1; if (q.y > 1) { q.y = -0.1; q.x = Math.random(); }
          ctx.strokeStyle = `rgba(220,235,255,${0.25 + 0.35 * q.s})`; ctx.lineWidth = dpr * (0.8 + q.s * 0.6);
          ctx.beginPath(); ctx.moveTo(q.x * W, q.y * H); ctx.lineTo(q.x * W - 5 * dpr, q.y * H - (18 + 12 * q.s) * dpr); ctx.stroke();
        } else if (mode === "snow") {
          q.y += dt * (0.08 + q.s * 0.1); q.x += Math.sin(t / 1200 + q.p) * dt * 0.03; if (q.y > 1) q.y = -0.05;
          ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(q.x * W, q.y * H, (1.5 + q.s * 2.5) * dpr, 0, 6.3); ctx.fill();
        } else {
          const y = q.y * Math.max(0, limit - 6 * dpr);
          if (y <= 0) continue;
          q.p += dt * (1 + q.s * 2); const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(q.p));
          ctx.fillStyle = `rgba(255,255,255,${a * (0.35 + 0.65 * q.s)})`; ctx.beginPath(); ctx.arc(q.x * W, y, (0.6 + 1.3 * q.s) * dpr, 0, 6.3); ctx.fill();
        }
      }
      if (kind === "storm") { if (Math.random() < 0.006) flash = 1; if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); flash -= dt * 3; } }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return { stop() { alive = false; cancelAnimationFrame(raf); } };
  }
  const hmin = (iso) => { const m = /T(\d\d):(\d\d)/.exec(iso || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function nowMin(tz) {
    try {
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz || undefined, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      return (Number(p.find((x) => x.type === "hour").value) % 24) * 60 + Number(p.find((x) => x.type === "minute").value);
    } catch (_) { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  }

  C.wx = { svg, card, fillCard, chip, expand };
})();
