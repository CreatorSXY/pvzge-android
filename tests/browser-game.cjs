// Real official game smoke test. Run against an extracted Docker web build.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PVZ_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.PVZ_GAME_DIR || '../pvzge_web/docs');
const output = path.resolve(process.env.PVZ_BROWSER_OUTPUT || 'work/browser-results');
const port=Number(process.env.PVZ_PORT || 8765);
const origin='http://127.0.0.1:'+port;
fs.mkdirSync(output, {recursive:true});
const direct = fs.readFileSync('app/src/main/assets/android-direct-touch.js','utf8');
const input = fs.readFileSync('app/src/main/assets/android-input.js','utf8');
const waveFix = fs.readFileSync('app/src/main/assets/android-wave-fix.js','utf8');
const exporting = fs.readFileSync('app/src/main/assets/android-export.js','utf8');
const types = {'.js':'application/javascript','.json':'application/json','.html':'text/html', '.css':'text/css',
  '.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif',
  '.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  if(rel==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const file=path.resolve(root,'.'+rel);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);res.end();return;
  }
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  if(rel==='/index.html' && process.env.PVZ_SERVE_CLIENT==='1') {
    const hooks=waveFix+'\n'+direct+'\n'+input+`\nwindow.render_game_to_text=function(){
      return JSON.stringify({coordinates:'CSS pixels, origin top left',touch:PvzDirectTouch.state(),contacts:PvzInput.state(),
        scene:window.System&&System.get(System.resolve('cc'))?.director.getScene()?.name});};
      var boot=setInterval(function(){
        var K=window.System&&System.get('chunks:///_virtual/KeyListener.ts')?.KeyListener;
        if(!K?.cp)return;
        var buttons=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length);
        if(buttons.length===1&&buttons[0].textContent.trim()==='')buttons[0].click();
        if(System.get(System.resolve('cc')).director.getScene()?.name==='mainScene'){
          clearInterval(boot);K.goToLevel(['tutorial1'],[],false,false).catch(console.error);
        }
      },500);`;
    res.end(fs.readFileSync(file,'utf8').replace('</head>','<script>'+hooks+'</script></head>'));return;
  }
  if(rel==='/application.js') {
    const s=fs.readFileSync(file,'utf8');
    if(!/\bcc\s*=\s*engine\s*;/.test(s))throw Error('Unknown bootstrap');
    res.end(s.replace(/\bcc\s*=\s*engine\s*;/,m=>m+'window.PvzDirectTouch.installEngine(engine);window.PvzWaveFix.installEngine(engine);'));return;
  }
  if(rel==='/assets/main/index.js') {res.write('window.PvzDirectTouch.captureModules(System);window.PvzWaveFix.captureModules(System);\n');}
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  if(process.env.PVZ_SERVE_CLIENT==='1'){console.log('Interactive test game: '+origin);return;}
  const browser=await chromium.launch({executablePath:process.env.PVZ_CHROME || '/usr/bin/google-chrome',
    args:process.env.PVZ_GPU==='hardware'?['--no-sandbox']:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const page=await context.newPage();
  const logs=[];
  page.on('pageerror',e=>logs.push({type:'pageerror',text:String(e)}));
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')logs.push({type:m.type(),text:m.text()});});
  await page.addInitScript(`window.__nativeExports=[];window.GardendlessBridge={
    exportData:(data,name)=>window.__nativeExports.push({data,name}),
    exportError:()=>{throw Error('Native export failed');}};`+exporting+'\n'+waveFix+'\n'+direct+'\n'+input);
  // Avoid unrelated third-party analytics/ad requests in the isolated test profile.
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/') ? route.continue():route.abort());
  try {
    await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.System&&System.get('chunks:///_virtual/KeyListener.ts')?.KeyListener?.cp,null,{timeout:180000});
    // KeyListener is also created in splashScene, before resource loading finishes.
    await page.waitForFunction(()=>System.get(System.resolve('cc')).director.getScene()?.name==='mainScene',null,{timeout:180000});
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length),null,{timeout:60000});
    await page.screenshot({path:path.join(output,'01-loaded.png')});
    // Fresh profiles display the official update notes in a DOM modal above the canvas.
    console.log('Visible HTML controls:',JSON.stringify(await page.locator('button').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent.trim(),visible:!!n.getClientRects().length})))));
    const htmlButtons=await page.locator('button').all();
    const visibleButtons=[];
    for(const button of htmlButtons)if(await button.isVisible())visibleButtons.push(button);
    // The official modal close is an SVG-only button (no text/accessible name).
    if(visibleButtons.length!==1)throw Error('Expected the one visible official update close button');
    await visibleButtons[0].click();
    console.log('Closed official update notes');
    const before=await page.evaluate(()=>({touch:PvzDirectTouch.state(),waveFix:PvzWaveFix.state(),
      scene:System.get(System.resolve('cc')).director.getScene()?.name,
      player:!!System.get('chunks:///_virtual/PlayerProperties.ts')?.AllPlayerProperties?.currentPlayer}));
    console.log('Loaded official game:',JSON.stringify(before));
    if(before.waveFix.legacy!==false||before.waveFix.applied)throw Error('Modern official wave logic was unexpectedly replaced');
    await page.waitForFunction(()=>!System.get('chunks:///_virtual/KeyListener.ts').KeyListener.screenColorTweening,null,{timeout:30000});
    await Promise.race([page.evaluate(async()=>{
      const K=System.get('chunks:///_virtual/KeyListener.ts').KeyListener;
      await K.goToLevel(['tutorial1'],[],false,false);
    }),new Promise((_,reject)=>setTimeout(()=>reject(Error('Tutorial transition timed out')),90000).unref())]);
    await page.waitForFunction(()=>window.PvzDirectTouch.state().ready,null,{timeout:120000});
    await page.waitForFunction(()=>{
      const U=System.get('chunks:///_virtual/UI.ts')?.UIInGame.component;
      return U?.cards?.CFs.some(cf=>cf.ca.getSelectable());
    },null,{timeout:30000});
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(output,'02-tutorial.png')});
    const resolveTargets=()=>{
      const cc=System.get(System.resolve('cc'));
      const U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;
      const S=System.get('chunks:///_virtual/Square.ts').Square;
      const M=System.get('chunks:///_virtual/Mouse.ts').Mouse;
      const L=System.get('chunks:///_virtual/levelController.ts').LevelPlay.component;
      function css(p){
        const v=cc.view.getViewportRect(),r=document.getElementById('GameCanvas').getBoundingClientRect();
        const design=cc.view.getDesignResolutionSize();
        const visible=cc.view.getVisibleSize();
        // Convert UI world coordinates through the same engine scale/viewport as getUILocation.
        const dpr=cc.screen.devicePixelRatio;
        return {x:r.left+(p.x*cc.view.getScaleX()+v.x)/dpr,
          y:r.top+r.height-(p.y*cc.view.getScaleY()+v.y)/dpr};
      }
      window.__touchCss = css;
      const card=U.cards.CFs.findIndex(cf=>cf.ca.getSelectable());
      if(card<0)throw Error('No selectable tutorial plant');
      const cardPoint=css(U.cards.CFs[card].node.worldPosition);
      const cell=S.getLnC(2,0);
      const world=cell.node.worldPosition;
      // Mouse.position adds camera/UI offset to Mouse.positionOrg.
      const delta={x:M.position.x-M.positionOrg.x,y:M.position.y-M.positionOrg.y};
      const cellPoint=css({x:world.x-delta.x,y:world.y-delta.y});
      window.__touchSmoke={U,S,cell,card,cardPoint,cellPoint,before:cell.getAllPlants().length};
      return {card,cardPoint,cellPoint,selectable:U.cards.CFs[card].ca.getSelectable(),
        cost:U.cards.CFs[card].SUNCOST,sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value,
        state:PvzDirectTouch.state()};
    };
    const info=await page.evaluate(resolveTargets);
    await page.evaluate(()=>{
      window.__plantingMouseEvents=0;
      document.getElementById('GameCanvas').addEventListener('mousedown',()=>window.__plantingMouseEvents++);
    });
    console.log('Touch targets:',JSON.stringify(info));
    const hit = await page.evaluate(p=>({tag:document.elementFromPoint(p.x,p.y)?.tagName,
      id:document.elementFromPoint(p.x,p.y)?.id}),info.cardPoint);
    if(hit.id!=='GameCanvas')throw Error('Test target covered by HTML overlay: '+JSON.stringify(hit));
    await page.touchscreen.tap(info.cardPoint.x,info.cardPoint.y);
    const selected=await page.evaluate(()=>PvzDirectTouch.state());
    if(selected.selected!==info.card)throw Error('Touch did not directly select card: '+JSON.stringify(selected));
    await page.touchscreen.tap(info.cellPoint.x,info.cellPoint.y);
    await page.waitForFunction(()=>{
      const t=window.__touchSmoke;return t.cell.getAllPlants().length>t.before;
    },{},{timeout:10000});
    const after=await page.evaluate(()=>({state:PvzDirectTouch.state(),plants:window.__touchSmoke.cell.getAllPlants().length,
      sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value,mouseEvents:window.__plantingMouseEvents}));
    if(after.mouseEvents!==0)throw Error('Planting still emitted synthetic mouse events');
    if(after.sun!==info.sun-info.cost)throw Error('Original sun cost was not applied: '+JSON.stringify({info,after}));
    await page.screenshot({path:path.join(output,'03-single-tap-planted.png')});
    // Reload the tutorial for a clean drag scenario with normal sun/cooldown state.
    await Promise.race([page.evaluate(()=>System.get('chunks:///_virtual/KeyListener.ts').KeyListener.goToLevel(['tutorial1'],[],false,false)),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('Second tutorial transition timed out')),90000).unref())]);
    await page.waitForFunction(()=>window.PvzDirectTouch.state().ready,null,{timeout:120000});
    await page.waitForFunction(()=>{
      const U=System.get('chunks:///_virtual/UI.ts')?.UIInGame.component;
      return U?.cards?.CFs.some(cf=>cf.ca.getSelectable());
    },null,{timeout:30000});
    await page.waitForTimeout(500);
    const dragInfo=await page.evaluate(resolveTargets);
    const session=await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:dragInfo.cardPoint.x,y:dragInfo.cardPoint.y,id:1}]});
    for(let step=1;step<=8;step++) {
      const t=step/8;
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{
        x:dragInfo.cardPoint.x+(dragInfo.cellPoint.x-dragInfo.cardPoint.x)*t,
        y:dragInfo.cardPoint.y+(dragInfo.cellPoint.y-dragInfo.cardPoint.y)*t,id:1}]});
      await page.waitForTimeout(50);
    }
    const preview=await page.evaluate(()=>({state:PvzDirectTouch.state(),plants:window.__touchSmoke.cell.getAllPlants().length}));
    if(preview.plants!==0)throw Error('Drag planted before finger release');
    if(preview.state.row!==2||preview.state.column!==0)throw Error('Drag preview on wrong cell');
    await page.screenshot({path:path.join(output,'04-drag-preview.png')});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>window.__touchSmoke.cell.getAllPlants().length===1,null,{timeout:10000});
    const dragAfter=await page.evaluate(()=>({state:PvzDirectTouch.state(),plants:window.__touchSmoke.cell.getAllPlants().length,
      sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value,mouseEvents:window.__plantingMouseEvents}));
    if(dragAfter.mouseEvents!==0||dragAfter.sun!==dragInfo.sun-dragInfo.cost)throw Error('Drag bypassed game cost or emitted mouse clicks');
    await page.screenshot({path:path.join(output,'05-drag-planted.png')});
    const expectedExport=await page.evaluate(()=>{
      const players=System.get('chunks:///_virtual/PlayerProperties.ts').AllPlayerProperties.allPlayers;
      System.get('chunks:///_virtual/SettingWindow.ts').createExportElement(players,'android-save-存档');
      return JSON.stringify(players);
    });
    await page.waitForFunction(()=>window.__nativeExports.length===1,null,{timeout:10000});
    const actualExport=await page.evaluate(()=>{
      const result=window.__nativeExports[0];
      const bytes=Uint8Array.from(atob(result.data.split(',')[1]),c=>c.charCodeAt(0));
      return {name:result.name,players:JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)))};
    });
    if(actualExport.players!==expectedExport||actualExport.name!=='android-save-存档.json')throw Error('Real game Blob export did not reach native bridge intact');
    fs.writeFileSync(path.join(output,'export-check.json'),JSON.stringify({name:actualExport.name,passed:true}));
    // A three-slot tutorial fixture, populated through the game's original card APIs.
    // Costs, cooldowns, collection, terrain checks and spawning stay unmodified.
    await page.evaluate(()=>{
      const Cards=System.get('chunks:///_virtual/Cards.ts').Cards;
      const lay=Cards.prototype.laySlots;
      Cards.prototype.laySlots=function(){this.maxSlotCount=Math.max(3,this.maxSlotCount);return lay.apply(this,arguments);};
    });
    await page.evaluate(()=>System.get('chunks:///_virtual/KeyListener.ts').KeyListener.goToLevel(['tutorial1'],[],false,false));
    await page.waitForFunction(()=>PvzDirectTouch.state().ready,null,{timeout:120000});
    await page.evaluate(()=>{
      const U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;
      const L=System.get('chunks:///_virtual/levelController.ts').LevelPlay.component;
      Object.keys(L).filter(k=>k.startsWith('Tutorial_')&&typeof L[k]==='boolean').forEach(k=>L[k]=false);
      L.Tutorial_Sun_Stuck=true;L.Tutorial_Wave_Stuck=true;
      U.cards.addCardByType('wallnut');U.cards.addCardByType('potatomine');
      for(let i=1;i<3;i++) {U.cards.CFs[i].ca.disallowed=0;U.cards.CUs[i].gameStart();U.cards.cardsUIUpper.push(U.cards.CUs[i]);}
      U.cards.cardsUIUpper.forEach(c=>{c.CD=0;c.coolDown(0);});
      const Sun=System.get('chunks:///_virtual/SunCount.ts').SunCount;
      Sun.component.SunAdd(1000-Sun.Value);
    });
    await page.waitForFunction(()=>System.get('chunks:///_virtual/UI.ts').UIInGame.component.cards.CFs.length===3&&
      System.get('chunks:///_virtual/UI.ts').UIInGame.component.cards.CFs.every(cf=>cf.ca.getSelectable()),null,{timeout:30000});
    await page.evaluate(resolveTargets);
    const multi=await page.evaluate(()=>{
      const U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;
      const S=System.get('chunks:///_virtual/Square.ts').Square;
      const M=System.get('chunks:///_virtual/Mouse.ts').Mouse;
      const delta={x:M.position.x-M.positionOrg.x,y:M.position.y-M.positionOrg.y};
      return {cards:U.cards.CFs.map(cf=>({point:__touchCss(cf.node.worldPosition),type:cf.Type,cost:cf.SUNCOST})),
        cells:[0,1,2].map(c=>{const p=S.getLnC(2,c).node.worldPosition;return __touchCss({x:p.x-delta.x,y:p.y-delta.y});}),
        sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value};
    });
    console.log('Multi-contact fixture:',JSON.stringify(multi));
    const fingers=new Map();
    async function startFinger(id,p) {fingers.set(id,{...p,id});await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[...fingers.values()]});}
    async function moveFinger(id,p) {fingers.set(id,{...p,id});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[...fingers.values()]});}
    async function endFinger(id) {
      // CDP's nonempty touchEnd list identifies the contacts being released, not survivors.
      const ended=fingers.get(id);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[ended]});fingers.delete(id);
    }
    for(let i=0;i<3;i++)await startFinger(11+i,multi.cards[i].point);
    for(let i=0;i<3;i++)await moveFinger(11+i,multi.cells[i]);
    await page.waitForTimeout(200);
    const heldThree=await page.evaluate(()=>({touch:PvzDirectTouch.state(),contacts:PvzInput.state(),
      previews:System.get('chunks:///_virtual/UI.ts').UIInGame.component.plantInHandLayer.children.length}));
    if(heldThree.touch.fingers!==3||heldThree.contacts.length!==3)throw Error('Three contacts did not remain independently held: '+JSON.stringify(heldThree));
    if(heldThree.previews>1)throw Error('Asynchronous card previews piled up: '+JSON.stringify(heldThree));
    await page.screenshot({path:path.join(output,'06-three-fingers-held.png')});
    await endFinger(12);
    const partial=await page.evaluate(()=>({touch:PvzDirectTouch.state(),contacts:PvzInput.state()}));
    if(partial.touch.fingers!==2||partial.contacts.length!==2)throw Error('Ending one finger cancelled survivors');
    await moveFinger(11,multi.cells[0]);await endFinger(11);await endFinger(13);
    await page.waitForFunction(()=>[0,1,2].every(c=>System.get('chunks:///_virtual/Square.ts').Square.getLnC(2,c).getAllPlants().length===1),null,{timeout:20000});
    const threeResult=await page.evaluate(()=>({
      types:[0,1,2].map(c=>System.get('chunks:///_virtual/Square.ts').Square.getLnC(2,c).getAllPlants()[0].Plant_Type),
      sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value,touch:PvzDirectTouch.state(),contacts:PvzInput.state(),mouseEvents:__plantingMouseEvents
    }));
    if(threeResult.sun!==multi.sun-multi.cards.reduce((sum,c)=>sum+c.cost,0)||threeResult.mouseEvents!==0)throw Error('Multiple fingers changed costs or emitted planting mouse events: '+JSON.stringify(threeResult));
    if(threeResult.types.some((type,i)=>type!==multi.cards[i].type))throw Error('A finger planted another finger\'s card: '+JSON.stringify(threeResult));
    if(threeResult.contacts.length)throw Error('Stuck contacts after final release');
    await page.screenshot({path:path.join(output,'07-three-fingers-planted.png')});
    fs.writeFileSync(path.join(output,'multi-touch-check.json'),JSON.stringify({multi,heldThree,partial,threeResult},null,2));
    console.log('PASS: three actual contacts retained card ownership, release order, positions and original shared costs');
    async function resetCards(sun) {
      await page.evaluate(value=>{
        const U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;
        U.tryChangingIndex(-1);
        U.cards.cardsUIUpper.forEach(c=>{c.CD=0;c.coolDown(0);});
        const S=System.get('chunks:///_virtual/SunCount.ts').SunCount;
        if(S.Value>value)S.component.SunDec(S.Value-value);else S.component.SunAdd(value-S.Value);
      },sun);
      await page.waitForTimeout(100);
    }
    async function cellPoint(row,column) {
      return page.evaluate(([r,c])=>{
        const M=System.get('chunks:///_virtual/Mouse.ts').Mouse;
        const p=System.get('chunks:///_virtual/Square.ts').Square.getLnC(r,c).node.worldPosition;
        return __touchCss({x:p.x-M.position.x+M.positionOrg.x,y:p.y-M.position.y+M.positionOrg.y});
      },[row,column]);
    }
    async function resultAt(cells) {
      return page.evaluate(targets=>({sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value,
        plants:targets.map(([r,c])=>System.get('chunks:///_virtual/Square.ts').Square.getLnC(r,c).getAllPlants().map(p=>p.Plant_Type)),
        contacts:PvzInput.state()}),cells);
    }
    // Keep a plant held while another finger independently presses/releases empty lawn.
    await resetCards(500);
    const plantPoint=await cellPoint(2,3),emptyPoint=await cellPoint(2,8);
    await startFinger(21,multi.cards[0].point);await moveFinger(21,plantPoint);
    await startFinger(22,emptyPoint);await endFinger(22);
    const afterNeutral=await resultAt([[2,3],[2,8]]);
    if(afterNeutral.plants.some(p=>p.length)||afterNeutral.contacts.length!==1)throw Error('Neutral finger stole a held plant: '+JSON.stringify(afterNeutral));
    await page.waitForTimeout(150);
    // Real suns use original production, hit geometry, collect() and SunCount.SunAdd.
    await page.evaluate(()=>{
      const cc=System.get(System.resolve('cc'));
      const S=System.get('chunks:///_virtual/Square.ts').Square;
      const producer=System.get('chunks:///_virtual/Sunflower.ts').sunflower;
      const a=S.getLnC(2,3).node.worldPosition,b=S.getLnC(2,8).node.worldPosition;
      const points=[b,S.getLnC(2,7).node.worldPosition,new cc.Vec2((a.x+b.x)/2,(a.y+b.y)/2)];
      window.__multiSuns=points.map(p=>producer.produceSun(25,new cc.Vec2(p.x,p.y),0,false)[0]);
      __multiSuns.forEach(s=>{s.gravity=0;s.linearVelocity=new cc.Vec2(0,0);s.bodyLinearVelocity=0;});
    });
    await page.waitForTimeout(150);
    const pickupPoints=await page.evaluate(()=>{
      const M=System.get('chunks:///_virtual/Mouse.ts').Mouse;
      return __multiSuns.map(s=>{const p=s.node.worldPosition;return __touchCss({x:p.x-M.position.x+M.positionOrg.x,y:p.y-M.position.y+M.positionOrg.y});});
    });
    await startFinger(22,pickupPoints[0]);await startFinger(23,pickupPoints[1]);
    await page.waitForTimeout(100);
    const pickupResult=await page.evaluate(()=>({sun:System.get('chunks:///_virtual/SunCount.ts').SunCount.Value,
      collected:__multiSuns.map(s=>s.collected),contacts:PvzInput.state(),touch:PvzDirectTouch.state(),
      previews:System.get('chunks:///_virtual/UI.ts').UIInGame.component.plantInHandLayer.children.length}));
    if(pickupResult.sun!==550||JSON.stringify(pickupResult.collected)!=='[true,true,false]'||pickupResult.contacts.length!==3)
      throw Error('Independent pickup failed or a phantom line collected the midpoint sun: '+JSON.stringify(pickupResult));
    if(pickupResult.previews>1)throw Error('Pickup switching duplicated the planting preview');
    await page.screenshot({path:path.join(output,'08-plant-and-two-pickup-fingers.png')});
    await endFinger(22);await moveFinger(21,plantPoint);await endFinger(23);await endFinger(21);
    await page.waitForFunction(()=>System.get('chunks:///_virtual/Square.ts').Square.getLnC(2,3).getAllPlants().length===1,null,{timeout:10000});
    const plantAndPickup=await resultAt([[2,3],[2,8]]);
    if(plantAndPickup.sun!==450||plantAndPickup.plants[1].length)throw Error('Pickups interfered with held plant cost/target: '+JSON.stringify(plantAndPickup));
    await page.evaluate(()=>{__multiSuns[2].node.active=false;}); // Remove this scenario's uncollected decoy.
    // One browser touchend event releases both contacts before any next game frame.
    async function pair(cardIndices,targets) {
      for(let i=0;i<2;i++)await startFinger(31+i,multi.cards[cardIndices[i]].point);
      for(let i=0;i<2;i++)await moveFinger(31+i,await cellPoint(...targets[i]));
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});fingers.clear();
      await page.waitForFunction(targets=>{
        const S=System.get('chunks:///_virtual/Square.ts').Square;
        return targets.every(([r,c])=>!S.getLnC(r,c).spawningPromiseCount)&&
          targets.some(([r,c])=>S.getLnC(r,c).getAllPlants().length>0);
      },targets,{timeout:20000});
      return resultAt(targets);
    }
    await resetCards(500);
    const sharedCooldown=await pair([0,0],[[2,4],[2,5]]);
    if(sharedCooldown.sun!==400||sharedCooldown.plants.reduce((n,p)=>n+p.length,0)!==1)throw Error('Shared card bypassed its cooldown: '+JSON.stringify(sharedCooldown));
    await resetCards(100);
    const sharedSun=await pair([0,1],[[2,5],[2,6]]);
    if(sharedSun.sun!==0||sharedSun.plants.reduce((n,p)=>n+p.length,0)!==1)throw Error('Simultaneous contacts overspent shared sun: '+JSON.stringify(sharedSun));
    await resetCards(500);
    const sameCell=await pair([0,1],[[2,6],[2,6]]);
    if(sameCell.sun!==400||sameCell.plants.some(p=>p.length!==1))throw Error('Two contacts occupied the same pending cell: '+JSON.stringify(sameCell));
    fs.writeFileSync(path.join(output,'multi-touch-check.json'),JSON.stringify({multi,heldThree,partial,threeResult,
      afterNeutral,pickupResult,plantAndPickup,sharedCooldown,sharedSun,sameCell},null,2));
    await page.screenshot({path:path.join(output,'09-multi-touch-regressions.png')});
    console.log('PASS: held plant + neutral finger + independent pickup, no phantom inter-finger sweep, same-event cooldown/sun/occupancy');
    // Built-in engine buttons use touch identity too; separate mouse state alone
    // must not leave one pressed or click the other twice through shared touch 0.
    await page.evaluate(()=>{
      const cc=System.get(System.resolve('cc')),U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;
      const parent=U.s2xButton.node.parent,layout=parent.getComponent(cc.Layout);
      if(layout)layout.enabled=false;
      window.__multiButtons=[];window.__multiButtonClicks=[0,0];
      for(let i=0;i<2;i++){
        const n=new cc.Node();n.layer=U.s2xButton.node.layer;
        n.addComponent(cc.UITransform).setContentSize(56,56);
        n.name='IndependentButton'+i;n.parent=parent;
        const p=U.s2xButton.node.worldPosition;
        n.worldPosition=new cc.Vec3(p.x-240+i*80,p.y,0);
        const button=n.addComponent(cc.Button);button.enabled=true;button.interactable=true;button.clickEvents=[];
        n.on('click',()=>__multiButtonClicks[i]++);__multiButtons.push(button);
      }
    });
    await page.waitForTimeout(300);
    const buttonPoints=await page.evaluate(()=>__multiButtons.map(b=>__touchCss(b.node.worldPosition)));
    if(!await page.evaluate(()=>PvzDirectTouch.state().nativeUI))throw Error('Engine native touch routing unavailable');
    await startFinger(61,buttonPoints[0]);
    await startFinger(62,buttonPoints[1]);
    const buttonsHeld=await page.evaluate(()=>__multiButtons.map(b=>b._pressed));
    if(JSON.stringify(buttonsHeld)!=='[true,true]')throw Error('Built-in buttons did not remain independently held: '+JSON.stringify(buttonsHeld));
    await endFinger(62);
    const buttonSurvivor=await page.evaluate(()=>({pressed:__multiButtons.map(b=>b._pressed),clicks:__multiButtonClicks.slice()}));
    if(JSON.stringify(buttonSurvivor)!=='{"pressed":[true,false],"clicks":[0,1]}')throw Error('Button release affected its peer or clicked twice: '+JSON.stringify(buttonSurvivor));
    await endFinger(61);
    const buttonsDone=await page.evaluate(()=>({pressed:__multiButtons.map(b=>b._pressed),clicks:__multiButtonClicks.slice()}));
    if(JSON.stringify(buttonsDone)!=='{"pressed":[false,false],"clicks":[1,1]}')throw Error('A built-in button remained pressed or lost its click: '+JSON.stringify(buttonsDone));
    fs.writeFileSync(path.join(output,'native-ui-check.json'),JSON.stringify({buttonPoints,buttonsHeld,buttonSurvivor,buttonsDone},null,2));
    await page.screenshot({path:path.join(output,'10-independent-ui-buttons.png')});
    console.log('PASS: built-in UI buttons preserve independent native touch IDs and emit one click each');
    if(logs.some(l=>l.type==='pageerror'))throw Error('Game reported a JavaScript error: '+JSON.stringify(logs));
    fs.writeFileSync(path.join(output,'state.json'),JSON.stringify({before,info,selected,after,dragInfo,preview,dragAfter},null,2));
    console.log('PASS: first lawn tap planted using real game API',JSON.stringify(after));
  } catch(e) {
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    const diagnostic=await page.evaluate(()=>({state:window.PvzDirectTouch?.state(),
      scene:(window.System && System.get(System.resolve('cc')))?.director.getScene()?.name,
      cards:(()=>{const U=window.System?.get('chunks:///_virtual/UI.ts')?.UIInGame?.component;return U?.cards?.CFs.map(c=>({type:c.Type,cost:c.SUNCOST,cooling:c.ca.cooling,affordable:c.ca.affordable,disallowed:c.ca.disallowed}));})(),
      nodes:(()=>{const cc=(window.System && System.get(System.resolve('cc')));const scene=cc?.director.getScene();return scene?.children.map(n=>({name:n.name,active:n.activeInHierarchy}));})()})).catch(()=>({}));
    fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),diagnostic},null,2));
    process.exitCode=1;console.error(e);
  } finally {
    fs.writeFileSync(path.join(output,'console.json'),JSON.stringify(logs,null,2));
    await browser.close();server.close();
  }
})().catch(e=>{console.error(e);process.exit(1);});
