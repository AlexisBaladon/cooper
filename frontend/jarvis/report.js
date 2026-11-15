// Reporte de Cooper sobre el análisis real (/api/analyze): vistas con datos + guion narrado.
//
// - VIEWS: cada vista arma un visual (visuals.js) o el globo con los números del análisis.
//   Las usa el reporte y también el chat: el modelo solo elige el id, nunca pone números.
//   Los ids tienen que coincidir con VIEWS en backend/app/jarvis.py.
// - buildReport(): el guion, con plantillas en inglés (adaptadas de "Explain it simply" de Cooper).
// - Los textos fijos de pantalla están en UI (inglés y español). Los que vienen del motor
//   (motivos, riesgos, ideas, nombres) pasan por t(): si el servidor los pudo traducir,
//   devuelve la traducción; si no, quedan en inglés.
// - buildContext(): resumen compacto del análisis para el chat (sin coordenadas).

const AG_NUM = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4];       // año agrícola: mayo → abril
const MONTH_FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ROLE_INDEX = { current: 0, alt1: 1, alt2: 2 };
const SCORE_KEYS = ["agua", "suelo", "ingreso", "forraje", "clima"];
const SCORE_LABELS = { agua: "Water saving", suelo: "Soil health", ingreso: "Income (indicative)", forraje: "Forage", clima: "Climate resilience" };
const AMBER = "#ffb347", GREEN = "#3dffc2", CYAN = "#4fd8ff";

const UI = {
  en: {
    months: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
    bare: "no crop", today: "Today", alt: "Alt", rain: "Rainfall", et: "Water the sun takes away",
    axes: ["Water", "Soil", "Income", "Forage", "Climate"], limit: "limit",
    level: { fuerte: "Good", medio: "Fair", flojo: "Weak" },
    diagnosis: "Strengths and weaknesses", ideas: "Ideas to improve", risks: "Review with your agronomist",
    why: "Why it scores better", noIdeas: "No weak points in what matters to you.",
    chapters: ["Your field", "Climate", "Your rotation today", "Strengths and weaknesses", "A better option", "Before you decide"],
  },
  es: {
    months: ["May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic", "Ene", "Feb", "Mar", "Abr"],
    bare: "sin cultivo", today: "Hoy", alt: "Alt", rain: "Lluvia", et: "Agua que se lleva el sol",
    axes: ["Agua", "Suelo", "Ingreso", "Forraje", "Clima"], limit: "límite",
    level: { fuerte: "Bien", medio: "Regular", flojo: "Flojo" },
    diagnosis: "Lo bueno y lo flojo", ideas: "Ideas para mejorar", risks: "Para revisar con tu agrónomo",
    why: "Por qué puntúa mejor", noIdeas: "Sin puntos flojos en lo que te importa.",
    chapters: ["Tu campo", "Clima", "Tu rotación hoy", "Lo bueno y lo flojo", "Una opción mejor", "Antes de decidir"],
  },
};
export const ui = (lang) => UI[lang] || UI.en;

const nf = (v, d = 0) => Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "custom" es la rotación que el usuario armó a mano (si hay una).
const rotOf = (a, role) => (role === "custom" && a.custom) || a.rotaciones[ROLE_INDEX[role] ?? 0] || a.rotaciones[0];
const trend = (a, id) => a.clima.tendencias.indicadores.find((x) => x.id === id);

/* Nombre de rotación para decir en voz alta: "Wheat / second-crop soybean" → "Wheat and second-crop soybean". */
function spoken(name) {
  return name.replace(/\s*→\s*/g, ", then the next year, ").replace(/\s*\/\s*/g, " and ")
    .replace(/\b2nd\b/g, "second-crop").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}
function speakable(text) {
  return text.replace(/\s*\([^)]*\)/g, "").replace(/~/g, "about ").replace(/→/g, " to ")
    .replace(/t\/ha/g, "tonnes per hectare").replace(/\s+/g, " ").trim();
}
function shortRisk(text) {
  const head = speakable(text).split(/[:;]/)[0].replace(/\.$/, "");
  return head.length > 80 ? head.slice(0, 77).replace(/\s+\S*$/, "") + "…" : head;
}
function longestRun(flags) {
  let best = [], cur = [];
  flags.forEach((f, i) => { if (f) { cur.push(i); if (cur.length > best.length) best = cur.slice(); } else cur = []; });
  return best;
}

