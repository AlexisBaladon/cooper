"""API de Cooper + servidor de la página web.

Fase 1: clima de la zona a partir de 30 años de datos diarios de NASA POWER.
Fase 2: comparación de rotaciones (balance de agua, puntajes, explicaciones)
        y simulador de clima (menos lluvia, más temperatura).
Fase 3: relieve SRTM, erosión RUSLE por rotación y zonas dentro del campo.
Fase 4: diagnóstico (lo bueno y lo flojo) y recomendaciones, en engine.compare().
Fase 5: redacción opcional de la voz de "Explain it simply" con Groq (/api/narrate).
Fase 6: interfaz nueva: ranking de todas las rotaciones (mejor opción por puntaje),
        tiempo actual (/api/weather), suelo SoilGrids (/api/soil) y asistente (/api/assistant).

Ejecutar desde backend/:  python -m uvicorn app.main:app --reload
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import assistant, climate, engine, jarvis, narrator, power, soil, terrain, weather

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"

# Rango aproximado de Uruguay: Cooper está pensado para esta zona.
URUGUAY_BBOX = (-35.1, -30.0, -58.6, -53.0)  # lat_min, lat_max, lon_min, lon_max

# Campos de ejemplo en zonas rurales (verificados sobre el mapa).
DEMO_FIELDS = [
    {"id": "young", "nombre": "Near Young, Río Negro (cropland)", "lat": -32.62, "lon": -57.75,
     "rotacion": "soja_continua", "tiene_ganado": False},
    {"id": "florida", "nombre": "Near Florida (dairy)", "lat": -34.22, "lon": -56.33,
     "rotacion": "verdeo_sorgo", "tiene_ganado": True},
    {"id": "paysandu", "nombre": "Near Paysandú (crops and livestock)", "lat": -32.40, "lon": -57.85,
     "rotacion": "trigo_soja2", "tiene_ganado": True},
]

app = FastAPI(title="Cooper", version="0.6.0")
catalog = engine.load_catalog()


class Prioridades(BaseModel):
    agua: float = Field(3, ge=0, le=5)
    suelo: float = Field(3, ge=0, le=5)
    ingreso: float = Field(3, ge=0, le=5)
    forraje: float = Field(3, ge=0, le=5)
    clima: float = Field(3, ge=0, le=5)


class Escenario(BaseModel):
    lluvia_pct: float = Field(0, ge=-50, le=30, description="Cambio de lluvia en %")
    temp_delta: float = Field(0, ge=0, le=4, description="Aumento de temperatura en °C")


class AnalyzeRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    rotacion_actual: str
    prioridades: Prioridades = Prioridades()
    escenario: Escenario = Escenario()
    capacidad_suelo_mm: float = Field(120, ge=40, le=250)
    tiene_ganado: bool = True
    area_ha: float = Field(100, ge=5, le=2000)


class SlideText(BaseModel):
    key: str = Field(..., max_length=30)
    headline: str = Field(..., max_length=200)
    narration: list[str] = Field(..., min_length=1, max_length=8)


class NarrateRequest(BaseModel):
    slides: list[SlideText] = Field(..., min_length=1, max_length=12)
    language: Literal["en", "es"] = "en"


@app.post("/api/narrate")
def narrate(req: NarrateRequest) -> dict:
    """Reescribe los textos de "Explain it simply" con Groq; si no se puede, devuelve la plantilla."""
    slides = [s.model_dump() for s in req.slides]
    if any(len(t) > 600 for s in slides for t in s["narration"]):
        raise HTTPException(400, "Sentence too long")
    return narrator.rewrite(slides, language=req.language)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=1500)


class AssistantRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=600)
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)
    context: dict | None = None
    language: Literal["en", "es"] = "en"


@app.post("/api/assistant")
def assistant_chat(req: AssistantRequest) -> dict:
    """Responde preguntas sobre el análisis abierto (Groq, opcional). Nunca decide ni calcula."""
    return assistant.answer(req.message.strip(), [t.model_dump() for t in req.history],
                            req.context, req.language)


@app.get("/api/weather")
def get_weather(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)) -> dict:
    """Tiempo actual y pronóstico de 7 días (contexto; no entra en los cálculos)."""
    try:
        return weather.current(lat, lon)
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(502, "Weather service unavailable") from exc


@app.get("/api/soil")
def get_soil(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)) -> dict:
    """Propiedades del suelo modeladas por SoilGrids (referencia; no entran en los cálculos)."""
    try:
        return soil.fetch(lat, lon)
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(502, "Soil service unavailable") from exc


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=1500)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=20)
    contexto: dict | None = None


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict:
    """"Ask Cooper": respuesta breve sobre el análisis que manda la página."""
    if req.messages[-1].role != "user":
        raise HTTPException(400, "The last message must come from the user")
    try:
        answer = assistant.chat([m.model_dump() for m in req.messages], req.contexto)
    except assistant.AssistantError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return {"respuesta": answer}


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    """Nota de voz (cuerpo crudo, Content-Type audio/*) → texto con Whisper de Groq."""
    size = int(request.headers.get("content-length") or 0)
    if size > assistant.MAX_AUDIO_BYTES:
        raise HTTPException(413, "The recording is too long. Please keep it under a minute.")
    audio = await request.body()
    try:
        text = assistant.transcribe(audio, request.headers.get("content-type", ""))
    except assistant.AssistantError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return {"texto": text}


async def _json_body(request: Request) -> dict:
    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(400, "Invalid JSON") from None
    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid request")
    return data


@app.post("/api/jarvis/chat")
async def jarvis_chat(request: Request) -> dict:
    """Jarvis a pantalla completa: frases + vista a mostrar, datos de la ficha y acción."""
    data = await _json_body(request)
    try:
        return await run_in_threadpool(jarvis.chat, data)
    except assistant.AssistantError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/jarvis/transcribe")
async def jarvis_transcribe(request: Request) -> dict:
    """Nota de voz de Jarvis → {text, lang}."""
    if int(request.headers.get("content-length") or 0) > assistant.MAX_AUDIO_BYTES:
        raise HTTPException(413, "The recording is too long. Please keep it under a minute.")
    audio = await request.body()
    try:
        return await run_in_threadpool(jarvis.transcribe, audio, request.headers.get("content-type", ""))
    except assistant.AssistantError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/jarvis/translate")
async def jarvis_translate(request: Request) -> dict:
    """Traducción del reporte de Jarvis, verificando que cada texto conserve sus números."""
    data = await _json_body(request)
    try:
        return await run_in_threadpool(jarvis.translate, data)
    except assistant.AssistantError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.get("/api/catalog")
def get_catalog() -> dict:
    return {
        "cultivos": list(catalog.crops.values()),
        "rotaciones": [{k: r.get(k) for k in ("id", "nombre", "descripcion", "requiere_ganado", "anios")}
                       for r in catalog.rotations.values()],
        "campos_demo": DEMO_FIELDS,
        "puntajes": engine.SUBSCORES,
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    if req.rotacion_actual not in catalog.rotations:
        raise HTTPException(400, f"Unknown rotation: {req.rotacion_actual}")
    if not any(req.prioridades.model_dump().values()):
        raise HTTPException(400, "Choose at least one priority above zero.")
    try:
        raw, meta = power.fetch_daily(req.lat, req.lon)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, f"Could not fetch NASA POWER data: {exc}") from exc
    except OSError as exc:
        raise HTTPException(503, "Climate data storage is temporarily unavailable. Please try again.") from exc

    base = climate.derive_daily(raw, req.lat)
    esc = req.escenario
    scenario_active = esc.lluvia_pct != 0 or esc.temp_delta != 0
    daily = (climate.derive_daily(raw, req.lat, esc.temp_delta, 1 + esc.lluvia_pct / 100)
             if scenario_active else base)

    monthly = climate.monthly_series(daily)
    clim = climate.climatology(monthly)
    clim_base = clim if not scenario_active else climate.climatology(climate.monthly_series(base))

    warnings = []

    # --- Terreno (SRTM) y erosión RUSLE: si falla, se sigue con el proxy de erosión.
    erosion_maps, erosion, zone_data = {}, None, None
    try:
        dem = terrain.fetch_dem(req.lat, req.lon, req.area_ha)
        terr = terrain.analyze_terrain(dem)
        r_annual, r_frac = terrain.r_factor(daily)
        for rid, rot in catalog.rotations.items():
            c = terrain.c_factor(rot, catalog.crops, r_frac)
            erosion_maps[rid] = terrain.erosion_map(terr, r_annual, c)
        erosion = {rid: terrain.erosion_summary(a) for rid, a in erosion_maps.items()}
    except (httpx.HTTPError, ValueError, KeyError, OSError) as exc:
        warnings.append(f"Could not get SRTM elevation ({exc}); erosion is estimated without the slope.")

    rotations, ranked = engine.compare_full(req.rotacion_actual, req.prioridades.model_dump(), monthly,
                                            req.capacidad_suelo_mm, clim, catalog, req.tiene_ganado,
                                            erosion=erosion)
    if erosion is not None:
        zone_data = terrain.zones(dem, terr, {r["id"]: erosion_maps[r["id"]] for r in rotations})
        # Erosión por celda de cada rotación del ranking (para "Mi campo" y las mejores opciones).
        zone_data["erosion_ranking"] = {
            r["id"]: [round(float(v), 1) for v in erosion_maps[r["id"]].ravel()] for r in ranked}
        zone_data["r_factor"] = round(r_annual)
        zone_data["k_factor"] = terrain.K_DEFAULT
        zone_data["area_ha"] = req.area_ha
    lat_min, lat_max, lon_min, lon_max = URUGUAY_BBOX
    if not (lat_min <= req.lat <= lat_max and lon_min <= req.lon <= lon_max):
        warnings.append("This point is outside Uruguay. Cooper's crop calendars are designed "
                        "for Uruguay, so some results may not apply.")
    if scenario_active:
        changes = ([f"rainfall {esc.lluvia_pct:+.0f}%"] if esc.lluvia_pct else []) + \
                  ([f"temperature +{esc.temp_delta:.1f} °C"] if esc.temp_delta else [])
        warnings.append(f"Scenario on: {' and '.join(changes)}, applied to the 1996–2025 record.")

    return {
        "meta": meta,
        "escenario": {**esc.model_dump(), "activo": scenario_active},
        "advertencias": warnings,
        "clima": {"mensual": clim, "mensual_base": clim_base,
                  "tendencias": climate.trends(base)},
        "rotaciones": rotations,
        "ranking": ranked,
        "zonas": zone_data,
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
