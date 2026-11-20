const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = readFileSync('app/src/main/assets/android-export.js','utf8');
function setup() {
  const sent=[], readers=[], events={}, revoked=[], originalClicks=[];
  let count=0, failures=0;
  class Anchor {click(){originalClicks.push(this.href);}getAttribute(k){return this[k];}}
  const context={Map,document:{addEventListener:(t,f)=>events[t]=f},
    HTMLAnchorElement:Anchor,
    URL:{createObjectURL:()=> 'blob:test-'+(++count),revokeObjectURL:u=>revoked.push(u)},
    FileReader:class {readAsDataURL(blob){readers.push(()=>{this.result=blob.data;this.onload();});}},
    GardendlessBridge:{exportData:(data,name)=>sent.push({data,name}),exportError:()=>failures++}};
  context.window=context;vm.runInNewContext(source,context);
  return {context,sent,readers,events,revoked,originalClicks,Anchor,get failures(){return failures;}};
}
test('immediate URL revocation does not lose the Blob before native export',()=>{
  const s=setup(), data='data:application/json;base64,'+Buffer.from('[{"name":"中文存档"}]').toString('base64');
  const url=s.context.URL.createObjectURL({size:100,data});
  const a=new s.Anchor();a.download='玩家.json';a.href=url;a.click();
  s.context.URL.revokeObjectURL(url);
  assert.equal(s.sent.length,0);s.readers[0]();
  assert.deepEqual(s.sent,[{data,name:'玩家.json'}]);assert.equal(s.originalClicks.length,0);
});
test('normal data downloads are handed directly to native save UI',()=>{
  const s=setup(), a=new s.Anchor();a.href='data:application/json,%5B%5D';a.download='all.json';a.click();
  assert.equal(s.sent[0].name,'all.json');assert.equal(s.originalClicks.length,0);
});
test('real anchor clicks are intercepted once; unrelated links keep native behavior',()=>{
  const s=setup(),a=new s.Anchor();a.href='data:application/json,[]';a.download='save.json';
  let prevented=false,stopped=false;
  s.events.click({target:{closest:()=>a},preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});
  assert.equal(s.sent.length,1);assert.equal(prevented&&stopped,true);
  a.href='https://example.com';a.click();assert.deepEqual(s.originalClicks,['https://example.com']);
});
test('unknown/revoked and oversized blobs fail explicitly instead of silently disappearing',()=>{
  const s=setup(),a=new s.Anchor();a.download='save.json';a.href='blob:missing';a.click();
  const url=s.context.URL.createObjectURL({size:17*1024*1024});a.href=url;a.click();
  assert.equal(s.failures,2);assert.equal(s.sent.length,0);assert.equal(s.originalClicks.length,0);
});
