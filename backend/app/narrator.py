"""Redacción de "Explain it simply" con un LLM de Groq (opcional).

El LLM NO decide ni calcula nada: recibe los textos de plantilla de cada slide
(que ya traen los números del análisis) y los reescribe en lenguaje más natural.
Cada slide reescrita se valida antes de aceptarla:

- misma cantidad de frases (cada frase dispara un paso de la animación);
- cada frase conserva exactamente los números de la frase original, y no agrega otros;
- largo razonable.

Si falta la clave, Groq falla o una slide no pasa la validación, se usa la plantilla.
Los textos de la UI y de la voz están en inglés, igual que los mensajes que se muestran.

Configuración (variables de entorno o backend/.env):
    GROQ_API_KEY   clave de https://console.groq.com/keys
    GROQ_MODEL     opcional; por defecto openai/gpt-oss-120b

A Groq solo se envían los textos de las slides (nombre del campo, rotaciones y
cifras del análisis). No se envían coordenadas.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from collections import OrderedDict
from threading import Lock
from pathlib import Path

import httpx

try:  # python-dotenv es opcional
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:  # pragma: no cover
    pass

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-oss-120b"
MAX_SENTENCE_CHARS = 340
MAX_HEADLINE_CHARS = 70

SYSTEM_PROMPT = """You are the writer for a farming decision-support tool used by farmers in Uruguay.
You receive the slides of a spoken explanation, written from templates. Your ONLY job is to
rewrite them so they sound natural, warm and easy to follow when heard aloud.

Mandatory rules:
1. Return the same slides, with the same "key" and in the same order.
2. Each slide must have EXACTLY the same number of sentences in "narration", in the same
   order, each with the same content as the matching original sentence (every sentence is
   synced with an animation).
3. Keep every number exactly as written, in digits, and do not add any number, fact, crop,
   cause or recommendation that is not in the original text.
4. Keep proper names and the names of crops and rotations.
5. Plain, friendly English for farmers in Uruguay, speaking to them as "you". Short sentences
   (30 words at most), no new jargon, no emojis and no unusual symbols: the text is read
   aloud by a speech synthesizer. Keep metric units (millimeters, tonnes per hectare, °C).
6. Don't soften or change the meaning of warnings: the tool helps people think, it doesn't
   decide, and they should talk to their agronomist.
7. "headline" is a title of 9 words at most, with the same message as the original.

Reply with JSON only: {"slides": [{"key": "...", "headline": "...", "narration": ["...", "..."]}]}"""

_NUM = re.compile(r"[+-]?\d+(?:\.\d+)?")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")
MAX_CACHE_ENTRIES = 64
_cache: OrderedDict[str, dict] = OrderedDict()
_cache_lock = Lock()


def _numbers(text: str) -> list[str]:
    """Números de una frase; en inglés la coma es separador de miles ("1,308" = "1308")."""
    return sorted(_NUM.findall(_THOUSANDS.sub("", text.replace("−", "-"))))


def validate_slide(original: dict, new: dict) -> str | None:
    """Devuelve None si la slide reescrita es aceptable, o el motivo del rechazo."""
    if not isinstance(new, dict) or new.get("key") != original["key"]:
        return "different key"
    narr = new.get("narration")
    if not isinstance(narr, list) or len(narr) != len(original["narration"]):
        return "different number of sentences"
    for old, cur in zip(original["narration"], narr):
        if not isinstance(cur, str) or not cur.strip():
            return "empty sentence"
        if len(cur) > MAX_SENTENCE_CHARS:
            return "sentence too long"
        if _numbers(cur) != _numbers(old):
            return "numbers don't match the data"
    head = new.get("headline")
    if not isinstance(head, str) or not head.strip() or len(head) > MAX_HEADLINE_CHARS:
        return "invalid headline"
    if not set(_numbers(head)) <= set(_numbers(original["headline"])):
        return "the headline adds numbers"
    return None


def _call_groq(slides: list[dict], api_key: str, model: str) -> list[dict]:
    payload = {
        "model": model,
        "temperature": 0.4,
        "max_completion_tokens": 4096,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({"slides": slides}, ensure_ascii=False)},
        ],
    }
    resp = httpx.post(GROQ_URL, json=payload, timeout=20,
                      headers={"Authorization": f"Bearer {api_key}"})
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    out = json.loads(content)["slides"]
    if not isinstance(out, list):
        raise ValueError("response without a list of slides")
    return out


def _call_with_retry(slides: list[dict], api_key: str, model: str, attempts: int = 2) -> list[dict]:
    """Reintenta cuando el modelo devuelve un JSON mal formado (falla intermitente)."""
    for attempt in range(attempts):
        last = attempt == attempts - 1
        try:
            return _call_groq(slides, api_key, model)
        except httpx.HTTPStatusError as exc:
            # 400 = Groq no pudo validar el JSON generado; otros códigos (401, 404, 429) no se arreglan reintentando.
            if last or exc.response.status_code != 400:
                raise
        except (KeyError, ValueError, TypeError):
            if last:
                raise
    raise RuntimeError("no attempts")  # pragma: no cover


def rewrite(slides: list[dict]) -> dict:
    """slides: [{key, headline, narration: [str]}]. Devuelve los textos finales y su origen."""
    template = {"fuente": "plantilla", "modelo": None, "slides": slides, "reescritas": 0}
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        return {**template, "motivo": "GROQ_API_KEY is missing in backend/.env"}
    model = os.environ.get("GROQ_MODEL", "").strip() or DEFAULT_MODEL

    key = hashlib.sha256(json.dumps([model, slides], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached

    try:
        generated = _call_with_retry(slides, api_key, model)
    except httpx.HTTPStatusError as exc:
        try:   # código de error de Groq (p. ej. model_not_found, json_validate_failed), sin el cuerpo completo
            code = exc.response.json().get("error", {}).get("code") or ""
        except ValueError:
            code = ""
        return {**template, "motivo": f"Groq responded {exc.response.status_code}" + (f" ({code})" if code else "")}
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        return {**template, "motivo": f"Could not use Groq ({type(exc).__name__})"}

    by_key = {s.get("key"): s for s in generated if isinstance(s, dict)}
    final, rejected, ok = [], [], 0
    for original in slides:
        new = by_key.get(original["key"])
        reason = validate_slide(original, new) if new else "missing slide"
        if reason:
            final.append(original)
            rejected.append({"key": original["key"], "motivo": reason})
        else:
            final.append({"key": original["key"], "headline": new["headline"].strip(),
                          "narration": [t.strip() for t in new["narration"]]})
            ok += 1
    result = {"fuente": "groq" if ok else "plantilla", "modelo": model if ok else None,
              "slides": final, "reescritas": ok, "rechazadas": rejected}
    if ok:
        with _cache_lock:
            _cache[key] = result
            _cache.move_to_end(key)
            while len(_cache) > MAX_CACHE_ENTRIES:
                _cache.popitem(last=False)
    return result
