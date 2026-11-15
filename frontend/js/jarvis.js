/* Cooper · Jarvis, the floating assistant. HUD rings (jarvis image) around a WebGL plasma core.
 * Answers questions about the open analysis: Groq when the server has a key, otherwise guided
 * answers built from the same numbers. It explains; it never decides. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { esc, fmt, icon, $, $$ } = C;

  const S = { el: null, open: false, history: [], busy: false, rec: null, field: null, core: null, tl: null };

  /* --------------------------------------------------------- WebGL core */
  function plasma(canvas) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return null;
    const vs = "attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}";
    const fs = `precision mediump float;varying vec2 v;uniform float t;uniform float e;uniform float dk;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p*=2.03;a*=.5;}return s;}
      void main(){
        vec2 uv=v;float r=length(uv);float a=atan(uv.y,uv.x);
        float w=fbm(vec2(a*1.6+t*.35,r*4.-t*.9))*.55+fbm(uv*3.5+vec2(t*.2,-t*.15))*.45;
        float pulse=.5+.5*sin(t*(2.2+e*5.));
        float core=smoothstep(.62,.0,r+w*.18-.06*pulse*(.4+e));
        float rim=smoothstep(.02,.0,abs(r-(.5+.04*sin(a*6.+t*2.))))*(.55+e*.6);
        float sp=0.;
        for(int k=0;k<14;k++){float fk=float(k);float ang=t*(.5+.07*fk)*(mod(fk,2.)<.5?1.:-1.)+fk*2.399;float rad=.33+.24*fract(fk*.618+t*.03);
          vec2 q=vec2(cos(ang),sin(ang))*rad;sp+=.0016/(.0009+dot(uv-q,uv-q))*(.35+.65*h(vec2(fk,1.)));}
        vec3 deep=vec3(.02,.26,.42),cy=vec3(.18,.85,1.),wh=vec3(.85,1.,1.);
        vec3 col=deep*core*1.2+cy*pow(core,1.6)*(.9+e*.6)+wh*pow(core,5.)*.9+cy*rim+cy*sp*.05;
        float al=clamp(core*.95+rim*.8+sp*.04,0.,1.)*smoothstep(.98,.7,r);
        gl_FragColor=vec4(col*al,al);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ut = gl.getUniformLocation(pr, "t"), ue = gl.getUniformLocation(pr, "e");
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let energy = 0, target = 0, raf = 0, start = performance.now(), running = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { const s = canvas.clientWidth * dpr; if (canvas.width !== s) { canvas.width = canvas.height = s; gl.viewport(0, 0, s, s); } };
    const reduce = C.reducedMotion();
    const frame = (now) => {
      raf = 0;
      resize();
      energy += (target - energy) * 0.06;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(ut, reduce ? 3 : (now - start) / 1000); gl.uniform1f(ue, energy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (running && !reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running && !raf) raf = requestAnimationFrame(frame); });
    return { set(e) { target = e; if (reduce && !raf) raf = requestAnimationFrame(frame); } };
  }

  /* --------------------------------------------------------------- DOM */
  function build() {
    const el = document.createElement("div");
    el.id = "jarvis";
    el.innerHTML = `
      <div class="jv-bubble" role="status" hidden><strong>Hi, I'm Jarvis.</strong> Ask me about your analysis.</div>
      <button type="button" class="jv-orb" aria-label="Open Jarvis, the Cooper assistant" aria-expanded="false" aria-controls="jv-panel">
        <span class="jv-glow" aria-hidden="true"></span>
        <canvas class="jv-core" aria-hidden="true"></canvas>
        <img class="jv-ring a" src="assets/brand/jarvis-256.webp" alt="" aria-hidden="true" width="256" height="256">
        <img class="jv-ring b" src="assets/brand/jarvis-256.webp" alt="" aria-hidden="true" width="256" height="256">
        <svg class="jv-arcs" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" class="arc1"/><circle cx="50" cy="50" r="41" class="arc2"/></svg>
      </button>
      <section class="jv-panel" id="jv-panel" role="dialog" aria-label="Jarvis assistant" hidden>
        <header class="jv-head">
          <span class="jv-mini" aria-hidden="true"><img src="assets/brand/jarvis-256.webp" alt=""></span>
          <div><strong>Jarvis</strong><small class="jv-status">Cooper assistant</small></div>
          <button type="button" class="icon-btn" data-jv="clear" title="New conversation" aria-label="New conversation">${icon("reset")}</button>
          <button type="button" class="icon-btn" data-jv="close" aria-label="Close">${icon("close")}</button>
        </header>
        <div class="jv-log" aria-live="polite"></div>
        <div class="jv-suggest"></div>
        <form class="jv-input">
          <label class="sr-only" for="jv-text">Message</label>
          <input id="jv-text" autocomplete="off" maxlength="600" placeholder="Ask about water, soil, income, climate…">
          <button type="submit" class="icon-btn send" aria-label="Send">${icon("send")}</button>
        </form>
        <p class="jv-foot">Jarvis explains your analysis; it doesn't decide. Check with your agronomist.</p>
      </section>`;
    document.body.appendChild(el);
    S.el = el;
    S.core = plasma($(".jv-core", el));
    if (!S.core) el.classList.add("no-gl");
    const orb = $(".jv-orb", el);
    orb.addEventListener("click", () => toggle());
    orb.addEventListener("pointerenter", () => { S.core?.set(0.5); speed(3); });
    orb.addEventListener("pointerleave", () => { S.core?.set(S.busy ? 1 : 0); speed(1); });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-jv]");
      if (b?.dataset.jv === "close") toggle(false);
      if (b?.dataset.jv === "clear") { S.history = []; $(".jv-log", el).innerHTML = ""; greet(); }
      const s = e.target.closest("[data-ask]");
      if (s) ask(s.dataset.ask);
      const a = e.target.closest("[data-action]");
      if (a) act(a.dataset.action);
    });
    $(".jv-input", el).addEventListener("submit", (e) => { e.preventDefault(); const i = $("#jv-text"); const q = i.value.trim(); if (q) { i.value = ""; ask(q); } });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) { toggle(false); $(".jv-orb", el).focus(); } });
    // Rings spin with GSAP so their speed can change smoothly.
    const g = C.motion.gsap;
    if (g) {
      S.tl = [g.to($(".jv-ring.a", el), { rotation: 360, duration: 26, ease: "none", repeat: -1 }),
        g.to($(".jv-ring.b", el), { rotation: -360, duration: 17, ease: "none", repeat: -1 }),
        g.to($(".jv-arcs", el), { rotation: 360, duration: 9, ease: "none", repeat: -1, transformOrigin: "50% 50%" })];
      g.to($(".jv-glow", el), { scale: 1.12, opacity: 0.85, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: -1 });
    } else el.classList.add("css-spin");
  }
  function speed(k) { const g = C.motion.gsap; if (!g || !S.tl) return; S.tl.forEach((t) => g.to(t, { timeScale: k, duration: 0.6 })); }

  function entrance() {
    const g = C.motion.gsap, orb = $(".jv-orb", S.el);
    if (g) g.fromTo(orb, { scale: 0, rotation: -120, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 1.2, ease: "expo.out", delay: 0.4 });
    if (C.storage.get("cooper-jarvis-greeted")) return;
    setTimeout(() => {
      const b = $(".jv-bubble", S.el); if (S.open) return;
      b.hidden = false;
      if (g) g.fromTo(b, { opacity: 0, y: 8, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "expo.out" });
      setTimeout(() => { if (g) g.to(b, { opacity: 0, duration: 0.4, onComplete: () => { b.hidden = true; } }); else b.hidden = true; }, 6500);
      C.storage.set("cooper-jarvis-greeted", true);
    }, 2200);
  }

  function toggle(force) {
    const open = force ?? !S.open;
    if (open === S.open) return;
    S.open = open;
    const panel = $(".jv-panel", S.el), orb = $(".jv-orb", S.el);
    orb.setAttribute("aria-expanded", String(open));
    S.el.classList.toggle("is-open", open);
    $(".jv-bubble", S.el).hidden = true;
    const g = C.motion.gsap;
    if (open) {
      panel.hidden = false;
      if (!$(".jv-log", S.el).children.length) greet();
      if (g) {
        g.fromTo(panel, { opacity: 0, y: 24, scale: 0.92, transformOrigin: "100% 100%" }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "expo.out" });
        g.fromTo($$(".jv-msg, .jv-suggest button", panel), { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.04, duration: 0.4, delay: 0.15 });
      }
      S.core?.set(0.35);
      setTimeout(() => $("#jv-text")?.focus(), 80);
    } else {
      S.core?.set(0);
      if (g) g.to(panel, { opacity: 0, y: 16, scale: 0.95, duration: 0.25, ease: "power2.in", onComplete: () => { panel.hidden = true; } });
      else panel.hidden = true;
    }
  }

  /* ----------------------------------------------------------- dialogue */
  function suggestions() {
    const has = !!S.rec;
    const list = has ? ["Which option saves the most water?", "How can I reduce erosion?", "Explain my best option", "What if it rains 20% less?", "Play the explanation"]
      : ["How does Cooper work?", "Run a new analysis", "What data does Cooper use?"];
    $(".jv-suggest", S.el).innerHTML = list.map((q) => `<button type="button" class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
  }
  function greet() {
    const f = S.field?.nombre;
    say("assistant", S.rec
      ? `Hello! I have the analysis of ${f} from ${C.dateLabel(S.rec.fecha)}. Ask me about water, soil, income, forage or climate risk, or about any rotation.`
      : `Hello! I'm Jarvis. There's no analysis for ${f || "this field"} yet. Run one and I'll help you read it.`,
      S.rec ? null : [{ label: "New analysis", action: "new" }]);
    suggestions();
  }
  function say(role, text, actions, source) {
    const log = $(".jv-log", S.el);
    const m = document.createElement("div");
    m.className = `jv-msg ${role}`;
    m.innerHTML = `<p>${esc(text).replace(/\n/g, "<br>")}</p>${actions?.length ? `<div class="jv-actions">${actions.map((a) => `<button type="button" class="btn soft sm" data-action="${esc(a.action)}">${esc(a.label)}</button>`).join("")}</div>` : ""}${source ? `<small class="jv-src">${esc(source)}</small>` : ""}`;
    log.appendChild(m);
    C.motion.gsap?.fromTo(m, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" });
    log.scrollTop = log.scrollHeight;
    if (role !== "typing") S.history.push({ role: role === "assistant" ? "assistant" : "user", content: text });
    S.history = S.history.slice(-8);
    return m;
  }

  async function ask(q) {
    if (S.busy) return;
    say("user", q);
    const local = intent(q);
    if (local?.immediate) { setTimeout(() => say("assistant", local.text, local.actions, local.source), 250); return; }
    S.busy = true; S.core?.set(1); speed(4);
    const typing = document.createElement("div");
    typing.className = "jv-msg assistant typing"; typing.innerHTML = "<span></span><span></span><span></span>";
    $(".jv-log", S.el).appendChild(typing);
    $(".jv-log", S.el).scrollTop = 1e6;
    let answer = null;
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ message: q, language: C.lang(), history: S.history.slice(-7, -1).map((h) => ({ role: h.role, content: h.content.slice(0, 600) })), context: context() }) });
      if (r.ok) { const d = await r.json(); if (d.fuente === "groq" && d.respuesta) answer = { text: d.respuesta, actions: local?.actions, source: "AI answer from your analysis data" }; }
    } catch (_) { /* guided answer below */ }
    typing.remove();
    S.busy = false; S.core?.set(S.open ? 0.35 : 0); speed(1);
    const out = answer || local || { text: helpText(), actions: [] };
    say("assistant", out.text, out.actions, answer ? out.source : (local ? "Guided answer from your analysis data" : null));
    $(".jv-status", S.el).textContent = C.t(answer ? "Cooper assistant · AI on" : "Cooper assistant");
  }

  const has = (q, words) => words.some((w) => q.includes(w));
  function intent(raw) {
    const q = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (has(q, ["how does cooper work", "como funciona", "what data", "que datos", "data does"]))
      return { immediate: true, text: "Cooper downloads 30 years of daily NASA POWER climate (1996–2025) and NASA SRTM terrain for your field. It simulates the water balance and erosion of every rotation in its library with written agronomic rules, and scores water saving, soil health, income (relative), forage and climate resilience. No AI makes the decisions." };
    if (has(q, ["new analysis", "nuevo analisis", "run a", "analizar"])) return { immediate: true, text: "Let's go to New analysis. Check the field, your current rotation and your priorities, then press Analyze my field.", actions: [{ label: "New analysis", action: "new" }] };
    if (!S.rec) return { immediate: true, text: "I need an analysis of this field to answer that. Run one first and I'll explain the results.", actions: [{ label: "New analysis", action: "new" }] };
    const r = S.rec.result, ranking = r.ranking || r.rotaciones, cur = ranking.find((x) => x.id === r.rotaciones[0].id) || r.rotaciones[0];
    const best = (k) => C.home.bestBy(ranking, k)[0];
    const topic = (k) => {
      const b = best(k), p = b.perfil?.[k];
      const same = b.id === cur.id;
      return `${same ? "Your current rotation is already the best" : "The best option"} for ${C.t(C.SCORES[k].label).toLowerCase()} is ${C.t(b.nombre)}, with ${b.puntajes[k]} points${same ? "" : ` (today: ${cur.puntajes[k]})`}. ${p ? cap(C.t(p.por_que)) + "." : ""}${p && p.recomendaciones?.length && p.nivel !== "fuerte" ? " Idea: " + C.t(p.recomendaciones[0]) + "." : ""}`;
    };
    if (has(q, ["rain", "lluv", "simul", "scenario", "escenario", "drought", "sequia"]) && has(q, ["less", "menos", "20", "what if", "si llueve", "simul"]))
      return { immediate: true, text: "I can recalculate everything with 20% less rain over the same 30-year record. It's a what-if simulation, not a forecast.", actions: [{ label: "Simulate 20% less rain", action: "rain-20" }] };
    if (has(q, ["play", "explain", "explica", "video", "reproduc", "narr"]) && !has(q, ["best", "mejor"])) return { immediate: true, text: "Here is the narrated explanation of this analysis. It keeps playing while you use the rest of the app.", actions: [{ label: "Play the explanation", action: "play" }] };
    if (/\b(save|keep|store)\b.*\b(analysis|this|it)\b|\bguard(a|ar)\b/.test(q) && !/\bsaves?\b.*\b(water|soil)\b|ahorra/.test(q)) return { immediate: true, text: S.rec.saved ? "This analysis is already saved in your history." : "I can save this analysis in your history with its date and time.", actions: S.rec.saved ? [{ label: "Open history", action: "history" }] : [{ label: "Save analysis", action: "save" }] };
    if (/\b(pdf|export|report|informe|reporte)\b/.test(q)) return { immediate: true, text: "I'll prepare a PDF report of this analysis, with the logo, charts, maps and tables.", actions: [{ label: "Export PDF", action: "pdf" }] };
    if (has(q, ["weather", "tiempo", "pronostico", "forecast", "temperatura hoy"])) return { text: weatherText(), actions: [] };
    if (has(q, ["water", "agua", "riego", "deficit"])) return { text: topic("agua"), actions: [] };
    if (has(q, ["soil", "suelo", "erosion", "erod"])) return { text: topic("suelo") + (cur.indicadores.erosion_t_ha != null ? ` Your current rotation loses about ${fmt(cur.indicadores.erosion_t_ha, 1)} t/ha a year (tolerance ${r.zonas?.tolerancia_t_ha || 7}).` : ""), actions: [{ label: "See zones of the field", action: "analysis" }] };
    if (has(q, ["income", "ingreso", "plata", "money", "renta"])) return { text: topic("ingreso") + " Income is a relative score: there are no prices, costs or yields.", actions: [] };
    if (has(q, ["forage", "forraje", "ganado", "livestock", "pastur"])) return { text: topic("forraje"), actions: [] };
    if (has(q, ["climate", "clima", "helada", "frost", "calor", "heat", "resilien"])) return { text: topic("clima"), actions: [] };
    if (has(q, ["best", "mejor", "recom", "suggest", "conviene", "option", "opcion"])) {
      const b = ranking[0];
      return { text: b.id === cur.id ? `For your priorities, your current rotation (${C.t(cur.nombre)}) already has the highest total: ${fmt(cur.total)} out of 100.`
        : `For your priorities, the best overall option is ${C.t(b.nombre)} with ${fmt(b.total)} out of 100, against ${fmt(cur.total)} for your current rotation. Review the trade-offs with your agronomist before deciding.`, actions: [{ label: "Open full analysis", action: "analysis" }] };
    }
    return null;
  }
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
  function helpText() {
    return "I can tell you the best option for water, soil, income, forage or climate risk, simulate less rain, play the explanation, save the analysis or export a PDF.";
  }
  function weatherText() {
    const w = C.weather.last;
    if (!w) return "I don't have the weather for this field right now.";
    const a = w.actual;
    return `Now at ${S.field?.nombre}: ${fmt(a.temp, 0)} °C, ${C.t(a.estado).toLowerCase()}, humidity ${fmt(a.humedad)}%. Rain forecast for the week: ${fmt(w.diario.reduce((s, d) => s + (d.lluvia_mm || 0), 0), 0)} mm.`;
  }

  function act(a) {
    if (a === "new" || a === "analysis") { C.go("analysis"); if (a === "new") C.analysis.selectTab("new"); }
    if (a === "history") { C.go("analysis/history"); }
    if (a === "play" && S.rec) C.player.open(S.rec, $(".jv-orb", S.el));
    if (a === "save") C.saveCurrent?.();
    if (a === "pdf" && S.rec) C.exporter.pdf(S.rec);
    if (a === "rain-20") C.simulateRain?.(-20);
    if (matchMedia("(max-width: 700px)").matches) toggle(false);
  }

  /* Compact summary sent with each question (no coordinates). */
  function context() {
    if (!S.rec) return { campo: S.field?.nombre, analisis: null };
    const r = S.rec.result, ranking = r.ranking || r.rotaciones;
    const pick = (x) => ({ nombre: x.nombre, total: x.total, puntajes: Object.fromEntries(Object.keys(C.SCORES).map((k) => [k, x.puntajes[k]])),
      agua_usada_mm: x.indicadores.uso_agua_mm, deficit_ano_seco_mm: x.indicadores.deficit_seco_mm, erosion_t_ha: x.indicadores.erosion_t_ha,
      meses_sin_cultivo: x.indicadores.meses_descubiertos, por_que: x.perfil ? Object.fromEntries(Object.entries(x.perfil).map(([k, p]) => [k, p.por_que])) : undefined });
    const months = r.clima.mensual;
    return {
      campo: S.rec.context?.field, fecha: S.rec.fecha, area_ha: S.rec.input.area_ha, ganado: S.rec.input.tiene_ganado,
      prioridades: S.rec.input.prioridades, escenario: r.escenario,
      actual: pick(ranking.find((x) => x.id === r.rotaciones[0].id) || r.rotaciones[0]),
      ranking: ranking.slice(0, 5).map(pick),
      mejor_por_tema: Object.fromEntries(Object.keys(C.SCORES).map((k) => { const b = C.home.bestBy(ranking, k)[0]; return [k, { nombre: b.nombre, puntaje: b.puntajes[k] }]; })),
      clima: { lluvia_anual_mm: Math.round(months.reduce((s, m) => s + m.lluvia_mm, 0)), et0_anual_mm: Math.round(months.reduce((s, m) => s + m.et0_mm, 0)),
        tendencias: r.clima.tendencias.indicadores.map((t) => ({ nombre: t.nombre, cambio_pct: t.cambio_pct })) },
      terreno: r.zonas ? { desnivel_m: Math.round(r.zonas.resumen.desnivel_m), pendiente_media_pct: r.zonas.resumen.pendiente_media_pct, bajos_pct: r.zonas.resumen.area_baja_pct, tolerancia_t_ha: r.zonas.tolerancia_t_ha } : null,
      diagnostico_actual: (r.rotaciones[0].diagnostico?.items || []).map((d) => ({ tema: d.etiqueta, nivel: d.nivel, por_que: d.por_que })),
    };
  }

  function setContext(field, rec) {
    const changed = S.rec?.id !== rec?.id || S.field?.id !== field?.id;
    S.field = field; S.rec = rec;
    if (changed && S.el && $(".jv-log", S.el).children.length) { S.history = []; $(".jv-log", S.el).innerHTML = ""; if (S.open) greet(); }
    if (S.el) suggestions();
  }

  C.jarvis = { mount() { build(); entrance(); }, setContext, toggle, context, intent };
})();
