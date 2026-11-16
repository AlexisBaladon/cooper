/* Cooper · motion layer shared by every view.
 * - Cards enter when they scroll into view (and again after leaving it), with their bars,
 *   rings, numbers and icons animating as they arrive.
 * - Option and overall cards tilt toward the pointer with a soft light.
 * - Illustrated icons come alive on hover.
 * - Score cards open in a large focus view and fly back to their place when closed. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { $, $$, icon, esc } = C;
  const G = () => C.motion.gsap;

  /* ------------------------------------------------------------- ring gauge */
  C.ring = (value, colorVar, size = 64, stroke = 7, cls = "") => {
    const r = size / 2 - stroke / 2 - 1, c = 2 * Math.PI * r;
    return `<svg class="ring-gauge ${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="track" style="stroke-width:${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fill" style="stroke:var(${colorVar});stroke-width:${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-ring="${c * (1 - Math.max(0, Math.min(100, value)) / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  };

  /* ------------------------------------------------------- what animates */
  function liven(el) {
    const g = G();
    C.motion.bars(el);
    $$("[data-ring]", el).forEach((c) => {
      if (c.closest(".back")) return;
      const full = c.getAttribute("stroke-dasharray");
      if (g) g.fromTo(c, { attr: { "stroke-dashoffset": full } }, { attr: { "stroke-dashoffset": c.dataset.ring }, duration: 1.5, ease: "expo.out", delay: 0.15 });
      else c.setAttribute("stroke-dashoffset", c.dataset.ring);
    });
    $$("[data-count]", el).forEach((n) => C.motion.count(n, Number(n.dataset.count), { decimals: n.dataset.decimals ? Number(n.dataset.decimals) : 0 }));
    if (g) {
      const imgs = $$("img.i3d", el).filter((i) => !i.closest(".back")).slice(0, 14);
      g.fromTo(imgs, { scale: 0.4, rotation: -18, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.8, ease: "back.out(2.2)", stagger: 0.04, delay: 0.1, clearProps: "transform,opacity" });
    }
  }

  /* ------------------------------------------------------ scroll reveals */
  const SKIP = ".dlg-wrap, .wx-modal-wrap, #player-shell, #jarvis, .focus-wrap, .m3d-wrap, .menu";
  const state = new WeakMap(); // el → "hidden" | "shown"
  let queue = [], raf = 0;
  const io = "IntersectionObserver" in window ? new IntersectionObserver(onIntersect, { threshold: [0, 0.01, 0.02, 0.04, 0.08], rootMargin: "0px 0px -6% 0px" }) : null;

  function hide(el, fromAbove = false) {
    const g = G();
    if (!g) return;
    // Option cards come in from the side and settle in their place; the rest rise softly.
    if (el.matches(".opt-card")) g.set(el, { opacity: 0, x: fromAbove ? 90 : -90, y: 0, scale: 0.94, rotationY: fromAbove ? 14 : -14, transformPerspective: 1200, transformOrigin: "50% 50%" });
    else g.set(el, { opacity: 0, y: fromAbove ? -36 : 46, scale: 0.965, rotationX: fromAbove ? -6 : 7, transformPerspective: 1100, transformOrigin: "50% 0%" });
    state.set(el, "hidden");
  }
  function onIntersect(entries) {
    for (const e of entries) {
      const el = e.target;
      // Enough of it is on screen: 8 % of a normal card, or ~160 px of a very tall section
      // (a long column of cards on a phone never reaches 8 %).
      const seen = e.isIntersecting && (e.intersectionRatio >= 0.08 || e.intersectionRect.height >= Math.min(160, e.boundingClientRect.height * 0.08));
      if (seen) {
        if (state.get(el) === "hidden") { state.set(el, "queued"); queue.push(el); }
      } else if (state.get(el) === "shown" && e.intersectionRatio === 0) {
        // Out of sight: get ready to enter again from the side it will come back.
        const r = e.boundingClientRect;
        if (r.bottom < 0 || r.top > window.innerHeight) hide(el, r.bottom < 0);
      }
    }
    if (queue.length && !raf) raf = requestAnimationFrame(flush);
  }
  function flush() {
    raf = 0;
    const g = G();
    const batch = queue.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    queue = [];
    batch.forEach((el, i) => {
      state.set(el, "shown");
      if (!g) return;
      const side = el.matches(".opt-card");
      g.to(el, { opacity: 1, x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, duration: side ? 0.95 : 1.05, ease: side ? "back.out(1.25)" : "expo.out", delay: i * (side ? 0.11 : 0.075),
        onStart: () => liven(el), clearProps: "transform,opacity,transformPerspective" });
    });
  }
  function observe(el) {
    if (!el || el.closest(SKIP)) return false;
    if (!io || !G()) { liven(el); return true; }
    if (state.has(el)) return true;
    hide(el);
    io.observe(el);
    return true;
  }
  C.fx = { observe, liven };

  /* C.motion.reveal routes page cards through the observer; everything else animates at once. */
  const baseReveal = C.motion.reveal.bind(C.motion);
  C.motion.reveal = (targets, opts = {}) => {
    const els = typeof targets === "string" ? $$(targets) : [].concat(targets).flat().filter(Boolean);
    const rest = els.filter((el) => !(el.matches?.("[data-rev], .card, .opt-card") && observe(el)));
    if (rest.length) baseReveal(rest, opts);
  };

  /* --------------------------------------------------- tilt and light */
  const TILT = ".opt-card, .card.overall, .rot.card, .tile, .choice, .h-item";
  let tiltEl = null;
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || C.reducedMotion()) return;
    const el = e.target.closest?.(TILT);
    if (el !== tiltEl) { if (tiltEl) untilt(tiltEl); tiltEl = el; }
    if (!el || el.closest(SKIP)) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    el.classList.add("lit");
    const g = G();
    // The overall card is tall: a soft tilt only, so its lower edge never swings away from the pointer.
    const strong = el.matches(".card.overall") ? 0.2 : el.matches(".opt-card") ? 1 : el.matches(".rot.card") ? 0.6 : 0.35;
    const big = r.width > 700 ? 0.35 : 1;
    // Option cards only catch the light; they never move under the pointer.
    if (g && !el.classList.contains("flipping") && !el.matches(".opt-card")) {
      g.to(el, { rotationY: (px - 0.5) * 9 * strong * big, rotationX: -(py - 0.5) * 7 * strong * big, y: el.matches(".card.overall") ? -1 : -4 * strong, transformPerspective: el.matches(".card.overall") ? 2400 : 1000,
        duration: 0.6, ease: "power3.out", overwrite: "auto" });
    }
  }, { passive: true });
  function untilt(el) {
    el.classList.remove("lit");
    G()?.to(el, { rotationY: 0, rotationX: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.6)", overwrite: "auto", clearProps: "transform" });
  }
  document.addEventListener("pointerleave", () => { if (tiltEl) untilt(tiltEl); tiltEl = null; });

  /* Living icons: every illustrated icon moves all the time with its own motion (styles.css,
     "living icons"); the sidebar menu icons stay still and move only on hover. */

  /* ------------------------------------------------------- focus view */
  let focus = null;
  function openFocus(card, html, opts = {}) {
    if (focus) return;
    const g = G();
    const from = card.getBoundingClientRect();
    const wrap = document.createElement("div");
    wrap.className = "focus-wrap";
    wrap.innerHTML = `<div class="focus-card ${opts.cls || ""}" role="dialog" aria-modal="true" aria-label="${esc(opts.label || "Details")}">
      <button type="button" class="focus-close icon-btn" aria-label="Close">${C.line("close")}</button>
      <div class="focus-body"></div></div>`;
    const body = $(".focus-body", wrap);
    if (typeof html === "string") body.innerHTML = html; else body.appendChild(html);
    document.body.appendChild(wrap);
    document.body.classList.add("has-dialog");
    const box = $(".focus-card", wrap);
    focus = { wrap, box, card, opener: document.activeElement };
    card.style.visibility = "hidden";
    opts.onOpen?.(body);
    const to = box.getBoundingClientRect();
    if (g) {
      g.fromTo(wrap, { backgroundColor: "rgba(4,10,7,0)", backdropFilter: "blur(0px)" }, { backgroundColor: "rgba(4,10,7,.55)", backdropFilter: "blur(14px)", duration: 0.6 });
      g.fromTo(box, { x: from.left - to.left, y: from.top - to.top, scaleX: from.width / to.width, scaleY: from.height / to.height, transformOrigin: "0 0", rotationY: -6, transformPerspective: 1400 },
        { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationY: 0, duration: 0.85, ease: "expo.inOut" });
      g.fromTo(body.children, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: "expo.out", delay: 0.4, onStart: () => liven(body) });
    } else liven(body);
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest(".focus-close")) closeFocus(); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeFocus(); } });
    setTimeout(() => $(".focus-close", wrap).focus(), 80);
  }
  function closeFocus() {
    if (!focus) return;
    const { wrap, box, card, opener } = focus;
    focus = null;
    const g = G();
    const done = () => { wrap.remove(); card.style.visibility = ""; if (!$(".dlg-wrap, .focus-wrap, .m3d-wrap")) document.body.classList.remove("has-dialog"); opener?.focus?.({ preventScroll: true }); };
    const r = card.getBoundingClientRect(), to = box.getBoundingClientRect();
    if (g && r.width) {
      g.to($(".focus-body", wrap), { opacity: 0, duration: 0.18 });
      g.to(box, { x: r.left - to.left, y: r.top - to.top, scaleX: r.width / to.width, scaleY: r.height / to.height, transformOrigin: "0 0", duration: 0.65, ease: "expo.inOut" });
      g.to(wrap, { backgroundColor: "rgba(4,10,7,0)", backdropFilter: "blur(0px)", duration: 0.65, onComplete: done });
    } else done();
  }
  C.fx.openFocus = openFocus;
  C.fx.closeFocus = closeFocus;
  Object.defineProperty(C.fx, "focusOpen", { get: () => !!focus });

  /* Click a score card anywhere except on its own controls (or its "open large" button) to
     bring it close. A drag (scrolling the crop calendar, selecting text in the card) does
     not open it. */
  const INTERACTIVE = "button, a, summary, input, select, textarea, label, canvas, .leaflet-container, .more";
  let downAt = null;
  document.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".opt-card, .rot.card");
    if (!card || card.closest(SKIP)) return;
    const zoom = e.target.closest("[data-zoom]");
    if (!zoom && e.target.closest(INTERACTIVE)) return;
    if (!zoom && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
    const sel = window.getSelection?.();
    if (!zoom && sel && !sel.isCollapsed && sel.toString().trim() && card.contains(sel.anchorNode)) return;
    focusCard(card);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".opt-card, .rot.card")) { e.preventDefault(); focusCard(e.target); }
  });
  let focusAlt = null;
  document.addEventListener("pointerdown", (e) => { const alt = e.target.closest(".opt-card.flipped .alt"); focusAlt = alt ? [...alt.parentElement.children].indexOf(alt) + 1 : null; }, true);
  function focusCard(card) {
    if (card.matches(".opt-card")) {
      const k = card.dataset.score;
      // A turned card opens on the alternative that was clicked; otherwise on the best option.
      const n = card.classList.contains("flipped") ? (focusAlt ?? 1) : 0;
      focusAlt = null;
      const html = C.home?.focusHTML?.(k, n);
      if (html) openFocus(card, html, { cls: "wide opt-focus", label: C.SCORES[k].label, onOpen: (b) => { b.style.setProperty("--c", `var(${C.SCORES[k].color})`); C.home.bindFocus(b, k); } });
      return;
    }
    try { openRotation(card); } catch (err) {
      // Never leave the farmer without the large view: show the plain card if the enhanced
      // layout fails for any reason.
      console.error("Cooper: enhanced large view failed", err);
      if (focus) return;
      const plain = card.cloneNode(true);
      plain.removeAttribute("style"); plain.classList.add("is-focus", "plain");
      plain.querySelectorAll("details").forEach((d) => { d.open = false; });
      openFocus(card, plain, { cls: "wide rot-focus", label: card.querySelector("h3")?.textContent || "Rotation" });
    }
  }
  function openRotation(card) {
    const clone = card.cloneNode(true);
    clone.removeAttribute("style");
    clone.classList.add("is-focus");
    clone.querySelector(".rot-zoom")?.remove();
    // Large view: the rotation's facts fill the left column; on the right, the month-by-month
    // guide and the explanations, which always start closed.
    clone.querySelectorAll("details").forEach((d) => { d.open = false; });
    clone.querySelectorAll("[data-ring]").forEach((c) => c.setAttribute("stroke-dashoffset", c.getAttribute("stroke-dasharray")));
    const left = document.createElement("div"), right = document.createElement("div");
    left.className = "rf-left"; right.className = "rf-right";
    [...clone.children].forEach((ch) => (ch.tagName === "DETAILS" ? right : left).appendChild(ch));
    const acc = document.createElement("div"); acc.className = "rf-more";
    acc.innerHTML = `<p class="rf-label">${C.t("More about this rotation")}</p>`;
    [...right.children].forEach((d) => acc.appendChild(d));
    right.appendChild(acc);
    const fk = C.results?.focusKpis?.(card.dataset.guide);
    if (fk) left.querySelector(".kpis")?.insertAdjacentHTML("afterend", fk), left.querySelector(".kpis:not(.fk)")?.remove();
    const guide = C.results?.guideHTML?.(card.dataset.guide);
    if (guide) right.insertAdjacentHTML("afterbegin", guide);
    clone.append(left, right);
    openFocus(card, clone, { cls: "wide rot-focus", label: card.querySelector("h3")?.textContent || "Rotation",
      onOpen: (b) => setTimeout(() => C.results?.bindGuide?.(b.querySelector(".rg")), 120) });
  }
})();
