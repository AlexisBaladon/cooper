"""Cliente de NASA POWER (datos diarios por punto) con caché en disco.

API: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
No requiere clave. La grilla es de ~0.5° x 0.625° (~50 km): describe el clima
de la zona, no diferencias dentro de un campo.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
PARAMETERS = ["T2M_MAX", "T2M_MIN", "PRECTOTCORR", "GWETROOT"]
START_YEAR = 1996
END_YEAR = 2025  # 30 años completos

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"


def _cache_path(lat: float, lon: float) -> Path:
    return CACHE_DIR / f"power_{lat:.2f}_{lon:.2f}_{START_YEAR}_{END_YEAR}.json"


def _download(lat: float, lon: float) -> dict:
    params = {
        "parameters": ",".join(PARAMETERS),
        "community": "AG",
        "latitude": f"{lat:.2f}",
        "longitude": f"{lon:.2f}",
        "start": f"{START_YEAR}0101",
        "end": f"{END_YEAR}1231",
        "format": "JSON",
    }
    resp = httpx.get(BASE_URL, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


@lru_cache(maxsize=64)
def _load(lat: float, lon: float) -> tuple[pd.DataFrame, dict]:
    path = _cache_path(lat, lon)
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
    else:
        raw = _download(lat, lon)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(raw), encoding="utf-8")

    fill = raw.get("header", {}).get("fill_value", -999.0)
    df = pd.DataFrame(raw["properties"]["parameter"])
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df = df.replace(fill, np.nan).sort_index()

    coords = raw.get("geometry", {}).get("coordinates", [lon, lat, None])
    meta = {
        "fuente": "NASA POWER (MERRA-2 / GPM-IMERG), comunidad AG",
        "periodo": f"{START_YEAR}-{END_YEAR}",
        "lat": lat,
        "lon": lon,
        "elevacion_m": coords[2] if len(coords) > 2 else None,
        "resolucion": "~0.5° x 0.625° (~50 km)",
    }
    return df, meta


def fetch_daily(lat: float, lon: float) -> tuple[pd.DataFrame, dict]:
    """Devuelve (DataFrame diario, metadatos). No mutar el DataFrame devuelto."""
    return _load(round(lat, 2), round(lon, 2))
