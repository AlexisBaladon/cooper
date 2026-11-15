"""Propiedades del suelo del punto desde ISRIC SoilGrids 2.0 (250 m, sin clave).

Son estimaciones globales de un modelo, no un análisis de laboratorio del campo.
Se muestran en "Mi campo" como referencia; no cambian ningún cálculo de rotaciones.
Caché en disco para respetar el límite de uso de la API.

API: https://rest.isric.org/soilgrids/v2.0/docs
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

from .power import CACHE_DIR

QUERY_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
PROPERTIES = ["clay", "sand", "silt", "soc", "phh2o", "bdod", "cec", "nitrogen"]
DEPTHS = ["0-5cm", "5-15cm", "15-30cm"]
LABELS = {
    "clay": ("Clay", "%"), "sand": ("Sand", "%"), "silt": ("Silt", "%"),
    "soc": ("Soil organic carbon", "g/kg"), "phh2o": ("pH (water)", ""),
    "bdod": ("Bulk density", "g/cm³"), "cec": ("Cation exchange capacity", "cmol(c)/kg"),
    "nitrogen": ("Total nitrogen", "g/kg"),
}


def texture_class(sand: float, silt: float, clay: float) -> str:
    """Clase textural USDA a partir de porcentajes de arena, limo y arcilla."""
    if silt + 1.5 * clay < 15:
        return "Sand"
    if silt + 1.5 * clay >= 15 and silt + 2 * clay < 30:
        return "Loamy sand"
    if (7 <= clay < 20 and sand > 52 and silt + 2 * clay >= 30) or (clay < 7 and silt < 50 and silt + 2 * clay >= 30):
        return "Sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "Loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "Silt loam"
    if silt >= 80 and clay < 12:
        return "Silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "Sandy clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "Clay loam"
    if 27 <= clay < 40 and sand <= 20:
        return "Silty clay loam"
    if clay >= 35 and sand > 45:
        return "Sandy clay"
    if clay >= 40 and silt >= 40:
        return "Silty clay"
    return "Clay"


def _cache_path(lat: float, lon: float) -> Path:
    return CACHE_DIR / f"soilgrids_{lat:.3f}_{lon:.3f}.json"


def _download(lat: float, lon: float) -> dict:
    params = [("lon", f"{lon:.4f}"), ("lat", f"{lat:.4f}"), ("value", "mean")]
    params += [("property", p) for p in PROPERTIES] + [("depth", d) for d in DEPTHS]
    resp = httpx.get(QUERY_URL, params=params, timeout=25)
    resp.raise_for_status()
    return resp.json()


def normalize(raw: dict) -> dict:
    layers = {}
    for layer in raw["properties"]["layers"]:
        name = layer["name"]
        if name not in LABELS:
            continue
        factor = float(layer.get("unit_measure", {}).get("d_factor") or 1)
        vals = {}
        for d in layer.get("depths", []):
            v = d.get("values", {}).get("mean")
            vals[d["label"]] = None if v is None else round(v / factor, 2)
        label, unit = LABELS[name]
        layers[name] = {"nombre": label, "unidad": unit, "por_profundidad": vals}
    top = {k: (layers.get(k, {}).get("por_profundidad", {}) or {}).get("0-5cm") for k in ("sand", "silt", "clay")}
    textura = texture_class(top["sand"], top["silt"], top["clay"]) if None not in top.values() else None
    return {"fuente": "ISRIC SoilGrids 2.0 (250 m, modelled)", "profundidades": DEPTHS,
            "propiedades": layers, "textura_superficial": textura}


def fetch(lat: float, lon: float) -> dict:
    lat, lon = round(lat, 3), round(lon, 3)
    path = _cache_path(lat, lon)
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
    else:
        raw = _download(lat, lon)
        data = normalize(raw)  # valida antes de guardar
        if not data["propiedades"] or all(v is None for p in data["propiedades"].values() for v in p["por_profundidad"].values()):
            raise ValueError("SoilGrids has no data for this point")
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(raw), encoding="utf-8")
        except OSError:
            pass  # sin caché se sigue funcionando
        return data
    return normalize(raw)
