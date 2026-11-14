"""Tests del motor con clima sintético (sin red)."""
import numpy as np
import pandas as pd
import pytest

from app import climate, engine


@pytest.fixture(scope="module")
def cat():
    return engine.load_catalog()


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


def monthly(raw, **kw):
    return climate.monthly_series(climate.derive_daily(raw, -33.0, **kw))


def test_catalog_is_valid(cat):
    assert len(cat.rotations) >= 6
    for r in cat.rotations.values():
        for year in r["anios"]:
            engine.year_layout(year, cat.crops)  # no lanza


def test_overlap_is_rejected(cat):
    bad = {"x": {"id": "x", "anios": [["trigo", "colza"]]}}
    with pytest.raises(ValueError):
        engine._validate(cat.crops, bad)


def test_monthly_series_complete_ag_years():
    m = monthly(synthetic_raw())
    assert len(m) % 12 == 0
    assert m.iloc[0]["month"] == 5


def test_cover_crop_reduces_bare_months(cat):
    m = monthly(synthetic_raw())
    arr = engine._month_arrays(m)
    soja = engine.simulate(cat.rotations["soja_continua"], cat.crops, arr, 120)
    cob = engine.simulate(cat.rotations["soja_cobertura"], cat.crops, arr, 120)
    assert cob["meses_descubiertos"] < soja["meses_descubiertos"]
    assert cob["lluvia_suelo_desnudo_mm"] < soja["lluvia_suelo_desnudo_mm"]


def test_less_rain_increases_deficit(cat):
    raw = synthetic_raw()
    rot = cat.rotations["trigo_soja2"]
    base = engine.simulate(rot, cat.crops, engine._month_arrays(monthly(raw)), 120)
    dry = engine.simulate(rot, cat.crops, engine._month_arrays(monthly(raw, rain_factor=0.6)), 120)
    assert dry["deficit_mm"] > base["deficit_mm"]


def test_bigger_soil_bucket_reduces_deficit(cat):
    arr = engine._month_arrays(monthly(synthetic_raw()))
    rot = cat.rotations["soja_continua"]
    small = engine.simulate(rot, cat.crops, arr, 60)
    big = engine.simulate(rot, cat.crops, arr, 200)
    assert big["deficit_mm"] <= small["deficit_mm"]


def test_compare_returns_current_plus_two(cat):
    m = monthly(synthetic_raw())
    res = engine.compare("soja_continua", {"agua": 3, "suelo": 3, "ingreso": 3, "forraje": 3, "clima": 3},
                         m, 120, climate.climatology(m), cat, tiene_ganado=False)
    assert [r["rol"] for r in res] == ["actual", "alternativa_1", "alternativa_2"]
    assert all(not cat.rotations[r["id"]].get("requiere_ganado") for r in res[1:])
    for r in res:
        assert set(r["explicacion"]) == {"por_que", "evidencia", "beneficios", "vacios", "riesgos"}
        assert all(r["explicacion"][k] for k in r["explicacion"])


def test_priorities_change_ranking(cat):
    m = monthly(synthetic_raw())
    clim = climate.climatology(m)
    forage = engine.compare("soja_continua", {"agua": 0, "suelo": 0, "ingreso": 0, "forraje": 5, "clima": 0},
                            m, 120, clim, cat)
    income = engine.compare("soja_continua", {"agua": 0, "suelo": 0, "ingreso": 5, "forraje": 0, "clima": 0},
                            m, 120, clim, cat)
    assert forage[1]["id"] != income[1]["id"]


def test_user_facing_text_is_english(cat):
    m = monthly(synthetic_raw())
    res = engine.compare("soja_continua", {"agua": 3, "suelo": 4, "ingreso": 4, "forraje": 1, "clima": 3},
                         m, 120, climate.climatology(m), cat, tiene_ganado=False)
    text = " ".join(t for r in res for part in r["explicacion"].values() for t in part)
    text += " ".join(c["nombre"] for c in cat.crops.values()) + " ".join(r["nombre"] for r in cat.rotations.values())
    for spanish in (" el ", " los ", " cultivo", " lluvia", " año", "rotación"):
        assert spanish not in text.lower()
