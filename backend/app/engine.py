"""Motor de comparación de rotaciones (reglas + puntaje explicable, sin ML).

Para cada rotación:
1. Se ubica cada cultivo en los meses del año agrícola (mayo–abril).
2. Se corre un balance hídrico mensual tipo "balde" sobre los años reales
   de NASA POWER (1996–2025), probando todas las fases de la rotación.
   - Demanda del cultivo: ETc = ET0 x Kc (FAO-56). Suelo desnudo: Kc = 0.3.
   - Lluvia efectiva: método USDA-SCS (el usado por FAO CROPWAT).
   - El balde se llena hasta la capacidad de agua del suelo elegida.
3. Se calculan indicadores (meses descubiertos, déficit en años normales y
   secos, lluvia sobre suelo desnudo, calor/helada en etapas críticas, etc.).
4. Se convierten en 5 puntajes de 0 a 100 y se ponderan con las prioridades
   del productor. Cada umbral está escrito acá abajo para que se pueda revisar.

Los textos que ve el usuario (etiquetas y explicaciones) están en inglés.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .climate import AG_MONTHS, month_name

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
KC_BARE = 0.3
EROSION_TOL = 7.0  # t/ha/año, tolerancia de referencia (igual que terrain.TOLERANCIA_T_HA)
COVER_CROP = "cover crop"         # valor de "tipo" en data/crops.json
WINTER_IDX = AG_MONTHS.index(8)   # agosto: representa la zafra de invierno
SUMMER_IDX = AG_MONTHS.index(1)   # enero: representa la zafra de verano

SUBSCORES = {
    "agua": "Water saving",
    "suelo": "Soil health",
    "ingreso": "Income (indicative)",
    "forraje": "Forage",
    "clima": "Climate resilience",
}


def _clamp01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


# ---------------------------------------------------------------- catálogo

@dataclass
class Catalog:
    crops: dict
    rotations: dict


def load_catalog() -> Catalog:
    crops = {c["id"]: c for c in json.loads(
        (DATA_DIR / "crops.json").read_text(encoding="utf-8"))["cultivos"]}
    rotations = {r["id"]: r for r in json.loads(
        (DATA_DIR / "rotations.json").read_text(encoding="utf-8"))["rotaciones"]}
    _validate(crops, rotations)
    return Catalog(crops, rotations)


def _validate(crops: dict, rotations: dict) -> None:
    for c in crops.values():
        if len(c["kc"]) != len(c["meses"]):
            raise ValueError(f"{c['id']}: 'kc' y 'meses' deben tener el mismo largo")
        if not set(c["meses_criticos"]) <= set(c["meses"]):
            raise ValueError(f"{c['id']}: meses críticos fuera del ciclo")
    for r in rotations.values():
        for i, year in enumerate(r["anios"]):
            used: set[int] = set()
            for cid in year:
                if cid not in crops:
                    raise ValueError(f"{r['id']}: cultivo desconocido '{cid}'")
                overlap = used & set(crops[cid]["meses"])
                if overlap:
                    raise ValueError(f"{r['id']} año {i + 1}: meses superpuestos {sorted(overlap)}")
                used |= set(crops[cid]["meses"])


def year_layout(year: list[str], crops: dict) -> list[tuple[str, float] | None]:
    """12 posiciones (May→Abr) con (cultivo, Kc) o None si está descubierto."""
    layout: list[tuple[str, float] | None] = [None] * 12
    for cid in year:
        c = crops[cid]
        for m, kc in zip(c["meses"], c["kc"]):
            layout[AG_MONTHS.index(m)] = (cid, kc)
    return layout


# ------------------------------------------------------------ simulación

def effective_rain(p: float) -> float:
    """Lluvia efectiva mensual, USDA-SCS (mm)."""
    return p * (125 - 0.2 * p) / 125 if p <= 250 else 125 + 0.1 * p


def _month_arrays(m: pd.DataFrame) -> dict[str, np.ndarray]:
    n = len(m) // 12
    return {k: m[k].to_numpy(dtype=float).reshape(n, 12)
            for k in ("rain", "et0", "heat", "frost", "heavy")}


def simulate(rotation: dict, crops: dict, arr: dict[str, np.ndarray], cap: float) -> dict:
    layouts = [year_layout(y, crops) for y in rotation["anios"]]
    n_rot = len(layouts)
    n_years = arr["rain"].shape[0]
    recs = []
    for offset in range(n_rot):
        storage = cap
        for k in range(n_years):
            lay = layouts[(k + offset) % n_rot]
            r = dict(etc=0.0, crop_def=0.0, crit_def=0.0, bare=0, rain_bare=0.0,
                     heavy_bare=0.0, heat_crit=0.0, frost_crit=0.0)
            for mi in range(12):
                entry = lay[mi]
                et0, rain = arr["et0"][k, mi], arr["rain"][k, mi]
                kc = entry[1] if entry else KC_BARE
                etc = et0 * kc
                new = storage + effective_rain(rain) - etc
                deficit = max(0.0, -new)
                storage = min(cap, max(0.0, new))
                if entry:
                    crop = crops[entry[0]]
                    r["etc"] += etc
                    r["crop_def"] += deficit
                    if AG_MONTHS[mi] in crop["meses_criticos"]:
                        r["crit_def"] += deficit
                        if crop["sensible_calor"]:
                            r["heat_crit"] += arr["heat"][k, mi]
                        if crop["sensible_helada"]:
                            r["frost_crit"] += arr["frost"][k, mi]
                else:
                    r["bare"] += 1
                    r["rain_bare"] += rain
                    r["heavy_bare"] += arr["heavy"][k, mi]
            recs.append(r)
    df = pd.DataFrame(recs)
    return {
        "uso_agua_mm": float(df["etc"].mean()),
        "deficit_mm": float(df["crop_def"].mean()),
        "deficit_seco_mm": float(df["crop_def"].quantile(0.8)),
        "deficit_critico_mm": float(df["crit_def"].mean()),
        "deficit_critico_seco_mm": float(df["crit_def"].quantile(0.8)),
        "meses_descubiertos": float(df["bare"].mean()),
        "lluvia_suelo_desnudo_mm": float(df["rain_bare"].mean()),
        "lluvia_fuerte_suelo_desnudo": float(df["heavy_bare"].mean()),
        "dias_calor_critico": float(df["heat_crit"].mean()),
        "dias_helada_critico": float(df["frost_crit"].mean()),
    }


def static_metrics(rotation: dict, crops: dict) -> dict:
    years = rotation["anios"]
    n = len(years)
    all_crops = [crops[c] for y in years for c in y]
    families = {c["familia"] for c in all_crops}

    # Repetición del mismo cultivo en la misma zafra en años seguidos
    # (no cuenta pasturas perennes ni coberturas).
    layouts = [year_layout(y, crops) for y in years]
    slots = repeats = 0
    for idx in (WINTER_IDX, SUMMER_IDX):
        for i in range(n):
            cur, prev = layouts[i][idx], layouts[i - 1][idx]
            if not cur:
                continue
            c = crops[cur[0]]
            if c["perenne"] or c["tipo"] == COVER_CROP:
                continue
            slots += 1
            if prev and prev[0] == cur[0]:
                repeats += 1
            elif prev and crops[prev[0]]["familia"] == c["familia"]:
                repeats += 0.5
    commercial = [sum(1 for c in y if crops[c]["ingreso"] >= 3) for y in years]
    return {
        "residuo_anual": sum(c["residuo"] for c in all_crops) / n,
        "aporte_n_anual": sum(c["aporte_n"] for c in all_crops) / n,
        "forraje_anual": sum(c["forraje"] for c in all_crops) / n,
        "ingreso_anual": sum(c["ingreso"] for c in all_crops) / n,
        "familias": len(families),
        "repeticion": repeats / slots if slots else 0.0,
        "anios_doble_cultivo": sum(1 for x in commercial if x >= 2),
        "duracion_anios": n,
    }


# --------------------------------------------------------------- puntajes

def subscores(mt: dict) -> dict:
    """Convierte indicadores en puntajes 0-100. Umbrales heurísticos, revisables."""
    cobertura = 1 - mt["meses_descubiertos"] / 12
    materia_org = _clamp01(mt["residuo_anual"] / 6)
    if "erosion_t_ha" in mt:
        # RUSLE con terreno real: 0 t/ha → mejor; 2 x tolerancia (14 t/ha) → peor.
        erosion = 1 - _clamp01(mt["erosion_t_ha"] / (2 * EROSION_TOL))
    else:
        # Sin terreno (OpenTopoData no respondió): proxy de lluvia sobre suelo desnudo.
        erosion = 1 - _clamp01(mt["lluvia_suelo_desnudo_mm"] / 700)
    nitrogeno = _clamp01(mt["aporte_n_anual"] / 3)
    diversidad = 0.6 * _clamp01((mt["familias"] - 1) / 3) + 0.4 * (1 - mt["repeticion"])
    suelo = np.mean([cobertura, materia_org, erosion, nitrogeno, diversidad])

    # Agua: déficit en año seco (0 mm → mejor, 600 mm → peor) y demanda total
    # de los cultivos (500 mm/año → mejor, 1400 mm/año → peor).
    agua = (0.5 * (1 - _clamp01(mt["deficit_seco_mm"] / 600))
            + 0.5 * (1 - _clamp01((mt["uso_agua_mm"] - 500) / 900)))
    # Clima: el déficit en etapas críticas pesa completo; el resto del ciclo,
    # un 25 % (una pastura también sufre la sequía aunque no tenga floración crítica).
    deficit_pond = (mt["deficit_critico_seco_mm"]
                    + 0.25 * (mt["deficit_seco_mm"] - mt["deficit_critico_seco_mm"]))
    clima = (1 - 0.5 * _clamp01(deficit_pond / 300)
             - 0.25 * _clamp01(mt["dias_calor_critico"] / 15)
             - 0.25 * _clamp01(mt["dias_helada_critico"] / 5))
    return {
        "agua": round(100 * agua),
        "suelo": round(100 * suelo),
        "ingreso": round(100 * _clamp01(mt["ingreso_anual"] / 7)),
        "forraje": round(100 * _clamp01(mt["forraje_anual"] / 5)),
        "clima": round(100 * clima),
        "_detalle_suelo": {
            "cobertura": round(100 * cobertura),
            "materia_organica": round(100 * materia_org),
            "erosion": round(100 * erosion),
            "nitrogeno": round(100 * nitrogeno),
            "diversidad": round(100 * diversidad),
        },
    }


def total_score(sub: dict, prio: dict) -> float:
    w = {k: max(0.0, float(prio.get(k, 0))) for k in SUBSCORES}
    tw = sum(w.values()) or 1.0
    return round(sum(w[k] * sub[k] for k in SUBSCORES) / tw, 1)


# ----------------------------------------------------------- explicaciones

def _names(ids, crops) -> str:
    names = [crops[i]["nombre"] for i in dict.fromkeys(ids)]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _say(ids, crops, singular: str, plural: str) -> str:
    """'<cultivos> <verbo>' con concordancia de número."""
    return f"{_names(ids, crops)} {singular if len(ids) == 1 else plural}"


def _months_txt(x: float) -> str:
    if x < 0.5:
        return "practically no months"
    n = round(x)
    return f"{n} month" if n == 1 else f"{n} months"


def _crop_ids(rotation: dict) -> list[str]:
    return list(dict.fromkeys(c for y in rotation["anios"] for c in y))


def explain(rot: dict, ev: dict, cur: dict | None, prio: dict,
            crops: dict, clim: list[dict], ctx: dict) -> dict:
    mt, sub = ev["indicadores"], ev["puntajes"]
    ids = _crop_ids(rot)
    clim_by_month = {c["mes"]: c for c in clim}

    # --- Por qué
    por_que: list[str] = []
    if cur is None:
        por_que.append("This is the rotation you use today. It's shown as the baseline for comparison.")
    else:
        top = [SUBSCORES[k].lower() for k, v in prio.items() if v >= 4 and k in SUBSCORES]
        if top:
            por_que.append("You gave the most weight to: " + ", ".join(top) + ".")
        cm, cs = cur["indicadores"], cur["puntajes"]
        gains = sorted(((prio.get(k, 0) * (sub[k] - cs[k]), k) for k in SUBSCORES), reverse=True)
        for weight, k in gains:
            if weight <= 0 or sub[k] - cs[k] < 3:
                continue
            a, b = cs[k], sub[k]
            if k == "suelo":
                extra = []
                if "erosion_t_ha" in mt and mt["erosion_t_ha"] < cm["erosion_t_ha"] * 0.9:
                    extra.append(f"estimated erosion drops from {cm['erosion_t_ha']:.1f} to {mt['erosion_t_ha']:.1f} t/ha a year")
                if mt["meses_descubiertos"] < cm["meses_descubiertos"] - 0.5:
                    extra.append(f"the field is left without a crop {_months_txt(mt['meses_descubiertos'])} a year instead of {_months_txt(cm['meses_descubiertos'])}")
                if mt["aporte_n_anual"] > cm["aporte_n_anual"]:
                    extra.append("it adds legumes that supply nitrogen")
                if mt["residuo_anual"] > cm["residuo_anual"]:
                    extra.append("it leaves more stubble to build organic matter")
                if mt["familias"] > cm["familias"]:
                    extra.append("it rotates more plant families")
                por_que.append(f"It improves soil health ({a}→{b} points)" + (": " + "; ".join(extra) if extra else "") + ".")
            elif k == "agua":
                por_que.append(f"It uses water with more margin ({a}→{b}): in a dry year (1 in 5) the crops' water deficit goes from {cm['deficit_seco_mm']:.0f} to {mt['deficit_seco_mm']:.0f} mm.")
            elif k == "ingreso":
                txt = f"It has a higher indicative income ({a}→{b})"
                if mt["anios_doble_cultivo"]:
                    txt += f", because it grows two cash crops a year in {mt['anios_doble_cultivo']} of {mt['duracion_anios']} years"
                por_que.append(txt + ".")
            elif k == "forraje":
                por_que.append(f"It produces more forage for livestock ({a}→{b}).")
            elif k == "clima":
                por_que.append(f"It is more resilient to the climate ({a}→{b}): less water shortage, heat or frost during the crops' critical stages.")
        if len(por_que) <= 1:
            por_que.append("It's the next best option for your priorities, although it doesn't improve much on your current rotation.")

    # --- Evidencia (datos)
    evidencia = [
        f"Daily NASA POWER data for your area, {ctx['periodo']} ({ctx['n_anios']} complete farming years).",
        f"The crops in this rotation need about {mt['uso_agua_mm']:.0f} mm of water a year; average rainfall is {ctx['lluvia_anual']:.0f} mm.",
        f"Crop water deficit: {mt['deficit_mm']:.0f} mm in an average year and {mt['deficit_seco_mm']:.0f} mm in a dry year (1 in 5), with a soil that holds {ctx['capacidad']:.0f} mm.",
    ]
    if mt["meses_descubiertos"] >= 0.5:
        evidencia.append(
            f"The field is left without a crop {mt['meses_descubiertos']:.1f} months a year; {mt['lluvia_suelo_desnudo_mm']:.0f} mm of rain fall on bare soil in those months, with {mt['lluvia_fuerte_suelo_desnudo']:.1f} heavy-rain days (≥40 mm) a year.")
    else:
        evidencia.append("The soil stays covered almost all year.")
    if "erosion_t_ha" in mt:
        evidencia.append(
            f"Estimated erosion (RUSLE with SRTM slope, assuming no-till): {mt['erosion_t_ha']:.1f} t/ha a year on average; "
            f"{mt['erosion_area_alta_pct']:.0f}% of the field exceeds the reference tolerance of {EROSION_TOL:.0f} t/ha a year.")
    for cid in ids:
        c = crops[cid]
        if not c["meses_criticos"]:
            continue
        meses = " and ".join(month_name(m) for m in c["meses_criticos"])
        heat = sum(clim_by_month[m]["dias_calor"] for m in c["meses_criticos"])
        frost = sum(clim_by_month[m]["dias_helada"] for m in c["meses_criticos"])
        bal = sum(clim_by_month[m]["balance_mm"] for m in c["meses_criticos"])
        parts = [f"rain minus evapotranspiration of {bal:+.0f} mm"]
        if c["sensible_calor"]:
            parts.append(f"{heat:.1f} days at 32 °C or more")
        if c["sensible_helada"]:
            parts.append(f"{frost:.1f} frost-risk days")
        evidencia.append(f"{c['nombre']}: critical stage in {meses} ({c['critico_por']}). On average those months have " + ", ".join(parts) + ".")

    # --- Beneficios
    beneficios = []
    fix = [i for i in ids if crops[i]["aporte_n"] >= 2]
    if fix:
        beneficios.append(_say(fix, crops, "adds", "add") + " nitrogen to the soil, cutting fertilizer needs.")
    deep = [i for i in ids if crops[i]["raiz_profunda"]]
    if deep:
        beneficios.append(_say(deep, crops, "has", "have") + " deep roots that improve water infiltration and soil structure.")
    res = [i for i in ids if crops[i]["residuo"] >= 4]
    if res:
        beneficios.append(_say(res, crops, "leaves", "leave") + " plenty of stubble, which protects the soil and builds organic matter.")
    cov = [i for i in ids if crops[i]["tipo"] == COVER_CROP]
    if cov:
        beneficios.append(_say(cov, crops, "covers", "cover") + " the soil in months when it would otherwise be bare.")
    if mt["familias"] >= 3:
        beneficios.append(f"It rotates {mt['familias']} plant families, which breaks pest, disease and weed cycles.")
    forage = [i for i in ids if crops[i]["forraje"] >= 4]
    if forage:
        beneficios.append(_say(forage, crops, "provides", "provide") + " high-quality forage for livestock.")
    if mt["anios_doble_cultivo"]:
        beneficios.append(f"Two cash crops a year in {mt['anios_doble_cultivo']} of {mt['duracion_anios']} years.")
    tol = [i for i in ids if crops[i]["tolerancia_sequia"] >= 4]
    if tol:
        beneficios.append(_say(tol, crops, "handles", "handle") + " drought better.")
    if not beneficios:
        beneficios.append("A simple, well-known system with an established market.")

    # --- Vacíos de información
    vacios = [
        "Climate: NASA POWER uses a ~50 km grid, so it can't see differences within the field.",
        f"Soil: we use a soil water capacity of {ctx['capacidad']:.0f} mm that you chose; we don't read the paddock's actual soil type yet.",
        "Market: the income score only compares crops with each other; it doesn't use prices, costs or yields for your area.",
    ]
    if "erosion_t_ha" in mt:
        vacios.append("Erosion: the field is approximated by a square around the point; SRTM (30 m) can't see gullies "
                      "or micro-relief, and soil erodibility (K) is a typical value, not a measured one.")
    for cid in ids:
        vacios += [v for v in crops[cid]["vacios"] if v not in vacios]

    # --- Riesgos a revisar con un agrónomo
    riesgos: list[str] = []
    if mt.get("erosion_t_ha", 0) > EROSION_TOL:
        riesgos.append(f"Estimated erosion ({mt['erosion_t_ha']:.1f} t/ha a year) exceeds the reference tolerance: "
                       "an agronomist should review slope length, terraces or strip cropping.")
    if mt["deficit_critico_seco_mm"] > 60:
        riesgos.append(f"In dry years water runs short during critical stages (about {mt['deficit_critico_seco_mm']:.0f} mm): review sowing dates, varieties or irrigation.")
    if mt["dias_calor_critico"] > 5:
        riesgos.append(f"On average there are {mt['dias_calor_critico']:.0f} days of strong heat a year while sensitive crops are flowering.")
    if mt["dias_helada_critico"] > 0.5:
        riesgos.append(f"On average there are {mt['dias_helada_critico']:.1f} frost-risk days a year during sensitive stages.")
    if cur is not None:
        cs = cur["puntajes"]
        for k, label in SUBSCORES.items():
            if cs[k] - sub[k] >= 8:
                riesgos.append(f"In exchange, {label.lower()} drops ({cs[k]}→{sub[k]}).")
    for cid in ids:
        riesgos += [r for r in crops[cid]["riesgos"] if r not in riesgos]
    riesgos.append("The agronomic rules come from general literature: a local agronomist should validate them for your paddock.")

    return {"por_que": por_que, "evidencia": evidencia, "beneficios": beneficios,
            "vacios": vacios, "riesgos": riesgos}


# ----------------------------------------------------------------- API

def evaluate(rotation: dict, cat: Catalog, arr: dict, cap: float, prio: dict,
             erosion: dict | None = None) -> dict:
    mt = simulate(rotation, cat.crops, arr, cap) | static_metrics(rotation, cat.crops) | (erosion or {})
    sub = subscores(mt)
    return {
        "id": rotation["id"],
        "nombre": rotation["nombre"],
        "descripcion": rotation["descripcion"],
        "indicadores": {k: round(v, 2) if isinstance(v, float) else v for k, v in mt.items()},
        "puntajes": sub,
        "total": total_score(sub, prio),
    }


def calendar(rotation: dict, crops: dict) -> list[list[dict | None]]:
    out = []
    for year in rotation["anios"]:
        row = []
        for mi, entry in enumerate(year_layout(year, crops)):
            if entry is None:
                row.append(None)
                continue
            c = crops[entry[0]]
            row.append({"id": c["id"], "abrev": c["abrev"], "nombre": c["nombre"],
                        "color": c["color"], "critico": AG_MONTHS[mi] in c["meses_criticos"]})
        out.append(row)
    return out


def compare(current_id: str, prio: dict, m: pd.DataFrame, cap: float,
            clim: list[dict], cat: Catalog, tiene_ganado: bool = True,
            n_alternatives: int = 2, erosion: dict[str, dict] | None = None) -> list[dict]:
    """erosion: {rotación_id: resumen RUSLE} si hay datos de terreno; si no, se usa el proxy."""
    if current_id not in cat.rotations:
        raise KeyError(current_id)
    arr = _month_arrays(m)
    evals = {rid: evaluate(r, cat, arr, cap, prio, (erosion or {}).get(rid))
             for rid, r in cat.rotations.items()}
    current = evals[current_id]
    candidates = [e for rid, e in evals.items()
                  if rid != current_id
                  and (tiene_ganado or not cat.rotations[rid].get("requiere_ganado"))]
    alts = sorted(candidates, key=lambda e: e["total"], reverse=True)[:n_alternatives]

    ag = m.groupby("ag_year")
    ctx = {
        "periodo": f"{int(m['ag_year'].min())}–{int(m['ag_year'].max()) + 1}",
        "n_anios": int(m["ag_year"].nunique()),
        "lluvia_anual": float(ag["rain"].sum().mean()),
        "capacidad": cap,
    }
    result = []
    for role, ev in [("actual", current)] + [(f"alternativa_{i + 1}", e) for i, e in enumerate(alts)]:
        rot = cat.rotations[ev["id"]]
        result.append({
            **ev,
            "rol": role,
            "calendario": calendar(rot, cat.crops),
            "explicacion": explain(rot, ev, None if role == "actual" else current,
                                   prio, cat.crops, clim, ctx),
        })
    return result
