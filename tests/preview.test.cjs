const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('app/src/main/assets/android-direct-touch.js','utf8');
test('rapid A/B/A selection serializes asynchronous previews and destroys stale nodes',async()=>{
  const context={console,Promise};context.window=context;
  vm.runInNewContext(script,context);
  const removed=[];
  const system={register(name,deps,declare){declare(()=>{},{}).execute();}};
  context.PvzDirectTouch.captureModules(system);
  system.register('chunks:///_virtual/NodePools.ts',[],publish=>({execute(){publish({
    destroyPooly(node){node.destroyed=true;removed.push(node);},
    destroyNodeArrayPooly(nodes){for(const node of nodes.splice(0)){node.destroyed=true;removed.push(node);}}
  });}}));
  const pending=[];
  const card=name=>({name,SUNCOST:100,Prop:{},thisCard:()=>new Promise(resolve=>pending.push({name,resolve}))});
  const a=card('A'),b=card('B');
  class UI {
    constructor(){this.index=-1;this.plantInHandLayer={children:[]};}
    async plantInHand(card,preview=true){
      this.currentCF=card;this.plantReady=null;this.willCostSun=0;
      if(!preview||!card)return;
      const index=this.index;this.willCostSun=card.SUNCOST;
      const data=await card.thisCard();
      const node={name:data.name,parent:null};this.plantReady=node;
      if(!this.currentCF||this.index!==index)return;
      node.parent=this.plantInHandLayer;node.parent.children.push(node);
    }
  }
  system.register('chunks:///_virtual/UI.ts',[],publish=>({execute(){publish('UIInGame',UI);}}));
  const ui=new UI();
  ui.index=0;const first=ui.plantInHand(a);
  ui.index=1;await ui.plantInHand(b);
  ui.index=0;await ui.plantInHand(a);
  assert.equal(pending.length,1,'only one original preview load can be outstanding');
  pending[0].resolve({name:'stale A'});
  await new Promise(setImmediate);
  assert.equal(pending.length,2);assert.equal(pending[1].name,'A');
  pending[1].resolve({name:'latest A'});await first;
  assert.equal(ui.plantInHandLayer.children.length,1);
  assert.equal(ui.plantInHandLayer.children[0].name,'latest A');
  assert.ok(removed.some(n=>n.name==='stale A'));
  ui.index=1;const loading=ui.plantInHand(b);
  await ui.plantInHand(null);
  pending[2].resolve({name:'cancelled B'});await loading;
  assert.equal(ui.plantInHandLayer.children.length,0);
  assert.equal(ui.currentCF,null);
  assert.ok(removed.some(n=>n.name==='cancelled B'),'an unparented stale preview is returned to the pool');
});
