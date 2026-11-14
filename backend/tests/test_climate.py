"""Tests del clima y de la API con datos sintéticos (no usan internet)."""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import climate, main, power


def synthetic_raw(years=6, rain_mm_day=3.0, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2000-01-01", periods=365 * years + 2, freq="D")
    doy = idx.dayofyear.to_numpy()
    season = np.cos(2 * np.pi * (doy - 15) / 365)  # verano austral en enero
    return pd.DataFrame({
        "T2M_MAX": 24 + 8 * season + rng.normal(0, 2, len(idx)),
        "T2M_MIN": 11 + 6 * season + rng.normal(0, 2, len(idx)),
        "PRECTOTCORR": rng.exponential(rain_mm_day, len(idx)),
        "GWETROOT": 0.6,
    }, index=idx)


def test_et0_is_higher_in_summer():
    d = climate.derive_daily(synthetic_raw(), -33.0)
    assert (d["et0"] >= 0).all()
    by_month = d.groupby(d.index.month)["et0"].mean()
    assert by_month[1] > by_month[7]   # enero (verano austral) > julio


def test_threshold_flags():
    raw = synthetic_raw()
    raw.iloc[0, raw.columns.get_loc("T2M_MAX")] = 35.0
    raw.iloc[1, raw.columns.get_loc("T2M_MIN")] = -1.0
    raw.iloc[2, raw.columns.get_loc("PRECTOTCORR")] = 60.0
    d = climate.derive_daily(raw, -33.0)
    assert d["heat"].iloc[0] == 1 and d["frost"].iloc[1] == 1 and d["heavy"].iloc[2] == 1


def test_monthly_series_has_complete_ag_years():
    m = climate.monthly_series(climate.derive_daily(synthetic_raw(), -33.0))
    assert len(m) % 12 == 0
    assert m.iloc[0]["month"] == 5          # el año agrícola empieza en mayo
    assert m.groupby("ag_year").size().eq(12).all()


def test_climatology_is_in_ag_order():
    m = climate.monthly_series(climate.derive_daily(synthetic_raw(), -33.0))
    clim = climate.climatology(m)
    assert [c["mes"] for c in clim] == climate.AG_MONTHS
    for c in clim:
        assert c["balance_mm"] == pytest.approx(c["lluvia_mm"] - c["et0_mm"], abs=0.11)
        assert c["lluvia_seca_mm"] <= c["lluvia_mm"] + 0.1


def test_scenario_changes_rain_and_heat():
    raw = synthetic_raw()
    base = climate.derive_daily(raw, -33.0)
    hot_dry = climate.derive_daily(raw, -33.0, temp_delta=2, rain_factor=0.8)
    assert hot_dry["rain"].sum() == pytest.approx(base["rain"].sum() * 0.8)
    assert hot_dry["heat"].sum() >= base["heat"].sum()


def test_trends_compare_two_halves():
    t = climate.trends(climate.derive_daily(synthetic_raw(years=10), -33.0))
    ids = {i["id"] for i in t["indicadores"]}
    assert ids == {"lluvia_mm", "dias_calor", "dias_helada", "et0_mm"}
    assert all(i["periodo_1"] != i["periodo_2"] for i in t["indicadores"])


@pytest.fixture
def client(monkeypatch):
    meta = {"fuente": "prueba", "periodo": "2000-2005", "lat": 0, "lon": 0,
            "elevacion_m": 70, "resolucion": "~50 km"}
    monkeypatch.setattr(power, "fetch_daily", lambda lat, lon: (synthetic_raw(), meta))
    return TestClient(main.app)


def test_catalog_lists_demo_fields(client):
    cat = client.get("/api/catalog").json()
    fields = cat["campos_demo"]
    assert len(fields) == 3 and all({"id", "nombre", "lat", "lon", "rotacion"} <= set(f) for f in fields)
    rotation_ids = {r["id"] for r in cat["rotaciones"]}
    assert all(f["rotacion"] in rotation_ids for f in fields)


BODY = {"lat": -32.62, "lon": -57.75, "rotacion_actual": "soja_continua", "tiene_ganado": False}


def test_analyze_returns_climate_and_rotations(client):
    data = client.post("/api/analyze", json=BODY).json()
    assert len(data["clima"]["mensual"]) == 12
    assert data["clima"]["tendencias"]["indicadores"]
    assert data["advertencias"] == []
    assert [r["rol"] for r in data["rotaciones"]] == ["actual", "alternativa_1", "alternativa_2"]


def test_analyze_scenario_adds_warning_and_baseline(client):
    data = client.post("/api/analyze", json={**BODY, "escenario": {"lluvia_pct": -20, "temp_delta": 1}}).json()
    assert data["escenario"]["activo"]
    assert any("Scenario on" in w for w in data["advertencias"])
    dry = sum(m["lluvia_mm"] for m in data["clima"]["mensual"])
    base = sum(m["lluvia_mm"] for m in data["clima"]["mensual_base"])
    assert dry < base


def test_analyze_rejects_unknown_rotation(client):
    assert client.post("/api/analyze", json={**BODY, "rotacion_actual": "nope"}).status_code == 400


def test_analyze_warns_outside_uruguay(client):
    data = client.post("/api/analyze", json={**BODY, "lat": 40.4, "lon": -3.7}).json()
    assert any("outside Uruguay" in w for w in data["advertencias"])


def test_analyze_validates_coordinates(client):
    assert client.post("/api/analyze", json={**BODY, "lat": 120, "lon": 0}).status_code == 422