/* ------------------------------------------------------ datos del campo */
function grid(a) {
  const z = a.zonas;
  if (!z) return null;
  const n = Math.round(Math.sqrt(z.celdas.length));
  return { n, elev: z.celdas.map((c) => c.elev), side_m: z.celda_m * n };
}
/* Imagen satelital del cuadrado del campo (Esri World Imagery, la misma que usa Cooper en el mapa). */
function fieldImage(a) {
  const [[latMin, lonMin], [latMax, lonMax]] = a.zonas.bounds;
  return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
    + `?bbox=${lonMin},${latMin},${lonMax},${latMax}&bboxSR=4326&imageSR=4326&size=512,512&format=jpg&f=image`;
}
const erosCells = (a, rot) => a.zonas.celdas.map((c) => c.eros[rot.id]);
const tolerance = (a) => (a.zonas && a.zonas.tolerancia_t_ha) || 7;
const calendarRow = (rot, t) => rot.calendario[0].map((c) => (c ? { id: c.id, abrev: c.abrev, nombre: t(c.nombre) } : null));
const threeLabels = (a, u) => a.rotaciones.map((r, i) => (i === 0 ? u.today : `${u.alt} ${i}`));
const threeColors = (a) => a.rotaciones.map((_, i) => [AMBER, GREEN, CYAN][i]);

/* ================================================================ vistas */
// Cada vista: (análisis, rol, { t, lang }) → { show, label, …parámetros del visual, panel? }.
export const VIEWS = {
  location: (a, role, { t }) => ({ show: "globe", label: t(a.campo || "Your field") }),

  relief: (a, role, { t, lang }) => {
    if (!a.zonas) return { show: "terrain", label: t(a.campo || "Your field") };
    const s = a.zonas.resumen;
    return { show: "fieldplot", grid: grid(a), image: fieldImage(a), lang,
      label: t(`Height difference ${nf(s.desnivel_m)} m · slope ${nf(s.pendiente_media_pct, 1)}%`) };
  },

  climate: (a, role, { t, lang }) => {
    const m = a.clima.mensual, u = ui(lang);
    return { show: "waterchart", rain: m.map((x) => x.lluvia_mm), et0: m.map((x) => x.et0_mm),
      thirsty: m.map((x) => x.et0_mm - x.lluvia_mm > 10), initials: u.months.map((x) => x[0]),
      legend: [u.rain, u.et], lang,
      label: t(`${nf(m.reduce((s, x) => s + x.lluvia_mm, 0))} mm of rain a year`) };
  },

  rain_trend: (a, role, { t, lang }) => trendChart(trend(a, "lluvia_mm"), "Rainfall per year (mm)", t, lang),
  heat_trend: (a, role, { t, lang }) => trendChart(trend(a, "dias_calor"), "Hot days per year", t, lang),

  heat_days: (a, role, { t, lang }) => monthChart(a, "dias_calor", "Hot days (32 °C or more) by month", t, lang),
  frost_days: (a, role, { t, lang }) => monthChart(a, "dias_helada", "Frost-risk days by month", t, lang),

  field: (a, role, env) => {
    const rot = rotOf(a, role), u = ui(env.lang);
    if (!a.zonas) return VIEWS.rotation(a, role, env);
    return { show: "fieldplot", grid: grid(a), image: fieldImage(a), eros: erosCells(a, rot), tol: tolerance(a),
      calendar: calendarRow(rot, env.t), monthNames: u.months, bareText: u.bare, lang: env.lang, label: env.t(rot.nombre) };
  },

  erosion: (a, role, { t, lang }) => {
    const rot = rotOf(a, role);
    if (!a.zonas) return { show: "soil", variant: "erosion", label: t(rot.nombre) };
    return { show: "fieldplot", grid: grid(a), image: fieldImage(a), eros: erosCells(a, rot), tol: tolerance(a), lang,
      label: t(`${nf(rot.indicadores.erosion_t_ha, 1)} t/ha a year · limit ${nf(tolerance(a))}`) };
  },

  erosion_compare: (a, role, { t, lang }) => {
    const u = ui(lang), has = a.rotaciones[0].indicadores.erosion_t_ha != null;
    return { show: "chart", lang, labels: threeLabels(a, u), colors: threeColors(a),
      values: a.rotaciones.map((r) => Number((has ? r.indicadores.erosion_t_ha : r.indicadores.lluvia_suelo_desnudo_mm).toFixed(1))),
      limit: has ? { value: tolerance(a), label: `${u.limit} ${nf(tolerance(a))}` } : undefined,
      label: t(has ? "Soil loss (t/ha a year)" : "Rain on bare soil (mm a year)") };
  },

  deficit_compare: (a, role, { t, lang }) => ({ show: "chart", lang, labels: threeLabels(a, ui(lang)), colors: threeColors(a),
    values: a.rotaciones.map((r) => Math.round(r.indicadores.deficit_seco_mm)), label: t("Water deficit in a dry year (mm)") }),

  rotation: (a, role, { t, lang }) => {
    const rot = rotOf(a, role), years = rot.calendario.length;
    return { show: "calendar", cells: calendarRow(rot, t), first: 5, lang,
      label: t(rot.nombre) + (years > 1 ? ` · 1/${years}` : "") };
  },

  scores: (a, role, { t, lang }) => {
    const cur = a.rotaciones[0], rot = rotOf(a, role);
    const serie = (r, color) => ({ name: `${t(r.nombre)} · ${nf(r.total)}`, values: SCORE_KEYS.map((k) => r.puntajes[k]), color });
    return { show: "radar", axes: ui(lang).axes, series: rot === cur ? [serie(cur, AMBER)] : [serie(cur, AMBER), serie(rot, GREEN)],
      label: `${nf(rot.total)} / 100` };
  },

  totals: (a, role, { t, lang }) => ({ show: "chart", lang, labels: threeLabels(a, ui(lang)), colors: threeColors(a),
    values: a.rotaciones.map((r) => r.total), label: t("Total score for your priorities") }),

  diagnosis: (a, role, env) => {
    const rot = rotOf(a, role), u = ui(env.lang);
    const items = (rot.diagnostico ? rot.diagnostico.items : [])
      .map((i) => `${u.level[i.nivel]} · ${env.t(i.etiqueta)}: ${env.t(cap(i.por_que))}.`);
    return { ...VIEWS.scores(a, role, env), label: env.t(rot.nombre), panel: { title: u.diagnosis, items } };
  },

  ideas: (a, role, { t, lang }) => {
    const rot = rotOf(a, role), u = ui(lang);
    const items = (rot.diagnostico ? rot.diagnostico.items : [])
      .flatMap((i) => i.recomendaciones.map((r) => `${t(i.etiqueta)}: ${t(cap(r))}.`)).slice(0, 6);
    return { show: "soil", variant: "healthy", label: t(rot.nombre), panel: { title: u.ideas, items: items.length ? items : [u.noIdeas] } };
  },

  risks: (a, role, env) => {
    const rot = rotOf(a, role), u = ui(env.lang);
    const items = rot.explicacion.riesgos.slice(0, 6).map((r) => env.t(shortRisk(r)));
    return { ...VIEWS.rotation(a, role, env), panel: { title: u.risks, items } };
  },
};

