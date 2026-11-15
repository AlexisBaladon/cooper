const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AnalysisQueue, validate, readResponse, explanationData, sourceNote, labelScenario} = require('../workflow.js');

test('changed inputs discard an old response and queue only the latest comparison', () => {
  const queue = new AnalysisQueue();
  const old = queue.begin();
  queue.invalidate(); queue.invalidate();
  assert.equal(queue.begin(), null);
  assert.equal(queue.isCurrent(old), false);
  assert.equal(queue.finish(), true);
  const latest = queue.begin();
  assert.equal(queue.isCurrent(latest), true);
  assert.equal(queue.finish(), false);
});
test('reject empty priorities and invalid coordinates before fetching data', () => {
  assert.throws(() => validate({lat: -33, lon: -56, prioridades: {agua: 0, suelo: 0}}), /priority/);
  for (const lat of [NaN, Infinity, 91]) assert.throws(() => validate({lat, lon: -56, prioridades:{agua:1}}), /latitude/);
  assert.doesNotThrow(() => validate({lat:-33,lon:-56,prioridades:{agua:1}}));
});
test('plain-text upstream failures and rate limits produce useful messages', async () => {
  await assert.rejects(readResponse({status:504,json:async()=>{throw Error()}}), /HTTP 504/);
  await assert.rejects(readResponse({status:429,ok:false,json:async()=>({})}), /wait a few seconds/);
  await assert.rejects(readResponse({status:502,ok:false,json:async()=>({})}), /data service/);
  await assert.rejects(readResponse({status:400,ok:false,json:async()=>({detail:'Choose a priority'})}), /Choose a priority/);
  assert.deepEqual(await readResponse({ok:true,json:async()=>({rotaciones:[1]})}), {rotaciones:[1]});
});
test('embedded explanations use this tab, never another tab or sample when storage is blocked', () => {
  const current = {campo:'This field',terreno:null};
  const win = {parent:{CooperAnalysis:current},localStorage:{getItem:()=>{throw Error('blocked')}}};
  assert.equal(explanationData(win), current);
  win.parent = {};
  win.localStorage.getItem = () => JSON.stringify({campo:'Another tab'});
  assert.equal(explanationData(win), null);
});
test('standalone charts handle unavailable/corrupt storage without crashing', () => {
  const win = {localStorage:{getItem:()=>'{broken'}}; win.parent=win;
  assert.equal(explanationData(win),null);
  win.localStorage.getItem = () => JSON.stringify({campo:'Saved field'});
  assert.equal(explanationData(win).campo,'Saved field');
});
test('the narration labels simulated climate explicitly', () => {
  const text=sourceNote({context:{field:'Sample field'},escenario:{activo:true,lluvia_pct:-20,temp_delta:1}});
  assert.match(text,/Sample field/); assert.match(text,/-20%/); assert.match(text,/not a forecast/);
  const slides=labelScenario([{narration:['Your field.']}],{escenario:{activo:true}});
  assert.match(slides[0].narration[0],/not a forecast/);
  assert.equal(slides[0].narration.length,1);
});
