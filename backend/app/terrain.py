"""Terreno del campo (SRTM 30 m) y erosión RUSLE simplificada.

Fuente de elevación: NASA SRTM 1 arc-second (~30 m), servida por OpenTopoData
(api.opentopodata.org, dataset 'srtm30m', sin clave, 100 puntos por consulta,
1 consulta por segundo). Se guarda en caché en data/cache/.

El campo se aproxima por un cuadrado centrado en el punto marcado, con el área
indicada por el productor, muestreado en una grilla de N x N puntos.

RUSLE: A = R · K · LS · C · P   (t/ha/año)
- R: erosividad anual de la lluvia (Renard & Freimund, 1994) a partir de la lluvia
  anual de NASA POWER, repartida por mes según los días de lluvia erosiva (≥12,7 mm).
- K: erodabilidad del suelo. Sin datos de suelo todavía: valor típico de 0,035
  t·h/(MJ·mm) para Brunosoles (≈0,27 en unidades de EE.UU.). Pendiente: SoilGrids/MGAP.
- LS: factor topográfico de Moore & Burch (1986) con área de aporte por flujo D8.
- C: cobertura según el calendario de la rotación, mes a mes, ponderada por R mensual.
  Se asume siembra directa.
- P: prácticas de conservación = 1 (sin terrazas ni curvas de nivel).
"""
from __future__ import annotations

import json
import math
import time
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from .climate import AG_MONTHS
from .engine import year_layout

OTD_URL = "https://api.opentopodata.org/v1/srtm30m"
GRID_N = 15
K_DEFAULT = 0.035          # t·ha·h / (ha·MJ·mm)
TOLERANCIA_T_HA = 7.0      # pérdida de suelo tolerable de referencia (revisar por suelo)
AS_CAP_M = 250.0           # largo de ladera máximo efectivo (m)
CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"


# --------------------------------------------------------------- elevación

def field_grid(lat: float, lon: float, area_ha: float, n: int = GRID_N):
    side_m = math.sqrt(area_ha * 10_000)
    dlat = side_m / 111_320
    dlon = side_m / (111_320 * math.cos(math.radians(lat)))
    # Centros de celda; fila 0 = norte, columna 0 = oeste.
    lats = lat + dlat / 2 - (np.arange(n) + 0.5) * dlat / n
    lons = lon - dlon / 2 + (np.arange(n) + 0.5) * dlon / n
    bounds = [[lat - dlat / 2, lon - dlon / 2], [lat + dlat / 2, lon + dlon / 2]]
    return lats, lons, side_m / n, bounds, (dlat / n, dlon / n)


def _download_dem(lats: np.ndarray, lons: np.ndarray) -> list[float]:
    pts = [(la, lo) for la in lats for lo in lons]
    out: list[float] = []
    for i in range(0, len(pts), 100):
        if i:
            time.sleep(1.1)  # límite de la API pública: 1 consulta/segundo
        chunk = pts[i:i + 100]
        locs = "|".join(f"{la:.6f},{lo:.6f}" for la, lo in chunk)
        resp = httpx.get(OTD_URL, params={"locations": locs}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "OK":
            raise ValueError(f"OpenTopoData: {data.get('error', data.get('status'))}")
        out += [r["elevation"] for r in data["results"]]
    if any(e is None for e in out):
        raise ValueError("SRTM has no data for part of the field")
    return out


@lru_cache(maxsize=64)
def fetch_dem(lat: float, lon: float, area_ha: float) -> dict:
    lat, lon = round(lat, 4), round(lon, 4)
    lats, lons, cell_m, bounds, (dlat_c, dlon_c) = field_grid(lat, lon, area_ha)
    path = CACHE_DIR / f"dem_{lat:.4f}_{lon:.4f}_{area_ha:g}ha_{GRID_N}.json"
    if path.exists():
        elev = json.loads(path.read_text(encoding="utf-8"))["elev"]
    else:
        elev = _download_dem(lats, lons)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"elev": elev}), encoding="utf-8")
    return {
        "z": np.array(elev, dtype=float).reshape(GRID_N, GRID_N),
        "lats": lats, "lons": lons, "cell_m": cell_m, "bounds": bounds,
        "dlat": dlat_c, "dlon": dlon_c,
    }


# ------------------------------------------------------------ geomorfología

def _mean_filter(z: np.ndarray, r: int) -> np.ndarray:
    p = np.pad(z, r, mode="edge")
    k = 2 * r + 1
    out = np.zeros_like(z)
    for di in range(k):
        for dj in range(k):
            out += p[di:di + z.shape[0], dj:dj + z.shape[1]]
    return out / (k * k)


def d8_accumulation(z: np.ndarray, cell_m: float) -> np.ndarray:
    """Número de celdas que drenan a cada celda (incluida ella), flujo D8."""
    n, m = z.shape
    acc = np.ones_like(z)
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    for flat in np.argsort(z, axis=None)[::-1]:
        i, j = divmod(int(flat), m)
        best, target = 0.0, None
        for di, dj in nbrs:
            a, b = i + di, j + dj
            if 0 <= a < n and 0 <= b < m:
                drop = (z[i, j] - z[a, b]) / (cell_m * math.hypot(di, dj))
                if drop > best:
                    best, target = drop, (a, b)
        if target:
            acc[target] += acc[i, j]
    return acc


