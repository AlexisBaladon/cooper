"""Tests de "Ask Cooper" (chat y audio): Groq se simula, no se usa la red."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import assistant, main


class FakeResponse:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code = status
        self._body = body or {}
        self.headers = headers or {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=httpx.Request("POST", "https://x"),
                                        response=httpx.Response(self.status_code, json=self._body))


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)


@pytest.fixture
def client():
    return TestClient(main.app)


CONTEXT = {"field": "Near Young", "rotations": [{"name": "Continuous soybean", "total": 43.6}]}


def test_chat_sends_analysis_and_returns_answer(monkeypatch):
    seen = {}

    def fake_post(url, json=None, **kw):
        seen.update(url=url, payload=json)
        return FakeResponse(body={"choices": [{"message": {"content": " Your current total is 43.6. "}}]})
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    answer = assistant.chat([{"role": "user", "content": "What's my score?"}], CONTEXT)
    assert answer == "Your current total is 43.6."
    system = seen["payload"]["messages"][0]["content"]
    assert "Continuous soybean" in system and "at most 3 short sentences" in system
    assert seen["payload"]["reasoning_effort"] == "low"


def test_chat_keeps_only_recent_history(monkeypatch):
    seen = {}
    monkeypatch.setattr(assistant.httpx, "post", lambda url, json=None, **kw: (seen.update(p=json), FakeResponse(
        body={"choices": [{"message": {"content": "ok"}}]}))[1])
    msgs = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(15)]
    assistant.chat(msgs, None)
    assert len(seen["p"]["messages"]) == 2 + assistant.MAX_HISTORY   # sistema + historial + idioma
    assert "No analysis has been run yet." in seen["p"]["messages"][0]["content"]


def test_chat_without_key_explains_setup(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    with pytest.raises(assistant.AssistantError, match="GROQ_API_KEY"):
        assistant.chat([{"role": "user", "content": "hi"}], None)


def test_chat_rate_limit_message(monkeypatch):
    monkeypatch.setattr(assistant.httpx, "post", lambda *a, **k: FakeResponse(429, {"error": {"code": "rate_limit"}}))
    with pytest.raises(assistant.AssistantError, match="busy"):
        assistant.chat([{"role": "user", "content": "hi"}], None)


def test_context_is_truncated():
    big = {"x": "a" * (assistant.MAX_CONTEXT_CHARS * 2)}
    assert len(assistant.build_context(big)) <= assistant.MAX_CONTEXT_CHARS + 20


def test_transcribe_sends_audio_to_whisper(monkeypatch):
    seen = {}

    def fake_post(url, files=None, data=None, **kw):
        seen.update(url=url, files=files, data=data)
        return FakeResponse(body={"text": " ¿Cuánta lluvia hay en enero? "})
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    text = assistant.transcribe(b"\x1aE\xdf\xa3audio", "audio/webm;codecs=opus")
    assert text == "¿Cuánta lluvia hay en enero?"
    assert seen["url"] == assistant.TRANSCRIBE_URL
    assert seen["files"]["file"][0] == "voice.webm" and seen["data"]["model"] == "whisper-large-v3-turbo"


@pytest.mark.parametrize("size, ctype, status", [
    (0, "audio/webm", 400),
    (assistant.MAX_AUDIO_BYTES + 1, "audio/webm", 413),
    (3, "text/plain", 415),
], ids=["empty", "too-long", "not-audio"])
def test_transcribe_rejects_bad_audio(size, ctype, status):
    with pytest.raises(assistant.AssistantError) as err:
        assistant.transcribe(b"x" * size, ctype)
    assert err.value.status == status


def test_api_chat(client, monkeypatch):
    monkeypatch.setattr(assistant, "chat", lambda messages, context: f"echo: {messages[-1]['content']}")
    data = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hello"}], "contexto": CONTEXT}).json()
    assert data == {"respuesta": "echo: hello"}


def test_api_chat_validation(client):
    assert client.post("/api/chat", json={"messages": []}).status_code == 422
    assert client.post("/api/chat", json={"messages": [{"role": "system", "content": "x"}]}).status_code == 422
    assert client.post("/api/chat", json={"messages": [{"role": "assistant", "content": "x"}]}).status_code == 400
    assert client.post("/api/chat", json={"messages": [{"role": "user", "content": "x" * 2000}]}).status_code == 422


def test_api_chat_without_key_returns_503(client, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503 and "GROQ_API_KEY" in r.json()["detail"]


def test_api_transcribe(client, monkeypatch):
    monkeypatch.setattr(assistant, "transcribe", lambda audio, ctype: f"{len(audio)} bytes of {ctype}")
    r = client.post("/api/transcribe", content=b"12345", headers={"Content-Type": "audio/webm"})
    assert r.json() == {"texto": "5 bytes of audio/webm"}


def test_api_transcribe_unsupported_type(client):
    r = client.post("/api/transcribe", content=b"12345", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415


def test_chat_retries_once_after_short_rate_limit(monkeypatch):
    calls = []

    def fake_post(url, **kw):
        calls.append(1)
        if len(calls) == 1:
            return FakeResponse(429, {"error": {"code": "rate_limit"}}, {"retry-after": "0.01"})
        return FakeResponse(body={"choices": [{"message": {"content": "ok"}}]})
    monkeypatch.setattr(assistant.httpx, "post", fake_post)
    assert assistant.chat([{"role": "user", "content": "hi"}], None) == "ok" and len(calls) == 2


def test_chat_long_rate_limit_is_not_retried(monkeypatch):
    calls = []
    monkeypatch.setattr(assistant.httpx, "post", lambda *a, **k: (calls.append(1), FakeResponse(
        429, {"error": {"code": "rate_limit"}}, {"retry-after": "30"}))[1])
    with pytest.raises(assistant.AssistantError, match="busy"):
        assistant.chat([{"role": "user", "content": "hi"}], None)
    assert len(calls) == 1


@pytest.mark.parametrize("text, lang", [
    ("When do my crops go thirsty?", "English"),
    ("Why is alternative 1 better than what I do now?", "English"),
    ("What price will soybean have next year?", "English"),
    ("¿Cuánta tierra estoy perdiendo por erosión?", "Spanish"),
    ("cuanta lluvia hay en enero", "Spanish"),
    ("Que me conviene sembrar", "Spanish"),
])
def test_detect_language(text, lang):
    assert assistant.detect_language(text) == lang


def test_chat_tells_model_the_language(monkeypatch):
    seen = {}
    monkeypatch.setattr(assistant.httpx, "post", lambda url, json=None, **kw: (seen.update(p=json), FakeResponse(
        body={"choices": [{"message": {"content": "ok"}}]}))[1])
    assistant.chat([{"role": "user", "content": "¿Cuánta agua usan mis cultivos?"}], None)
    assert seen["p"]["messages"][-1] == {"role": "system", "content": "Answer in Spanish."}
