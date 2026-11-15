/* Cooper · "Coming up in your rotation": a satellite pass over the farming year.
 * The field is a strip of 12 months (May → April) where each crop grows month by month
 * through its cycle; a satellite flies along its orbit and its scan beam reads the month
 * you choose (drag it, click a month or use the arrow keys). Below: that month's crop and
 * climate, and the next sowing, critical stage and harvest with a countdown. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;
  const FULL = ["May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March", "April"];

  function todayPos() {
    const d = new Date();
    const idx = C.AG_ORDER.indexOf(d.getMonth() + 1);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { idx, frac: (d.getDate() - 1) / dim };
  }
  function daysTo(i, atEnd = false) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const m = C.AG_ORDER[i] - 1;
    let y = now.getFullYear();
    let d = atEnd ? new Date(y, m + 1, 0) : new Date(y, m, 1);
    if (d < now && m !== now.getMonth()) { y += 1; d = atEnd ? new Date(y, m + 1, 0) : new Date(y, m, 1); }
    return Math.round((d - now) / 864e5);
  }
  function events(rot) {
    const { idx } = todayPos();
    const year = rot.calendario[0];
    const out = [], seen = new Set();
    for (let s = 0; s < 12 && out.length < 5; s++) {
      const i = (idx + s) % 12, prev = (i + 11) % 12, next = (i + 1) % 12;
      const c = year[i];
      if (!c) continue;
      if ((!year[prev] || year[prev].id !== c.id) && !seen.has("s" + c.id)) { out.push({ t: "Sowing", c, i, kind: "sowing", days: daysTo(i) }); seen.add("s" + c.id); }
      if (c.critico && !(year[prev]?.critico && year[prev].id === c.id) && !seen.has("k" + c.id)) { out.push({ t: "Critical stage", c, i, kind: "critical", days: daysTo(i) }); seen.add("k" + c.id); }
      if ((!year[next] || year[next].id !== c.id) && !seen.has("h" + c.id)) { out.push({ t: "Harvest or end of cycle", c, i, kind: "harvest", days: daysTo(i, true) }); seen.add("h" + c.id); }
    }
    return out.sort((a, b) => a.days - b.days).slice(0, 4);
  }
  const when = (d) => (d <= 0 ? C.t("Now") : d === 1 ? C.t("Tomorrow") : d < 45 ? `${C.t("in")} ${d} ${C.t("days")}` : `${C.t("in")} ${Math.round(d / 30.4)} ${C.t("months")}`);

  /* Growth stage of each month inside its crop's cycle (0…1), for the plant height. */
  function stages(year) {
    const out = new Array(12).fill(0);
    let i = 0;
    while (i < 12) {
      const c = year[i];
      if (!c) { i++; continue; }
      let j = i; while (j + 1 < 12 && year[j + 1]?.id === c.id) j++;
      const len = j - i + 1;
      for (let k = i; k <= j; k++) out[k] = (k - i + 1) / len;
      i = j + 1;
    }
    return out;
  }

  /* A small plant drawn with paths: taller and fuller as the stage advances. */
  function plant(x, base, h, color, stage) {
    const leaves = Math.max(1, Math.round(1 + stage * 3));
    let p = `<path class="stem" d="M${x} ${base} C${x - 1.5} ${base - h * 0.4}, ${x + 1.5} ${base - h * 0.7}, ${x} ${base - h}" style="stroke:${color}"/>`;
    for (let l = 0; l < leaves; l++) {
      const y = base - h * (0.3 + 0.6 * (l / Math.max(1, leaves))), s = 5 + stage * 7, dir = l % 2 ? 1 : -1;
      p += `<path class="leaf" d="M${x} ${y} q${dir * s} ${-s * 0.6} ${dir * s * 1.4} ${-s * 0.1} q${-dir * s * 0.6} ${s * 0.5} ${-dir * s * 1.4} ${s * 0.1}z" style="fill:${color}"/>`;
    }
    if (stage >= 0.99) p += `<circle class="grain" cx="${x}" cy="${base - h - 3}" r="${3.4}" style="fill:${color}"/>`;
    return p;
  }

  function render(host, rec) {
    if (!rec) {
      host.innerHTML = `<p class="hint">Sowing, critical stages and harvest for your rotation appear after the first analysis.</p>`;
      return { destroy() {} };
    }
    const rot = rec.result.rotaciones[0];
    const clim = rec.result.clima.mensual;
    const W = 1000, H = 300, left = 20, right = 20, colW = (W - left - right) / 12;
    const groundY = 252, orbitY = 46;
    const today = todayPos();
    let yearIx = 0, sel = today.idx;

    const xOf = (i) => left + colW * (i + 0.5);
    function strip(year) {
      const st = stages(year);
      return year.map((c, i) => {
        const x0 = left + i * colW;
        const soil = `<rect class="soil ${c ? "" : "bare"}" x="${x0 + 3}" y="${groundY}" width="${colW - 6}" height="22" rx="6"/>`;
        const ph = 26 + st[i] * 112;
        const rows = c ? [0.25, 0.5, 0.75].map((f) => plant(x0 + colW * f, groundY, ph, c.color, st[i])).join("") : `<path class="furrow" d="M${x0 + 10} ${groundY - 3} h${colW - 20}"/>`;
        const flag = c?.critico ? `<g class="crit-flag" transform="translate(${x0 + colW / 2 - 6} ${groundY - ph - 34})"><line x1="0" y1="0" x2="0" y2="22"/><path d="M0 0 h12 l-3 5 l3 5 h-12z"/></g>` : "";
        return `<g class="col" data-i="${i}"><rect class="col-hit" x="${x0}" y="${orbitY + 20}" width="${colW}" height="${H - orbitY - 20}"/>
          <g class="plants">${rows}</g>${soil}${flag}
          <text class="mlabel ${i === today.idx ? "now" : ""}" x="${x0 + colW / 2}" y="${H - 6}">${esc(C.t(C.AG_MONTHS[i]))}</text></g>`;
      }).join("");
    }
    const years = rot.calendario;
    host.innerHTML = `<div class="sp">
      ${years.length > 1 ? `<div class="sp-years seg" role="group" aria-label="Year of the rotation">${years.map((_, y) => `<button type="button" data-y="${y}" aria-pressed="${y === 0}">${C.t("Year")} ${y + 1}</button>`).join("")}</div>` : ""}
      <div class="sp-stage" tabindex="0" role="slider" aria-label="Month" aria-valuemin="1" aria-valuemax="12">
        <svg class="sp-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          <path class="orbit" d="M${left} ${orbitY + 26} Q${W / 2} ${orbitY - 34} ${W - right} ${orbitY + 26}"/>
          <polygon class="beam" points="0,0 0,0 0,0"/>
          <g class="sp-cols">${strip(years[0])}</g>
          <line class="today-line" x1="${left + colW * (today.idx + today.frac)}" x2="${left + colW * (today.idx + today.frac)}" y1="${orbitY + 30}" y2="${groundY + 22}"/>
          <text class="today-tag" x="${left + colW * (today.idx + today.frac)}" y="${orbitY + 26}">${esc(C.t("Today"))}</text>
          <image class="sat" href="assets/icons/satellite.webp" width="54" height="54" x="-27" y="-27"/>
        </svg>
      </div>
      <div class="sp-info">
        <div class="sp-month"></div>
        <ol class="sp-events">${events(rot).map((e) => `<li class="ev-item ${e.kind}" data-i="${e.i}" tabindex="0">
          <span class="ev-ic">${icon(e.kind)}</span><span class="ev-main"><strong>${esc(C.t(e.t))}</strong><span>${esc(e.c.nombre)}</span></span>
          <span class="ev-when"><b>${esc(C.t(C.AG_MONTHS[e.i]))}</b><small>${esc(when(e.days))}</small></span>
          <span class="ev-bar"><i style="--k:${Math.max(0.04, 1 - Math.min(365, e.days) / 365)}"></i></span></li>`).join("") || `<li class="hint">No crop changes in the next months.</li>`}</ol>
      </div>
    </div>`;

    const svg = $(".sp-svg", host), sat = $(".sat", svg), beam = $(".beam", svg), stage = $(".sp-stage", host);
    const g = C.motion.gsap;
    const satPos = { x: xOf(sel) };
    const orbitAt = (x) => { const t = (x - left) / (W - left - right); return (1 - t) * (1 - t) * (orbitY + 26) + 2 * (1 - t) * t * (orbitY - 34) + t * t * (orbitY + 26); };
    function drawSat() {
      const x = satPos.x, y = orbitAt(x);
      sat.setAttribute("transform", `translate(${x} ${y}) rotate(${((x - W / 2) / W) * 30})`);
      beam.setAttribute("points", `${x - 6},${y + 14} ${x + 6},${y + 14} ${x + colW * 0.5},${groundY} ${x - colW * 0.5},${groundY}`);
    }
    function showMonth(i, animate = true) {
      sel = (i + 12) % 12;
      const year = years[yearIx], c = year[sel], st = stages(year)[sel];
      const m = clim.find((x) => x.mes === C.AG_ORDER[sel]) || {};
      const stageTxt = !c ? C.t("Field without a crop") : st >= 0.99 ? C.t("Harvest or end of cycle") : st <= 1 / 3 ? C.t("Sowing and emergence") : st <= 2 / 3 ? C.t("Growing") : C.t("Flowering and filling");
      $(".sp-month", host).innerHTML = `
        <div class="spm-head"><span class="spm-dot" style="background:${c ? c.color : "var(--surface-3)"}"></span><div><small>${sel === today.idx ? esc(C.t("This month")) : `${C.t("Year")} ${yearIx + 1}`}</small><strong>${esc(C.t(FULL[sel]))}</strong></div></div>
        <p class="spm-crop"><b>${esc(c ? c.nombre : C.t("No crop"))}</b> · ${esc(stageTxt)}${c?.critico ? ` · <span class="crit">${esc(C.t("Critical stage"))}</span>` : ""}</p>
        <div class="spm-stats">
          <span>${icon("water")}<em>${C.t("Rain")}</em><b>${fmt(m.lluvia_mm)} mm</b></span>
          <span>${icon("weather")}<em>ET0</em><b>${fmt(m.et0_mm)} mm</b></span>
          <span>${icon("climate")}<em>${C.t("Frost")}</em><b>${fmt(m.dias_helada, 1)} d</b></span>
          <span>${icon("simulation")}<em>${C.t("Heat")}</em><b>${fmt(m.dias_calor, 1)} d</b></span>
        </div>`;
      $$(".col", svg).forEach((el) => el.classList.toggle("on", Number(el.dataset.i) === sel));
      $$(".sp-events .ev-item", host).forEach((li) => li.classList.toggle("on", Number(li.dataset.i) === sel));
      stage.setAttribute("aria-valuenow", String(sel + 1));
      stage.setAttribute("aria-valuetext", C.t(FULL[sel]));
      if (g && animate) g.to(satPos, { x: xOf(sel), duration: 0.9, ease: "expo.out", onUpdate: drawSat, overwrite: true });
      else { satPos.x = xOf(sel); drawSat(); }
      if (g && animate) g.fromTo($$(".spm-stats span", host), { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.05, ease: "expo.out" });
    }

    /* interactions: hover, click, drag the beam, keys */
    const monthAt = (clientX) => { const r = svg.getBoundingClientRect(); const x = ((clientX - r.left) / r.width) * W; return Math.max(0, Math.min(11, Math.floor((x - left) / colW))); };
    let drag = false;
    stage.addEventListener("pointerdown", (e) => { drag = true; stage.setPointerCapture(e.pointerId); showMonth(monthAt(e.clientX)); });
    stage.addEventListener("pointermove", (e) => { if (drag) { const r = svg.getBoundingClientRect(); satPos.x = Math.max(left, Math.min(W - right, ((e.clientX - r.left) / r.width) * W)); drawSat(); const i = monthAt(e.clientX); if (i !== sel) showMonth(i, false); satPos.x = Math.max(left, Math.min(W - right, ((e.clientX - r.left) / r.width) * W)); drawSat(); } });
    stage.addEventListener("pointerup", () => { if (!drag) return; drag = false; showMonth(sel); });
    stage.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); showMonth(sel + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); showMonth(sel - 1); }
      if (e.key === "Home") { e.preventDefault(); showMonth(today.idx); }
    });
    host.addEventListener("click", (e) => {
      const li = e.target.closest(".ev-item[data-i]"); if (li) showMonth(Number(li.dataset.i));
      const yb = e.target.closest("[data-y]");
      if (yb) {
        yearIx = Number(yb.dataset.y);
        $$("[data-y]", host).forEach((b) => b.setAttribute("aria-pressed", String(b === yb)));
        $(".sp-cols", svg).innerHTML = strip(years[yearIx]);
        grow();
        showMonth(sel, false);
      }
    });
    host.addEventListener("pointerover", (e) => { const li = e.target.closest(".ev-item[data-i]"); if (li && !drag) showMonth(Number(li.dataset.i)); });

    /* entrance: plants grow from the soil month by month, the satellite flies in */
    function grow() {
      if (!g) return;
      g.fromTo($$(".col .plants", svg), { scaleY: 0, transformOrigin: `50% ${groundY}px` }, { scaleY: 1, duration: 0.9, ease: "back.out(1.6)", stagger: 0.06 });
      g.fromTo($$(".crit-flag", svg), { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "bounce.out", stagger: 0.08, delay: 0.6 });
    }
    function play() {
      grow();
      if (!g) { showMonth(today.idx, false); return; }
      satPos.x = left - 40; drawSat();
      g.to(satPos, { x: xOf(today.idx), duration: 2.2, ease: "power3.inOut", delay: 0.3, onUpdate: drawSat, onComplete: () => showMonth(today.idx, false) });
      g.fromTo($$(".sp-events .ev-item", host), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.08, ease: "expo.out", delay: 0.5 });
      g.fromTo($$(".ev-bar i", host), { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: "expo.out", stagger: 0.08, delay: 0.8 });
    }
    showMonth(today.idx, false);
    let played = false;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !played) { played = true; play(); }
      if (!e.isIntersecting && e.intersectionRatio === 0) played = false;
    }), { threshold: 0.3 });
    io.observe(host);
    return { destroy() { io.disconnect(); } };
  }

  C.calendar = { render, events, daysTo };
})();
