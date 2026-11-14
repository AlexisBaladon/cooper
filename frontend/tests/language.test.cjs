const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(savedLanguage) {
  const control = {value:'en', addEventListener(type,fn){ this.change=fn; }};
  const text = {nodeValue:'Analyze my field',parentElement:{closest:()=>null}};
  const store = new Map(savedLanguage ? [['cooper-language',savedLanguage]] : []);
  const win = {addEventListener(){},dispatchEvent(){}};
  const document = {
    body:{},documentElement:{lang:'en',classList:{add(){}}},
    getElementById:()=>control,querySelectorAll:()=>[],
    createTreeWalker(){let done=false; return {nextNode(){if(done)return null;done=true;return text;}};}
  };
  const context = vm.createContext({window:win,parent:win,document,localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
    MutationObserver:class {observe(){}disconnect(){}},NodeFilter:{SHOW_TEXT:4},requestAnimationFrame:()=>{},CustomEvent:class{}});
  for (const file of ['translations-es.js','language.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return {win,control,text,document,store};
}
test('English is the default and Spanish is visibly selectable',()=>{
  const p=page();assert.equal(p.win.CooperLang.current,'en');assert.equal(p.text.nodeValue,'Analyze my field');
  p.control.change({target:{value:'es'}});
  assert.equal(p.document.documentElement.lang,'es');assert.equal(p.text.nodeValue,'Analizar mi campo');
  assert.equal(p.store.get('cooper-language'),'es');
});
test('switching back restores the original English rather than translating Spanish twice',()=>{
  const p=page('es');assert.equal(p.text.nodeValue,'Analizar mi campo');
  p.control.change({target:{value:'en'}});assert.equal(p.text.nodeValue,'Analyze my field');
});
test('translations preserve scientific numbers and crop identity',()=>{
  const p=page('es');
  assert.equal(p.win.CooperLang.t('Continuous soybean'),'Soja continua');
  assert.equal(p.win.CooperLang.t('Rainfall -20%'),'Lluvia -20%');
  assert.equal(p.win.CooperLang.t('Save as PDF'),'Guardar como PDF');
});
