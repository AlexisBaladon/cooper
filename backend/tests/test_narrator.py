"""Tests de la redacción con Groq: el LLM se simula, no se usa la red."""
import httpx
import pytest

from app import narrator

SLIDES = [
    {"key": "hoy", "headline": "Today: the soil is bare 6 months a year",
     "narration": ["This is your field.", "About 11 tonnes per hectare are lost each year: that's 37 truckloads."]},
    {"key": "cierre", "headline": "It helps you think. The decision is yours.",
     "narration": ["This tool helps you think, but the decision is yours."]},
]


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    narrator._cache.clear()
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)


def fake(monkeypatch, slides):
    monkeypatch.setattr(narrator, "_call_groq", lambda *_: slides)


def test_without_key_uses_template(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    out = narrator.rewrite(SLIDES)
    assert out["fuente"] == "plantilla" and out["slides"] == SLIDES
    assert "GROQ_API_KEY" in out["motivo"]


def test_narration_cache_is_bounded_and_reuses_recent_entries(monkeypatch):
    monkeypatch.setattr(narrator, "MAX_CACHE_ENTRIES", 2)
    calls = []
    def rewrite(slides, *_):
        calls.append(slides)
        return slides
    monkeypatch.setattr(narrator, "_call_groq", rewrite)
    def slides(label):
        return [{"key": label, "headline": label, "narration": ["Compare your rotations."]}]
    for label in ("a", "b", "c"):
        assert narrator.rewrite(slides(label))["fuente"] == "groq"
    assert len(narrator._cache) == 2
    narrator.rewrite(slides("c"))
    assert len(calls) == 3
    narrator.rewrite(slides("a"))
    assert len(calls) == 4


def test_good_rewrite_is_accepted(monkeypatch):
    fake(monkeypatch, [
        {"key": "hoy", "headline": "Your soil sits bare 6 months",
         "narration": ["Take a look at your field.", "Each year about 11 tonnes per hectare wash away, like 37 truckloads of soil."]},
        {"key": "cierre", "headline": "You decide", "narration": ["The tool helps; you're the one who decides."]},
    ])
    out = narrator.rewrite(SLIDES)
    assert out["fuente"] == "groq" and out["reescritas"] == 2
    assert out["slides"][0]["narration"][1].startswith("Each year")


def test_thousands_separator_counts_as_the_same_number():
    original = {"key": "cambio", "headline": "The climate is changing",
                "narration": ["It rained 1,308 millimeters a year; since 2011, 1,191."]}
    rewritten = {"key": "cambio", "headline": "Less rain than before",
                 "narration": ["Rain fell from 1308 to 1191 millimeters a year after 2011."]}
    assert narrator.validate_slide(original, rewritten) is None


def test_changed_number_falls_back_for_that_slide(monkeypatch):
    fake(monkeypatch, [
        {"key": "hoy", "headline": "Your soil", "narration": ["Look at your field.", "12 tonnes are lost, like 37 truckloads."]},
        {"key": "cierre", "headline": "You decide", "narration": ["You're the one who decides."]},
    ])
    out = narrator.rewrite(SLIDES)
    assert out["slides"][0] == SLIDES[0]            # plantilla: el 11 se convirtió en 12
    assert out["slides"][1]["headline"] == "You decide"
    assert out["rechazadas"][0]["key"] == "hoy"


@pytest.mark.parametrize("bad", [
    {"key": "hoy", "headline": "Ok", "narration": ["One single sentence with 11 and 37."]},                # frases de menos
    {"key": "hoy", "headline": "Ok", "narration": ["Look.", "That's 11 tonnes, 37 truckloads and 5 years."]},  # número agregado
    {"key": "hoy", "headline": "Save 40%", "narration": ["Look.", "That's 11 tonnes and 37 truckloads."]},     # titular con dato nuevo
    {"key": "hoy", "headline": "Ok", "narration": ["Look.", "x" * 400 + " 11 37"]},                          # frase larguísima
])
def test_invalid_slides_are_rejected(bad):
    assert narrator.validate_slide(SLIDES[0], bad) is not None


def test_groq_error_uses_template(monkeypatch):
    def boom(*_):
        raise httpx.ConnectError("no network")
    monkeypatch.setattr(narrator, "_call_groq", boom)
    out = narrator.rewrite(SLIDES)
    assert out["fuente"] == "plantilla" and out["slides"] == SLIDES and "motivo" in out


def test_malformed_json_is_retried_once(monkeypatch):
    calls = []

    def flaky(*_):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("malformed JSON")
        return [{"key": "hoy", "headline": "Your soil sits bare 6 months",
                 "narration": ["Take a look at your field.", "About 11 tonnes per hectare wash away, like 37 truckloads."]},
                {"key": "cierre", "headline": "You decide", "narration": ["You're the one who decides."]}]
    monkeypatch.setattr(narrator, "_call_groq", flaky)
    out = narrator.rewrite(SLIDES)
    assert len(calls) == 2 and out["fuente"] == "groq" and out["reescritas"] == 2


def test_auth_error_is_not_retried(monkeypatch):
    calls = []

    def denied(*_):
        calls.append(1)
        raise httpx.HTTPStatusError("401", request=httpx.Request("POST", narrator.GROQ_URL),
                                    response=httpx.Response(401, json={"error": {"code": "invalid_api_key"}}))
    monkeypatch.setattr(narrator, "_call_groq", denied)
    out = narrator.rewrite(SLIDES)
    assert len(calls) == 1 and out["fuente"] == "plantilla" and "invalid_api_key" in out["motivo"]
