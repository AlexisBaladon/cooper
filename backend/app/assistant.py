"""Asistente conversacional de Cooper ("Jarvis"), opcional, con Groq.

Responde preguntas sobre el análisis que el productor tiene abierto. No calcula,
no elige ni ordena rotaciones: solo explica con las cifras que recibe del
navegador (un resumen del análisis ya calculado por las reglas de Cooper).
Sin clave de Groq, devuelve fuente="sin_ia" y el navegador usa respuestas guiadas.

A Groq se envía solo la pregunta, el historial corto y ese resumen (sin coordenadas).
"""
from __future__ import annotations

import json
import os

import httpx

from .narrator import DEFAULT_MODEL, GROQ_URL

SYSTEM_PROMPT = """You are Jarvis, the assistant inside Cooper, a decision-support tool that helps
farmers in Uruguay compare crop rotations with 30 years of NASA data.

Rules you must follow:
- Answer ONLY from the analysis summary provided as JSON. If the answer is not in it, say so
  plainly and suggest what the farmer could check or measure.
- You never decide for the farmer and never invent numbers, prices, yields or doses. Cooper's
  scores come from written agronomic rules; you only explain them.
- Remind the farmer to review important decisions with their agronomist when relevant.
- Income scores are relative indicators, not profit. Scenarios are what-if simulations, not forecasts.
- Be brief and concrete: at most 120 words, plain language, no tables, no markdown headings.
- Reply in {language}."""

MAX_CONTEXT_CHARS = 7000


def answer(message: str, history: list[dict], context: dict | None, language: str = "en") -> dict:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        return {"fuente": "sin_ia", "respuesta": None, "motivo": "GROQ_API_KEY is missing"}
    model = os.environ.get("GROQ_MODEL", "").strip() or DEFAULT_MODEL
    ctx = json.dumps(context or {}, ensure_ascii=False)[:MAX_CONTEXT_CHARS]
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT.format(language="Spanish (Rioplatense, using 'vos')" if language == "es" else "English")},
        {"role": "system", "content": "Analysis summary (JSON): " + ctx},
    ]
    for turn in history[-6:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        messages.append({"role": role, "content": str(turn.get("content", ""))[:600]})
    messages.append({"role": "user", "content": message})
    try:
        resp = httpx.post(GROQ_URL, timeout=25, headers={"Authorization": f"Bearer {api_key}"},
                          json={"model": model, "temperature": 0.3, "max_completion_tokens": 700,
                                "messages": messages})
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"].strip()
    except httpx.HTTPStatusError as exc:
        return {"fuente": "sin_ia", "respuesta": None, "motivo": f"Groq responded {exc.response.status_code}"}
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
        return {"fuente": "sin_ia", "respuesta": None, "motivo": f"Could not use Groq ({type(exc).__name__})"}
    if not text:
        return {"fuente": "sin_ia", "respuesta": None, "motivo": "Empty answer"}
    return {"fuente": "groq", "modelo": model, "respuesta": text[:1500]}
