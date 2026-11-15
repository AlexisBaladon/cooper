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
CONTEXT = json.dumps({"field": "Near Young", "rotations": [
    {"role": "current", "name": "Continuous soybean", "total": 43.6, "erosion_t_ha_yr": 11.05, "bare_months": 6},
    {"role": "alt1", "name": "Barley/sorghum", "total": 58.9, "erosion_t_ha_yr": 7.7}]})


def test_parse_reply_with_analysis_only_allows_data_views():
    content = json.dumps({"segments": [
        {"say": "Your thirsty months.", "show": "climate"},
        {"say": "Erosion of option 1.", "show": "erosion", "rotation": "alt1"},
        {"say": "Your own rotation.", "show": "field", "rotation": "custom"},   # ya no existe: vuelve a "current"
        {"say": "Made-up chart.", "show": "chart", "values": [1, 2, 3]},        # el modelo no arma gráficos
        {"say": "", "show": "scores"},                                           # sin texto: se descarta
    ], "action": "report", "set": {"rotation": "soja_continua"}})
    segments, action = jarvis.parse_reply(content, CONTEXT, "tell me the report")
    assert segments == [{"say": "Your thirsty months.", "view": "climate", "rot": "current"},
                        {"say": "Erosion of option 1.", "view": "erosion", "rot": "alt1"},
                        {"say": "Your own rotation.", "view": "field", "rot": "current"},
                        {"say": "Made-up chart."}]
    assert action == "report"


def test_report_only_starts_when_the_user_asks_for_it():
    content = json.dumps({"segments": [{"say": "Hi."}], "action": "report"})
    assert jarvis.parse_reply(content, CONTEXT, "why is option 1 better?")[1] is None
    assert jarvis.parse_reply(content, CONTEXT, "contame el reporte completo")[1] == "report"
    assert jarvis.parse_reply(content, "", "tell me the report")[1] is None          # sin análisis no hay reporte
    assert jarvis.parse_reply(json.dumps({"segments": [{"say": "Hi."}], "action": "analyze"}), CONTEXT, "report")[1] is None


def test_sentences_with_numbers_that_are_not_in_the_analysis_are_dropped():
    content = json.dumps({"segments": [
        {"say": "You lose 11.05 tonnes per hectare a year.", "show": "erosion"},
        {"say": "Across your field that is about 1105 tonnes a year."},            # una cuenta del modelo
        {"say": "With option 1 it drops to 8 tonnes, and its total is 59."},      # redondeos de 7.7 y 58.9
    ]})
    segments, _ = jarvis.parse_reply(content, CONTEXT, "how much soil do I lose?")
    assert [s["say"] for s in segments] == ["You lose 11.05 tonnes per hectare a year.",
                                            "With option 1 it drops to 8 tonnes, and its total is 59."]


def test_reply_with_only_made_up_numbers_becomes_an_honest_answer():
    content = json.dumps({"segments": [{"say": "You will earn 420 dollars per hectare.", "show": "scores"}]})
    segments, _ = jarvis.parse_reply(content, CONTEXT, "¿cuánto voy a ganar?", "es")
    assert segments == [{"say": jarvis.NO_FIGURE["es"]}]
    # Un número que dijo el usuario se puede repetir.
    segments, _ = jarvis.parse_reply(json.dumps({"segments": [{"say": "I have no data on 420 dollars."}]}), CONTEXT, "is 420 right?")
    assert segments == [{"say": "I have no data on 420 dollars."}]


def test_number_parsing_and_rounding():
    assert jarvis.numbers("1,308 mm, 7.7 t/ha, 11,05 y 1.255 mm; 1996–2010") == [1308.0, 7.7, 11.05, 1255.0, 1996.0, 2010.0]
    allowed = {11.05, 43.6}
    assert jarvis.grounded("11 tonnes, 11.1 tonnes, 43.6 out of 100, in 3 options over 30 years", allowed)
    assert not jarvis.grounded("12.5 tonnes", allowed)


def test_views_follow_the_alternative_named_in_the_question():
    content = json.dumps({"segments": [{"say": "It scores better.", "show": "scores"}, {"say": "Thirsty months.", "show": "climate"}]})
    segments, _ = jarvis.parse_reply(content, CONTEXT, "¿por qué la alternativa 2 es mejor?")
    assert segments[0] == {"say": "It scores better.", "view": "scores", "rot": "alt2"}
    assert segments[1]["rot"] == "current"                                           # "climate" no usa rotación
    # Si el modelo ya mostró esa alternativa, no se toca nada.
    content = json.dumps({"segments": [{"say": "Today.", "show": "erosion"}, {"say": "Option.", "show": "erosion", "rotation": "alt1"}]})
    assert [s["rot"] for s in jarvis.parse_reply(content, CONTEXT, "compare with the first option")[0]] == ["current", "alt1"]
    assert jarvis.asked_rotation("what about my current rotation?") is None


def test_score_ranking_needs_a_valid_score():
    assert jarvis.clean_view({"show": "score_ranking", "score": "water"}) == {"view": "score_ranking", "rot": "current", "score": "agua"}
    assert jarvis.clean_view({"show": "score_ranking", "score": "profit"}) == {"view": "ranking", "rot": "current"}
    assert jarvis.clean_view({"show": "forecast"}) == {"view": "forecast", "rot": "current"}


