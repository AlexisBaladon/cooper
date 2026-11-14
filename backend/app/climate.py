"""Indicadores agroclimáticos a partir de los datos diarios de NASA POWER.

Todo es transparente (sin ML):
- ET0 (evapotranspiración de referencia) por Hargreaves-Samani (FAO-56, ec. 52).
- Día de calor: Tmax >= 32 °C.
- Día con riesgo de helada: Tmin del aire a 2 m <= 2 °C. Se usa 2 °C y no 0 °C
  porque el suelo y las plantas se enfrían más que el aire a 2 m y porque la
  grilla de ~50 km suaviza los extremos.
- Lluvia fuerte: >= 40 mm en un día (proxy de lluvia erosiva).

El año agrícola va de mayo a abril (zafra de invierno + zafra de verano).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

AG_MONTHS = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

HEAT_T = 32.0
FROST_T = 2.0
HEAVY_P = 40.0


def month_name(m: int) -> str:
    return MONTH_NAMES[m - 1]


def extraterrestrial_radiation(lat_deg: float, doy: np.ndarray) -> np.ndarray:
    """Radiación extraterrestre Ra en MJ/m²/día (FAO-56, ec. 21)."""
    phi = np.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    delta = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(delta), -1, 1))
    return (24 * 60 / np.pi) * 0.0820 * dr * (
        ws * np.sin(phi) * np.sin(delta) + np.cos(phi) * np.cos(delta) * np.sin(ws)
    )


def derive_daily(raw: pd.DataFrame, lat: float,
                 temp_delta: float = 0.0, rain_factor: float = 1.0) -> pd.DataFrame:
    """Variables diarias derivadas, con escenario opcional (+°C, % de lluvia)."""
    d = pd.DataFrame(index=raw.index)
    d["tmax"] = raw["T2M_MAX"] + temp_delta
    d["tmin"] = raw["T2M_MIN"] + temp_delta
    d["rain"] = raw["PRECTOTCORR"].clip(lower=0) * rain_factor
    d["gwet"] = raw["GWETROOT"]
    d = d.dropna(subset=["tmax", "tmin", "rain"])

    tmean = (d["tmax"] + d["tmin"]) / 2
    ra = extraterrestrial_radiation(lat, d.index.dayofyear.to_numpy())
    trange = (d["tmax"] - d["tmin"]).clip(lower=0)
    d["et0"] = (0.0023 * 0.408 * ra * (tmean + 17.8) * np.sqrt(trange)).clip(lower=0)

    d["heat"] = (d["tmax"] >= HEAT_T).astype(int)
    d["frost"] = (d["tmin"] <= FROST_T).astype(int)
    d["heavy"] = (d["rain"] >= HEAVY_P).astype(int)
    return d


def monthly_series(d: pd.DataFrame) -> pd.DataFrame:
    """Serie mensual con solo años agrícolas (mayo–abril) completos."""
    m = d.resample("MS").agg({
        "rain": "sum", "et0": "sum", "heat": "sum", "frost": "sum",
        "heavy": "sum", "tmax": "mean", "tmin": "mean", "gwet": "mean",
    })
    m["year"] = m.index.year
    m["month"] = m.index.month
    m["ag_year"] = np.where(m["month"] >= 5, m["year"], m["year"] - 1)
    sizes = m.groupby("ag_year")["month"].transform("size")
    m = m[sizes == 12]
    return m.reset_index(drop=True)


def climatology(m: pd.DataFrame) -> list[dict]:
    """Promedios por mes, en orden de año agrícola (May→Abr)."""
    g = m.groupby("month")
    mean = g.mean(numeric_only=True)
    p20 = g["rain"].quantile(0.2)
    out = []
    for mo in AG_MONTHS:
        r = mean.loc[mo]
        out.append({
            "mes": mo,
            "nombre": month_name(mo),
            "lluvia_mm": round(float(r["rain"]), 1),
            "lluvia_seca_mm": round(float(p20.loc[mo]), 1),
            "et0_mm": round(float(r["et0"]), 1),
            "balance_mm": round(float(r["rain"] - r["et0"]), 1),
            "tmax": round(float(r["tmax"]), 1),
            "tmin": round(float(r["tmin"]), 1),
            "dias_calor": round(float(r["heat"]), 1),
            "dias_helada": round(float(r["frost"]), 1),
            "dias_lluvia_fuerte": round(float(r["heavy"]), 2),
            "humedad_raiz": None if pd.isna(r["gwet"]) else round(float(r["gwet"]), 2),
        })
    return out


def trends(d: pd.DataFrame) -> dict:
    """Cómo viene cambiando la zona: primera mitad vs. segunda mitad del período."""
    years = d.groupby(d.index.year)
    annual = pd.DataFrame({
        "lluvia_mm": years["rain"].sum(),
        "dias_calor": years["heat"].sum(),
        "dias_helada": years["frost"].sum(),
        "et0_mm": years["et0"].sum(),
        "dias": years["rain"].size(),
    })
    annual = annual[annual["dias"] >= 360].drop(columns="dias")
    yrs = annual.index.to_numpy()
    half = len(yrs) // 2
    first, second = annual.iloc[:half], annual.iloc[half:]

    labels = {
        "lluvia_mm": ("Annual rainfall", "mm"),
        "dias_calor": ("Hot days (≥32 °C) per year", "days"),
        "dias_helada": ("Frost-risk days per year", "days"),
        "et0_mm": ("Annual reference evapotranspiration", "mm"),
    }
    indicators = []
    for col, (label, unit) in labels.items():
        slope = float(np.polyfit(yrs, annual[col].to_numpy(), 1)[0]) * 10
        a, b = float(first[col].mean()), float(second[col].mean())
        indicators.append({
            "id": col,
            "nombre": label,
            "unidad": unit,
            "periodo_1": f"{yrs[0]}–{yrs[half - 1]}",
            "valor_1": round(a, 1),
            "periodo_2": f"{yrs[half]}–{yrs[-1]}",
            "valor_2": round(b, 1),
            "cambio_pct": round((b - a) / a * 100, 1) if a else None,
            "tendencia_por_decada": round(slope, 1),
        })
    serie = [
        {"anio": int(y), **{k: round(float(v), 1) for k, v in row.items()}}
        for y, row in annual.iterrows()
    ]
    return {"indicadores": indicators, "serie_anual": serie}
