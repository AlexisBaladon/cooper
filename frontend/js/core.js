/* Cooper · shared core: helpers, icons, motion, theme, storage, fields, dialogs.
 * Classic script (no build step). Everything hangs from window.Cooper. */
(function () {
  "use strict";
  const C = (window.Cooper = window.Cooper || {});

  /* ------------------------------------------------------------ helpers */
  C.$ = (s, root = document) => root.querySelector(s);
  C.$$ = (s, root = document) => [...root.querySelectorAll(s)];
  C.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  C.fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  C.cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  C.t = (s) => (window.CooperLang ? window.CooperLang.t(s) : s);
  C.lang = () => (window.CooperLang ? window.CooperLang.current : "en");
  C.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  C.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  C.reducedMotion = () => document.documentElement.classList.contains("reduce-motion") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  C.needsDarkText = (hex) => {
    const h = String(hex).replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
  };
  C.storage = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  };
  C.on = (el, ev, sel, fn) => el.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t && el.contains(t)) fn(e, t); });
  C.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* Events between modules. */
  const bus = new EventTarget();
  C.emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
  C.listen = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

  /* Lazy loader for optional libraries (PDF). */
  const loaded = {};
  C.loadScript = (src) => (loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.crossOrigin = "anonymous";
    s.onload = resolve; s.onerror = () => { delete loaded[src]; reject(new Error("Could not load " + src)); };
    document.head.appendChild(s);
  }));

  /* -------------------------------------------------------------- icons
   * One stroke family, 24×24, drawn for Cooper (no icon font). */
  const P = {
    home: '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v10.5h13V9"/><path d="M10 19.5v-5.5h4v5.5"/>',
    analysis: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="11" width="3" height="6" rx=".6"/><rect x="12" y="7" width="3" height="10" rx=".6"/><rect x="17" y="13" width="3" height="4" rx=".6"/>',
    field: '<path d="M3 18.5c3-1.6 6-2.4 9-2.4s6 .8 9 2.4"/><path d="M5 14.8c2.4-1.2 4.7-1.8 7-1.8s4.6.6 7 1.8"/><path d="M12 13V6"/><path d="M12 9c0-2.2 1.6-3.8 4-4-.1 2.4-1.7 4-4 4Z"/><path d="M12 10.5c0-1.8-1.3-3.1-3.2-3.3.1 1.9 1.4 3.2 3.2 3.3Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4l-.3 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4Z"/>',
    agua: '<path d="M12 3.5c3.4 4.1 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.6-6.5 6-10.6Z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
    suelo: '<path d="M3 15h18"/><path d="M5 18.5h2M10 18.5h2M15 18.5h2"/><path d="M7 21h1.5M13 21h1.5M18 21h1"/><path d="M12 15V9"/><path d="M12 11c0-3 2-5 5-5.2C16.9 8.8 15 11 12 11Z"/><path d="M12 12.4c0-2.2-1.6-3.8-3.8-4 .1 2.3 1.6 3.9 3.8 4Z"/>',
    ingreso: '<ellipse cx="9" cy="7" rx="5" ry="2.2"/><path d="M4 7v4c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V7"/><path d="M4 11v4c0 1.2 2.2 2.2 5 2.2 1 0 1.9-.1 2.7-.4"/><ellipse cx="16" cy="14" rx="4.5" ry="2"/><path d="M11.5 14v3.6c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V14"/>',
    forraje: '<path d="M4 20c1.5-3.5 1.8-7.2 1-11"/><path d="M8 20c.4-4.2 1.6-8 4-11.5"/><path d="M12.5 20c.2-3.6-.5-7.4-2.5-11"/><path d="M16 20c.5-4 2.2-7.3 4.5-9.5"/><path d="M19 20c-.5-3-1.8-5.6-4-7.6"/><path d="M3 20h18"/>',
    clima: '<path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    overall: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/>',
    back10: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5v4h4"/><text x="12" y="15.2" font-size="6.6" text-anchor="middle" fill="currentColor" stroke="none" font-family="IBM Plex Sans, sans-serif" font-weight="600">10</text>',
    fwd10: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20 3.5v4h-4"/><text x="12" y="15.2" font-size="6.6" text-anchor="middle" fill="currentColor" stroke="none" font-family="IBM Plex Sans, sans-serif" font-weight="600">10</text>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    cc: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6"/>',
    minimize: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><rect x="11.5" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 16.5V20h14v-3.5"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5" rx=".6"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4.5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7 7.5 20h9l1-13"/><path d="M10.5 11v5.5M13.5 11v5.5"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    right: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    pin: '<path d="M12 21s6.5-6.1 6.5-11.3a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.4"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    satellite: '<path d="m13 7 4 4"/><rect x="10.2" y="8.2" width="5" height="5" rx=".8" transform="rotate(45 12.7 10.7)"/><path d="m8.4 8.6-3.9-3.9 2.1-2.1 3.9 3.9M17 14.9l3.9 3.9-2.1 2.1-3.9-3.9"/><path d="M5 15a4 4 0 0 0 4 4M3 15a6 6 0 0 0 6 6"/>',
    layers: '<path d="m12 4 9 4.8-9 4.8-9-4.8z"/><path d="m3 13.2 9 4.8 9-4.8"/>',
    send: '<path d="M4 12 20 4l-4.5 16-3.8-6.7z"/><path d="m11.7 13.3 8.3-9.3"/>',
    moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.1"/>',
    bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M8.2 14.2A6 6 0 1 1 15.8 14.2c-.8.7-1.3 1.6-1.3 2.6v.7h-5v-.7c0-1-.5-1.9-1.3-2.6Z"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7.5"/>',
    wind: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h7"/>',
    humidity: '<path d="M12 3.5c3.4 4.1 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.6-6.5 6-10.6Z"/><path d="m9.5 16 5-5M10 11.5v.1M14 15.5v.1"/>',
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    partly: '<path d="M8.5 6.2a3.6 3.6 0 0 1 5.8 2.3"/><path d="M5 9.2 3.6 8.4M8.5 3V4.6M12.6 4.3l-.9 1.2"/><path d="M7 19h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.7 1.2A2.9 2.9 0 0 0 7 19Z"/>',
    cloudy: '<path d="M6.5 18.5h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 6.5 18.5Z"/>',
    fog: '<path d="M6.5 13.5h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4"/><path d="M4 17h16M6 20h12"/>',
    drizzle: '<path d="M6.5 14.5h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 6.5 14.5Z"/><path d="M9 17.5v1M13 17.5v1M17 17.5v1"/>',
    rain: '<path d="M6.5 14h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 6.5 14Z"/><path d="m9 16.5-1 3M13 16.5l-1 3M17 16.5l-1 3"/>',
    storm: '<path d="M6.5 14h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 6.5 14Z"/><path d="m12.5 14-2 3.5h3l-2 3.5"/>',
    snow: '<path d="M6.5 14h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 6.5 14Z"/><path d="M9 17.5v.1M12 19.5v.1M15 17.5v.1"/>',
    file: '<path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5V8h4"/>',
    leaf: '<path d="M5 19c0-8 5-13.5 14-14-.5 9-6 14-14 14Z"/><path d="M5 19 13 11"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
    star: '<path d="m12 3.8 2.5 5.3 5.7.7-4.2 4 1.1 5.7L12 16.7l-5.1 2.8L8 13.8l-4.2-4 5.7-.7z"/>',
  };
  C.icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.info}</svg>`;

  /* Score metadata shared by every view (labels stay in English; language.js translates). */
  C.SCORES = {
    agua: { label: "Water saving", icon: "agua", color: "--c-agua" },
    suelo: { label: "Soil health", icon: "suelo", color: "--c-suelo" },
    ingreso: { label: "Income (indicative)", icon: "ingreso", color: "--c-ingreso" },
    forraje: { label: "Forage", icon: "forraje", color: "--c-forraje" },
    clima: { label: "Climate resilience", icon: "clima", color: "--c-clima" },
  };
  C.AG_MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
  C.AG_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4];
  C.PRIORITY_HINTS = {
    agua: "Save water",
    suelo: "Look after the soil",
    ingreso: "Income potential (relative)",
    forraje: "Have forage for livestock",
    clima: "Less climate risk",
  };
  C.DEFAULT_PRIORITIES = { agua: 3, suelo: 4, ingreso: 4, forraje: 1, clima: 3 };

  /* -------------------------------------------------------------- motion
   * GSAP when available; every helper degrades to "final state" without it. */
  const G = () => (window.gsap && !C.reducedMotion() ? window.gsap : null);
  // Slow devices must still finish every animation on time (no lag smoothing).
  if (window.gsap) window.gsap.ticker.lagSmoothing(0);
  C.motion = {
    get gsap() { return G(); },
    reveal(targets, opts = {}) {
      const els = typeof targets === "string" ? C.$$(targets) : [].concat(targets).flat().filter(Boolean);
      if (!els.length) return;
      const g = G();
      if (!g) { els.forEach((e) => { e.style.opacity = ""; e.style.transform = ""; }); return; }
      g.fromTo(els, { opacity: 0, y: opts.y ?? 18, scale: opts.scale ?? 1 },
        { opacity: 1, y: 0, scale: 1, duration: opts.duration ?? 0.7, ease: opts.ease ?? "expo.out",
          stagger: opts.stagger ?? 0.06, delay: opts.delay ?? 0, clearProps: "transform,opacity" });
    },
    count(el, to, { decimals = 0, prefix = "", suffix = "", duration = 1.1, from = 0 } = {}) {
      if (!el) return;
      const g = G();
      const out = (v) => { el.textContent = prefix + C.fmt(v, decimals) + suffix; };
      if (!g || to == null) { out(to ?? 0); return; }
      const o = { v: from };
      g.to(o, { v: to, duration, ease: "power3.out", onUpdate: () => out(o.v) });
    },
    bars(root) {
      const els = C.$$("[data-w]", root);
      const g = G();
      els.forEach((el, i) => {
        const w = el.dataset.w + "%";
        if (!g) { el.style.width = w; return; }
        g.fromTo(el, { width: "0%" }, { width: w, duration: 1.1, ease: "expo.out", delay: 0.15 + i * 0.03 });
      });
    },
  };

  /* --------------------------------------------------------------- theme */
  C.theme = {
    get() { return C.storage.get("cooper-theme", "system"); },
    effective() {
      const t = this.get();
      return t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
    },
    set(t) {
      C.storage.set("cooper-theme", t);
      const root = document.documentElement;
      const apply = () => {
        if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", this.effective() === "dark" ? "#0b120e" : "#10261a");
        C.emit("theme", this.effective());
      };
      // Cross-fade the whole interface when the browser supports view transitions.
      if (document.startViewTransition && !C.reducedMotion()) document.startViewTransition(apply); else apply();
    },
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (C.theme.get() === "system") C.emit("theme", C.theme.effective()); });

  /* --------------------------------------------------------------- toast */
  C.toast = (msg, kind = "ok", ms = 3600) => {
    const root = C.$("#toasts");
    if (!root) return;
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.innerHTML = `${C.icon(kind === "error" ? "alert" : kind === "info" ? "info" : "check")}<span>${C.esc(msg)}</span>`;
    root.appendChild(el);
    const g = G();
    if (g) g.fromTo(el, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" });
    setTimeout(() => {
      if (g) g.to(el, { y: 8, opacity: 0, duration: 0.3, onComplete: () => el.remove() }); else el.remove();
    }, ms);
  };

  /* --------------------------------------------------------------- dialog
   * Accessible modal: focus trap, Escape, restores focus, blurred backdrop. */
  C.dialog = ({ title, body, actions = [], wide = false, onOpen }) => new Promise((resolve) => {
    const opener = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "dlg-wrap";
    wrap.innerHTML = `<div class="dlg ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <header class="dlg-head"><h2 id="dlg-title">${C.esc(title)}</h2>
        <button type="button" class="icon-btn" data-dlg="close" aria-label="Close">${C.icon("close")}</button></header>
      <div class="dlg-body"></div>
      <footer class="dlg-foot">${actions.map((a, i) => `<button type="${a.submit ? "submit" : "button"}" class="btn ${a.kind || "ghost"}" data-dlg="${i}">${C.esc(a.label)}</button>`).join("")}</footer>
    </div>`;
    const bodyEl = C.$(".dlg-body", wrap);
    if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    document.body.appendChild(wrap);
    document.body.classList.add("has-dialog");
    const box = C.$(".dlg", wrap);
    const close = (value) => {
      const done = () => { wrap.remove(); if (!C.$(".dlg-wrap")) document.body.classList.remove("has-dialog"); opener?.focus?.(); resolve(value); };
      const g = G();
      if (g) { g.to(box, { y: 14, opacity: 0, scale: 0.98, duration: 0.22, ease: "power2.in" }); g.to(wrap, { opacity: 0, duration: 0.25, onComplete: done }); }
      else done();
    };
    wrap.addEventListener("click", async (e) => {
      if (e.target === wrap) return close(null);
      const b = e.target.closest("[data-dlg]");
      if (!b) return;
      if (b.dataset.dlg === "close") return close(null);
      const a = actions[Number(b.dataset.dlg)];
      if (a?.handler) {
        const r = await a.handler(bodyEl);
        if (r === false) return;
        return close(r ?? a.value ?? true);
      }
      close(a?.value ?? true);
    });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(null); }
      if (e.key === "Tab") {
        const f = C.$$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]', box).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    const g = G();
    if (g) { g.fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: 0.25 }); g.fromTo(box, { y: 24, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }); }
    onOpen?.(bodyEl, close);
    setTimeout(() => (C.$("[autofocus]", box) || C.$("input,select,button.btn", box) || box).focus(), 30);
  });
  C.confirm = (title, text, label = "Confirm", kind = "danger") =>
    C.dialog({ title, body: `<p>${C.esc(text)}</p>`, actions: [{ label: "Cancel", value: false }, { label, kind, value: true }] });

  /* ------------------------------------------------------------- storage
   * IndexedDB: saved analyses (history) and the last unsaved result per field. */
  const DB_NAME = "cooper", DB_VERSION = 1;
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("analyses")) {
          const s = d.createObjectStore("analyses", { keyPath: "id" });
          s.createIndex("fieldId", "fieldId"); s.createIndex("fecha", "fecha");
        }
        if (!d.objectStoreNames.contains("drafts")) d.createObjectStore("drafts", { keyPath: "fieldId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbp = null; throw e; });
    return dbp;
  }
  const tx = async (store, mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((r) => { out = r; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Transaction aborted"));
    });
  };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  /* Memory fallback keeps the session usable in private windows without IndexedDB. */
  const mem = { analyses: new Map(), drafts: new Map() };
  C.db = {
    async put(store, value) {
      try { await tx(store, "readwrite", (s) => { s.put(value); }); }
      catch (_) { mem[store].set(value.id || value.fieldId, value); }
      return value;
    },
    async get(store, key) {
      try { return await tx(store, "readonly", (s) => reqP(s.get(key))); }
      catch (_) { return mem[store].get(key) || null; }
    },
    async all(store) {
      try { return await tx(store, "readonly", (s) => reqP(s.getAll())); }
      catch (_) { return [...mem[store].values()]; }
    },
    async del(store, key) {
      try { await tx(store, "readwrite", (s) => { s.delete(key); }); }
      catch (_) { mem[store].delete(key); }
    },
    async clear() {
      for (const s of ["analyses", "drafts"]) {
        try { await tx(s, "readwrite", (st) => { st.clear(); }); } catch (_) { mem[s].clear(); }
      }
    },
  };

  /* -------------------------------------------------------------- fields
   * Each user can keep several independent fields in this browser. */
  C.fields = {
    list() { return C.storage.get("cooper-fields", []); },
    save(list) { C.storage.set("cooper-fields", list); C.emit("fields", list); },
    get(id) { return this.list().find((f) => f.id === id) || null; },
    activeId() { return C.storage.get("cooper-active-field", null); },
    active() { return this.get(this.activeId()) || this.list()[0] || null; },
    setActive(id) { C.storage.set("cooper-active-field", id); C.emit("active-field", this.get(id)); },
    upsert(field) {
      const list = this.list();
      const i = list.findIndex((f) => f.id === field.id);
      if (i >= 0) list[i] = { ...list[i], ...field, actualizado: new Date().toISOString() };
      else list.push({ ...field, id: field.id || C.uid(), creado: new Date().toISOString() });
      this.save(list);
      return list.find((f) => f.id === (field.id || list[list.length - 1].id));
    },
    async remove(id) {
      const list = this.list().filter((f) => f.id !== id);
      this.save(list);
      await C.db.del("drafts", id);
      const saved = (await C.db.all("analyses")).filter((a) => a.fieldId === id);
      for (const a of saved) await C.db.del("analyses", a.id);
      if (this.activeId() === id) this.setActive(list[0]?.id ?? null);
    },
    /* First visit: start with the sample field near Young so the app is never empty. */
    ensure(catalog) {
      if (this.list().length) { if (!this.active()) this.setActive(this.list()[0].id); return; }
      const d = catalog.campos_demo[0];
      const f = this.upsert({
        id: "sample-" + d.id, nombre: d.nombre, muestra: true, lat: d.lat, lon: d.lon, area_ha: 100,
        rotacion_actual: d.rotacion, tiene_ganado: d.tiene_ganado, capacidad_suelo_mm: 120,
        prioridades: { ...C.DEFAULT_PRIORITIES },
      });
      this.setActive(f.id);
    },
  };

  /* Same square as the backend (terrain.field_grid). */
  C.fieldBounds = (lat, lon, ha) => {
    const side = Math.sqrt(ha * 10000);
    const dlat = side / 111320;
    const dlon = side / (111320 * Math.cos((lat * Math.PI) / 180));
    return [[lat - dlat / 2, lon - dlon / 2], [lat + dlat / 2, lon + dlon / 2]];
  };
  C.inUruguay = (lat, lon) => !(lat < -35.1 || lat > -30 || lon < -58.6 || lon > -53);

  /* Map tiles shared by every map. */
  C.baseLayers = () => ({
    Satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 17, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }),
    Map: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }),
  });

  C.dateLabel = (iso, opts = { dateStyle: "medium", timeStyle: "short" }) => {
    try { return new Intl.DateTimeFormat(C.lang() === "es" ? "es-UY" : "en-GB", opts).format(new Date(iso)); }
    catch (_) { return iso; }
  };
})();
