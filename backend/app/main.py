"""API de Cooper + servidor de la página web.

Fase 1: clima de la zona a partir de 30 años de datos diarios de NASA POWER.

Ejecutar desde backend/:  python -m uvicorn app.main:app --reload
"""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import climate, power

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"

# Rango aproximado de Uruguay: Cooper está pensado para esta zona.
URUGUAY_BBOX = (-35.1, -30.0, -58.6, -53.0)  # lat_min, lat_max, lon_min, lon_max

# Campos de ejemplo en zonas rurales (verificados sobre el mapa).
DEMO_FIELDS = [
    {"id": "young", "nombre": "Cerca de Young, Río Negro (agrícola)", "lat": -32.62, "lon": -57.75},
    {"id": "florida", "nombre": "Cerca de Florida (lechería)", "lat": -34.22, "lon": -56.33},
    {"id": "paysandu", "nombre": "Cerca de Paysandú (agrícola-ganadero)", "lat": -32.40, "lon": -57.85},
]

app = FastAPI(title="Cooper", version="0.1.0")


class AnalyzeRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


@app.get("/api/catalog")
def get_catalog() -> dict:
    return {"campos_demo": DEMO_FIELDS}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    try:
        raw, meta = power.fetch_daily(req.lat, req.lon)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, f"No se pudieron obtener datos de NASA POWER: {exc}") from exc

    daily = climate.derive_daily(raw, req.lat)
    monthly = climate.monthly_series(daily)

    warnings = []
    lat_min, lat_max, lon_min, lon_max = URUGUAY_BBOX
    if not (lat_min <= req.lat <= lat_max and lon_min <= req.lon <= lon_max):
        warnings.append("El punto está fuera de Uruguay: Cooper está pensado para Uruguay "
                        "y algunos resultados pueden no aplicar.")

    return {
        "meta": meta,
        "advertencias": warnings,
        "clima": {"mensual": climate.climatology(monthly), "tendencias": climate.trends(daily)},
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
