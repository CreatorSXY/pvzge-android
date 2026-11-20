const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function environment(factory,withTouch=false){
  const events=[],context={console,Promise,Math};context.window=context;
  vm.runInNewContext(fs.readFileSync('app/src/main/assets/android-wave-fix.js','utf8'),context);
  const published={};
  const system={register(name,deps,declare){const module=declare((key,value)=>{published[key]=value;return value},{});module.execute()}};
  if(withTouch){vm.runInNewContext(fs.readFileSync('app/src/main/assets/android-direct-touch.js','utf8'),context);context.PvzDirectTouch.captureModules(system);}
  context.PvzWaveFix.captureModules(system);
  let Type;
  system.register('chunks:///_virtual/JSONs.ts',[],publish=>({execute(){publish('PvZ2Object',{getObjectsByRTID(ref){return ref==='valid'?[{objdata:{food:1},id:1}]:[]}})}}));
  class Range{constructor(a,b){this.a=a;this.b=b}static getRandomFromRange(r){return(r.a+r.b)/2}}
  system.register('chunks:///_virtual/ArrayGet.ts',[],publish=>({execute(){publish('ValueRange',Range)}}));
  system.register('chunks:///_virtual/levelController.ts',[],factory);
  context.PvzWaveFix.installEngine({tween(target){return{to(time,value){events.push({time,value});Object.assign(target,value);return this},start(){}}}});
  Type=published.levelController;
  const level=new Type();Object.assign(level,{currentWave:0,waveManagerProps:{Waves:[['valid','disabled']],FlagWaveInterval:10,MaxNextWaveHealthPercentage:.65,MinNextWaveHealthPercentage:.5},levelSchedulers:[],WaveZombieDamageCountdown:Infinity,NextWaveZombieHealthPercentage:-Infinity,readWave:async a=>events.push(a.id),addPlantFood:a=>events.push(a.food)});
  return{context,level,events,Type,system};
}
function legacyFactory(publish){return{execute(){function Legacy(){};Legacy.prototype.judgeWaveCount=function(){return new Promise(resolve=>{let left=this.waveManagerProps.Waves[this.currentWave].length;this.waveManagerProps.Waves[this.currentWave].forEach(ref=>{new Promise(done=>{if(ref==='valid')done()}).then(()=>{if(--left===0)resolve()})})})};Legacy.prototype.nextWave=function(){};publish('levelController',Legacy)}}}
function modernFactory(publish){return{execute(){function Modern(){};Modern.prototype.judgeWaveCount=function(){return Promise.all(this.waveManagerProps.Waves[this.currentWave].map(ref=>Promise.resolve(ref)))};Modern.prototype.nextWave=function(){};publish('levelController',Modern)}}}
test('legacy empty RTID reproduces unresolved wave; patch finishes valid + disabled references',async()=>{
  let Old;legacyFactory((key,type)=>Old=type).execute();const old=new Old();old.currentWave=0;old.waveManagerProps={Waves:[['valid','disabled']]};
  assert.equal(await Promise.race([old.judgeWaveCount().then(()=>false),new Promise(r=>setTimeout(()=>r(true),20))]),true);
  const {context,level,events}=environment(legacyFactory);
  assert.equal(context.PvzWaveFix.state().applied,true);
  await level.judgeWaveCount();
  assert.equal(level.currentWave,1);assert.equal(level.levelProgressPercentage,.1);
  assert.ok(level.NextWaveCountdown>=25&&level.NextWaveCountdown<30);
  assert.ok(level.WaveZombieDamageCountdown>=4&&level.WaveZombieDamageCountdown<5);
  assert.equal(level.NextWaveZombieHealthPercentage,.575);
  assert.deepEqual(events.slice(1),[1,1]);
});
test('an entirely empty legacy wave resolves and preserves wave bookkeeping',async()=>{
  const {level}=environment(legacyFactory);level.waveManagerProps.Waves=[[]];
  level.levelSchedulers=[{EndingWave:-1},{EndingWave:2}];
  await level.judgeWaveCount();assert.equal(level.currentWave,1);assert.equal(level.levelSchedulers.length,0);
  assert.ok(Number.isFinite(level.WaveZombieDamageCountdown));
});
test('real asynchronous actions remain awaited; failures are propagated without unlocking waves',async()=>{
  const {level}=environment(legacyFactory);let finish;
  level.readWave=()=>new Promise(r=>finish=r);const pending=level.judgeWaveCount();
  assert.equal(level.WaveZombieDamageCountdown,Infinity);finish();await pending;
  assert.ok(Number.isFinite(level.WaveZombieDamageCountdown));
  level.currentWave=0;level.WaveZombieDamageCountdown=Infinity;level.readWave=async()=>{throw Error('spawn failed')};
  await assert.rejects(level.judgeWaveCount(),/spawn failed/);assert.equal(level.WaveZombieDamageCountdown,Infinity);
});
test('flag delay and cowboy/kill-all rules remain the original game rules',async()=>{
  const {level}=environment(legacyFactory);level.waveManagerProps.Waves=Array.from({length:10},()=>['valid']);level.currentWave=9;
  await level.judgeWaveCount();assert.ok(level.NextWaveCountdown>=35&&level.NextWaveCountdown<40);
  level.currentWave=0;level.isCowboyMinigame=true;await level.judgeWaveCount();
  assert.equal(level.NextWaveCountdown,Infinity);assert.equal(level.WaveZombieDamageCountdown,0);assert.equal(level.NextWaveZombieHealthPercentage,0);
  level.currentWave=0;level.isCowboyMinigame=false;level.readWave=async()=>{level.MustKillAllThisWave=true};await level.judgeWaveCount();assert.equal(level.NextWaveZombieHealthPercentage,0);
});
test('modern Promise.all controller stays untouched and capture is idempotent',async()=>{
  const {context,level,system}=environment(modernFactory);assert.equal(context.PvzWaveFix.state().legacy,false);assert.equal(context.PvzWaveFix.state().applied,false);
  const method=level.judgeWaveCount;context.PvzWaveFix.captureModules(system);assert.equal(level.judgeWaveCount,method);assert.deepEqual(await method.call(level),['valid','disabled']);
});

test('wave detection sees original factories when combined with the existing touch capture',async()=>{
  const {context,level}=environment(legacyFactory,true);await level.judgeWaveCount();assert.equal(context.PvzWaveFix.state().applied,true);assert.ok(Number.isFinite(level.WaveZombieDamageCountdown));
});
