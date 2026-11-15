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
// Clases de textura del USDA (las que devuelve backend/app/soil.py), en español.
const TEXTURE_ES = { "Clay": "arcilloso", "Silty clay": "arcillo limoso", "Sandy clay": "arcillo arenoso", "Clay loam": "franco arcilloso",
  "Silty clay loam": "franco arcillo limoso", "Sandy clay loam": "franco arcillo arenoso", "Loam": "franco", "Silt loam": "franco limoso",
  "Sandy loam": "franco arenoso", "Silt": "limoso", "Loamy sand": "arenoso franco", "Sand": "arenoso" };
const texture = (name, lang) => (lang === "es" && TEXTURE_ES[name]) || name;

const UI = {
  en: {
    months: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
    bare: "no crop", today: "Today", alt: "Alt", rain: "Rainfall", et: "Water the sun takes away",
    axes: ["Water", "Soil", "Income", "Forage", "Climate"], limit: "limit",
    level: { fuerte: "Good", medio: "Fair", flojo: "Weak" },
    diagnosis: "Strengths and weaknesses", ideas: "Ideas to improve", risks: "Review with your agronomist",
    why: "Why it scores better", noIdeas: "No weak points in what matters to you.",
    ranking: "All rotations, for your priorities", rankingBy: "Rotations ranked by", you: "today",
    scoreNames: { agua: "water saving", suelo: "soil health", ingreso: "income (indicative)", forraje: "forage", clima: "climate resilience" },
    forecast: "Rain forecast (mm) · Open-Meteo", noForecast: "Forecast not available", week: "Next days",
    soil: "Soil at the surface (%) · SoilGrids, modelled", noSoil: "Soil data not available", soilPanel: "Soil reference (0–5 cm)",
    soilRows: { clay: "Clay", silt: "Silt", sand: "Sand", texture: "Texture", soc: "Organic carbon", ph: "pH", nitrogen: "Nitrogen" },
    soilNote: "Modelled at 250 m: a reference, not a lab test. It doesn't change Cooper's scores.",
    chapters: ["Your field", "Climate", "Your rotation today", "Strengths and weaknesses", "A better option", "Before you decide"],
  },
  es: {
    months: ["May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic", "Ene", "Feb", "Mar", "Abr"],
    bare: "sin cultivo", today: "Hoy", alt: "Alt", rain: "Lluvia", et: "Agua que se lleva el sol",
    axes: ["Agua", "Suelo", "Ingreso", "Forraje", "Clima"], limit: "límite",
    level: { fuerte: "Bien", medio: "Regular", flojo: "Flojo" },
    diagnosis: "Lo bueno y lo flojo", ideas: "Ideas para mejorar", risks: "Para revisar con tu agrónomo",
    why: "Por qué puntúa mejor", noIdeas: "Sin puntos flojos en lo que te importa.",
    ranking: "Todas las rotaciones, según tus prioridades", rankingBy: "Rotaciones ordenadas por", you: "hoy",
    scoreNames: { agua: "ahorro de agua", suelo: "salud del suelo", ingreso: "ingreso (indicativo)", forraje: "forraje", clima: "resiliencia al clima" },
    forecast: "Pronóstico de lluvia (mm) · Open-Meteo", noForecast: "Pronóstico no disponible", week: "Próximos días",
    soil: "Suelo en superficie (%) · SoilGrids, modelado", noSoil: "Datos de suelo no disponibles", soilPanel: "Referencia del suelo (0–5 cm)",
    soilRows: { clay: "Arcilla", silt: "Limo", sand: "Arena", texture: "Textura", soc: "Carbono orgánico", ph: "pH", nitrogen: "Nitrógeno" },
    soilNote: "Modelado a 250 m: una referencia, no un análisis de laboratorio. No cambia los puntajes de Cooper.",
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
// Cada vista: (análisis, rol, { t, lang }, segmento) → { show, label, …parámetros del visual, panel? }.
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

  // Toda la librería de rotaciones elegibles (no solo las tres del reporte), por puntaje total.
  ranking: (a, role, env) => rankChart(a, env, (r) => r.total, ui(env.lang).ranking),

  // Lo mismo, ordenado por uno de los cinco puntajes (seg.score: agua, suelo, ingreso, forraje, clima).
  score_ranking: (a, role, env, seg = {}) => {
    const k = SCORE_KEYS.includes(seg.score) ? seg.score : "agua", u = ui(env.lang);
    return rankChart(a, env, (r) => r.puntajes[k], `${u.rankingBy} ${u.scoreNames[k]}`);
  },

  // Contexto, fuera del análisis: el pronóstico de Open-Meteo y el suelo de SoilGrids (a.extras).
  forecast: (a, role, { lang }) => {
    const u = ui(lang), days = (a.extras?.weather?.diario || []).filter((d) => d.lluvia_mm != null).slice(0, 7);
    if (days.length < 2) return { show: "rain", label: u.noForecast };
    const day = (d) => new Date(`${d.fecha}T12:00`).toLocaleDateString(lang === "es" ? "es" : "en", { weekday: "short" }).replace(".", "");
    return { show: "chart", lang, values: days.map((d) => Number(d.lluvia_mm.toFixed(1))), labels: days.map(day), label: u.forecast,
      panel: { title: u.week, items: days.map((d) => `${cap(day(d))}: ${nf(d.lluvia_mm, 1)} mm · ${nf(d.tmin)}–${nf(d.tmax)} °C`) } };
  },

  soil_data: (a, role, { lang }) => {
    const u = ui(lang), s = a.extras?.soil, top = (k) => s?.propiedades?.[k]?.por_profundidad?.["0-5cm"];
    const tex = ["clay", "silt", "sand"].map(top);
    if (tex.some((v) => v == null)) return { show: "soil", variant: "healthy", label: u.noSoil };
    const row = (k, label, d = 1) => (top(k) == null ? [] : [`${label}: ${nf(top(k), d)} ${s.propiedades[k].unidad}`.trim()]);
    return { show: "chart", lang, values: tex.map((v) => Number(v.toFixed(1))), labels: [u.soilRows.clay, u.soilRows.silt, u.soilRows.sand],
      colors: ["#c98b5c", "#e0b98a", "#f2dba8"], label: u.soil,
      panel: { title: u.soilPanel, items: [
        ...(s.textura_superficial ? [`${u.soilRows.texture}: ${texture(s.textura_superficial, lang)}`] : []),
        ...row("soc", u.soilRows.soc), ...row("phh2o", u.soilRows.ph), ...row("nitrogen", u.soilRows.nitrogen, 2), u.soilNote] } };
  },
};

/* Barras de las rotaciones elegibles ordenadas por un valor; al costado, la lista con los nombres. */
function rankChart(a, { t, lang }, value, title) {
  const u = ui(lang), cur = a.rotaciones[0];
  const all = (a.ranking && a.ranking.length ? a.ranking : a.rotaciones).slice().sort((x, y) => value(y) - value(x)).slice(0, 6);
  return { show: "chart", lang, values: all.map((r) => Math.round(value(r))), labels: all.map((_, i) => String(i + 1)),
    colors: all.map((r, i) => (r.id === cur.id ? AMBER : i === 0 ? GREEN : CYAN)), label: title,
    panel: { title, items: all.map((r, i) => `${i + 1} · ${t(r.nombre)}: ${nf(value(r))}${r.id === cur.id ? ` (${u.you})` : ""}`) } };
}

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
  const { view, rot, score, ...rest } = seg;
  return { ...rest, ...VIEWS[view](a, rot || "current", env, { score }) };
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

/* Resumen del análisis para el modelo, sin coordenadas. Compacto a propósito: el plan gratuito de
   Groq da 8.000 tokens por minuto por modelo, y cada pregunta manda este resumen entero. */
export function buildContext(a, form) {
  if (!a) return null;
  const z = a.zonas, months = a.clima.mensual;
  const col = (k, dec = 0) => months.map((m) => Number(m[k].toFixed(dec)));
  const roles = ["current", "alt1", "alt2"];
  const scores = (r) => SCORE_KEYS.map((k) => Math.round(r.puntajes[k])).join("/");
  const shown = new Set(a.rotaciones.map((r) => r.id));
  const ranking = a.ranking || [];
  const ctx = {
    field: a.campo || "The user's field",
    inputs: {
      has_livestock: form.ganado,
      soil_water_capacity_mm: form.suelo_mm,
      field_size_ha: form.area_ha,
      priorities_0_to_5: Object.fromEntries(Object.entries(form.prioridades).map(([k, v]) => [SCORE_LABELS[k] || k, v])),
      climate_scenario: a.escenario.activo ? `rainfall ${a.escenario.lluvia_pct}%, temperature +${a.escenario.temp_delta} °C (a what-if simulation, not a forecast)` : "none (historical climate)",
    },
    warnings: a.advertencias.length ? a.advertencias : undefined,
    climate: {
      source: `NASA POWER daily ${a.meta.periodo}, ~50 km grid (describes the area, not the field)`,
      months: UI.en.months.join(","),
      rain_mm: col("lluvia_mm"),
      et0_mm: col("et0_mm"),
      hot_days_over_32c: col("dias_calor", 1),
      frost_risk_days: col("dias_helada", 1),
      trends: a.clima.tendencias.indicadores.map((t) =>
        `${t.nombre}: ${Math.round(t.valor_1)} (${t.periodo_1}) → ${Math.round(t.valor_2)} ${t.unidad} (${t.periodo_2}), ${t.cambio_pct > 0 ? "+" : ""}${t.cambio_pct}%`),
    },
    terrain: z ? `NASA SRTM 30 m: height difference ${z.resumen.desnivel_m} m, mean slope ${z.resumen.pendiente_media_pct}%, max slope ${z.resumen.pendiente_max_pct}%, low spots ${z.resumen.area_baja_pct}% of field, tolerable erosion ${z.tolerancia_t_ha} t/ha/yr`
      : "not available",
    legend: "scores are 0-100 in this order: " + SCORE_KEYS.map((k) => SCORE_LABELS[k]).join(" / ")
      + ". deficit_year_mm = the crops' water deficit over the whole year; deficit_critical_mm = only during critical crop stages; each as [average year, dry year (1 in 5)]."
      + " Income is a relative score: there are no prices, costs or yields.",
    rotations: a.rotaciones.map((r, idx) => {
      const ind = r.indicadores, isCur = idx === 0;
      const items = r.diagnostico ? r.diagnostico.items : [];
      return {
        role: roles[idx],
        name: r.nombre,
        total: r.total,
        scores: scores(r),
        bare_months: ind.meses_descubiertos,
        water_use_mm: Math.round(ind.uso_agua_mm),
        deficit_year_mm: [Math.round(ind.deficit_mm), Math.round(ind.deficit_seco_mm)],
        deficit_critical_mm: [Math.round(ind.deficit_critico_mm), Math.round(ind.deficit_critico_seco_mm)],
        ...(ind.erosion_t_ha != null
          ? { erosion_t_ha_yr: ind.erosion_t_ha, field_pct_over_tolerance: Math.round(ind.erosion_area_alta_pct) }
          : { rain_on_bare_soil_mm: Math.round(ind.lluvia_suelo_desnudo_mm) }),
        calendar: r.calendario.map((row, i) => (r.calendario.length > 1 ? `Y${i + 1} ` : "") + calendarText(row)).join(" | "),
        why: isCur ? undefined : r.explicacion.por_que.filter((x) => !x.startsWith("You gave")),
        // Clima promedio de los meses críticos (lluvia menos evapotranspiración), no el déficit del cultivo.
        critical_stage_climate: r.explicacion.evidencia.filter((e) => e.includes("critical stage")).map((e) => e.replace(/\s*\([^)]*\)/, "")),
        // De la actual, todo el diagnóstico con una idea; de las alternativas, solo lo fuerte y lo flojo.
        assessment: items.filter((i) => isCur || i.nivel !== "medio").map((i) =>
          `${i.etiqueta}: ${UI.en.level[i.nivel].toLowerCase()}, ${i.por_que}` + (isCur && i.recomendaciones[0] ? `. Idea: ${i.recomendaciones[0]}` : "")),
        risks: isCur ? undefined : r.explicacion.riesgos.filter((x) => !/general literature/.test(x)).slice(0, 3).map((x) => x.split(/:\s/)[0]),
      };
    }),
  };
  const w = a.extras?.weather, s = a.extras?.soil;
  if (w?.actual) {
    ctx.weather_now = `${nf(w.actual.temp)} °C, ${w.actual.estado}, humidity ${nf(w.actual.humedad)}% (Open-Meteo; context only, not part of the analysis)`;
    const days = (w.diario || []).filter((d) => d.lluvia_mm != null).slice(0, 7);
    const wd = (d) => new Date(`${d.fecha}T12:00`).toLocaleDateString("en", { weekday: "long" });
    // Con el día ya nombrado y el total ya sumado: el modelo no tiene que hacer cuentas.
    if (days.length) ctx.forecast = {
      days: days.map((d) => `${wd(d)} ${d.fecha}: rain ${nf(d.lluvia_mm, 1)} mm, ${Math.round(d.tmin)} to ${Math.round(d.tmax)} °C`),
      rain_total_mm: Number(days.reduce((s, d) => s + d.lluvia_mm, 0).toFixed(1)),
      rainy_days: days.filter((d) => d.lluvia_mm >= 1).length,
    };
  }
  const top = (k) => s?.propiedades?.[k]?.por_profundidad?.["0-5cm"];
  if (top("clay") != null) {
    ctx.soil_reference = `SoilGrids, modelled at 250 m, surface 0-5 cm (a reference: it does not change Cooper's scores): `
      + `texture ${s.textura_superficial || "unknown"}${TEXTURE_ES[s.textura_superficial] ? ` (in Spanish: ${TEXTURE_ES[s.textura_superficial]})` : ""}, clay ${nf(top("clay"), 1)}%, silt ${nf(top("silt"), 1)}%, sand ${nf(top("sand"), 1)}%`
      + (top("soc") != null ? `, organic carbon ${nf(top("soc"), 1)} g/kg` : "") + (top("phh2o") != null ? `, pH ${nf(top("phh2o"), 1)}` : "")
      + (top("nitrogen") != null ? `, total nitrogen ${nf(top("nitrogen"), 2)} g/kg` : "");
  }
  if (ranking.length) {
    // El resto de la librería (todas las rotaciones elegibles), y la mejor en cada puntaje.
    ctx.other_rotations = ranking.filter((r) => !shown.has(r.id)).slice(0, 5)
      .map((r) => `${r.nombre}: total ${Math.round(r.total)}, scores ${scores(r)}`);
    ctx.best_by_score = Object.fromEntries(SCORE_KEYS.map((k) => {
      const b = ranking.reduce((x, y) => (y.puntajes[k] > x.puntajes[k] ? y : x));
      return [SCORE_LABELS[k], `${b.nombre} (${Math.round(b.puntajes[k])})`];
    }));
  }
  return ctx;
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
