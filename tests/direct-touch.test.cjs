const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const direct = readFileSync('app/src/main/assets/android-direct-touch.js', 'utf8');
const input = readFileSync('app/src/main/assets/android-input.js', 'utf8');
function setup() {
  const events = [], listeners = {}, placed = [], calls = [];
  const rect = { left: 40, top: 20, width: 800, height: 500 };
  const canvas = { getBoundingClientRect: () => rect, dispatchEvent: e => events.push(e) };
  class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class Vec3 extends Vec2 { constructor(x,y,z) { super(x,y); this.z = z; } }
  const cc = { Vec2, Vec3, UITransform: function() {}, view: {
    convertToLocationInView(x,y,r) { return new Vec2((x-r.left)*2, (r.top+r.height-y)*2); }
  }, Touch: class { constructor(x,y) { this.x=x;this.y=y; } getUILocation() { return new Vec2(this.x/2,this.y/2); } } };
  const Mouse = { _position: new Vec2(), mouseInLnC: null,
    get position() { return this._position; },
    judgeInUITransform(t) { const p=this._position;return p.x>=t.x&&p.x<t.x+60&&p.y>=t.y&&p.y<t.y+60; }
  };
  function node(transform = {x:0,y:420}) {return {activeInHierarchy:true,getComponent:()=>transform};}
  const ca = { getSelectable: () => true };
  const card = { node: node(), ca };
  const ui = { node: node(), gameStarted:true, index:-1, currentCF:null, cards:{CFs:[card]},
    mouse:{},plantInHandLayer:{},paused:false,indexLocked:false,
    tryChangingIndex(i) { calls.push(['select',i]);if(ca.getSelectable()){this.index=i;this.currentCF=card;} }
  };
  let sun = 150;
  const cells = Array.from({length:5},(_,r)=>Array.from({length:9},(_,c)=>({
    lIndex:r,cIndex:c,isInLawn:()=>true,onMouseLeave(){calls.push(['leave',r,c]);},
    onMouseEnter(){calls.push(['preview',r,c]);},
    PlaceUIPlant(){if(this.occupied||sun<100)return;placed.push([r,c]);this.occupied=true;sun-=100;ui.index=-1;ui.currentCF=null;}
  })));
  // Same boundary convention as the official Square methods: upper/left edge is outside.
  const Square = {component:{},judgeLIndex:y=>Math.ceil((400-y)/60)-1,
    judgeCIndex:x=>Math.ceil((x-100)/60)-1,
    getLnC:(r,c)=>cells[r]?.[c]||{isInLawn:()=>false}};
  const LevelPlay = {component:{node:node()}};
  const context = { console, Math, document:{ getElementById:()=>canvas,
    addEventListener:(type,fn)=>listeners[type]=fn }, MouseEvent:class {
      constructor(type,init){Object.assign(this,init,{type});}
    }, WheelEvent:class {constructor(type,init){Object.assign(this,init,{type});}} };
  context.window=context;context.addEventListener=(type,fn)=>listeners[type]=fn;
  vm.runInNewContext(direct,context);
  const api=context.PvzDirectTouch;
  const system={register(name,deps,declare){declare((k,v)=>v,{}).execute();return name;}};
  api.captureModules(system);
  for(const [name,value] of Object.entries({UIInGame:{component:ui},Mouse,Square,LevelPlay})) {
    const module={UIInGame:'UI',Mouse:'Mouse',Square:'Square',LevelPlay:'levelController'}[name];
    system.register('chunks:///_virtual/'+module+'.ts',[],publish=>({execute(){publish(name,value);}}));
  }
  api.installEngine(cc);vm.runInNewContext(input,context);
  function touch(type,points,changed=[]) {
    const toTouch=([x,y])=>({clientX:x,clientY:y});
    listeners[type]({type,target:canvas,touches:points.map(toTouch),changedTouches:changed.map(toTouch),
      preventDefault(){},stopImmediatePropagation(){}});
  }
  function tap(p){touch('touchstart',[p]);touch('touchend',[],[p]);}
  return {api,touch,tap,events,placed,calls,ui,card,cells,ca,LevelPlay,Mouse,get sun(){return sun;}};
}
test('tap card then first tap on a new cell plants once without any DOM mouse events',()=>{
  const s=setup();s.tap([60,60]);assert.equal(s.ui.index,0);assert.equal(s.placed.length,0);
  s.tap([210,210]);assert.deepEqual(s.placed,[[1,1]]);assert.equal(s.sun,50);assert.equal(s.events.length,0);
});
test('drag updates preview immediately but commits only on release',()=>{
  const s=setup();s.touch('touchstart',[[60,60]]);s.touch('touchmove',[[270,270]]);
  assert.deepEqual(s.api.state().row,2);assert.equal(s.placed.length,0);
  s.touch('touchend',[],[[270,270]]);assert.deepEqual(s.placed,[[2,2]]);assert.equal(s.events.length,0);
});
test('latest release coordinates win even without an intermediate move/frame',()=>{
  const s=setup();s.touch('touchstart',[[60,60]]);s.touch('touchend',[],[[330,330]]);
  assert.deepEqual(s.placed,[[3,3]]);
});
test('occupied, unaffordable, cooled-down or out-of-lawn targets cannot spawn',()=>{
  for(const mode of ['occupied','unselectable','outside']) {
    const s=setup();s.tap([60,60]);
    if(mode==='occupied')s.cells[1][1].occupied=true;
    if(mode==='unselectable')s.ca.getSelectable=()=>false;
    s.tap(mode==='outside'?[80,210]:[210,210]);
    assert.equal(s.placed.length,0,mode);assert.equal(s.sun,150,mode);
  }
});
test('cancel, second finger, pause, scene exit and selection change never commit',()=>{
  for(const mode of ['cancel','second','pause','scene','selection','blur']) {
    const s=setup();s.touch('touchstart',[[60,60]]);s.touch('touchmove',[[210,210]]);
    if(mode==='cancel')s.touch('touchcancel',[]);
    if(mode==='second')s.touch('touchstart',[[210,210],[220,220]]);
    if(mode==='pause')s.ui.paused=true;
    if(mode==='scene')s.LevelPlay.component.node.activeInHierarchy=false;
    if(mode==='selection')s.ui.index=1;
    if(mode==='blur')s.api.cancel({}); // Explicit native pause cancellation uses PvzInput.cancel.
    if(mode==='blur')s.touch('touchcancel',[]);
    s.touch('touchend',[],[[210,210]]);assert.equal(s.placed.length,0,mode);
  }
});
test('a commit token cannot spend sun or place twice',()=>{
  const s=setup();s.tap([60,60]);const t=s.api.begin({x:210,y:210});
  s.api.end(t,{x:210,y:210},false);s.api.end(t,{x:270,y:210},false);
  assert.equal(s.placed.length,1);assert.equal(s.sun,50);
});
