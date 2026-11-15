"""Tests de la voz (/api/voice). ElevenLabs se simula, no se usa la red."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import main, voice


class FakeAudio:
    status_code = 200
    content = b"ID3-fake-mp3"

    def raise_for_status(self):
        pass


@pytest.fixture(autouse=True)
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)
    monkeypatch.delenv("ELEVENLABS_MODEL", raising=False)
    for name in ("", "_ES", "_EN", "_PT"):
        monkeypatch.delenv("ELEVENLABS_VOICE_JARVIS" + name, raising=False)
    monkeypatch.setattr(voice, "CACHE_DIR", tmp_path / "voice")


@pytest.fixture
def client():
    return TestClient(main.app)


def test_returns_audio_and_sends_language(monkeypatch, client):
    calls = []
    monkeypatch.setattr(voice.httpx, "post", lambda url, **kw: calls.append((url, kw)) or FakeAudio())
    r = client.post("/api/voice", json={"text": "Su campo  pierde 212 mm.", "lang": "es"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3-fake-mp3"
    url, kw = calls[0]
    assert url.endswith(voice.DEFAULT_VOICE)
    assert kw["json"] == {"text": "Su campo pierde 212 mm.", "model_id": voice.DEFAULT_MODEL, "language_code": "es"}
    assert kw["headers"] == {"xi-api-key": "test-key"}


def test_jarvis_has_its_own_voice_per_language(monkeypatch, client):
    urls = []
    monkeypatch.setattr(voice.httpx, "post", lambda url, **kw: urls.append(url.rsplit("/", 1)[1]) or FakeAudio())
    for lang in ("en", "es"):
        assert client.post("/api/voice", json={"text": "Hello.", "lang": lang, "speaker": "jarvis"}).status_code == 200
    monkeypatch.setenv("ELEVENLABS_VOICE_JARVIS_ES", "custom-es")
    client.post("/api/voice", json={"text": "Hello.", "lang": "es", "speaker": "jarvis"})
    client.post("/api/voice", json={"text": "Hello.", "lang": "es"})
    assert urls == [voice.JARVIS_VOICES["en"], voice.JARVIS_VOICES["es"], "custom-es", voice.DEFAULT_VOICE]
    assert client.post("/api/voice", json={"text": "Hello.", "speaker": "robot"}).status_code == 422


def test_same_sentence_is_generated_once(monkeypatch, client):
    calls = []
    monkeypatch.setattr(voice.httpx, "post", lambda url, **kw: calls.append(1) or FakeAudio())
    for _ in range(3):
        assert client.post("/api/voice", json={"text": "Hello farmer.", "lang": "en"}).status_code == 200
    assert len(calls) == 1
    client.post("/api/voice", json={"text": "Hello farmer.", "lang": "pt"})  # otro idioma, otro audio
    assert len(calls) == 2


def test_without_key_the_page_falls_back(monkeypatch, client):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    monkeypatch.setattr(voice.httpx, "post", lambda *a, **k: pytest.fail("must not call ElevenLabs"))
    assert client.post("/api/voice", json={"text": "Hello.", "lang": "en"}).status_code == 503


def test_provider_error_is_503_and_not_saved(monkeypatch, client):
    def quota(url, **kw):
        raise httpx.HTTPStatusError("quota", request=httpx.Request("POST", url), response=httpx.Response(401))
    monkeypatch.setattr(voice.httpx, "post", quota)
    r = client.post("/api/voice", json={"text": "Hello.", "lang": "en"})
    assert r.status_code == 503 and "test-key" not in r.text
    assert not list(voice.CACHE_DIR.glob("*.mp3")) if voice.CACHE_DIR.exists() else True


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": "x" * (voice.MAX_CHARS + 1)}, {"text": "Hi", "lang": "fr"}])
def test_bad_requests_never_reach_the_provider(monkeypatch, client, body):
    monkeypatch.setattr(voice.httpx, "post", lambda *a, **k: pytest.fail("must not call ElevenLabs"))
    assert client.post("/api/voice", json=body).status_code == 422


def test_pages_load_the_voice_script(client):
    assert "CooperVoice" in client.get("/voice.js").text
    for page in ("/slides-3d.html", "/slides.html", "/jarvis/"):
        assert "voice.js" in client.get(page).text
