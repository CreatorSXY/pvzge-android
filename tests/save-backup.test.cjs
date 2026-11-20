const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('tools/save-backup.html','utf8');
const context=vm.createContext({});
vm.runInContext(html.match(/<script id="save-format">([\s\S]*?)<\/script>/)[1],context);
test('all-player backup produces original per-player import objects without losing progress',()=>{
  const players=[{name:'中文🌻',levels:{world1:42},plants:[1,3],unknown:{future:true}},
    {name:'第二位',progress:17}];
  const raw=JSON.stringify(players);
  const split=context.PvzSaveBackup.split(raw);
  assert.equal(split.length,2);
  for(let i=0;i<2;i++) assert.deepEqual(JSON.parse(split[i].json),players[i]);
  assert.equal(split[0].name,players[0].name);
  assert.equal(JSON.stringify(players),raw);
});
test('malformed and non-player backups fail explicitly',()=>{
  for(const raw of ['{','{}','[]','[null]','[[1]]','[3]'])
    assert.throws(()=>context.PvzSaveBackup.split(raw));
});
