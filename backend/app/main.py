"""API de Cooper + servidor de la página web.

Fase 1: clima de la zona a partir de 30 años de datos diarios de NASA POWER.
Fase 2: comparación de rotaciones (balance de agua, puntajes, explicaciones)
        y simulador de clima (menos lluvia, más temperatura).

Ejecutar desde backend/:  python -m uvicorn app.main:app --reload
"""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import climate, engine, power

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

app = FastAPI(title="Cooper", version="0.2.0")
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


@app.get("/api/catalog")
def get_catalog() -> dict:
    return {
        "cultivos": list(catalog.crops.values()),
        "rotaciones": [{k: r[k] for k in ("id", "nombre", "descripcion", "requiere_ganado")}
                       for r in catalog.rotations.values()],
        "campos_demo": DEMO_FIELDS,
        "puntajes": engine.SUBSCORES,
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    if req.rotacion_actual not in catalog.rotations:
        raise HTTPException(400, f"Unknown rotation: {req.rotacion_actual}")
    try:
        raw, meta = power.fetch_daily(req.lat, req.lon)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, f"Could not fetch NASA POWER data: {exc}") from exc

    base = climate.derive_daily(raw, req.lat)
    esc = req.escenario
    scenario_active = esc.lluvia_pct != 0 or esc.temp_delta != 0
    daily = (climate.derive_daily(raw, req.lat, esc.temp_delta, 1 + esc.lluvia_pct / 100)
             if scenario_active else base)

    monthly = climate.monthly_series(daily)
    clim = climate.climatology(monthly)
    clim_base = clim if not scenario_active else climate.climatology(climate.monthly_series(base))

    rotations = engine.compare(req.rotacion_actual, req.prioridades.model_dump(), monthly,
                               req.capacidad_suelo_mm, clim, catalog, req.tiene_ganado)

    warnings = []
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
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