def test_parse_reply_without_json_speaks_the_text():
    segments, action = jarvis.parse_reply("Just plain words.")
    assert segments == [{"say": "Just plain words."}] and action is None


def test_without_analysis_only_illustrations_without_numbers():
    assert jarvis.clean_visual({"show": "crops", "variant": "cactus"}) == {}
    assert jarvis.clean_visual({"show": "soil", "variant": "erosion", "label": "x", "values": [1, 2]}) == {"show": "soil", "variant": "erosion"}
    assert jarvis.clean_visual({"show": "chart", "values": [5, 4, 3]}) == {}
    content = json.dumps({"segments": [{"say": "Cooper uses 30 years of NASA data.", "show": "chart", "values": [5, 4, 3]},
                                       {"say": "It rains 1300 millimeters there."}]})
    assert jarvis.parse_reply(content)[0] == [{"say": "Cooper uses 30 years of NASA data."}]


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
                    "reply": "Tus meses con sed son de diciembre a febrero.", "action": None, "lang": "es",
                    "model": jarvis.CHAT_MODELS[0]}
    system = seen["messages"][0]["content"]
    assert "ANALYSIS (JSON)" in system and "Near Young" in system
    assert "FIELD FILE" not in system and '"set"' not in system     # Jarvis ya no arma la ficha
    assert seen["messages"][-1] == {"role": "system", "content": "Answer in Spanish. Address the farmer as 'usted'."}


def test_chat_without_analysis_explains_cooper_and_points_to_it(monkeypatch):
    prompt = jarvis.build_prompt("")
    assert "There is no analysis yet" in prompt and "Analyze my field" in prompt
    assert "[data]" not in prompt and "- chart" not in prompt and "- soil:" in prompt


def test_chat_route_retries_without_json_mode(client, monkeypatch):
    calls = []

    def fake_post(url, **kw):
        calls.append("response_format" in kw["json"])
        return FakeResponse(400, {"error": {"code": "json_validate_failed"}}) if len(calls) == 1 else reply("Plain answer.")
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 200 and calls == [True, False]
    assert r.json()["segments"] == [{"say": "Plain answer."}]


def test_chat_asks_again_when_the_model_makes_up_a_number(client, monkeypatch):
    answers = [json.dumps({"segments": [{"say": "That is about 1105 tonnes a year.", "show": "erosion"}]}),
               json.dumps({"segments": [{"say": "You lose 11.05 tonnes per hectare a year.", "show": "erosion"}]})]
    sent = []

    def fake_post(url, **kw):
        sent.append(kw["json"]["messages"])
        return reply(answers[len(sent) - 1])
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "how much soil do I lose?"}],
                                              "context": json.loads(CONTEXT)})
    assert r.status_code == 200 and len(sent) == 2
    assert "1105" in sent[1][-1]["content"]                                        # se le dice cuál sobró
    assert r.json()["segments"] == [{"say": "You lose 11.05 tonnes per hectare a year.", "view": "erosion", "rot": "current"}]


def test_chat_keeps_the_honest_answer_if_the_second_try_is_also_made_up(client, monkeypatch):
    monkeypatch.setattr(assistant.httpx, "post", lambda url, **kw: reply(json.dumps(
        {"segments": [{"say": "You will earn 420 dollars."}]})))
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "how much will I earn?"}],
                                              "context": json.loads(CONTEXT)})
    assert r.status_code == 200 and r.json()["segments"] == [{"say": jarvis.NO_FIGURE["en"]}]


def test_chat_falls_back_to_the_next_model_when_one_is_out_of_quota(client, monkeypatch):
    tried = []

    def fake_post(url, **kw):
        tried.append(kw["json"]["model"])
        if len(tried) == 1:
            r = FakeResponse(429, {"error": {"code": "rate_limit_exceeded"}})
            r.headers = {"retry-after": "40"}
            return r
        return reply(json.dumps({"segments": [{"say": "Hello."}]}))
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    monkeypatch.setattr(jarvis.time, "sleep", lambda s: pytest.fail("should not wait: another model has quota"))
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 200 and tried == list(jarvis.CHAT_MODELS[:2])
    assert r.json()["model"] == jarvis.CHAT_MODELS[1]


def test_chat_says_busy_when_every_model_is_out_of_quota(client, monkeypatch):
    def fake_post(url, **kw):
        r = FakeResponse(429, {"error": {"code": "rate_limit_exceeded"}})
        r.headers = {"retry-after": "55"}
        return r
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    monkeypatch.setattr(jarvis.time, "sleep", lambda s: pytest.fail("55 s is too long to wait"))
    r = client.post("/api/jarvis/chat", json={"messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 503 and "busy" in r.json()["detail"]


def test_chat_models_can_be_set_from_the_environment(monkeypatch):
    monkeypatch.setenv("GROQ_CHAT_MODELS", " model-a , model-b,model-a ")
    assert jarvis.chat_models() == ["model-a", "model-b"]


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
