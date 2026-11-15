// Globo para marcar y mostrar el campo, con globe.gl (https://globe.gl/).
// globe.gl se carga como script clásico (window.Globe) y dibuja en su propio canvas,
// que la página ubica dentro de los anillos del holograma.
//
// Superficie: mosaicos satelitales de Esri World Imagery (los mismos que usa Cooper en su mapa),
// que se van afinando al acercarse. Encima se dibujan:
//   - los campos de ejemplo (etiquetas clicables);
//   - el campo marcado: ondas, el cuadrado del área elegida y la celda de ~50 km de NASA POWER,
//     para que se vea que el clima describe la zona y no el campo;
//   - los límites entre países (Natural Earth 1:110m). Si no carga, el globo sigue sin ellos.

const TILES = (x, y, l) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`;
const EARTH_KM = 6371, COUNTRY_ALT = 0.2;
const URUGUAY = { lat: -32.8, lng: -56.0 };

// Límites entre países (Natural Earth 1:110m, ~490 KB), como líneas de 1 px.
const COUNTRIES_URL = "https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/example/datasets/ne_110m_admin_0_countries.geojson";
const BORDER_ALT = 0.00004;                               // ~250 m: apenas sobre los mosaicos, sin flotar al acercarse
const BORDER_COLOR = "rgba(79,216,255,0.6)";

/* Anillos de un Polygon/MultiPolygon como trazos [lat, lng] para la capa de paths. */
function rings(geometry) {
  const polys = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polys.flatMap((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
}
async function loadBorders() {
  const world = await fetch(COUNTRIES_URL, { signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return (world?.features || []).flatMap((f) => rings(f.geometry).map((pts) => ({ pts })));
}

/* Mismo cuadrado que usa el motor de Cooper (terrain.field_grid). */
function fieldSquare(lat, lon, ha) {
  const side = Math.sqrt(ha * 10000), dlat = side / 111320, dlon = side / (111320 * Math.cos((lat * Math.PI) / 180));
  return box(lat - dlat / 2, lat + dlat / 2, lon - dlon / 2, lon + dlon / 2);
}
/* Celda de la grilla de NASA POWER (MERRA-2: 0,5° × 0,625°) que contiene el punto. Aproximada. */
function powerCell(lat, lon) {
  const clat = Math.round(lat / 0.5) * 0.5, clon = Math.round(lon / 0.625) * 0.625;
  return box(clat - 0.25, clat + 0.25, clon - 0.3125, clon + 0.3125);
}
const box = (s, n, w, e) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

export function createGlobe(el, { onPick, onPickDemo }) {
  if (!window.Globe) return null;                       // sin internet o sin el script: la página sigue sin globo
  const globe = new window.Globe(el, { animateIn: false })
    .backgroundColor("rgba(0,0,0,0)")
    .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/earth-night.jpg")
    .globeTileEngineUrl(TILES)
    .showAtmosphere(true).atmosphereColor("#4fd8ff").atmosphereAltitude(0.17)
    .onGlobeClick(({ lat, lng }) => onPick(lat, lng))
    // Marcadores HTML: mantienen su tamaño en pantalla al acercarse (las etiquetas 3D se miden en grados).
    .htmlLat("lat").htmlLng("lon").htmlAltitude(0)
    .htmlElement((d) => {
      const pin = document.createElement("div");
      pin.className = "gpin";
      pin.textContent = d.short;
      pin.title = d.nombre;
      pin.addEventListener("click", (e) => { e.stopPropagation(); onPickDemo(d); });
      return pin;
    })
    .ringLat("lat").ringLng("lon").ringMaxRadius("r").ringPropagationSpeed("speed").ringRepeatPeriod(1100)
    .ringColor(() => (t) => `rgba(61,255,194,${1 - t})`)
    .polygonGeoJsonGeometry("geometry").polygonAltitude("alt")
    .polygonCapColor((d) => d.fill).polygonSideColor(() => "rgba(0,0,0,0)").polygonStrokeColor((d) => d.stroke)
    // Límites: líneas de 1 px (stroke null) que no se animan al aparecer.
    .pathPoints("pts").pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt(() => BORDER_ALT)
    .pathColor(() => BORDER_COLOR).pathStroke(null).pathTransitionDuration(0)
    .pointOfView({ ...URUGUAY, altitude: 2.2 });
  const controls = globe.controls();
  controls.minDistance = 100 * 1.0004;                  // deja acercarse hasta ver un campo de pocas hectáreas
  controls.autoRotateSpeed = 0.5;
  let field = null, shown = false;
  let borders = null, bordersOn = true;
  loadBorders().then((b) => { borders = b; if (bordersOn) globe.pathsData(b); });

  // Altura de cámara para que el campo ocupe más o menos un sexto del ancho.
  const fieldAlt = (ha) => Math.max(0.0012, (6 * Math.sqrt(ha) / 10) / (0.93 * EARTH_KM));

  const api = {
    get visible() { return shown; },
    get altitude() { return globe.pointOfView().altitude; },
    get view() { return globe.pointOfView(); },
    show() { shown = true; el.classList.add("on"); globe.resumeAnimation(); },
    hide() { shown = false; el.classList.remove("on"); globe.pauseAnimation(); },
    size(px) { if (px > 50 && Math.abs(globe.width() - px) > 2) globe.width(px).height(px); },
    spin(on) { controls.autoRotate = on; },
    /* Límites entre países: prendidos por defecto. */
    borders(on) {
      bordersOn = on;
      globe.pathsData(on && borders ? borders : []);
    },
    setDemo(list) {
      globe.htmlElementsData(list.map((f) => ({ ...f, short: f.nombre.replace(/^Near\s+/, "").split(/[,(]/)[0].trim() })));
    },
    /* field: { lat, lon, area_ha } | null */
    setField(f) {
      field = f;
      if (!f) { globe.ringsData([]).polygonsData([]); return; }
      globe.ringsData([{ lat: f.lat, lon: f.lon, r: 0.35, speed: 0.3 }, { lat: f.lat, lon: f.lon, r: 0.03, speed: 0.03 }]);
      globe.polygonsData([
        { geometry: powerCell(f.lat, f.lon), alt: 0.0006, fill: "rgba(255,179,71,0.05)", stroke: "#ffb347" },
        { geometry: fieldSquare(f.lat, f.lon, f.area_ha), alt: 0.0001, fill: "rgba(61,255,194,0.18)", stroke: "#3dffc2" },
      ]);
    },
    /* where: "world" | "country" | "area" (la celda de clima) | "field" */
    fly(where, ms = 1800) {
      const at = field ? { lat: field.lat, lng: field.lon } : URUGUAY;
      const altitude = where === "world" ? 2.2 : where === "country" || !field ? COUNTRY_ALT
        : where === "area" ? 0.035 : fieldAlt(field.area_ha);
      globe.pointOfView({ ...(where === "country" && !field ? URUGUAY : at), altitude }, ms);
    },
    /* Para el control con las manos (gestures.js). dx, dy en píxeles de pantalla. */
    rotate(dx, dy) {
      const pov = globe.pointOfView(), size = globe.width() || 1;
      const viewDeg = Math.min(120, 0.93 * pov.altitude * (180 / Math.PI));   // grados que entran en el ancho
      const lat = Math.max(-85, Math.min(85, pov.lat + (dy / size) * viewDeg));
      globe.pointOfView({ lat, lng: pov.lng - ((dx / size) * viewDeg) / Math.max(0.2, Math.cos((lat * Math.PI) / 180)) });
    },
    zoom(factor) {
      const alt = globe.pointOfView().altitude;
      globe.pointOfView({ altitude: Math.max(0.0012, Math.min(3, alt / factor)) });
    },
    /* Marca el punto del globo que está bajo esa posición de pantalla, como un clic. */
    pickAt(clientX, clientY) {
      const r = el.getBoundingClientRect();
      const hit = globe.toGlobeCoords(clientX - r.left, clientY - r.top);
      if (hit) onPick(hit.lat, hit.lng);
      return !!hit;
    },
  };
  api.hide();
  return api;
}
