const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const direct = readFileSync('app/src/main/assets/android-direct-touch.js', 'utf8');
const input = readFileSync('app/src/main/assets/android-input.js', 'utf8');
function setup(options={}) {
  const events = [], listeners = {}, placed = [], calls = [], spends=[],usedCards=[];
  const rect = { left: 40, top: 20, width: 800, height: 500 };
  const canvas = { getBoundingClientRect: () => rect, dispatchEvent(e) {
    events.push(e);
    if(options.mouseUI && e.type==='mousedown')ui.mouseDown=true;
    if(options.mouseUI && e.type==='mouseup')ui.mouseDown=false;
  } };
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
  const card = { node: node(), ca, SUNCOST:100 };
  const cards=[card,...[50,75].map((cost,i)=>({node:node({x:(i+1)*65,y:420}),ca:{getSelectable:()=>true},SUNCOST:cost}))];
  const ui = { node: node(), gameStarted:true, index:-1, currentCF:null,
    cards:{CFs:cards,cardsUIUpper:cards.map(()=>({CD:0}))},
    mouse:{},plantInHandLayer:{},paused:false,indexLocked:false,
    tryChangingIndex(i) { calls.push(['select',i]);
      if(i===-1 || i===this.index){this.index=-1;this.currentCF=null;return;}
      if(cards[i]?.ca.getSelectable()){this.index=i;this.currentCF=cards[i];this.willCostSun=cards[i].SUNCOST;}
    }
  };
  let sun = options.sun ?? 150;
  const freePool=['free-a','free-b'].map((Type,i)=>({Type,node:node({x:400+i*65,y:420}),SUNCOST:0,ca:{free:true,getSelectable:()=>true}}));
  const Conveyor={component:{node:node(),getCards:()=>options.free?freePool:[],chooseCard(cf){
    ui.index=8;ui.currentCF=ui.currentFreeCF=cf;ui.willCostSun=0;
  }}};
  const cells = Array.from({length:5},(_,r)=>Array.from({length:9},(_,c)=>({
    lIndex:r,cIndex:c,isInLawn:()=>true,onMouseLeave(){calls.push(['leave',r,c]);},
    onMouseEnter(){calls.push(['preview',r,c]);},
    PlaceUIPlant(){const cost=ui.willCostSun;if(this.occupied||sun<cost)return;
      placed.push([r,c]);spends.push([ui.index,r,c,cost]);usedCards.push(ui.currentCF.Type);
      if(ui.index===8)freePool.splice(freePool.indexOf(ui.currentCF),1); // Node destruction may be deferred until the frame ends.
      if(options.pending)this.spawningPromiseCount=(this.spawningPromiseCount||0)+1;else this.occupied=true;
      if(options.cooldown)ui.cards.cardsUIUpper[ui.index].CD=10;
      sun-=cost;ui.index=-1;ui.currentCF=null;}
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
  for(const [name,value] of Object.entries({UIInGame:{component:ui},Mouse,Square,LevelPlay,Conveyor,SunCount:{get Value(){return sun;}}})) {
    const module={UIInGame:'UI',Mouse:'Mouse',Square:'Square',LevelPlay:'levelController',SunCount:'SunCount',Conveyor:'Conveyor'}[name];
    system.register('chunks:///_virtual/'+module+'.ts',[],publish=>({execute(){publish(name,value);}}));
  }
  api.installEngine(cc);vm.runInNewContext(input,context);
  let last=[];
  function touch(type,points,changed=[]) {
    const toTouch=([x,y,id=0])=>({clientX:x,clientY:y,identifier:id});
    if (!changed.length && /touch(start|move)/.test(type)) changed=points;
    if (type==='touchcancel' && !changed.length) changed=last;
    listeners[type]({type,target:canvas,touches:points.map(toTouch),changedTouches:changed.map(toTouch),
      preventDefault(){},stopImmediatePropagation(){}});last=points;
  }
  function tap(p){touch('touchstart',[p]);touch('touchend',[],[p]);}
  return {api,touch,tap,events,placed,calls,spends,usedCards,ui,card,cards,cells,ca,LevelPlay,Mouse,get sun(){return sun;}};
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
test('cancel, pause and scene exit never commit',()=>{
  for(const mode of ['cancel','pause','scene','blur']) {
    const s=setup();s.touch('touchstart',[[60,60]]);s.touch('touchmove',[[210,210]]);
    if(mode==='cancel')s.touch('touchcancel',[]);
    if(mode==='pause')s.ui.paused=true;
    if(mode==='scene')s.LevelPlay.component.node.activeInHierarchy=false;
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
test('three held cards retain their own selection and release coordinates out of order',()=>{
  const s=setup({sun:500});
  const a=[60,60,11],b=[125,60,22],c=[190,60,33];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[b,a],[b]);s.touch('touchstart',[c,a,b],[c]);
  s.touch('touchmove',[[330,330,33],[210,210,11],[270,270,22]],[[210,210,11],[270,270,22],[330,330,33]]);
  assert.equal(s.placed.length,0);assert.equal(s.api.state().fingers,3);
  s.touch('touchend',[[210,210,11],[330,330,33]],[[270,270,22]]);
  s.touch('touchend',[[210,210,11]],[[330,330,33]]);
  s.touch('touchend',[],[[210,210,11]]);
  assert.deepEqual(s.spends,[[1,2,2,50],[2,3,3,75],[0,1,1,100]]);
  assert.equal(s.sun,275);assert.equal(s.events.length,0);assert.equal(s.api.state().fingers,0);
});
test('same-frame releases honor shared sun even when affordability flags are stale',()=>{
  const s=setup({sun:100}),a=[60,60,11],b=[125,60,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  s.touch('touchend',[],[[210,210,11],[270,270,22]]);
  assert.deepEqual(s.spends,[[0,1,1,100]]);assert.equal(s.sun,0);
});
test('same card cannot be spent twice before the next cooldown update',()=>{
  const s=setup({sun:500,cooldown:true}),a=[60,60,11],b=[60,60,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  s.touch('touchend',[],[[210,210,11],[270,270,22]]);
  assert.equal(s.spends.length,1);assert.equal(s.sun,400);
});
test('asynchronous pending placement reserves a cell against another same-frame finger',()=>{
  const s=setup({sun:500,pending:true}),a=[60,60,11],b=[125,60,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  s.touch('touchend',[],[[210,210,11],[210,210,22]]);
  assert.equal(s.spends.length,1);assert.equal(s.sun,400);
});
test('cancelling one finger leaves another drag alive and card identity unchanged',()=>{
  const s=setup({sun:500}),a=[60,60,11],b=[125,60,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  s.touch('touchcancel',[a],[b]);
  s.touch('touchend',[],[[210,210,11]]);
  assert.deepEqual(s.spends,[[0,1,1,100]]);
});
test('a neutral mouse contact cannot steal a held plant or end its preview',()=>{
  const s=setup({sun:500}),a=[60,60,11],b=[750,480,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  assert.equal(s.ui.index,0);assert.equal(s.ui.currentCF,s.card);
  s.touch('touchend',[a],[b]);s.touch('touchend',[],[[210,210,11]]);
  assert.deepEqual(s.spends,[[0,1,1,100]]);
  assert.equal(s.events.filter(e=>e.type==='mouseup').length,1);
});
test('two conveyor cards retain their own identity while released in reverse order',()=>{
  const s=setup({free:true,sun:0}),a=[460,60,11],b=[525,60,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  s.touch('touchend',[a],[[270,270,22]]);s.touch('touchend',[],[[210,210,11]]);
  assert.deepEqual(s.usedCards,['free-b','free-a']);assert.equal(s.sun,0);
});
test('one disposable card cannot be consumed twice while its node awaits destruction',()=>{
  const s=setup({free:true,sun:0}),a=[460,60,11],b=[460,60,22];
  s.touch('touchstart',[a],[a]);s.touch('touchstart',[a,b],[b]);
  s.touch('touchend',[],[[210,210,11],[270,270,22]]);
  assert.deepEqual(s.usedCards,['free-a']);
});
test('non-planting holds remain visible to game frames and releasing one restores the survivor',()=>{
  const s=setup({mouseUI:true}),a=[750,480,11],b=[780,450,22];
  s.touch('touchstart',[a],[a]);assert.equal(s.ui.mouseDown,true);
  s.touch('touchstart',[a,b],[b]);assert.equal(s.ui.mouseDown,true);
  s.touch('touchend',[a],[b]);assert.equal(s.ui.mouseDown,true);
  s.touch('touchcancel',[],[a]);assert.equal(s.ui.mouseDown,false);
  assert.equal(s.api.state().contacts,0);
});
