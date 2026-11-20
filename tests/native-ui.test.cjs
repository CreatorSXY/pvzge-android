const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('UI contacts keep distinct native IDs and suppress only their duplicate mouse touch simulation',()=>{
  const listeners={},native=[],simulated=[];
  const input={_dispatchImmediately:false,_needSimulateTouchMoveEvent:false,_simulateEventTouch:e=>simulated.push(e.type)};
  const original=input._simulateEventTouch;
  const canvas={dispatchEvent(event){
    event.target=this;
    if(listeners[event.type])listeners[event.type](event);
    if(event.type.startsWith('touch'))native.push(event);
    else if(event.type==='mousedown'||event.type==='mouseup'){
      input._simulateEventTouch(event);input._needSimulateTouchMoveEvent=event.type==='mousedown';
    }
  }};
  class Event {constructor(type,options){Object.assign(this,options,{type});}}
  const context={console,Promise,document:{getElementById:()=>canvas,addEventListener:(t,fn)=>listeners[t]=fn},
    MouseEvent:Event,TouchEvent:Event,Touch:class {constructor(options){Object.assign(this,options);}}};
  context.window=context;context.addEventListener=()=>{};
  vm.runInNewContext(fs.readFileSync('app/src/main/assets/android-direct-touch.js','utf8'),context);
  context.PvzDirectTouch.installEngine({input});
  vm.runInNewContext(fs.readFileSync('app/src/main/assets/android-input.js','utf8'),context);
  function send(type,touches,changed){
    const point=([id,x,y])=>({identifier:id,clientX:x,clientY:y,target:canvas});
    listeners[type]({type,target:canvas,touches:touches.map(point),changedTouches:changed.map(point),preventDefault(){},stopImmediatePropagation(){}});
  }
  const a=[11,100,100],b=[22,300,100];
  send('touchstart',[a],[a]);send('touchstart',[a,b],[b]);
  send('touchend',[a],[b]);send('touchcancel',[],[a]);
  assert.deepEqual(native.map(e=>e.type),['touchstart','touchstart','touchend','touchcancel']);
  const first=native[0].changedTouches[0].identifier,second=native[1].changedTouches[0].identifier;
  assert.notEqual(first,second);assert.notEqual(first,0);
  assert.equal(native[2].changedTouches[0].identifier,second);
  assert.equal(native[2].touches.length,1);assert.equal(native[2].touches[0].identifier,first);
  assert.equal(native[3].changedTouches[0].identifier,first);assert.equal(native[3].touches.length,0);
  assert.ok(native.every(e=>e.__pvzForwarded));
  assert.equal(simulated.length,0,'no shared touch 0 is created for routed contacts');
  assert.equal(context.PvzInput.state().length,0,'forwarded events do not recursively create gestures');
  assert.equal(input._simulateEventTouch,original);assert.equal(input._dispatchImmediately,false);
  assert.equal(input._needSimulateTouchMoveEvent,false);
  canvas.dispatchEvent(new Event('mousedown',{}));assert.deepEqual(simulated,['mousedown'],'physical mouse behavior is restored');
  const c=[33,500,100];send('touchstart',[c],[c]);
  const started=native[native.length-1].changedTouches[0].identifier;
  context.PvzDirectTouch.mouseAction=()=>{}; // The original scene no longer accepts mouse callbacks.
  send('touchend',[],[c]);
  assert.equal(native[native.length-1].type,'touchcancel');
  assert.equal(native[native.length-1].changedTouches[0].identifier,started,'scene exit still releases the native touch ID');
  assert.equal(context.PvzInput.state().length,0);
});
