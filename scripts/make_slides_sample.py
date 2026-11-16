"""Genera frontend/slides-sample.js con un análisis real del campo demo de Young."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app, DEMO_FIELDS  # noqa: E402

field = DEMO_FIELDS[0]
req = {"lat": field["lat"], "lon": field["lon"], "rotacion_actual": field["rotacion"],
       "tiene_ganado": field["tiene_ganado"],
       "prioridades": {"agua": 3, "suelo": 4, "ingreso": 4, "forraje": 1, "clima": 3}}
d = TestClient(app).post("/api/analyze", json=req).json()
slim = {
    "campo": field["nombre"],
    "meta": d["meta"],
    "clima": {"mensual": d["clima"]["mensual"], "tendencias": d["clima"]["tendencias"]["indicadores"]},
    "rotaciones": [{k: r[k] for k in ("id", "nombre", "rol", "total", "puntajes", "indicadores", "calendario", "explicacion", "diagnostico")}
                   for r in d["rotaciones"]],
    "terreno": {"n": 15, "elev": [c["elev"] for c in d["zonas"]["celdas"]],
                "eros": {r["id"]: [c["eros"][r["id"]] for c in d["zonas"]["celdas"]] for r in d["rotaciones"]}} if d["zonas"] else None,
    "zonas": {"resumen": d["zonas"]["resumen"], "tolerancia_t_ha": d["zonas"]["tolerancia_t_ha"], "area_ha": d["zonas"]["area_ha"]} if d["zonas"] else None,
}
out = ROOT / "frontend" / "slides-sample.js"
out.write_text("window.SAMPLE_ANALYSIS = " + json.dumps(slim, ensure_ascii=False) + ";\n", encoding="utf-8")
print("ok", out, out.stat().st_size, "bytes")
for r in slim["rotaciones"]:
    print(r["rol"], r["nombre"], r["total"], r["indicadores"].get("erosion_t_ha"), r["indicadores"]["meses_descubiertos"])
