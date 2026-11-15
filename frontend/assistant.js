/* Cooper — "Ask Cooper": botón fijo de chat sobre el análisis, con notas de voz (Whisper, Groq).
 *
 * La página manda al servidor la pregunta, el historial corto y un resumen del último análisis
 * (sin coordenadas). La respuesta es breve y solo usa esos datos. UI en inglés.
 */
"use strict";
(() => {
  const MAX_SECONDS = 60;
  const AG = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
  const SCORE_LABELS = { agua: "Water saving", suelo: "Soil health", ingreso: "Income (indicative)", forraje: "Forage", clima: "Climate resilience" };
  const ROLE = { actual: "current", alternativa_1: "alternative 1", alternativa_2: "alternative 2" };
  const LEVEL = { fuerte: "good", medio: "fair", flojo: "weak" };
  const SUGGESTIONS = ["When do my crops go thirsty?", "Why is alternative 1 better?", "How much soil am I losing?"];

  const history = [];          // {role: "user"|"assistant", content}
  let busy = false;
  let recorder = null, chunks = [], recTimer = null, recStart = 0;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ------------------------------------------------------------ interfaz */
  const root = document.createElement("div");
  root.className = "ask";
  root.innerHTML = `
    <button type="button" class="ask-fab" id="ask-fab" aria-expanded="false" aria-controls="ask-panel">
      <span class="ask-fab-ic" aria-hidden="true">💬</span><span class="ask-fab-label">Ask Cooper</span>
    </button>
    <section class="ask-panel" id="ask-panel" role="dialog" aria-label="Ask Cooper" hidden>
      <header class="ask-head">
        <div><strong>Ask Cooper</strong><small>Short answers from your analysis</small></div>
        <button type="button" class="ask-x" id="ask-close" aria-label="Close">✕</button>
      </header>
      <div class="ask-log" id="ask-log" aria-live="polite"></div>
      <div class="ask-sugg" id="ask-sugg"></div>
      <form class="ask-form" id="ask-form">
        <textarea id="ask-input" rows="1" maxlength="1000" placeholder="Ask about your analysis…" aria-label="Your question"></textarea>
        <button type="button" class="ask-mic" id="ask-mic" aria-label="Record a voice question" title="Record a voice question (up to ${MAX_SECONDS} s)">🎤</button>
        <button type="submit" class="ask-send" id="ask-send" aria-label="Send">➤</button>
      </form>
      <p class="ask-foot">AI can make mistakes. Check important decisions with your agronomist.</p>
    </section>`;
  document.body.appendChild(root);

  const $ = (id) => document.getElementById(id);
  const fab = $("ask-fab"), panel = $("ask-panel"), log = $("ask-log"), input = $("ask-input");
  const mic = $("ask-mic"), sendBtn = $("ask-send"), sugg = $("ask-sugg");

  function bubble(role, text, extra = "") {
    const el = document.createElement("div");
    el.className = `ask-msg ${role} ${extra}`.trim();
    // Texto plano: se quitan marcas de formato (**negrita**, # títulos) por si el modelo las usa.
    el.innerHTML = esc(String(text).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, ""));
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function renderSuggestions() {
    sugg.hidden = history.length > 0;
    sugg.innerHTML = SUGGESTIONS.map((s) => `<button type="button" class="ask-chip">${esc(s)}</button>`).join("");
  }

  function open() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    root.classList.add("open");
    if (!log.childElementCount) {
      bubble("assistant", window.cooperAnalysis
        ? "Hi! Ask me anything about this analysis: climate, rotations, scores or erosion. You can type or record a voice note."
        : "Hi! Run an analysis first (Analyze my field), then ask me about it. You can type or record a voice note.");
      renderSuggestions();
    }
    input.focus();
  }

  function close() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    root.classList.remove("open");
    if (recorder && recorder.state === "recording") recorder.stop();
    fab.focus();
  }

  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    mic.disabled = on && !(recorder && recorder.state === "recording");
    input.disabled = on;
  }

  /* --------------------------------------------- resumen del análisis */
  /* Tramos seguidos del mismo cultivo: "May–Oct: no crop; Nov–Apr: First-crop soybean". */
  function calendarText(row) {
    const parts = [];
    let start = 0;
    for (let i = 1; i <= 12; i++) {
      const prev = row[i - 1] ? row[i - 1].nombre : "no crop";
      const cur = i < 12 ? (row[i] ? row[i].nombre : "no crop") : null;
      if (cur !== prev) {
        parts.push(`${AG[start]}${i - 1 > start ? "–" + AG[i - 1] : ""}: ${prev}`);
        start = i;
      }
    }
    return parts.join("; ");
  }

  /* Resumen compacto (~1.500 tokens): el plan gratuito de Groq permite 8.000 tokens por minuto. */
  function buildContext() {
    const a = window.cooperAnalysis;
    if (!a) return null;
    const d = a.data, q = a.request || {};
    const z = d.zonas, months = d.clima.mensual;
    const col = (k, dec = 0) => months.map((m) => Number(m[k].toFixed(dec)));
    return {
      field: a.campo || "A point marked on the map",
      inputs: {
        current_rotation: d.rotaciones[0].nombre,
        has_livestock: q.tiene_ganado,
        soil_water_capacity_mm: q.capacidad_suelo_mm,
        field_size_ha: q.area_ha,
        priorities_0_to_5: q.prioridades && Object.fromEntries(Object.entries(q.prioridades).map(([k, v]) => [SCORE_LABELS[k] || k, v])),
        climate_scenario: d.escenario.activo ? `rainfall ${d.escenario.lluvia_pct}%, temperature +${d.escenario.temp_delta} °C` : "none (historical climate)",
      },
      warnings: d.advertencias,
      climate: {
        source: `NASA POWER daily ${d.meta.periodo}, ~50 km grid`,
        months: AG.join(","),
        rain_mm: col("lluvia_mm"),
        et0_mm: col("et0_mm"),
        hot_days_over_32c: col("dias_calor", 1),
        frost_risk_days: col("dias_helada", 1),
        trends: d.clima.tendencias.indicadores.map((t) =>
          `${t.nombre}: ${Math.round(t.valor_1)} (${t.periodo_1}) → ${Math.round(t.valor_2)} ${t.unidad} (${t.periodo_2}), ${t.cambio_pct > 0 ? "+" : ""}${t.cambio_pct}%`),
      },
      terrain: z ? `height difference ${z.resumen.desnivel_m} m, mean slope ${z.resumen.pendiente_media_pct}%, max slope ${z.resumen.pendiente_max_pct}%, low spots ${z.resumen.area_baja_pct}% of field, erosion tolerance ${z.tolerancia_t_ha} t/ha/yr`
        : "not available",
      rotations: d.rotaciones.map((r) => {
        const ind = r.indicadores;
        return {
          role: ROLE[r.rol] || r.rol,
          name: r.nombre,
          total_score: r.total,
          scores: Object.fromEntries(Object.entries(r.puntajes).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [SCORE_LABELS[k] || k, v])),
          figures: `${ind.meses_descubiertos} months without a crop per year; crops use ${Math.round(ind.uso_agua_mm)} mm of water per year; whole-year crop water deficit: ${Math.round(ind.deficit_mm)} mm in an average year, ${Math.round(ind.deficit_seco_mm)} mm in a dry year (1 in 5); water deficit during critical crop stages only: ${Math.round(ind.deficit_critico_mm)} mm in an average year, ${Math.round(ind.deficit_critico_seco_mm)} mm in a dry year`
            + (ind.erosion_t_ha != null ? `; erosion ${ind.erosion_t_ha} t/ha/yr, ${Math.round(ind.erosion_area_alta_pct)}% of field above tolerance` : `; ${Math.round(ind.lluvia_suelo_desnudo_mm)} mm of rain on bare soil/yr`),
          calendar: r.calendario.map((row, i) => `Year ${i + 1}: ${calendarText(row)}`),
          why: r.rol === "actual" ? undefined : r.explicacion.por_que.filter((t) => !t.startsWith("You gave")),
          // Clima promedio de los meses críticos (lluvia menos evapotranspiración), no el déficit del cultivo.
          critical_stage_climate: r.explicacion.evidencia.filter((e) => e.includes("critical stage"))
            .map((e) => e.replace(/\s*\([^)]*\)/, "")),
          assessment: (r.diagnostico ? r.diagnostico.items : []).map((i) =>
            `${i.etiqueta}: ${LEVEL[i.nivel] || i.nivel} (${i.puntaje}), ${i.por_que}` + (i.recomendaciones[0] ? `. Idea: ${i.recomendaciones[0]}` : "")),
          risks: r.rol === "actual" ? undefined : r.explicacion.riesgos
            .filter((t) => !/general literature/.test(t)).slice(0, 3).map((t) => t.split(/:\s/)[0]),
        };
      }),
    };
  }

  /* ---------------------------------------------------------------- chat */
  async function send(text, { voice = false } = {}) {
    text = text.trim();
    if (!text || busy) return;
    history.push({ role: "user", content: text });
    bubble("user", voice ? `🎤 ${text}` : text);
    renderSuggestions();
    input.value = "";
    autosize();
    setBusy(true);
    const typing = bubble("assistant", "…", "typing");
    try {
      const resp = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // El servidor acepta hasta 20 mensajes de 1500 caracteres y solo usa los últimos 6.
        body: JSON.stringify({
          messages: history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })),
          contexto: buildContext(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(typeof data.detail === "string" ? data.detail : `The assistant couldn't answer (${resp.status}).`);
      typing.remove();
      history.push({ role: "assistant", content: data.respuesta });
      bubble("assistant", data.respuesta);
    } catch (err) {
      typing.remove();
      history.pop(); // la pregunta sin respuesta no queda en el historial
      bubble("assistant", err.message || "The assistant couldn't be reached.", "error");
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  /* ----------------------------------------------------------- audio */
  function pickMime() {
    if (!window.MediaRecorder) return null;
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
      .find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  async function startRecording() {
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices) {
      bubble("assistant", "Voice notes aren't supported in this browser. Please type your question.", "error");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      bubble("assistant", "Microphone access was denied. Allow it in your browser to send voice notes.", "error");
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer);
      mic.classList.remove("recording");
      mic.textContent = "🎤";
      mic.setAttribute("aria-label", "Record a voice question");
      input.placeholder = "Ask about your analysis…";
      uploadRecording(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" }));
    };
    recorder.start();
    recStart = Date.now();
    mic.classList.add("recording");
    mic.textContent = "■";
    mic.setAttribute("aria-label", "Stop recording");
    const tick = () => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      input.placeholder = `Recording… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} (press ■ to send)`;
      if (s >= MAX_SECONDS) recorder.stop();
    };
    tick();
    recTimer = setInterval(tick, 250);
  }

  async function uploadRecording(blob) {
    if (blob.size < 800) {
      bubble("assistant", "That recording was too short. Hold on a bit longer and try again.", "error");
      return;
    }
    setBusy(true);
    const note = bubble("user", "🎤 Transcribing…", "typing");
    try {
      const resp = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(typeof data.detail === "string" ? data.detail : `The recording couldn't be transcribed (${resp.status}).`);
      note.remove();
      setBusy(false);
      await send(data.texto, { voice: true });
    } catch (err) {
      note.remove();
      setBusy(false);
      bubble("assistant", err.message || "The recording couldn't be transcribed.", "error");
    }
  }

  /* ---------------------------------------------------------- eventos */
  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
  }

  fab.addEventListener("click", () => (panel.hidden ? open() : close()));
  $("ask-close").addEventListener("click", close);
  $("ask-form").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  sugg.addEventListener("click", (e) => { const b = e.target.closest(".ask-chip"); if (b) send(b.textContent); });
  mic.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") recorder.stop();
    else if (!busy) startRecording();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(); });

  // Al cambiar de análisis, la conversación empieza de nuevo (el contexto ya es otro).
  window.addEventListener("cooper:analysis", () => {
    history.length = 0;
    log.innerHTML = "";
    if (!panel.hidden) open();
  });
})();
