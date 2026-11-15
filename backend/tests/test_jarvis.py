"""Tests de Jarvis a pantalla completa: validación de lo que devuelve el modelo, traducción y
rutas. Groq se simula, no se usa la red."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import assistant, jarvis, main



class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body or {}
        self.headers = {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=httpx.Request("POST", "https://x"),
                                        response=httpx.Response(self.status_code, json=self._body))


def reply(content):
    return FakeResponse(body={"choices": [{"message": {"content": content}}]})


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)


@pytest.fixture
def client():
    return TestClient(main.app)


# ------------------------------------------------------------ validación
def test_parse_reply_with_analysis_only_allows_data_views():
    content = json.dumps({"segments": [
        {"say": "Your thirsty months.", "show": "climate"},
        {"say": "Erosion of option 1.", "show": "erosion", "rotation": "alt1"},
        {"say": "Your own rotation.", "show": "field", "rotation": "custom"},   # ya no existe: vuelve a "current"
        {"say": "Made-up chart.", "show": "chart", "values": [1, 2, 3]},   # genérico: no se permite con análisis
        {"say": "", "show": "scores"},                                      # sin texto: se descarta
    ], "action": "report", "set": {"rotation": "soja_continua"}})
    segments, action = jarvis.parse_reply(content, True)
    assert segments == [{"say": "Your thirsty months.", "view": "climate", "rot": "current"},
                        {"say": "Erosion of option 1.", "view": "erosion", "rot": "alt1"},
                        {"say": "Your own rotation.", "view": "field", "rot": "current"},
                        {"say": "Made-up chart."}]
    assert action == "report"


def test_parse_reply_only_accepts_report_action_with_an_analysis():
    content = json.dumps({"segments": [{"say": "Hi."}], "action": "analyze"})
    assert jarvis.parse_reply(content, True)[1] is None
    content = json.dumps({"segments": [{"say": "Hi."}], "action": "report"})
    assert jarvis.parse_reply(content, False)[1] is None


def test_parse_reply_without_json_speaks_the_text():
    segments, action = jarvis.parse_reply("Just plain words.", False)
    assert segments == [{"say": "Just plain words."}] and action is None


def test_clean_visual_requires_needed_data():
    assert jarvis.clean_visual({"show": "temperature"}) == {}
    assert jarvis.clean_visual({"show": "crops", "variant": "cactus"}) == {}
    assert jarvis.clean_visual({"show": "calendar", "months": [0, 3, 3, 13, 5]}) == {"show": "calendar", "months": [3, 5]}


def test_digits_ignore_separators():
    assert jarvis._digits("1,308 mm y 7.7 t/ha") == jarvis._digits("1.308 mm and 7,7 t/ha")
    assert jarvis._digits("120 mm") != jarvis._digits("12 mm")


# ------------------------------------------------------------------ rutas
def test_chat_route_answers_with_views_and_no_form(client, monkeypatch):
    seen = {}

    def fake_post(url, **kw):
        seen.update(kw["json"])
        return reply(json.dumps({"segments": [{"say": "Tus meses con sed son de diciembre a febrero.", "show": "climate"}],
                                 "set": {"rotation": "soja_continua"}, "action": "analyze"}))
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    context = {"field": "Near Young", "rotations": [{"name": "Continuous soybean", "total": 44}]}
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "¿cuándo le falta agua a mi campo?"}],
                                              "context": context})
    assert r.status_code == 200
    data = r.json()
    assert data == {"segments": [{"say": "Tus meses con sed son de diciembre a febrero.", "view": "climate", "rot": "current"}],
                    "reply": "Tus meses con sed son de diciembre a febrero.", "action": None, "lang": "es"}
    system = seen["messages"][0]["content"]
    assert "ANALYSIS (JSON)" in system and "Near Young" in system
    assert "FIELD FILE" not in system and '"set"' not in system     # Jarvis ya no arma la ficha
    assert seen["messages"][-1] == {"role": "system", "content": "Answer in Spanish."}


def test_chat_without_analysis_explains_cooper_and_points_to_it(monkeypatch):
    prompt = jarvis.build_prompt("")
    assert "There is no analysis yet" in prompt and "Analyze my field" in prompt
    assert "[data]" not in prompt and "- globe:" not in prompt


def test_chat_route_retries_without_json_mode(client, monkeypatch):
    calls = []

    def fake_post(url, **kw):
        calls.append("response_format" in kw["json"])
        return FakeResponse(400, {"error": {"code": "json_validate_failed"}}) if len(calls) == 1 else reply("Plain answer.")
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 200 and calls == [True, False]
    assert r.json()["segments"] == [{"say": "Plain answer."}]


def test_chat_route_rejects_bad_requests_without_calling_groq(client, monkeypatch):
    monkeypatch.setattr(assistant.httpx, "post", lambda *a, **k: pytest.fail("Groq should not be called"))
    assert client.post("/api/jarvis/chat", json={}).status_code == 400
    assert client.post("/api/jarvis/chat", json={"messages": [{"role": "assistant", "content": "hi"}]}).status_code == 400
    assert client.post("/api/jarvis/chat", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/api/jarvis/translate", json={"texts": ["a"], "lang": "en"}).status_code == 400
    assert client.post("/api/jarvis/transcribe", content=b"{}", headers={"Content-Type": "application/json"}).status_code == 415


def test_translate_keeps_original_when_numbers_change(client, monkeypatch):
    texts = ["You lose 7.7 tonnes per hectare.", "Rain: 1,308 mm a year."]
    monkeypatch.setattr(assistant.httpx, "post", lambda url, **kw: reply(json.dumps(
        {"texts": ["Perdés 7,7 toneladas por hectárea.", "Lluvia: 1.380 mm por año."]})))
    r = client.post("/api/jarvis/translate", json={"texts": texts, "lang": "es"})
    assert r.status_code == 200
    assert r.json() == {"texts": ["Perdés 7,7 toneladas por hectárea.", texts[1]], "translated": 1, "total": 2}


def test_transcribe_route_returns_text_and_language(client, monkeypatch):
    monkeypatch.setattr(assistant.httpx, "post", lambda url, **kw: FakeResponse(body={"text": " hola ", "language": "spanish"}))
    r = client.post("/api/jarvis/transcribe", content=b"\x1a\x45" * 500, headers={"Content-Type": "audio/webm;codecs=opus"})
    assert r.status_code == 200 and r.json() == {"text": "hola", "lang": "es"}


def test_jarvis_page_is_served(client):
    r = client.get("/jarvis/index.html")
    assert r.status_code == 200 and "/api/jarvis/chat" in r.text
