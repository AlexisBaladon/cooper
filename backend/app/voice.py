"""Voz de Cooper con ElevenLabs: texto → audio MP3 (/api/voice).

La usan la narración de "Explain it simply" y Jarvis a pantalla completa. Si no hay clave, se
acabó el cupo o ElevenLabs falla, la ruta responde 503 y la página sigue con la voz del navegador.

Cada frase ya generada se guarda en disco (data/cache/voice): repetir una explicación no vuelve
a gastar caracteres del plan.

Configuración (variables de entorno o backend/.env):
    ELEVENLABS_API_KEY   clave de https://elevenlabs.io (permiso: Text to Speech)
    ELEVENLABS_VOICE_ID  opcional: voz de la narración ("Explain it simply")
    ELEVENLABS_VOICE_JARVIS, ELEVENLABS_VOICE_JARVIS_ES / _EN / _PT
                         opcional: voz de Jarvis, general o por idioma
    ELEVENLABS_MODEL     opcional, por defecto eleven_flash_v2_5 (rápido y barato)
"""
from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

import httpx

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:  # python-dotenv es opcional
    pass

API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}"
DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"   # "Sarah", voz incluida en todos los planes
# Jarvis habla con voz masculina, una por idioma (voces incluidas en todos los planes).
JARVIS_VOICES = {"en": "onwK4e9ZLuTAKqWW03F9",   # "Daniel"
                 "es": "nPczCjzI2devNBz1zQrb",   # "Brian"
                 "pt": "nPczCjzI2devNBz1zQrb"}
SPEAKERS = ("narrator", "jarvis")
DEFAULT_MODEL = "eleven_flash_v2_5"
LANGS = ("en", "es", "pt")
MAX_CHARS = 1000
TIMEOUT_S = 20
MAX_CACHE_FILES = 4000
CACHE_DIR = Path(os.environ.get("NASA_CACHE_DIR", Path(__file__).resolve().parents[2] / "data" / "cache")) / "voice"

# La cuenta admite pocas peticiones a la vez: el resto espera su turno acá, no en ElevenLabs.
_slots = threading.BoundedSemaphore(2)


class VoiceError(Exception):
    """La voz no está disponible; la página usa la del navegador."""


def _settings(lang: str, speaker: str) -> tuple[str, str, str]:
    env = lambda name: os.environ.get(name, "").strip()
    key = env("ELEVENLABS_API_KEY")
    if not key:
        raise VoiceError("ELEVENLABS_API_KEY is missing in backend/.env")
    if speaker == "jarvis":
        voice = env(f"ELEVENLABS_VOICE_JARVIS_{lang.upper()}") or env("ELEVENLABS_VOICE_JARVIS") or JARVIS_VOICES[lang]
    else:
        voice = env("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE
    model = os.environ.get("ELEVENLABS_MODEL", "").strip() or DEFAULT_MODEL
    return key, voice, model


def _cache_path(voice: str, model: str, lang: str, text: str) -> Path:
    digest = hashlib.sha256("\x00".join((voice, model, lang, text)).encode()).hexdigest()[:32]
    return CACHE_DIR / f"{digest}.mp3"


def _save(path: Path, audio: bytes) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        if sum(1 for _ in CACHE_DIR.iterdir()) >= MAX_CACHE_FILES:
            return
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_bytes(audio)
        tmp.replace(path)
    except OSError:
        pass  # sin caché la voz funciona igual


def speak(text: str, lang: str, speaker: str = "narrator") -> bytes:
    """Devuelve el MP3 de `text` dicho en `lang` ("en", "es" o "pt") por el narrador o por Jarvis."""
    text = " ".join(text.split())
    if not text or len(text) > MAX_CHARS or lang not in LANGS or speaker not in SPEAKERS:
        raise ValueError("text or language not supported")
    key, voice, model = _settings(lang, speaker)
    path = _cache_path(voice, model, lang, text)
    try:
        return path.read_bytes()
    except OSError:
        pass
    body = {"text": text, "model_id": model}
    if model.endswith("_v2_5"):
        body["language_code"] = lang  # los modelos 2.5 aceptan fijar el idioma; el resto lo detecta
    if not _slots.acquire(timeout=TIMEOUT_S):
        raise VoiceError("voice is busy")
    try:
        response = httpx.post(API_URL.format(voice=voice), params={"output_format": "mp3_44100_128"},
                              headers={"xi-api-key": key}, json=body, timeout=TIMEOUT_S)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        raise VoiceError(f"ElevenLabs did not answer ({status or type(exc).__name__})") from exc
    finally:
        _slots.release()
    audio = response.content
    if not audio:
        raise VoiceError("ElevenLabs returned no audio")
    _save(path, audio)
    return audio
