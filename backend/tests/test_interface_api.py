"""Endpoints de la interfaz nueva: ranking, tiempo, suelo y asistente (sin red)."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import assistant, engine, main, power, soil, terrain, weather
from test_climate import synthetic_dem, synthetic_raw


@pytest.fixture
def client(monkeypatch):
    meta = {"fuente": "test", "periodo": "2000-2005", "lat": -33.0, "lon": -56.0,
            "elevacion_m": 100, "resolucion": "~50 km"}
    monkeypatch.setattr(power, "fetch_daily", lambda lat, lon: (synthetic_raw(), meta))
    monkeypatch.setattr(terrain, "fetch_dem", synthetic_dem)
    return TestClient(main.app)


BODY = {"lat": -33.0, "lon": -56.0, "rotacion_actual": "soja_continua", "tiene_ganado": False,
        "prioridades": {"agua": 3, "suelo": 4, "ingreso": 4, "forraje": 1, "clima": 3}}


def test_analyze_adds_ranking_without_changing_rotations(client):
    data = client.post("/api/analyze", json=BODY).json()
    assert [r["rol"] for r in data["rotaciones"]] == ["actual", "alternativa_1", "alternativa_2"]
    ranked = data["ranking"]
    ids = {r["id"] for r in ranked}
    assert "soja_continua" in ids
    # sin ganado no se sugieren rotaciones que lo necesitan
    assert not any(r["requiere_ganado"] for r in ranked)
    assert [r["total"] for r in ranked] == sorted((r["total"] for r in ranked), reverse=True)
    for r in ranked:
        assert set(r["perfil"]) == set(engine.SUBSCORES)
        assert r["calendario"] and set(r["puntajes"]) >= set(engine.SUBSCORES)
    # el mapa de zonas tiene erosión para cada rotación del ranking
    shown = {r["id"] for r in data["rotaciones"]}
    assert set(data["zonas"]["celdas"][0]["eros"]) == shown  # contrato anterior intacto
    by_rot = data["zonas"]["erosion_ranking"]
    assert set(by_rot) == ids and all(len(v) == terrain.GRID_N ** 2 for v in by_rot.values())
    cur = data["rotaciones"][0]["id"]
    assert by_rot[cur][0] == data["zonas"]["celdas"][0]["eros"][cur]


def test_current_rotation_is_ranked_even_if_it_needs_livestock(client):
    data = client.post("/api/analyze", json={**BODY, "rotacion_actual": "verdeo_sorgo"}).json()
    ids = [r["id"] for r in data["ranking"]]
    assert "verdeo_sorgo" in ids
    assert sum(1 for r in data["ranking"] if r["requiere_ganado"]) == 1


def test_weather_is_normalized(monkeypatch):
    raw = {"timezone": "America/Montevideo", "utc_offset_seconds": -10800,
           "current": {"time": "2026-11-14T10:00", "temperature_2m": 22.4, "apparent_temperature": 21.0,
                       "relative_humidity_2m": 60, "precipitation": 0, "weather_code": 2,
                       "wind_speed_10m": 14, "wind_gusts_10m": 30, "wind_direction_10m": 90, "is_day": 1},
           "daily": {"time": ["2026-11-14"], "weather_code": [61], "temperature_2m_max": [25],
                     "temperature_2m_min": [12], "precipitation_sum": [4.2], "precipitation_probability_max": [70],
                     "et0_fao_evapotranspiration": [4.8], "wind_speed_10m_max": [20]}}
    weather._cache.clear()
    calls = []
    monkeypatch.setattr(weather, "_download", lambda lat, lon: calls.append(1) or raw)
    client = TestClient(main.app)
    data = client.get("/api/weather", params={"lat": -33, "lon": -56}).json()
    assert data["actual"]["temp"] == 22.4 and data["actual"]["estado"] == "Partly cloudy"
    assert data["diario"][0]["icono"] == "rain" and data["diario"][0]["et0_mm"] == 4.8
    client.get("/api/weather", params={"lat": -33.001, "lon": -56.001})
    assert len(calls) == 1  # caché por punto redondeado


def test_weather_failure_is_a_clean_502(monkeypatch):
    weather._cache.clear()
    def boom(lat, lon):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(weather, "_download", boom)
    r = TestClient(main.app).get("/api/weather", params={"lat": 10, "lon": 10})
    assert r.status_code == 502 and r.json()["detail"]
    assert TestClient(main.app).get("/api/weather", params={"lat": 100, "lon": 10}).status_code == 422


@pytest.mark.parametrize("sand,silt,clay,expected", [
    (90, 5, 5, "Sand"), (40, 40, 20, "Loam"), (20, 60, 20, "Silt loam"), (20, 30, 50, "Clay"),
    (65, 15, 20, "Sandy clay loam"), (30, 35, 35, "Clay loam"), (10, 50, 40, "Silty clay"),
])
def test_texture_class(sand, silt, clay, expected):
    assert soil.texture_class(sand, silt, clay) == expected


def test_soil_is_normalized_and_cached(monkeypatch, tmp_path):
    raw = {"properties": {"layers": [
        {"name": n, "unit_measure": {"d_factor": f}, "depths": [{"label": "0-5cm", "values": {"mean": v}}]}
        for n, f, v in [("clay", 10, 250), ("sand", 10, 400), ("silt", 10, 350), ("phh2o", 10, 62)]]}}
    monkeypatch.setattr(soil, "CACHE_DIR", tmp_path)
    calls = []
    monkeypatch.setattr(soil, "_download", lambda lat, lon: calls.append(1) or raw)
    data = TestClient(main.app).get("/api/soil", params={"lat": -33, "lon": -56}).json()
    assert data["propiedades"]["clay"]["por_profundidad"]["0-5cm"] == 25.0
    assert data["propiedades"]["phh2o"]["por_profundidad"]["0-5cm"] == 6.2
    assert data["textura_superficial"] == "Loam"
    soil.fetch(-33, -56)
    assert len(calls) == 1


def test_assistant_without_key_falls_back(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    r = TestClient(main.app).post("/api/assistant", json={"message": "Which option saves more water?"})
    assert r.status_code == 200 and r.json()["fuente"] == "sin_ia" and r.json()["respuesta"] is None


def test_assistant_uses_groq_with_context(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    seen = {}

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "  Wheat/soybean uses less water.  "}}]}

    def fake_post(url, json, headers, timeout):
        seen.update(json)
        return Resp()
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    r = TestClient(main.app).post("/api/assistant", json={
        "message": "Which saves water?", "language": "es", "context": {"campo": "Test"},
        "history": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]})
    body = r.json()
    assert body["fuente"] == "groq" and body["respuesta"] == "Wheat/soybean uses less water."
    assert "Spanish" in seen["messages"][0]["content"] and '"campo": "Test"' in seen["messages"][1]["content"]
    assert seen["messages"][-1] == {"role": "user", "content": "Which saves water?"}


def test_assistant_rejects_oversized_messages():
    r = TestClient(main.app).post("/api/assistant", json={"message": "x" * 601})
    assert r.status_code == 422
