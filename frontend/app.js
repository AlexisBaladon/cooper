/* Cooper — application shell: boot, routing, top bar (field, live weather, clock), settings.
 * Views live in js/*.js. No framework and no build step: FastAPI serves these files as they are. */
"use strict";
(function () {
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  const VIEWS = ["home", "analysis", "field", "settings"];
  const state = { catalog: null, view: null, sub: null, dirty: new Set(VIEWS), booted: false };

  /* ------------------------------------------------------------- weather */
  const wcache = new Map();
  C.weather = {
    last: null,
    async get(field) {
      if (!field) return null;
      const key = `${field.lat.toFixed(2)},${field.lon.toFixed(2)}`;
      const hit = wcache.get(key);
      if (hit && Date.now() - hit.t < 10 * 60e3) return (this.last = hit.v);
      const r = await fetch(`/api/weather?lat=${field.lat}&lon=${field.lon}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json();
      wcache.set(key, { t: Date.now(), v });
      return (this.last = v);
    },
  };

  /* ------------------------------------------------------------- records */
  async function homeRecord(field) {
    if (!field) return null;
    const d = await C.db.get("drafts", field.id);
    return d && d.result ? d : null;
  }

  /* ------------------------------------------------------------- routing */
  C.go = (route) => { if (location.hash !== "#" + route) location.hash = route; else show(route); };
  function parse() {
    const [v, sub] = (location.hash.replace(/^#\/?/, "") || "home").split("/");
    return { view: VIEWS.includes(v) ? v : "home", sub };
  }
  async function show(route) {
    const { view, sub } = route ? { view: route.split("/")[0], sub: route.split("/")[1] } : parse();
    const prev = state.view;
    state.view = view; state.sub = sub;
    $$("[data-nav]").forEach((a) => {
      const on = a.dataset.nav === view;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    moveIndicator();
    const out = prev && prev !== view ? $(`#view-${prev}`) : null;
    const inn = $(`#view-${view}`);
    const g = C.motion.gsap;
    if (out) {
      if (g) await new Promise((r) => g.to(out, { opacity: 0, y: -10, duration: 0.22, ease: "power2.in", onComplete: r }));
      out.hidden = true; out.style.opacity = ""; out.style.transform = "";
    }
    $$(".view").forEach((v) => { if (v !== inn) v.hidden = true; });
    inn.hidden = false;
    document.title = `${C.t({ home: "Home", analysis: "Analysis", field: "My field", settings: "Settings" }[view])} · Cooper`;
    if (prev && prev !== view) { window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" }); $("#main")?.focus({ preventScroll: true }); }
    await renderView(view, sub);
    if (g && prev !== view) g.fromTo(inn, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power1.out" });
  }
  async function renderView(view, sub) {
    const field = C.fields.active();
    if (!field || !state.catalog) return;
    if (view === "home" && state.dirty.has("home")) {
      state.dirty.delete("home");
      C.home.render($("#view-home"), { field, rec: await homeRecord(field), catalog: state.catalog });
    }
    if (view === "analysis") { C.analysis.onShow(sub); }
    if (view === "field" && state.dirty.has("field")) {
      state.dirty.delete("field");
      C.fieldView.render($("#view-field"), { field, rec: await homeRecord(field), catalog: state.catalog });
    }
    if (view === "settings") renderSettingsStats();
  }
  function invalidate(...views) { views.forEach((v) => state.dirty.add(v)); if (views.includes(state.view)) renderView(state.view, state.sub); }

  function moveIndicator() {
    const act = $(".sb-nav .nav-item.active"), ind = $(".sb-nav .nav-indicator");
    if (!ind) return;
    if (!act) { ind.style.opacity = "0"; return; }
    const y = act.offsetTop, h = act.offsetHeight;
    const g = C.motion.gsap;
    ind.style.opacity = "1";
    if (g) g.to(ind, { y, height: h, duration: 0.6, ease: "expo.out" }); else { ind.style.transform = `translateY(${y}px)`; ind.style.height = h + "px"; }
  }

  /* -------------------------------------------------------------- top bar */
  function tileThumb(lat, lon, z = 14) {
    const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n);
    const r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  function renderSwitcher() {
    const f = C.fields.active();
    if (!f) return;
    const btn = $("#field-switch");
    btn.innerHTML = `<span class="fs-thumb"><img src="${tileThumb(f.lat, f.lon)}" alt="" loading="lazy" onerror="this.remove()">${icon("field")}</span>
      <span class="fs-txt"><strong class="notranslate">${esc(f.nombre)}</strong><small>${fmt(f.area_ha)} ha</small></span>${icon("chevron")}`;
    $("#field-menu").innerHTML = C.fields.list().map((x) => `<button type="button" role="menuitemradio" aria-checked="${x.id === f.id}" data-field="${esc(x.id)}">
        <span class="notranslate">${esc(x.nombre)}</span><small>${fmt(x.area_ha)} ha</small>${x.id === f.id ? icon("check") : ""}</button>`).join("") +
      `<hr><button type="button" role="menuitem" data-act="add-field">${icon("plus")}<span>Add a field</span></button>
       <button type="button" role="menuitem" data-go="field">${icon("field")}<span>Manage fields</span></button>`;
  }
  function bindSwitcher() {
    const btn = $("#field-switch"), menu = $("#field-menu");
    const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      if (!open) return close();
      menu.hidden = false; btn.setAttribute("aria-expanded", "true");
      C.motion.gsap?.fromTo(menu, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.3, ease: "expo.out" });
      menu.querySelector("button")?.focus();
    });
    menu.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      close();
      if (b.dataset.field) C.fields.setActive(b.dataset.field);
      if (b.dataset.act === "add-field") { const f = await C.fieldEditor(); if (f) C.fields.setActive(f.id); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".field-switcher")) close(); });
    menu.addEventListener("keydown", (e) => {
      const items = $$("button", menu), i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { close(); btn.focus(); }
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
  }

  async function refreshWeatherPill() {
    const el = $("#weather-pill"), f = C.fields.active();
    if (!el || !f) return;
    try {
      const w = await C.weather.get(f);
      state.tz = w.zona_horaria || null;
      C.scene.update(w);
      C.wx.chip(el, w);
      el.title = `${w.fuente} · ${C.t("Humidity")} ${fmt(w.actual.humedad)}% · ${C.t("Wind")} ${fmt(w.actual.viento)} km/h`;
    } catch (_) {
      C.scene.update(null);
      C.wx.chip(el, null);
    }
  }
  function bindWeather() {
    $("#weather-pill").addEventListener("click", async () => {
      const f = C.fields.active();
      try { C.wx.expand($("#weather-pill"), f, await C.weather.get(f)); } catch (_) { C.toast(C.t("Live weather is unavailable right now."), "info"); }
    });
    document.addEventListener("click", async (e) => {
      const b = e.target.closest(".wx-expand");
      if (!b) return;
      const f = C.fields.active();
      try { C.wx.expand(b.closest(".wx-card"), f, await C.weather.get(f)); } catch (_) { /* card shows the message */ }
    });
  }
  /* The menu can be hidden to a slim rail and brought back. */
  function bindSidebar() {
    const btn = $("#sb-toggle");
    const sync = () => {
      const c = document.documentElement.classList.contains("sb-collapsed");
      btn.setAttribute("aria-expanded", String(!c));
      btn.setAttribute("aria-label", C.t(c ? "Show the menu" : "Collapse the menu"));
      btn.title = btn.getAttribute("aria-label");
      $(".nav-label", btn).textContent = C.t(c ? "Show menu" : "Hide menu");
    };
    btn.addEventListener("click", () => {
      const root = document.documentElement, g = C.motion.gsap;
      const collapse = !root.classList.contains("sb-collapsed");
      C.storage.set("cooper-sidebar-collapsed", collapse);
      if (g) {
        const from = $(".sidebar").offsetWidth;
        root.classList.toggle("sb-collapsed", collapse);
        const to = $(".sidebar").offsetWidth;
        g.fromTo(".app", { "--sidebar-anim": from + "px" }, { "--sidebar-anim": to + "px", duration: 0.55, ease: "expo.inOut", clearProps: "--sidebar-anim", onUpdate: () => window.dispatchEvent(new Event("resize")) });
        g.fromTo(".sidebar .nav-label, .sb-note, .sb-logo img", { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.25 });
      } else root.classList.toggle("sb-collapsed", collapse);
      sync(); setTimeout(moveIndicator, 600);
    });
    sync();
  }
  function clock() {
    const now = new Date();
    const loc = C.lang() === "es" ? "es-UY" : "en-GB";
    const opts = state.tz ? { timeZone: state.tz } : {};
    let time, date;
    try {
      time = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, ...opts }).format(now);
      const sec = new Intl.DateTimeFormat(loc, { second: "2-digit", ...opts }).format(now).padStart(2, "0");
      date = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", ...opts }).format(now);
      $("#clock-time").innerHTML = `${esc(time)}<small>${esc(sec)}</small>`;
    } catch (_) { $("#clock-time").textContent = now.toLocaleTimeString(); date = now.toDateString(); }
    $("#clock-date").textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }

  /* ------------------------------------------------------------- settings */
  function bindSettings() {
    const theme = C.theme.get();
    $$("#theme-seg button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.theme === theme));
      b.addEventListener("click", () => {
        C.theme.set(b.dataset.theme);
        $$("#theme-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
    });
    const intro = $("#set-intro"); intro.checked = C.storage.get("cooper-intro", true);
    intro.addEventListener("change", () => C.storage.set("cooper-intro", intro.checked));
    const rm = $("#set-motion"); rm.checked = C.storage.get("cooper-reduce-motion", false);
    rm.addEventListener("change", () => { C.storage.set("cooper-reduce-motion", rm.checked); document.documentElement.classList.toggle("reduce-motion", rm.checked); C.toast(C.t("Saved."), "info", 1600); });
    $("#set-export").addEventListener("click", async () => {
      const out = { app: "Cooper", exported: new Date().toISOString(), fields: C.fields.list(), analyses: await C.db.all("analyses") };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
      a.download = `cooper-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    $("#set-wipe").addEventListener("click", async () => {
      const ok = await C.confirm(C.t("Delete all data on this device?"), C.t("Your fields, saved analyses and notes will be removed from this browser. This cannot be undone."), C.t("Delete everything"));
      if (!ok) return;
      await C.db.clear();
      for (const k of ["cooper-fields", "cooper-active-field", "cooper-analysis"]) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }
      location.hash = "home"; location.reload();
    });
  }
  async function renderSettingsStats() {
    const n = (await C.db.all("analyses")).length;
    $("#set-stats").textContent = `${C.fields.list().length} ${C.t("fields")} · ${n} ${C.t("saved analyses")}`;
  }

  /* --------------------------------------------------------------- globals */
  C.saveCurrent = async () => {
    const f = C.fields.active();
    const rec = await homeRecord(f);
    if (!rec || rec.saved) { if (rec?.saved) C.toast(C.t("This analysis is already saved."), "info"); return; }
    const saved = { ...rec, saved: true };
    await C.db.put("analyses", saved); await C.db.put("drafts", saved);
    C.toast(C.t("Analysis saved in your history."));
    C.emit("history-changed"); C.emit("analysis", saved);
  };
  C.simulateRain = async (pct) => {
    C.go("analysis");
    C.analysis.selectTab("new");
    await new Promise((r) => setTimeout(r, 400));
    const s = $("#an-rain");
    if (!s) { C.toast(C.t("Run an analysis first."), "info"); return; }
    s.value = String(pct); s.dispatchEvent(new Event("input", { bubbles: true }));
    s.closest(".scenario")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  function bindGlobal() {
    document.addEventListener("click", async (e) => {
      const go = e.target.closest("[data-go]");
      if (go) { e.preventDefault(); C.go(go.dataset.go); return; }
      if (e.target.closest('[data-act="save-current"]')) { C.saveCurrent(); return; }
      const play = e.target.closest(".ex-play, [data-chapter]");
      if (play) {
        const rec = await homeRecord(C.fields.active());
        if (rec) C.player.open(rec, play, { chapter: play.dataset.chapter != null ? Number(play.dataset.chapter) : null });
      }
    });
    window.addEventListener("hashchange", () => show());
    window.addEventListener("resize", C.debounce(moveIndicator, 100));
    window.addEventListener("cooper-language", () => {
      C.emit("language", C.lang());
      invalidate("home", "field");
      C.analysis.refresh();
      renderSwitcher(); refreshWeatherPill(); clock();
      document.title = `${C.t({ home: "Home", analysis: "Analysis", field: "My field", settings: "Settings" }[state.view] || "Home")} · Cooper`;
    });
    C.listen("theme", () => { C.analysis.refresh(); invalidate("home", "field"); });
    C.listen("active-field", async (f) => {
      if (!f) return;
      renderSwitcher();
      invalidate("home", "field");
      C.analysis.load(f);
      const rec = await homeRecord(f);
      C.jarvis.setContext(f, rec);
      if (rec) C.player.setAnalysis(rec);
      refreshWeatherPill();
    });
    C.listen("fields", () => { renderSwitcher(); invalidate("field"); });
    C.listen("analysis", async (rec) => {
      const f = C.fields.active();
      if (rec.fieldId !== f?.id) return;
      invalidate("home", "field");
      C.jarvis.setContext(f, rec);
      C.player.invalidate(rec);
      C.player.setAnalysis(rec); // keeps slides*.html?analysis=1 working on their own
    });
  }

  /* -------------------------------------------------------------- reveal */
  function revealShell() {
    document.body.classList.remove("booting");
    const g = C.motion.gsap;
    if (!g) return;
    g.timeline()
      .fromTo(".sidebar", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power2.out", clearProps: "opacity" }, 0)
      .fromTo(".sb-nav .nav-item, .sb-bottom .nav-item", { x: -16, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.06, duration: 0.6, ease: "expo.out", clearProps: "transform,opacity" }, 0.2)
      .fromTo(".topbar > *", { y: -14, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.07, duration: 0.7, ease: "expo.out", clearProps: "transform,opacity" }, 0.15)
      .fromTo(".bottom-nav", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "expo.out", clearProps: "transform,opacity" }, 0.2);
  }

  /* ---------------------------------------------------------------- boot */
  async function boot() {
    if (C.storage.get("cooper-reduce-motion", false)) document.documentElement.classList.add("reduce-motion");
    C.scene.init();
    bindSettings();
    bindWeather();
    bindSidebar();
    bindGlobal();
    bindSwitcher();
    const introP = C.intro.play();
    try {
      state.catalog = await fetch("/api/catalog", { signal: AbortSignal.timeout(20000) }).then(CooperWorkflow.readResponse);
    } catch (err) {
      await introP; revealShell();
      $("#boot-error").hidden = false;
      $("#boot-error .msg").textContent = `${C.t("Could not load the app:")} ${err.message}`;
      return;
    }
    window.CooperCatalog = state.catalog;
    C.analysis.mount($("#view-analysis"), state.catalog);
    C.jarvis.mount();
    C.fields.ensure(state.catalog);
    renderSwitcher();
    clock(); setInterval(clock, 1000);
    refreshWeatherPill(); setInterval(refreshWeatherPill, 10 * 60e3);
    const f = C.fields.active();
    C.analysis.load(f);
    const first = await homeRecord(f);
    C.jarvis.setContext(f, first);
    if (first) C.player.setAnalysis(first);
    await introP;
    revealShell();
    await show();
    state.booted = true;
  }
  $("#boot-retry")?.addEventListener("click", () => location.reload());
  boot();
})();