function trendChart(tr, title, t, lang) {
  const short = (p) => p.split("–").map((y) => y.slice(2)).join("–");
  return { show: "chart", lang, values: [tr.valor_1, tr.valor_2], labels: [short(tr.periodo_1), short(tr.periodo_2)],
    colors: [CYAN, AMBER], label: `${t(title)} · ${tr.cambio_pct > 0 ? "+" : ""}${nf(tr.cambio_pct)}%` };
}
function monthChart(a, key, title, t, lang) {
  return { show: "chart", lang, values: a.clima.mensual.map((m) => m[key]), labels: ui(lang).months.map((x) => x[0]), label: t(title) };
}

/* Convierte un segmento { say, view, rot } en lo que entiende la página. */
export function resolve(seg, a, env) {
  if (!seg.view || !a || !VIEWS[seg.view]) return seg;
  const { view, rot, ...rest } = seg;
  return { ...rest, ...VIEWS[view](a, rot || "current", env) };
}

/* ================================================================ guion */
// Devuelve [{ say, view, rot, chapter }]. t() envuelve cada texto que se puede traducir.
export function buildReport(a, t = (s) => s) {
  const [cur, alt, alt2] = a.rotaciones;
  const ci = cur.indicadores, ai = alt ? alt.indicadores : null;
  const months = a.clima.mensual, tol = tolerance(a), area = (a.zonas && a.zonas.area_ha) || 100;
  const hasEro = ci.erosion_t_ha != null;
  const trucks = (tons) => Math.round((tons * area) / 30);      // camión de ~30 t
  const rain = trend(a, "lluvia_mm"), heat = trend(a, "dias_calor");
  const thirsty = longestRun(months.map((m) => m.et0_mm - m.lluvia_mm > 10)).map((i) => months[i].mes);
  const bareIdx = cur.calendario[0].map((c, i) => (c ? null : i)).filter((x) => x !== null);
  const bareWinter = bareIdx.length && bareIdx.filter((i) => i <= 4).length >= bareIdx.length / 2;
  const place = (a.campo || "").replace(/\s*\(.*\)/, "").replace(/^\w/, (c) => c.toLowerCase());
  const out = [];
  const add = (chapter, view, rot, text) => out.push({ chapter, view, rot, say: t(text) });

  /* 0 · Tu campo */
  add(0, "location", "current", (place ? `Let's take a look at your field ${place}.` : "Let's take a look at your field.")
    + " I pulled thirty years of daily NASA data for this spot.");
  if (a.escenario.activo) {
    add(0, "location", "current", `Keep in mind that this run uses your what-if scenario: rainfall ${a.escenario.lluvia_pct > 0 ? "+" : ""}${nf(a.escenario.lluvia_pct)} percent and temperature +${nf(a.escenario.temp_delta, 1)} degrees.`);
  }
  if (a.zonas) {
    const s = a.zonas.resumen;
    add(0, "relief", "current", `This is its real terrain, measured by NASA's SRTM mission, under a satellite image. From the lowest point to the highest there are ${nf(s.desnivel_m)} meters, with an average slope of ${nf(s.pendiente_media_pct, 1)} percent.`);
  }

  /* 1 · Clima */
  add(1, "climate", "current", "First, your area's climate. The blue bars are each month's rainfall, and the orange line is the water the sun's heat takes away, what agronomists call evapotranspiration.");
  add(1, "climate", "current", thirsty.length
    ? `From ${MONTH_FULL[thirsty[0]]} to ${MONTH_FULL[thirsty[thirsty.length - 1]]}, the line rises above the bars: in those months your crops depend on the water stored in the soil.`
    : "Almost all year it rains more than evaporates.");
  add(1, "rain_trend", "current", `And the climate isn't what it used to be. Between ${rain.periodo_1.replace("–", " and ")} it rained ${nf(rain.valor_1)} millimeters a year on average; since ${rain.periodo_2.split("–")[0]}, ${nf(rain.valor_2)}. That's ${nf(Math.abs(rain.cambio_pct))} percent ${rain.cambio_pct < 0 ? "less" : "more"} rain.`);
  add(1, "heat_trend", "current", `On top of that, very hot days went from ${nf(heat.valor_1)} to ${nf(heat.valor_2)} a year.`);

  /* 2 · Tu rotación hoy */
  add(2, "field", "current", `Now, your current rotation: ${spoken(cur.nombre)}. Watch how the field's cover changes month by month.`);
  add(2, "field", "current", ci.meses_descubiertos >= 0.5
    ? `The soil is bare ${nf(ci.meses_descubiertos)} ${Math.round(ci.meses_descubiertos) === 1 ? "month" : "months"} a year${bareWinter ? ", mostly in autumn and winter" : ""}. When it rains on bare soil, the water carries fertile soil downhill.`
    : "The soil stays covered almost all year, which protects it from the rain.");
  if (hasEro) {
    add(2, "erosion", "current", `We estimate that about ${nf(ci.erosion_t_ha, 1)} tonnes of soil per hectare are lost each year, ${ci.erosion_t_ha > tol ? `more than the ${nf(tol)} considered tolerable` : "within the tolerable limit"}. Across your ${nf(area)} hectares, that's like ${nf(trucks(ci.erosion_t_ha))} truckloads of soil a year. The red areas are where the most soil is lost.`);
  }

  /* 3 · Lo bueno y lo flojo */
  const diag = cur.diagnostico ? cur.diagnostico.items : [];
  const strong = diag.filter((i) => i.nivel === "fuerte"), weak = diag.filter((i) => i.nivel !== "fuerte");
  add(3, "diagnosis", "current", "So how is your current rotation doing, based on what matters to you?"
    + (strong.length ? ` What works: ${strong[0].tema}, because ${strong[0].por_que}.` : ""));
  weak.slice(0, 2).forEach((i) => add(3, "ideas", "current",
    `${i.nivel === "flojo" ? "What's weak" : "Room to improve"}: ${i.tema}, because ${i.por_que}.`
    + (i.recomendaciones[0] ? ` One idea to improve it: ${i.recomendaciones[0]}.` : "")));
  if (!strong.length && !weak.length) add(3, "diagnosis", "current", "We don't see any important weak points in what matters to you.");

  /* 4 · Una opción mejor */
  if (alt) {
    add(4, "field", "alt1", `One option that fits what matters to you is this one: ${spoken(alt.nombre)}.`
      + (ai.meses_descubiertos < ci.meses_descubiertos - 0.5 ? " The soil stays covered almost all year" : " Look at how the field changes")
      + (hasEro && ai.erosion_t_ha < ci.erosion_t_ha ? `, and erosion drops from ${nf(ci.erosion_t_ha, 1)} to about ${nf(ai.erosion_t_ha, 1)} tonnes per hectare.` : "."));
    alt.explicacion.por_que.filter((x) => !x.startsWith("You gave")).slice(0, 2)
      .forEach((x) => add(4, "scores", "alt1", speakable(x)));
    add(4, "totals", "current", `For your priorities it scores ${nf(alt.total)} out of 100, against ${nf(cur.total)} for your current rotation.`
      + (alt2 ? ` A second option, ${spoken(alt2.nombre)}, scores ${nf(alt2.total)}.` : ""));

    /* 5 · Antes de decidir */
    const risks = alt.explicacion.riesgos.filter((r) => !/general literature/.test(r) && !r.startsWith("In exchange"));
    add(5, "risks", "alt1", "Before changing anything, there are things to check."
      + risks.slice(0, 2).map((r) => ` ${shortRisk(r)}.`).join(""));
  }
  add(5, alt ? "risks" : "diagnosis", alt ? "alt1" : "current", "Talk all of this through with your agronomist: this data comes from satellites and a general crop table, and it doesn't know your field like you do. This tool helps you think, but the decision is yours.");
  add(5, "totals", "current", "You can ask me anything about this analysis, or change a detail of your field and run it again.");
  return out;
}