def analyze_terrain(dem: dict) -> dict:
    cell = dem["cell_m"]
    zs = _mean_filter(dem["z"], 1)  # SRTM viene en metros enteros: suavizar
    gy, gx = np.gradient(zs, cell, cell)
    tanb = np.hypot(gx, gy)
    beta = np.arctan(tanb)
    acc = d8_accumulation(zs, cell)
    a_s = np.minimum(acc * cell, AS_CAP_M)   # área de aporte específica (m²/m)
    ls = (a_s / 22.13) ** 0.4 * (np.sin(beta) / 0.0896) ** 1.3
    # Para la humedad relativa se suaviza más (5x5): en campos llanos el redondeo
    # de SRTM a metros enteros genera ruido en la dirección del flujo.
    zw = _mean_filter(dem["z"], 2)
    gwy, gwx = np.gradient(zw, cell, cell)
    acc_w = d8_accumulation(zw, cell)
    twi = np.log((acc_w * cell) / np.maximum(np.hypot(gwx, gwy), 0.001))
    tpi = zs - _mean_filter(zs, 2)
    return {"z": zs, "slope_pct": tanb * 100, "ls": ls, "twi": twi, "tpi": tpi}


# ----------------------------------------------------------------- RUSLE

def r_factor(daily: pd.DataFrame) -> tuple[float, list[float]]:
    """R anual (MJ·mm/ha/h/año) y fracción mensual en orden May→Abr."""
    years = daily.groupby(daily.index.year)
    p_annual = float(years["rain"].sum()[years["rain"].size() >= 360].mean())
    if p_annual <= 850:
        r = 0.0483 * p_annual ** 1.61
    else:
        r = 587.8 - 1.219 * p_annual + 0.004105 * p_annual ** 2
    erosive = daily["rain"].where(daily["rain"] >= 12.7, 0.0) ** 1.81
    by_month = erosive.groupby(daily.index.month).sum()
    frac = (by_month / by_month.sum()).reindex(range(1, 13), fill_value=0.0)
    return r, [float(frac[m]) for m in AG_MONTHS]


# Valores de C orientativos para SIEMBRA DIRECTA (la práctica dominante en Uruguay).
# Con laboreo convencional serían aproximadamente el doble.

def _c_crop(crop: dict, kc: float) -> float:
    if crop["perenne"]:
        return 0.02
    if kc < 0.6:
        return 0.20   # implantación: poca cobertura del cultivo
    if kc < 0.9:
        return 0.10
    return 0.04       # canopeo cerrado


def _c_bare(prev_residue: int | None) -> float:
    if prev_residue is None or prev_residue <= 1:
        return 0.25   # rastrojo escaso (p. ej. después de soja)
    if prev_residue <= 3:
        return 0.15
    return 0.08       # mucho rastrojo en superficie


def c_factor(rotation: dict, crops: dict, r_frac: list[float]) -> float:
    """C medio anual de la rotación, ponderado por la erosividad de cada mes."""
    layouts = [year_layout(y, crops) for y in rotation["anios"]]
    seq = [e for lay in layouts for e in lay]  # meses consecutivos de toda la rotación
    total = 0.0
    last_residue = None
    # Dos pasadas para que el primer barbecho conozca el rastrojo del último cultivo.
    for pass_ in range(2):
        for k, e in enumerate(seq):
            if e:
                crop = crops[e[0]]
                c = _c_crop(crop, e[1])
                last_residue = crop["residuo"]
            else:
                c = _c_bare(last_residue)
            if pass_ == 1:
                total += c * r_frac[k % 12]
    return total / len(layouts)


def erosion_map(terr: dict, r: float, c: float, k: float = K_DEFAULT) -> np.ndarray:
    return r * k * terr["ls"] * c * 1.0


def erosion_summary(a: np.ndarray) -> dict:
    return {
        "erosion_t_ha": float(a.mean()),
        "erosion_max_t_ha": float(a.max()),
        "erosion_area_alta_pct": float((a >= TOLERANCIA_T_HA).mean() * 100),
    }


# --------------------------------------------------------------- zonas

def zones(dem: dict, terr: dict, erosion_by_rot: dict[str, np.ndarray]) -> dict:
    n = GRID_N
    twi = terr["twi"]
    q1, q2 = np.quantile(twi, [1 / 3, 2 / 3])
    z = terr["z"]
    zmed = np.median(z)
    cells = []
    for i in range(n):
        for j in range(n):
            lat, lon = dem["lats"][i], dem["lons"][j]
            cells.append({
                "b": [[lat - dem["dlat"] / 2, lon - dem["dlon"] / 2],
                      [lat + dem["dlat"] / 2, lon + dem["dlon"] / 2]],
                "elev": round(float(z[i, j]), 1),
                "pend": round(float(terr["slope_pct"][i, j]), 1),
                "hum": 0 if twi[i, j] < q1 else (1 if twi[i, j] < q2 else 2),
                "bajo": bool(terr["tpi"][i, j] <= -0.4 and z[i, j] <= zmed),
                "eros": {rid: round(float(a[i, j]), 1) for rid, a in erosion_by_rot.items()},
            })
    relief = float(dem["z"].max() - dem["z"].min())
    return {
        "bounds": dem["bounds"],
        "celda_m": round(dem["cell_m"]),
        "tolerancia_t_ha": TOLERANCIA_T_HA,
        "resumen": {
            "elev_min": float(dem["z"].min()),
            "elev_max": float(dem["z"].max()),
            "desnivel_m": relief,
            "pendiente_media_pct": round(float(terr["slope_pct"].mean()), 1),
            "pendiente_max_pct": round(float(terr["slope_pct"].max()), 1),
            "area_baja_pct": round(sum(c["bajo"] for c in cells) / len(cells) * 100),
        },
        "celdas": cells,
    }
