"""Endpoints de demostración; ninguna puntuación es consejo agronómico."""

from __future__ import annotations

import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Rotaciones con datos NASA", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("WEB_ORIGIN", "http://localhost:3000")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class CompareRequest(BaseModel):
    rain_change_percent: int = Field(default=0, ge=-50, le=50)
    priority: str = Field(default="agua", pattern="^(agua|suelo|forraje)$")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/compare")
def compare(request: CompareRequest) -> dict:
    """Return three explicitly illustrative alternatives, without claiming field validity."""
    options = [
        {
            "name": "Rotación actual (ejemplo)",
            "crops": ["Soja", "Trigo"],
            "scores": {"agua": 2, "suelo": 2, "forraje": 0},
            "reason": "Referencia para comparar cambios posibles.",
            "benefit": "Conserva el manejo conocido por el productor.",
            "risk": "Revisar cobertura, erosión y presión de enfermedades con un técnico.",
        },
        {
            "name": "Alternativa A (ejemplo)",
            "crops": ["Soja", "Avena de cobertura", "Maíz"],
            "scores": {"agua": 1, "suelo": 4, "forraje": 2},
            "reason": "Incluye cobertura entre cultivos comerciales.",
            "benefit": "Podría reducir meses con suelo descubierto.",
            "risk": "Revisar agua disponible, fecha de siembra y costos.",
        },
        {
            "name": "Alternativa B (ejemplo)",
            "crops": ["Trigo", "Vicia de cobertura", "Sorgo"],
            "scores": {"agua": 3, "suelo": 3, "forraje": 4},
            "reason": "Combina una leguminosa de cobertura con una opción forrajera.",
            "benefit": "Podría diversificar la rotación y aportar forraje.",
            "risk": "Revisar adaptación local, mercado y manejo sanitario.",
        },
    ]
    # Sensitivity illustration only. A rainfall change is not a weather forecast.
    rain_penalty = max(0, -request.rain_change_percent) / 20
    for option in options:
        base = option["scores"][request.priority]
        option["illustrative_score"] = round(max(0, base - rain_penalty * (4 - option["scores"]["agua"]) / 2), 1)
        option["missing"] = "Suelo local, datos NASA procesados, calendario y reglas validadas."
    return {
        "status": "illustrative_only",
        "scenario": f"Lluvia {request.rain_change_percent:+d}% (supuesto, no pronóstico)",
        "priority": request.priority,
        "options": options,
        "notice": "Puntajes de demostración. No usar para decidir una siembra; consultar a un agrónomo local.",
    }


@app.get("/climate/power")
async def power_climate(latitude: float, longitude: float, year: int) -> dict:
    """Fetch NASA POWER daily T2M and PRECTOTCORR for one point and year."""
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise HTTPException(status_code=422, detail="Coordenadas fuera de rango")
    if not (1981 <= year <= 2025):
        raise HTTPException(status_code=422, detail="Elegir un año completo entre 1981 y 2025")
    params = {
        "parameters": "T2M,PRECTOTCORR",
        "community": "AG",
        "longitude": longitude,
        "latitude": latitude,
        "start": f"{year}0101",
        "end": f"{year}1231",
        "format": "JSON",
    }
    url = "https://power.larc.nasa.gov/api/temporal/daily/point"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="No se pudo obtener NASA POWER") from exc
    return {
        "source": "NASA POWER daily point API",
        "source_url": str(response.url),
        "note": "Dato regional; no representa una medición directa del lote.",
        "units": payload.get("parameters", {}),
        "data": payload.get("properties", {}).get("parameter", {}),
    }
