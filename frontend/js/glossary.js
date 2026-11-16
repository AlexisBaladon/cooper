/* Cooper · glossary: one list of terms, shown where each term is used.
 * A small "i" button is placed next to the first mention of a term in each zone of the page
 * (card, table, collapsible block); pointing at it, focusing it or tapping it opens the definition.
 * Text stays in English here; language.js translates the bubble like any other text. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc } = C;

  /* `match` runs against the English text of a text node (language.js keeps the original). */
  const TERMS = [
    { id: "et", name: "Evapotranspiration (ET)", match: /\b(?:evapotranspiration|ET0)\b/i, es: /evapotranspiración|ET0/i,
      html: "The water that leaves the field for the atmosphere: what evaporates from the soil plus what plants transpire. <em>Reference ET</em> (ET0) is the value for well-watered grass; each crop uses a fraction of it." },
    { id: "deficit", name: "Water deficit", match: /\bwater deficit\b/i, es: /déficit(?: hídrico| de agua)?/i,
      html: "The water a crop would need but can't find, either in the rain or in the soil." },
    { id: "cover", name: "Cover crop", match: /\bcover crops?\b/i, es: /(?:cultivo|leguminosa) de cobertura|cobertura/i,
      html: "A crop sown to protect and improve the soil rather than to sell, such as black oat or vetch." },
    { id: "firstsecond", name: "First-crop and second-crop", match: /\b(?:first|second)-crop\b/i, es: /de (?:primera|segunda)/i,
      html: "A first crop is sown on its normal date; a second crop (for example second-crop soybean) is sown later, right after harvesting a winter crop, so one paddock gives two harvests in a year." },
    { id: "rusle", name: "Erosion (RUSLE)", match: /\b(?:erosion|RUSLE)\b/i, es: /erosión|RUSLE/i,
      html: "A formula used worldwide (and in Uruguay's Erosión 6.0 tool from MGAP) to estimate how many tonnes of soil per hectare are lost each year. It combines rainfall strength, soil type, slope and slope length, and how long the soil stays covered." },
    { id: "twi", name: "Relative wetness (TWI)", match: /\b(?:relative wetness|TWI)\b/i, es: /humedad relativa|TWI/i,
      html: "An index of where water runs and collects based on the shape of the land: low spots and drainage lines collect water, while hilltops dry out first. It's relative within your field." },
    { id: "rootzone", name: "Root-zone soil moisture", match: /\broot-zone\b/i, es: /zona radicular/i,
      html: "How full of water the soil is, from 0 (dry) to 1 (saturated). It comes from a NASA model (MERRA-2) that combines satellites and weather stations." },
    { id: "frost", name: "Frost risk", match: /\bfrost[- ]risk\b/i, es: /riesgo de helada/i,
      html: "Days when the minimum air temperature is 2 °C or lower. We use 2 °C instead of 0 °C because the ground and leaves get colder than the air 2 m above them." },
    { id: "dry", name: "Dry year", match: /\bdry years?\b/i, es: /años? secos?/i,
      html: "A bad year that comes about once every five. For rainfall, it's the amount exceeded in 4 out of 5 years; for the crops' water deficit, the amount exceeded in only 1 out of 5 years." },
  ];
  const BY_ID = Object.fromEntries(TERMS.map((t) => [t.id, t]));
  const ANY = new RegExp(TERMS.map((t) => t.match.source).join("|"), "i");

  /* Text in these places never gets a button (controls, maps…). */
  const SKIP = "script,style,noscript,select,option,button,a,textarea,canvas,svg,[contenteditable],.gloss-pop,.leaflet-container,.sr-only,.notranslate,#toasts,.intro,.sidebar,.topbar,.bottom-nav";
  /* A term is explained once per zone. */
  const ZONE = "table,details,article,.card,section,.dlg,.jv-panel";

  const english = (node) => window.CooperLang?.original?.(node) ?? node.nodeValue;
  const zoneOf = (el) => el.closest(ZONE) || document.body;
  const shown = (text) => (window.CooperLang ? window.CooperLang.t(text) : text);

  function makeButton(term) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gloss-i";
    b.dataset.term = term.id;
    b.setAttribute("aria-label", `${term.name} · Glossary`);
    b.setAttribute("aria-expanded", "false");
    return b;
  }

  /* A sentence with terms becomes <span class="gloss-x">text <button> text</span>. The span keeps
     the English sentence and draws it in the current language itself, so each button stays right
     after its word in both languages (language.js leaves .notranslate alone). */
  function draw(span) {
    const text = shown(span.dataset.en), es = C.lang() === "es";
    const cuts = span.dataset.terms.split(",").map((id) => {
      const m = (es ? BY_ID[id].es : BY_ID[id].match).exec(text);
      return { id, at: m ? m.index + m[0].length : text.replace(/\s+$/, "").length };
    }).sort((x, y) => x.at - y.at);
    const open = openFor && span.contains(openFor) ? openFor.dataset.term : null;
    span.textContent = "";
    let from = 0;
    for (const c of cuts) {
      if (c.at > from) span.append(text.slice(from, c.at));
      const b = makeButton(BY_ID[c.id]);
      span.append(b);
      if (open === c.id) { openFor = b; b.setAttribute("aria-expanded", "true"); b.setAttribute("aria-describedby", "gloss-pop"); }
      from = Math.max(from, c.at);
    }
    if (from < text.length) span.append(text.slice(from));
  }

  /* ----------------------------------------------------------------- scan */
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(scan); }
  });
  const watch = () => observer.observe(document.body, { subtree: true, childList: true });

  function scan() {
    scheduled = false;
    observer.disconnect();
    const have = new Map(); // zone → Set of term ids already explained there
    const seen = (zone) => {
      if (!have.has(zone)) have.set(zone, new Set());
      return have.get(zone);
    };
    document.querySelectorAll(".gloss-i").forEach((b) => seen(zoneOf(b)).add(b.dataset.term));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const todo = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || node.nodeValue.length < 3) continue;
      const text = english(node);
      if (!ANY.test(text) || parent.closest(SKIP)) continue;
      const done = seen(zoneOf(parent));
      const ids = TERMS.filter((t) => !done.has(t.id) && t.match.test(text)).map((t) => t.id);
      ids.forEach((id) => done.add(id));
      if (ids.length) todo.push([node, text, ids]);
    }
    for (const [n, text, ids] of todo) {
      const span = document.createElement("span");
      span.className = "gloss-x notranslate";
      span.dataset.en = text;
      span.dataset.terms = ids.join(",");
      n.replaceWith(span);
      draw(span);
    }
    watch();
  }
  function redraw() {
    observer.disconnect();
    document.querySelectorAll(".gloss-x").forEach(draw);
    watch();
    requestAnimationFrame(place);
  }
  /* --------------------------------------------------------------- bubble */
  let pop = null, openFor = null, pinned = false, hideTimer = 0;

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement("div");
    pop.className = "gloss-pop";
    pop.id = "gloss-pop";
    pop.setAttribute("role", "tooltip");
    pop.hidden = true;
    pop.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    pop.addEventListener("pointerleave", () => { if (!pinned) hideSoon(); });
    document.body.appendChild(pop);
    return pop;
  }

  function place() {
    if (!openFor || !pop) return;
    if (!openFor.isConnected) return hide();
    const r = openFor.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const w = pop.offsetWidth, h = pop.offsetHeight, gap = 10, edge = 8;
    const above = r.bottom + gap + h > vh - edge && r.top - gap - h > edge;
    const left = Math.min(vw - w - edge, Math.max(edge, r.left + r.width / 2 - w / 2));
    pop.classList.toggle("above", above);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(above ? r.top - gap - h : r.bottom + gap)}px`;
    pop.style.setProperty("--ax", `${Math.round(Math.min(w - 16, Math.max(16, r.left + r.width / 2 - left)))}px`);
  }

  function show(btn, pin) {
    const term = BY_ID[btn.dataset.term];
    if (!term) return;
    clearTimeout(hideTimer);
    ensurePop();
    if (openFor && openFor !== btn) { openFor.setAttribute("aria-expanded", "false"); openFor.removeAttribute("aria-describedby"); }
    if (openFor !== btn) pop.innerHTML = `<strong class="gloss-t">${esc(term.name)}</strong><p>${term.html}</p>`;
    openFor = btn; pinned = !!pin;
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-describedby", "gloss-pop");
    pop.hidden = false;
    /* inside a modal dialog the bubble must sit above it */
    place();
    window.CooperLang?.refresh?.();
    place();
  }
  function hide() {
    clearTimeout(hideTimer);
    if (openFor) { openFor.setAttribute("aria-expanded", "false"); openFor.removeAttribute("aria-describedby"); }
    openFor = null; pinned = false;
    if (pop) pop.hidden = true;
  }
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 160); };
  const btnOf = (e) => (e.target instanceof Element ? e.target.closest(".gloss-i") : null);

  /* Capture phase: the button may sit inside clickable rows, cards or <summary>. */
  document.addEventListener("click", (e) => {
    const b = btnOf(e);
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (openFor === b && pinned) hide(); else show(b, true);
    } else if (openFor && !(e.target instanceof Element && e.target.closest(".gloss-pop"))) hide();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openFor) { e.stopPropagation(); const b = openFor; hide(); b.focus?.(); return; }
    if (btnOf(e) && (e.key === "Enter" || e.key === " ")) e.stopPropagation();
  }, true);
  document.addEventListener("pointerover", (e) => {
    const b = btnOf(e);
    if (b && e.pointerType !== "touch" && !(pinned && openFor !== b)) show(b, pinned && openFor === b);
  }, true);
  document.addEventListener("pointerout", (e) => {
    if (btnOf(e) && e.pointerType !== "touch" && !pinned) hideSoon();
  }, true);
  document.addEventListener("focusin", (e) => { const b = btnOf(e); if (b && b.matches(":focus-visible") && !pinned) show(b, false); });
  document.addEventListener("focusout", (e) => { if (btnOf(e) && !pinned) hideSoon(); });
  window.addEventListener("scroll", place, { capture: true, passive: true });
  window.addEventListener("resize", place);
  window.addEventListener("hashchange", hide);
  window.addEventListener("cooper-language", redraw);

  C.glossary = { TERMS, scan };
  scan();
})();
