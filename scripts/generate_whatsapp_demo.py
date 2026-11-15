"""Freeze the website's default analysis using existing NASA caches (no downloads).

Run from the repository root: python scripts/generate_whatsapp_demo.py
"""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app import main, power, terrain  # noqa: E402

INPUT = dict(lat=-32.62, lon=-57.75, area_ha=100, rotacion_actual='soja_continua',
             tiene_ganado=False, capacidad_suelo_mm=120,
             prioridades=dict(agua=3, suelo=4, ingreso=4, forraje=1, clima=3),
             escenario=dict(lluvia_pct=0, temp_delta=0))


def no_download(*args, **kwargs):
    raise RuntimeError('Populate the default field NASA caches before regenerating this snapshot.')


def generate():
    power._download = no_download
    terrain._download_dem = no_download
    a = main.analyze(main.AnalyzeRequest(**INPUT))
    scores = dict(agua='water', suelo='soil', ingreso='income', forraje='forage', clima='climate')
    rotations = []
    for role, r in zip(('current', 'alt1', 'alt2'), a['rotaciones']):
        r = {**r, **next(x for x in a['ranking'] if x['id'] == r['id'])}
        ind = r['indicadores']
        rotations.append(dict(
            role=role, id=r['id'], name=r['nombre'], total=r['total'],
            scores={scores[k]: r['puntajes'][k] for k in scores},
            bare_months=ind['meses_descubiertos'],
            water_use_mm=round(ind['uso_agua_mm']),
            deficit_year_mm=dict(typical=round(ind['deficit_mm']), dry=round(ind['deficit_seco_mm'])),
            deficit_critical_mm=dict(typical=round(ind['deficit_critico_mm']), dry=round(ind['deficit_critico_seco_mm'])),
            erosion_t_ha_yr=ind.get('erosion_t_ha'),
            calendar=r['calendario'],
            assessment=[dict(label=p['etiqueta'], level=p['nivel'], explanation=p['por_que'],
                             ideas=p['recomendaciones'][:1]) for p in r['perfil'].values()],
            reasons=r['explicacion']['por_que'][:2], risks=r['explicacion']['riesgos'][:2]))
    context = dict(
        demo=True, snapshot_id='young-default-v1', field='DEMO: Near Young, Rio Negro (cropland)',
        scope='Fixed example analysis, never the WhatsApp sender\'s own field. Not a forecast or live data.',
        inputs=dict(field_size_ha=100, has_livestock=False, soil_water_capacity_mm=120,
                    current_rotation='Continuous soybean', priorities_0_to_5={scores[k]: v for k,v in INPUT['prioridades'].items()},
                    climate_scenario='none (historical climate)'),
        climate=dict(source=a['meta']['fuente'], period=a['meta']['periodo'], resolution=a['meta']['resolucion'],
                     months='May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Jan,Feb,Mar,Apr',
                     rain_mm=[round(m['lluvia_mm']) for m in a['clima']['mensual']],
                     et0_mm=[round(m['et0_mm']) for m in a['clima']['mensual']]),
        warnings=a['advertencias'], rotations=rotations,
        ranking=[dict(name=r['nombre'], total=r['total'], scores={scores[k]: r['puntajes'][k] for k in scores}) for r in a['ranking']],
        limitations='Income is an indicative score, not currency, prices, profit or a yield prediction. Review decisions with an agronomist.')
    if a['zonas']:
        context['terrain'] = dict(source='NASA SRTM', summary=a['zonas']['resumen'],
                                 erosion_tolerance_t_ha_yr=a['zonas']['tolerancia_t_ha'])
    from app.jarvis import MAX_CONTEXT_CHARS
    if len(json.dumps(context, ensure_ascii=False, separators=(',', ':'))) > MAX_CONTEXT_CHARS:
        raise ValueError('Demo context exceeds the Jarvis prompt limit')
    fixture = dict(description='Frozen Cooper engine output for the website default sample inputs; not synthetic measurements.',
                   input=INPUT, context=context)
    target = ROOT / 'data' / 'whatsapp-default-analysis.json'
    target.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Saved default demo snapshot:', target.name)


if __name__ == '__main__':
    generate()
