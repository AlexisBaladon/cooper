// "Explain it simply": qué plantillas elige cada análisis (reglas, sin IA) y que el español quede completo.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FE = path.join(__dirname, '..');
const OPTIONAL = ['agua', 'extremos', 'terreno', 'cobertura', 'raices', 'otra'];

function load({search = '', spanish = false} = {}) {
  const store = new Map(spanish ? [['cooper-language', 'es']] : []);
  const win = {addEventListener(){}, dispatchEvent(){}};
  const document = {body:{}, documentElement:{lang:'en', classList:{add(){}, contains:()=>false}}, getElementById:()=>null, querySelectorAll:()=>[],
    createTreeWalker(){return {nextNode:()=>null};}, title:''};
  const context = vm.createContext({window:win, parent:win, document, location:{search}, URLSearchParams, performance, setTimeout,
    localStorage:{getItem:k=>store.get(k), setItem(){}}, MutationObserver:class{observe(){}disconnect(){}}, NodeFilter:{SHOW_TEXT:4},
    requestAnimationFrame:()=>{}, CustomEvent:class{}});
  for (const file of ['translations-es.js', 'language.js', 'slides-sample.js', 'slides.js']) vm.runInContext(fs.readFileSync(path.join(FE, file), 'utf8'), context);
  return {slides: win.CooperSlides, t: win.CooperLang.t, sample: () => JSON.parse(JSON.stringify(win.SAMPLE_ANALYSIS))};
}
// Array.from: los arreglos del contexto aislado (vm) no son "iguales" a los de este archivo.
const keys = (list) => Array.from(list, (s) => s.key);
const chosen = (plan) => Array.from(plan).filter((p) => p.optional && p.included).map((p) => p.key);

test('the sample field gets the fixed story plus its three most relevant templates', () => {
  const {slides, sample} = load();
  const d = sample(), plan = slides.plan(d), built = slides.buildSlides(d);
  assert.deepEqual(chosen(plan), ['agua', 'cobertura', 'raices']);
  assert.deepEqual(keys(built), ['intro', 'clima', 'cambio', 'agua', 'hoy', 'diagnostico', 'cobertura', 'opcion', 'raices', 'revisar', 'cierre']);
  assert.equal(plan.find((p) => p.key === 'extremos').score, 0);   // sin calor ni heladas en las etapas críticas
});

test('templates follow the data of each field', () => {
  const {slides, sample} = load();
  const hot = sample();
  hot.rotaciones[0].indicadores.dias_calor_critico = 9;
  assert.ok(chosen(slides.plan(hot)).includes('extremos'));
  const heat = slides.buildSlides(hot).find((s) => s.key === 'extremos');
  assert.equal(heat.headline, 'Heat at the worst moment');
  assert.match(heat.narration[1], /about 9\.0 very hot days a year/);

  const covered = sample();                                           // la opción ya no cubre más el suelo
  covered.rotaciones[1].indicadores.meses_descubiertos = covered.rotaciones[0].indicadores.meses_descubiertos;
  assert.equal(slides.plan(covered).find((p) => p.key === 'cobertura').score, 0);

  const flat = sample();
  flat.zonas = null;
  assert.equal(slides.plan(flat).find((p) => p.key === 'terreno').score, 0);

  const two = sample();
  two.rotaciones.length = 2;
  assert.equal(slides.plan(two).find((p) => p.key === 'otra').score, 0);
});

test('an older saved analysis without the new fields still builds the fixed story', () => {
  const {slides, sample} = load();
  const old = sample();
  old.clima.mensual.forEach((m) => { delete m.humedad_raiz; });
  old.rotaciones.forEach((r) => {
    for (const k of ['dias_calor_critico', 'dias_helada_critico', 'lluvia_suelo_desnudo_mm', 'erosion_area_alta_pct', 'deficit_critico_seco_mm']) delete r.indicadores[k];
    r.explicacion.beneficios = [];
  });
  const built = slides.buildSlides(old);
  for (const k of ['agua', 'extremos', 'terreno', 'cobertura', 'raices']) assert.ok(!keys(built).includes(k), k);
  assert.deepEqual(keys(built).slice(0, 3), ['intro', 'clima', 'cambio']);
});

test('every story fits the narrator limits and keeps its numbers in the text', () => {
  for (const search of ['', '?templates=' + OPTIONAL.join(',')]) {
    const {slides, sample} = load({search});
    const built = slides.buildSlides(sample());
    if (!search) assert.ok(built.length <= 12, 'the narrator accepts 12 slides');
    for (const s of built) {
      assert.ok(s.key.length <= 30 && s.headline.length <= 70, s.key);
      assert.ok(s.narration.length >= 1 && s.narration.length <= 8, s.key);
      for (const n of s.narration) assert.ok(n.length <= 340 && !/undefined|NaN|null/.test(n), `${s.key}: ${n}`);
    }
  }
});

test('?templates= only changes which optional templates are shown', () => {
  const {slides, sample} = load({search: '?templates=terreno,otra,nope'});
  assert.deepEqual(chosen(slides.plan(sample())), ['terreno', 'otra']);
});

test('the optional templates are fully translated to Spanish', () => {
  const {slides, sample, t} = load({search: '?templates=' + OPTIONAL.join(','), spanish: true});
  const d = sample();
  d.rotaciones[0].indicadores.dias_calor_critico = 9;
  d.rotaciones[1].indicadores.dias_helada_critico = 1.5;
  d.rotaciones[1].explicacion.beneficios.unshift('Vetch (cover crop) adds nitrogen to the soil, cutting fertilizer needs.');
  const english = /\b(the|your|with|soil|crops?|year|days|field|option|rain|roots|points|percent|against|short|about|it|is|are)\b/i;
  for (const s of slides.buildSlides(d).filter((x) => OPTIONAL.includes(x.key))) {
    for (const text of [s.headline, ...s.narration]) assert.ok(!english.test(t(text)), `${s.key}: ${t(text)}`);
  }
  for (const label of ['mm short in a dry year', 'Critical stages, dry year:', 'Bare soil', 'Covered soil', 'On bare soil today:', 'Second option', 'Deep roots',
    'Adds nitrogen', 'Stubble cover', 'Above the tolerable loss', 'a year, in the critical stages', 'With the option', 'Height difference'])
    assert.ok(!english.test(t(label)), t(label));
});
