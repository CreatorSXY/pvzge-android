const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const script = readFileSync('app/src/main/assets/android-input.js', 'utf8');
function setup() {
  const listeners = {}, events = [], planted = [], context = { console };
  let cursor = null;
  const canvas = { dispatchEvent(e) {
    events.push(e);
    if (e.type === 'mousemove') cursor = [e.clientX, e.clientY];
    if (e.type === 'mousedown' && e.button === 0) planted.push(cursor);
  } };
  context.window = context;
  context.addEventListener = (type, fn) => listeners[type] = fn;
  context.document = { getElementById: () => canvas, addEventListener: context.addEventListener };
  context.MouseEvent = context.WheelEvent = function(type, init) { Object.assign(this, init, { type }); };
  vm.runInNewContext(script, context);
  let sActive = [];
  const p = (x, y, id = 0) => ({ clientX: x, clientY: y, identifier: id });
  function touch(type, touches, changed = [], target = canvas) {
    let blocked = false;
    if (!changed.length && /touch(start|move)/.test(type)) changed = touches;
    if (type === "touchcancel" && !changed.length) changed = sActive;
    listeners[type]({ type, target, touches: touches.map(a => p(...a)), changedTouches: changed.map(a => p(...a)),
      preventDefault() { blocked = true; }, stopImmediatePropagation() {} });
    sActive = touches;
    return blocked;
  }
  return { touch, events, planted, context, listeners };
}
test('first tap at each new position updates cursor before down; one press per tap', () => {
  const s = setup();
  for (const p of [[100, 50], [500, 250], [123.5, 87.25]]) {
    s.touch('touchstart', [p]); s.touch('touchend', [], [p]);
  }
  assert.deepEqual(s.planted, [[100, 50], [500, 250], [123.5, 87.25]]);
  assert.equal(s.events.filter(e => e.type === 'mousedown').length, 3);
  assert.equal(s.events.filter(e => e.type === 'mouseup').length, 3);
  assert.equal(s.events.filter(e => e.type === 'click').length, 3);
});
test('drag preserves button state and releases at the final finger position', () => {
  const s = setup();
  s.touch('touchstart', [[20, 30]]);
  s.touch('touchmove', [[800, 500]]);
  s.touch('touchend', [], [[850, 550]]);
  const moves = s.events.filter(e => e.type === 'mousemove');
  assert.deepEqual(moves.map(e => e.buttons), [0, 1, 1]);
  const up = s.events.find(e => e.type === 'mouseup');
  assert.deepEqual([up.clientX, up.clientY, up.buttons], [850, 550, 0]);
  assert.equal(s.events.some(e => e.button === 2), false);
});
test('three fingers keep separate press, motion and release coordinates with no inferred gestures', () => {
  const s = setup();
  const a=[20,30,11], b=[400,300,22], c=[800,500,33];
  s.touch('touchstart',[a],[a]);
  s.touch('touchstart',[b,a],[b]);
  s.touch('touchstart',[c,a,b],[c]);
  s.touch('touchmove',[[800,510,33],[25,35,11],b],[[25,35,11]]);
  s.touch('touchend',[[25,35,11],c],[b]);
  s.touch('touchmove',[[30,40,11],c],[[30,40,11]]);
  s.touch('touchend',[c],[[30,40,11]]);
  s.touch('touchend',[],[c]);
  assert.deepEqual(s.planted,[[20,30],[400,300],[800,500]]);
  assert.deepEqual(s.events.filter(e=>e.type==='mouseup').map(e=>[e.clientX,e.clientY]),[[400,300],[30,40],[800,500]]);
  assert.equal(s.events.filter(e=>e.type==='click').length,3);
  assert.equal(s.events.some(e=>e.button===2 || e.type==='wheel'),false);
  assert.equal(s.context.PvzInput.state().length,0);
});
test('partial cancel releases only that finger and remaining contacts continue',()=>{
  const s=setup(), a=[20,30,11], b=[400,300,22];
  s.touch('touchstart',[a],[a]); s.touch('touchstart',[a,b],[b]);
  s.touch('touchcancel',[a],[b]);
  assert.equal(s.context.PvzInput.state().length,1);
  s.touch('touchmove',[[80,90,11]],[[80,90,11]]);
  s.touch('touchend',[],[[80,90,11]]);
  assert.equal(s.events.filter(e=>e.type==='mouseup').length,2);
  assert.deepEqual(s.events.filter(e=>e.type==='click').map(e=>[e.clientX,e.clientY]),[[80,90]]);
});
test('cancel and background release exactly once without click', () => {
  for (const action of ['cancel', 'blur']) {
    const s = setup();
    s.touch('touchstart', [[50, 60]]);
    if (action === 'cancel') s.touch('touchcancel', []); else s.listeners.blur();
    s.context.PvzInput.cancel();
    assert.equal(s.events.filter(e => e.type === 'mouseup').length, 1);
    assert.equal(s.events.some(e => e.type === 'click'), false);
  }
});
test('HTML controls keep native touch events; adapter installation is idempotent', () => {
  const s = setup();
  assert.equal(s.touch('touchstart', [[10, 10]], [], {}), false);
  assert.equal(s.touch('touchend', [], [[10, 10]], {}), false);
  assert.equal(s.events.length, 0);
  const handler = s.listeners.touchstart;
  vm.runInNewContext(script, s.context);
  assert.equal(s.listeners.touchstart, handler);
});
