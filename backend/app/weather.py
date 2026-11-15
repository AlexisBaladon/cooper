"""Tiempo actual y pronóstico de 7 días para el campo (Open-Meteo, sin clave).

Es información de contexto para la pantalla de inicio: no entra en ningún cálculo
de rotaciones. El proveedor se puede cambiar sin tocar el frontend: la respuesta
se normaliza a un formato propio.

API: https://open-meteo.com/en/docs (uso libre no comercial, sin clave).
"""
from __future__ import annotations

import time
from threading import Lock

import httpx

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
CACHE_SECONDS = 600
MAX_ENTRIES = 256

_cache: dict[tuple[float, float], tuple[float, dict]] = {}
_lock = Lock()

# Códigos WMO de Open-Meteo → descripción (inglés, se traduce en el navegador) e ícono.
WMO = {
    0: ("Clear sky", "clear"), 1: ("Mainly clear", "clear"), 2: ("Partly cloudy", "partly"),
    3: ("Overcast", "cloudy"), 45: ("Fog", "fog"), 48: ("Fog", "fog"),
    51: ("Light drizzle", "drizzle"), 53: ("Drizzle", "drizzle"), 55: ("Heavy drizzle", "drizzle"),
    56: ("Freezing drizzle", "drizzle"), 57: ("Freezing drizzle", "drizzle"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "rain"), 67: ("Freezing rain", "rain"),
    71: ("Light snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"), 77: ("Snow grains", "snow"),
    80: ("Rain showers", "rain"), 81: ("Rain showers", "rain"), 82: ("Violent rain showers", "rain"),
    85: ("Snow showers", "snow"), 86: ("Snow showers", "snow"),
    95: ("Thunderstorm", "storm"), 96: ("Thunderstorm with hail", "storm"), 99: ("Thunderstorm with hail", "storm"),
}


def describe(code: int | None) -> tuple[str, str]:
    return WMO.get(int(code) if code is not None else -1, ("Unknown", "cloudy"))


def _download(lat: float, lon: float) -> dict:
    params = {
        "latitude": f"{lat:.2f}", "longitude": f"{lon:.2f}", "timezone": "auto", "forecast_days": 7,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,"
                   "weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
                 "precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max,sunrise,sunset",
        "hourly": "temperature_2m,precipitation_probability,weather_code,is_day",
        "forecast_hours": 24,
    }
    resp = httpx.get(FORECAST_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()


def normalize(raw: dict) -> dict:
    cur = raw["current"]
    text, icon = describe(cur.get("weather_code"))
    d = raw.get("daily", {})
    days = []
    for i, day in enumerate(d.get("time", [])):
        dt, di = describe((d.get("weather_code") or [None] * (i + 1))[i])
        pick = lambda k: (d.get(k) or [None] * (i + 1))[i]  # noqa: E731
        days.append({
            "fecha": day, "estado": dt, "icono": di,
            "tmax": pick("temperature_2m_max"), "tmin": pick("temperature_2m_min"),
            "lluvia_mm": pick("precipitation_sum"), "prob_lluvia": pick("precipitation_probability_max"),
            "et0_mm": pick("et0_fao_evapotranspiration"), "viento_max": pick("wind_speed_10m_max"),
            "amanecer": pick("sunrise"), "atardecer": pick("sunset"),
        })
    h = raw.get("hourly", {})
    hours = []
    for i, t in enumerate((h.get("time") or [])[:24]):
        at = lambda k: (h.get(k) or [None] * (i + 1))[i]  # noqa: E731
        ht, hi = describe(at("weather_code"))
        hours.append({"hora": t, "temp": at("temperature_2m"), "prob_lluvia": at("precipitation_probability"),
                      "estado": ht, "icono": hi, "es_dia": bool(at("is_day") if at("is_day") is not None else 1)})
    return {
        "fuente": "Open-Meteo",
        "zona_horaria": raw.get("timezone"),
        "utc_offset_s": raw.get("utc_offset_seconds"),
        "actual": {
            "hora": cur.get("time"), "temp": cur.get("temperature_2m"),
            "sensacion": cur.get("apparent_temperature"), "humedad": cur.get("relative_humidity_2m"),
            "lluvia_mm": cur.get("precipitation"), "viento": cur.get("wind_speed_10m"),
            "rafagas": cur.get("wind_gusts_10m"), "viento_dir": cur.get("wind_direction_10m"),
            "es_dia": bool(cur.get("is_day", 1)), "estado": text, "icono": icon,
        },
        "diario": days,
        "horas": hours,
    }


def current(lat: float, lon: float) -> dict:
    key = (round(lat, 2), round(lon, 2))
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    data = normalize(_download(*key))
    with _lock:
        _cache[key] = (now, data)
        if len(_cache) > MAX_ENTRIES:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[: len(_cache) - MAX_ENTRIES]:
                del _cache[k]
    return data