/* Todos los textos traducibles del reporte y de las vistas (para pedir una sola traducción). */
export function collectStrings(a) {
  const seen = new Set();
  const t = (s) => { if (typeof s === "string" && /[a-z]/i.test(s)) seen.add(s); return s; };
  buildReport(a, t);
  for (const view of Object.keys(VIEWS)) for (const role of Object.keys(ROLE_INDEX)) {
    try { VIEWS[view](a, role, { t, lang: "en" }); } catch (e) { /* vista sin datos: no hay nada que traducir */ }
  }
  return [...seen];
}

/* ------------------------------------------------- resumen para el chat */
/* Tramos seguidos del mismo cultivo: "May–Oct: no crop; Nov–Apr: First-crop soybean". */
function calendarText(row) {
  const AG = UI.en.months, parts = [];
  let start = 0;
  for (let i = 1; i <= 12; i++) {
    const prev = row[i - 1] ? row[i - 1].nombre : "no crop";
    const cur = i < 12 ? (row[i] ? row[i].nombre : "no crop") : null;
    if (cur !== prev) { parts.push(`${AG[start]}${i - 1 > start ? "–" + AG[i - 1] : ""}: ${prev}`); start = i; }
  }
  return parts.join("; ");
}

/* Mismo resumen que "Ask Cooper" (~1.500 tokens): el plan gratuito de Groq da 8.000 por minuto. */
export function buildContext(a, form) {
  if (!a) return null;
  const z = a.zonas, months = a.clima.mensual;
  const col = (k, dec = 0) => months.map((m) => Number(m[k].toFixed(dec)));
  const roles = ["current", "alt1", "alt2"];
  return {
    field: a.campo || "A point marked on the globe",
    inputs: {
      current_rotation: a.rotaciones[0].nombre,
      has_livestock: form.ganado,
      soil_water_capacity_mm: form.suelo_mm,
      field_size_ha: form.area_ha,
      priorities_0_to_5: Object.fromEntries(Object.entries(form.prioridades).map(([k, v]) => [SCORE_LABELS[k] || k, v])),
      climate_scenario: a.escenario.activo ? `rainfall ${a.escenario.lluvia_pct}%, temperature +${a.escenario.temp_delta} °C` : "none (historical climate)",
    },
    warnings: a.advertencias,
    climate: {
      source: `NASA POWER daily ${a.meta.periodo}, ~50 km grid`,
      months: UI.en.months.join(","),
      rain_mm: col("lluvia_mm"),
      et0_mm: col("et0_mm"),
      hot_days_over_32c: col("dias_calor", 1),
      frost_risk_days: col("dias_helada", 1),
      trends: a.clima.tendencias.indicadores.map((t) =>
        `${t.nombre}: ${Math.round(t.valor_1)} (${t.periodo_1}) → ${Math.round(t.valor_2)} ${t.unidad} (${t.periodo_2}), ${t.cambio_pct > 0 ? "+" : ""}${t.cambio_pct}%`),
    },
    terrain: z ? `height difference ${z.resumen.desnivel_m} m, mean slope ${z.resumen.pendiente_media_pct}%, max slope ${z.resumen.pendiente_max_pct}%, low spots ${z.resumen.area_baja_pct}% of field, erosion tolerance ${z.tolerancia_t_ha} t/ha/yr`
      : "not available",
    rotations: a.rotaciones.concat(a.custom ? [a.custom] : []).map((r, idx) => {
      const ind = r.indicadores, isCur = idx === 0;
      return {
        role: roles[idx] || "custom (built by the user)",
        name: r.nombre,
        total_score: r.total,
        scores: Object.fromEntries(SCORE_KEYS.map((k) => [SCORE_LABELS[k], r.puntajes[k]])),
        figures: `${ind.meses_descubiertos} months without a crop per year; crops use ${Math.round(ind.uso_agua_mm)} mm of water per year; whole-year crop water deficit: ${Math.round(ind.deficit_mm)} mm in an average year, ${Math.round(ind.deficit_seco_mm)} mm in a dry year (1 in 5); water deficit during critical crop stages only: ${Math.round(ind.deficit_critico_mm)} mm in an average year, ${Math.round(ind.deficit_critico_seco_mm)} mm in a dry year`
          + (ind.erosion_t_ha != null ? `; erosion ${ind.erosion_t_ha} t/ha/yr, ${Math.round(ind.erosion_area_alta_pct)}% of field above tolerance` : `; ${Math.round(ind.lluvia_suelo_desnudo_mm)} mm of rain on bare soil/yr`),
        calendar: r.calendario.map((row, i) => `Year ${i + 1}: ${calendarText(row)}`),
        why: isCur ? undefined : r.explicacion.por_que.filter((x) => !x.startsWith("You gave")),
        // Clima promedio de los meses críticos (lluvia menos evapotranspiración), no el déficit del cultivo.
        critical_stage_climate: r.explicacion.evidencia.filter((e) => e.includes("critical stage")).map((e) => e.replace(/\s*\([^)]*\)/, "")),
        assessment: (r.diagnostico ? r.diagnostico.items : []).map((i) =>
          `${i.etiqueta}: ${UI.en.level[i.nivel].toLowerCase()} (${i.puntaje}), ${i.por_que}` + (i.recomendaciones[0] ? `. Idea: ${i.recomendaciones[0]}` : "")),
        risks: isCur ? undefined : r.explicacion.riesgos.filter((x) => !/general literature/.test(x)).slice(0, 3).map((x) => x.split(/:\s/)[0]),
      };
    }),
  };
}

