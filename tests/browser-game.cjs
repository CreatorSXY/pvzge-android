// Real official game smoke test. Run against an extracted Docker web build.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PVZ_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.PVZ_GAME_DIR || '../pvzge_web/docs');
const output = path.resolve(process.env.PVZ_BROWSER_OUTPUT || 'work/browser-results');
fs.mkdirSync(output, {recursive:true});
const direct = fs.readFileSync('app/src/main/assets/android-direct-touch.js','utf8');
const input = fs.readFileSync('app/src/main/assets/android-input.js','utf8');
const types = {'.js':'application/javascript','.json':'application/json','.html':'text/html', '.css':'text/css',
  '.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif',
  '.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  const file=path.resolve(root,'.'+rel);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);res.end();return;
  }
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  if(rel==='/application.js') {
    const s=fs.readFileSync(file,'utf8');
    if(!/\bcc\s*=\s*engine\s*;/.test(s))throw Error('Unknown bootstrap');
    res.end(s.replace(/\bcc\s*=\s*engine\s*;/,m=>m+'window.PvzDirectTouch.installEngine(engine);'));return;
  }
  if(rel==='/assets/main/index.js') {res.write('window.PvzDirectTouch.captureModules(System);\n');}
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.PVZ_CHROME || '/usr/bin/google-chrome',
    args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const page=await context.newPage();
  const logs=[];
  page.on('pageerror',e=>logs.push({type:'pageerror',text:String(e)}));
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')logs.push({type:m.type(),text:m.text()});});
  await page.addInitScript(direct+'\n'+input);
  // Avoid unrelated third-party analytics/ad requests in the isolated test profile.
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8765/') ? route.continue():route.abort());
  try {
    await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.System&&System.get('chunks:///_virtual/KeyListener.ts')?.KeyListener?.cp,{timeout:180000});
    await page.waitForTimeout(15000);
    await page.screenshot({path:path.join(output,'01-loaded.png')});
    const before=await page.evaluate(()=>({touch:PvzDirectTouch.state(),
      scene:System.get('cc').director.getScene()?.name,
      player:!!System.get('chunks:///_virtual/PlayerProperties.ts')?.AllPlayerProperties?.currentPlayer}));
    console.log('Loaded official game:',JSON.stringify(before));
    await page.evaluate(async()=>{
      const K=System.get('chunks:///_virtual/KeyListener.ts').KeyListener;
      await K.goToLevel(['tutorial1'],[],false,false);
    });
    await page.waitForFunction(()=>window.PvzDirectTouch.state().ready,{timeout:120000});
    await page.waitForTimeout(2000);
    await page.screenshot({path:path.join(output,'02-tutorial.png')});
    const info=await page.evaluate(()=>{
      const cc=System.get('cc');
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
      const card=U.cards.CFs.findIndex(cf=>cf.ca.getSelectable());
      if(card<0)throw Error('No selectable tutorial plant');
      const cardPoint=css(U.cards.CFs[card].node.worldPosition);
      const cell=S.getLnC(2,0);
      const world=cell.node.worldPosition;
      // Mouse.position adds camera/UI offset to Mouse.positionOrg.
      const delta={x:M.position.x-M.positionOrg.x,y:M.position.y-M.positionOrg.y};
      const cellPoint=css({x:world.x-delta.x,y:world.y-delta.y});
      window.__touchSmoke={U,S,cell,card,cardPoint,cellPoint,before:cell.getAllPlants().length};
      return {card,cardPoint,cellPoint,selectable:U.cards.CFs[card].ca.getSelectable(),state:PvzDirectTouch.state()};
    });
    console.log('Touch targets:',JSON.stringify(info));
    await page.touchscreen.tap(info.cardPoint.x,info.cardPoint.y);
    const selected=await page.evaluate(()=>PvzDirectTouch.state());
    if(selected.selected!==info.card)throw Error('Touch did not directly select card: '+JSON.stringify(selected));
    await page.touchscreen.tap(info.cellPoint.x,info.cellPoint.y);
    await page.waitForFunction(()=>{
      const t=window.__touchSmoke;return t.cell.getAllPlants().length>t.before;
    },{},{timeout:10000});
    const after=await page.evaluate(()=>({state:PvzDirectTouch.state(),plants:window.__touchSmoke.cell.getAllPlants().length}));
    await page.screenshot({path:path.join(output,'03-single-tap-planted.png')});
    fs.writeFileSync(path.join(output,'state.json'),JSON.stringify({before,info,selected,after},null,2));
    console.log('PASS: first lawn tap planted using real game API',JSON.stringify(after));
  } catch(e) {
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    const diagnostic=await page.evaluate(()=>({state:window.PvzDirectTouch?.state(),
      scene:window.System?.get('cc')?.director.getScene()?.name,
      nodes:(()=>{const cc=window.System?.get('cc');const scene=cc?.director.getScene();return scene?.children.map(n=>({name:n.name,active:n.activeInHierarchy}));})()})).catch(()=>({}));
    fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),diagnostic},null,2));
    process.exitCode=1;console.error(e);
  } finally {
    fs.writeFileSync(path.join(output,'console.json'),JSON.stringify(logs,null,2));
    await browser.close();server.close();
  }
})().catch(e=>{console.error(e);process.exit(1);});
