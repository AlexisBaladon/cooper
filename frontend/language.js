/* Local, reversible interface translations; no third-party translation service. */
(function () {
  "use strict";
  if (parent !== window) document.documentElement.classList.add("embedded");
  const originalTitle = document.title;
  let current = "en";
  try { current = localStorage.getItem("cooper-language") === "es" ? "es" : "en"; } catch (_) { /* English is the default */ }
  try { if (parent !== window && parent.CooperLang) current = parent.CooperLang.current; } catch (_) { /* separate origin */ }
  const originals = new WeakMap(), rendered = new WeakMap(), attributes = new WeakMap();
  const translations = new Map();
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Keys that start with "=" only translate a whole text node (short words such as "Home").
  const entries = Object.entries(window.CooperSpanish || {}).filter(([en]) => !en.startsWith("=")).sort((a, b) => b[0].length - a[0].length)
    .map(([en, es]) => [new RegExp((/^[a-z]/i.test(en) ? "\\b" : "") + escape(en) + (/[a-z]$/i.test(en) ? "\\b" : ""), "gi"), es]);
  function translate(text) {
    if (current !== "es" || !text?.trim() || !/[a-z]/i.test(text)) return text;
    if (translations.has(text)) return translations.get(text);
    const exact = window.CooperSpanish?.[text.trim()] || window.CooperSpanish?.["=" + text.trim()];
    if (exact) return text.replace(text.trim(), exact);
    let result = text;
    for (const [pattern, replacement] of entries) result = result.replace(pattern, replacement);
    if (translations.size >= 2048) translations.delete(translations.keys().next().value);
    translations.set(text, result);
    return result;
  }
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); }
  });
  function watch() { observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title", "aria-label", "alt", "placeholder"]}); }
  function refresh() {
    scheduled = false; observer.disconnect();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || node.parentElement.closest("script,style,noscript,#language,.notranslate")) continue;
      const actual = node.nodeValue;
      if (!originals.has(node) || actual !== rendered.get(node)) originals.set(node, actual);
      const output = translate(originals.get(node));
      if (actual !== output) node.nodeValue = output;
      rendered.set(node, output);
    }
    document.querySelectorAll("[title],[aria-label],[alt],[placeholder]").forEach((el) => {
      if (el.id === "language") return;
      const saved = attributes.get(el) || {};
      for (const name of ["title", "aria-label", "alt", "placeholder"]) {
        const actual = el.getAttribute(name); if (actual == null) continue;
        if (!saved[name] || actual !== saved[name].rendered) saved[name] = {original: actual};
        const output = translate(saved[name].original); if (actual !== output) el.setAttribute(name, output);
        saved[name].rendered = output;
      }
      attributes.set(el, saved);
    });
    document.documentElement.lang = current;
    document.title = translate(originalTitle);
    const selector = document.getElementById("language"); if (selector) selector.value = current;
    watch();
  }
  function set(language, persist = true) {
    current = language === "es" ? "es" : "en";
    if (persist) try { localStorage.setItem("cooper-language", current); } catch (_) { /* current tab still works */ }
    refresh(); window.dispatchEvent(new CustomEvent("cooper-language", {detail: current}));
  }
  function prepareSlides(slides) {
    return slides.map((slide) => ({...slide, headline: translate(slide.headline), narration: slide.narration.map(translate)}));
  }
  window.CooperLang = {get current() { return current; }, t: translate, refresh, prepareSlides};
  document.getElementById("language")?.addEventListener("change", (e) => set(e.target.value));
  window.addEventListener("storage", (e) => { if (e.key === "cooper-language") set(e.newValue, false); });
  refresh();
})();
