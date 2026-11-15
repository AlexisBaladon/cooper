/* Cooper · "Explain it simply" player: a video-style shell around the narrated 3D explanation.
 * Expands from its card over a blurred app, seeks by chapters or ±10 s, controls volume and
 * captions, and docks as a mini-player so it keeps playing while the farmer uses the app. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, icon, $, $$ } = C;

  const S = { shell: null, frame: null, recId: null, mode: "closed", raf: 0, ready: false, origin: null, volume: 1, muted: false, cc: true, dragging: false };

  const fmtTime = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const P = () => { try { return S.frame?.contentWindow?.cooperPlayer || null; } catch (_) { return null; } };

  function build() {
    const back = document.createElement("div");
    back.id = "player-backdrop"; back.hidden = true;
    const el = document.createElement("div");
    el.id = "player-shell"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Explain it simply");
    el.innerHTML = `
      <div class="ps-video">
        <iframe title="Explain it simply" allow="autoplay; fullscreen" tabindex="-1"></iframe>
        <div class="ps-loading" aria-live="polite"><div class="ld-orbit sat" aria-hidden="true"><img src="assets/icons/satellite.webp" alt=""><i></i><i></i></div><span>Preparing the explanation…</span></div>
        <button type="button" class="ps-bigplay" aria-label="Play">${icon("play")}</button>
        <div class="ps-mini-ctl">
          <button type="button" class="icon-btn" data-ps="toggle" aria-label="Play or pause">${icon("play", "i-play")}${icon("pause", "i-pause")}</button>
          <button type="button" class="icon-btn" data-ps="expand" aria-label="Expand">${icon("expand")}</button>
          <button type="button" class="icon-btn" data-ps="close" aria-label="Close">${icon("close")}</button>
        </div>
        <div class="ps-mini-bar"><i></i></div>
      </div>
      <div class="ps-controls">
        <div class="ps-seek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="ps-track"><div class="ps-chapters"></div><div class="ps-buf"></div><div class="ps-fill"></div><div class="ps-knob"></div></div>
          <div class="ps-tip" hidden></div>
        </div>
        <div class="ps-row">
          <div class="ps-left">
            <button type="button" class="icon-btn lg" data-ps="toggle" aria-label="Play or pause">${icon("play", "i-play")}${icon("pause", "i-pause")}</button>
            <button type="button" class="icon-btn" data-ps="back" aria-label="Back 10 seconds" title="Back 10 seconds">${icon("back10")}</button>
            <button type="button" class="icon-btn" data-ps="fwd" aria-label="Forward 10 seconds" title="Forward 10 seconds">${icon("fwd10")}</button>
            <div class="ps-vol">
              <button type="button" class="icon-btn" data-ps="mute" aria-label="Mute">${icon("volume", "i-vol")}${icon("mute", "i-mute")}</button>
              <input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
            </div>
            <span class="ps-time"><span class="ps-cur">0:00</span> / <span class="ps-dur">0:00</span></span>
            <span class="ps-chapter"></span>
          </div>
          <div class="ps-right">
            <button type="button" class="icon-btn on" data-ps="cc" aria-pressed="true" aria-label="Captions" title="Captions">${icon("cc")}</button>
            <button type="button" class="icon-btn" data-ps="mini" aria-label="Keep playing in a small window" title="Keep playing in a small window">${icon("minimize")}</button>
            <button type="button" class="icon-btn" data-ps="full" aria-label="Full screen" title="Full screen">${icon("expand")}</button>
            <button type="button" class="icon-btn" data-ps="close" aria-label="Close" title="Close">${icon("close")}</button>
          </div>
        </div>
      </div>`;
    document.body.append(back, el);
    S.shell = el; S.frame = $("iframe", el); S.back = back;
    // The explanation is laid out once at 1280×720 and scaled to the player, so the
    // mini window shows the same picture in small instead of squeezing it.
    const fit = () => {
      const box = $(".ps-video", el), w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      const k = Math.min(w / 1280, h / 720);
      Object.assign(S.frame.style, { width: "1280px", height: "720px", left: (w - 1280 * k) / 2 + "px", top: (h - 720 * k) / 2 + "px",
        transform: `scale(${k})`, transformOrigin: "0 0" });
    };
    new ResizeObserver(fit).observe($(".ps-video", el));
    S.fit = fit;
    el.addEventListener("click", onClick);
    back.addEventListener("click", () => setMode("mini"));
    const vol = $(".ps-vol input", el);
    vol.addEventListener("input", () => { S.volume = Number(vol.value); S.muted = S.volume === 0; applyVolume(); });
    bindSeek($(".ps-seek", el));
    el.addEventListener("keydown", (e) => {
      if (e.target.matches("input")) return;
      if (e.key === "Escape" && S.mode === "expanded") { e.preventDefault(); setMode("mini"); }
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      if (e.key === "ArrowLeft" && !e.target.closest(".ps-seek")) skip(-10);
      if (e.key === "ArrowRight" && !e.target.closest(".ps-seek")) skip(10);
      if (e.key === "m") { S.muted = !S.muted; applyVolume(); }
    });
    window.addEventListener("message", (e) => {
      if (e.origin === location.origin && e.source === S.frame.contentWindow && e.data?.type === "cooper-close") setMode("mini");
    });
    document.addEventListener("fullscreenchange", () => S.shell.classList.toggle("is-full", document.fullscreenElement === S.shell));
    window.addEventListener("resize", C.debounce(() => { if (S.mode !== "closed") place(S.mode, false); }, 100));
  }

  function onClick(e) {
    const b = e.target.closest("[data-ps]");
    if (e.target.closest(".ps-bigplay")) return toggle();
    if (!b) return;
    const a = b.dataset.ps;
    if (a === "toggle") toggle();
    if (a === "back") skip(-10);
    if (a === "fwd") skip(10);
    if (a === "mute") { S.muted = !S.muted; if (!S.muted && S.volume === 0) S.volume = 0.8; applyVolume(); }
    if (a === "cc") { S.cc = !S.cc; b.classList.toggle("on", S.cc); b.setAttribute("aria-pressed", String(S.cc)); applyCC(); }
    if (a === "mini") setMode("mini");
    if (a === "expand") setMode("expanded");
    if (a === "full") fullscreen();
    if (a === "close") close();
  }

  function applyVolume() {
    const v = S.muted ? 0 : S.volume;
    P()?.setVolume(v);
    $(".ps-vol input", S.shell).value = String(v);
    $(".ps-vol input", S.shell).style.setProperty("--p", v * 100 + "%");
    S.shell.classList.toggle("is-muted", v === 0);
  }
  function applyCC() { try { S.frame.contentDocument.documentElement.classList.toggle("no-cc", !S.cc || S.mode === "mini"); } catch (_) { /* separate origin */ } }

  function toggle() {
    const p = P();
    if (!p || !S.ready) return;
    p.toggle();
    if (S.mode === "mini" && !p.playing) return;
    pulse(p.playing ? "play" : "pause");
  }
  function skip(d) {
    const p = P();
    if (!p || !S.ready) return;
    S.seekTarget = Math.max(0, Math.min(p.duration() - 0.1, (S.seekTarget ?? p.currentTime()) + d));
    S.seekTotal = (S.seekTotal || 0) + d;
    preview(S.seekTarget / p.duration());
    $(".ps-cur", S.shell).textContent = fmtTime(S.seekTarget);
    flash(`${S.seekTotal > 0 ? "+" : "−"}${Math.abs(S.seekTotal)} s`);
    clearTimeout(S.seekTimer);
    S.seekTimer = setTimeout(() => { const t = S.seekTarget; S.seekTarget = null; S.seekTotal = 0; p.seek(t); }, 320);
  }

  function pulse(kind) {
    const b = $(".ps-bigplay", S.shell);
    b.innerHTML = icon(kind);
    const g = C.motion.gsap;
    if (g) g.fromTo(b, { opacity: 0.9, scale: 0.8 }, { opacity: 0, scale: 1.35, duration: 0.6, ease: "power2.out" });
  }
  function flash(text) {
    let f = $(".ps-flash", S.shell);
    if (!f) { f = document.createElement("div"); f.className = "ps-flash"; $(".ps-video", S.shell).appendChild(f); }
    f.textContent = text;
    const g = C.motion.gsap;
    if (g) g.fromTo(f, { opacity: 1, y: 0 }, { opacity: 0, y: -10, duration: 0.8, delay: 0.25 }); else f.style.opacity = 0;
  }

  /* --------------------------------------------------------------- seek */
  function bindSeek(seek) {
    const at = (x) => { const r = $(".ps-track", seek).getBoundingClientRect(); return C.clamp((x - r.left) / r.width, 0, 1); };
    const show = (k) => {
      const p = P(); if (!p) return;
      const tl = p.timeline(), t = k * tl.total;
      const ch = [...tl.chapters].reverse().find((c) => c.start <= t + 0.01);
      const tip = $(".ps-tip", seek);
      tip.hidden = false; tip.textContent = `${fmtTime(t)} · ${C.t(ch?.title || "")}`;
      tip.style.left = `${k * 100}%`;
    };
    seek.addEventListener("pointermove", (e) => { show(at(e.clientX)); if (S.dragging) preview(at(e.clientX)); });
    seek.addEventListener("pointerleave", () => { if (!S.dragging) $(".ps-tip", seek).hidden = true; });
    seek.addEventListener("pointerdown", (e) => { if (!S.ready) return; S.dragging = true; seek.setPointerCapture(e.pointerId); preview(at(e.clientX)); });
    seek.addEventListener("pointerup", (e) => {
      if (!S.dragging) return;
      S.dragging = false; $(".ps-tip", seek).hidden = true;
      const p = P(); if (p) p.seek(at(e.clientX) * p.duration());
    });
    seek.addEventListener("keydown", (e) => {
      const p = P(); if (!p) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); skip(-5); }
      if (e.key === "ArrowRight") { e.preventDefault(); skip(5); }
      if (e.key === "Home") { e.preventDefault(); p.seek(0); }
    });
  }
  function preview(k) { $(".ps-fill", S.shell).style.width = `${k * 100}%`; $(".ps-knob", S.shell).style.left = `${k * 100}%`; }

  function tick() {
    S.raf = requestAnimationFrame(tick);
    const p = P();
    if (!p || S.dragging || S.seekTarget != null) return;
    const t = p.currentTime(), d = p.duration(), k = d ? t / d : 0;
    preview(k);
    $(".ps-mini-bar i", S.shell).style.width = `${k * 100}%`;
    $(".ps-cur", S.shell).textContent = fmtTime(t);
    $(".ps-dur", S.shell).textContent = fmtTime(d);
    $(".ps-seek", S.shell).setAttribute("aria-valuenow", String(Math.round(k * 100)));
    $(".ps-seek", S.shell).setAttribute("aria-valuetext", `${fmtTime(t)} of ${fmtTime(d)}`);
    const ch = p.slides[p.i];
    const label = ch ? `${p.i + 1}. ${C.t(ch.headline)}` : "";
    const chEl = $(".ps-chapter", S.shell);
    if (chEl.textContent !== label) chEl.textContent = label;
    S.shell.classList.toggle("is-playing", !!p.playing);
    if (S.chapterSig !== p.timeline().total) renderChapters(p);
  }
  function renderChapters(p) {
    const tl = p.timeline();
    S.chapterSig = tl.total;
    $(".ps-chapters", S.shell).innerHTML = tl.chapters.slice(1).map((c) => `<i style="left:${(c.start / tl.total) * 100}%"></i>`).join("");
  }

  /* -------------------------------------------------------------- layout */
  function rectFor(mode) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (mode === "expanded") {
      const ctl = 92, pad = vw < 700 ? 0 : 32;
      let w = Math.min(1180, vw - pad * 2), h = w * 9 / 16 + ctl;
      if (h > vh - pad * 2) { h = vh - pad * 2; w = Math.min(vw - pad * 2, (h - ctl) * 16 / 9); }
      return { left: (vw - w) / 2, top: (vh - h) / 2, width: w, height: h };
    }
    const w = vw < 700 ? Math.min(300, vw - 24) : 360, h = w * 9 / 16;
    const bottom = vw < 900 ? 84 : 20;
    return { left: vw < 700 ? 12 : (document.querySelector(".sidebar")?.offsetWidth || 0) + 20, top: vh - h - bottom, width: w, height: h };
  }
  function place(mode, animate = true) {
    const r = rectFor(mode);
    const g = animate ? C.motion.gsap : null;
    const props = { left: r.left, top: r.top, width: r.width, height: r.height };
    if (g) g.to(S.shell, { ...props, duration: 0.75, ease: "expo.inOut" });
    else Object.assign(S.shell.style, Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v + "px"])));
  }

  function setMode(mode) {
    if (S.mode === mode) return;
    const prev = S.mode;
    S.mode = mode;
    S.shell.dataset.mode = mode;
    applyCC();
    const g = C.motion.gsap;
    if (mode === "expanded") {
      S.back.hidden = false;
      document.body.classList.add("player-open");
      if (g) g.fromTo(S.back, { opacity: 0 }, { opacity: 1, duration: 0.5 }); else S.back.style.opacity = 1;
      place("expanded", prev !== "closed" || !!g);
      setTimeout(() => $('.ps-controls [data-ps="toggle"]', S.shell)?.focus(), 50);
    } else if (mode === "mini") {
      document.body.classList.remove("player-open");
      if (g) g.to(S.back, { opacity: 0, duration: 0.4, onComplete: () => { S.back.hidden = true; } }); else S.back.hidden = true;
      if (document.fullscreenElement) document.exitFullscreen?.();
      place("mini");
    }
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else S.shell.requestFullscreen?.().catch(() => {});
  }

  /* --------------------------------------------------------------- open */
  function slim(rec) {
    const data = rec.result;
    return {
      campo: rec.context?.field || "Your selected field", context: rec.context, escenario: data.escenario, meta: data.meta,
      clima: { mensual: data.clima.mensual, tendencias: data.clima.tendencias.indicadores },
      rotaciones: data.rotaciones.map(({ id, nombre, rol, total, puntajes, indicadores, calendario, explicacion, diagnostico }) =>
        ({ id, nombre, rol, total, puntajes, indicadores, calendario, explicacion, diagnostico })),
      zonas: data.zonas ? { resumen: data.zonas.resumen, tolerancia_t_ha: data.zonas.tolerancia_t_ha, area_ha: data.zonas.area_ha } : null,
      terreno: data.zonas ? {
        n: Math.round(Math.sqrt(data.zonas.celdas.length)),
        elev: data.zonas.celdas.map((c) => c.elev),
        eros: Object.fromEntries(data.rotaciones.map((r) => [r.id, data.zonas.celdas.map((c) => c.eros[r.id])])),
      } : null,
    };
  }
  /* The embedded pages read the analysis from the parent window (or localStorage as a fallback). */
  function setAnalysis(rec) {
    const s = slim(rec);
    window.CooperAnalysis = s;
    try { localStorage.setItem("cooper-analysis", JSON.stringify(s)); } catch (_) { /* in-memory copy is enough */ }
  }

  async function waitPlayer(token) {
    for (let i = 0; i < 400; i++) {
      if (token !== S.loadToken) return null;
      let p = null, ready = null;
      try { p = S.frame.contentWindow.cooperPlayer; ready = S.frame.contentWindow.cooperReady; } catch (_) { /* loading */ }
      if (p && ready) { await ready; return token === S.loadToken ? p : null; }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  async function open(rec, originEl, opts = {}) {
    if (!S.shell) build();
    const fresh = S.recId !== rec.id + "|" + C.lang();
    S.shell.hidden = false;
    if (S.mode === "closed") {
      const o = (originEl?.closest?.("[data-player-anchor]") || originEl)?.getBoundingClientRect?.();
      const r = o && o.width ? { left: o.left, top: o.top, width: o.width, height: o.height } : rectFor("expanded");
      Object.assign(S.shell.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      S.shell.dataset.mode = "opening";
    }
    setMode("expanded");
    if (!S.raf) tick();
    if (fresh) {
      S.ready = false;
      S.shell.classList.add("is-loading");
      S.recId = rec.id + "|" + C.lang();
      setAnalysis(rec);
      const token = (S.loadToken = (S.loadToken || 0) + 1);
      S.frame.src = `${rec.result.zonas ? "slides-3d.html" : "slides.html"}?analysis=1&embed=1&r=${encodeURIComponent(rec.id)}`;
      S.frame.onload = () => applyCC();
      const p = await waitPlayer(token);
      if (!p) { if (token === S.loadToken) { $(".ps-loading span", S.shell).textContent = C.t("The explanation could not load. Please try again."); } return; }
      S.ready = true;
      S.shell.classList.remove("is-loading");
      applyVolume(); applyCC(); renderChapters(p);
      if (opts.chapter != null) p.go(opts.chapter);
      p.play();
      pulse("play");
    } else {
      const p = P();
      if (p && opts.chapter != null) { p.go(opts.chapter); if (!p.playing) p.play(); }
      else if (p && !p.playing) p.play();
    }
  }

  function close() {
    const p = P();
    try { p?.pause(); S.frame.contentWindow.speechSynthesis?.cancel(); } catch (_) { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen?.();
    document.body.classList.remove("player-open");
    const g = C.motion.gsap;
    const done = () => { S.shell.hidden = true; S.back.hidden = true; S.mode = "closed"; S.shell.dataset.mode = "closed"; cancelAnimationFrame(S.raf); S.raf = 0; };
    if (g) { g.to(S.shell, { opacity: 0, scale: 0.96, duration: 0.3, ease: "power2.in", onComplete: () => { g.set(S.shell, { opacity: 1, scale: 1 }); done(); } }); g.to(S.back, { opacity: 0, duration: 0.3 }); }
    else done();
  }

  /* When the analysis behind the player changes, a closed player reloads on next open;
     a playing one keeps the explanation the farmer started. */
  function invalidate(rec) { if (S.mode === "closed" && rec && S.recId && !S.recId.startsWith(rec.id + "|")) S.recId = null; }
  /* Language changes rebuild the narration in the new language. */
  C.listen("language", () => { if (S.mode === "closed") S.recId = null; });

  C.player = { open, close, invalidate, setMode, setAnalysis, get mode() { return S.mode; } };
})();