/* Cifras clave para el tablero. */
export function keyFigures(a, lang) {
  const es = lang === "es", cur = a.rotaciones[0], best = a.rotaciones.slice(1).sort((x, y) => y.total - x.total)[0];
  const rain = a.clima.mensual.reduce((s, x) => s + x.lluvia_mm, 0);
  const rows = [
    [es ? "Lluvia por año" : "Rain per year", `${nf(rain)} mm`],
    [es ? "Puntaje actual" : "Current score", `${nf(cur.total)} / 100`],
  ];
  if (best) rows.push([es ? "Mejor opción" : "Best option", `${nf(best.total)} / 100`]);
  if (cur.indicadores.erosion_t_ha != null) {
    rows.push([es ? "Erosión hoy" : "Erosion today", `${nf(cur.indicadores.erosion_t_ha, 1)} t/ha`]);
    if (best) rows.push([es ? "Erosión con la opción" : "Erosion with option", `${nf(best.indicadores.erosion_t_ha, 1)} t/ha`]);
  }
  rows.push([es ? "Meses sin cultivo" : "Months without a crop", `${nf(cur.indicadores.meses_descubiertos, 1)}${best ? ` → ${nf(best.indicadores.meses_descubiertos, 1)}` : ""}`]);
  if (a.zonas) rows.push([es ? "Desnivel" : "Height difference", `${nf(a.zonas.resumen.desnivel_m)} m`]);
  return rows;
}
