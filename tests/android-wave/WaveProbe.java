package com.pvzge.waveprobe;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.view.*;
import android.webkit.WebView;
import org.json.*;
import java.io.*;
import java.lang.reflect.Field;
import java.util.concurrent.*;

/** Runs against an existing, signed release APK; never needs app sources or user data. */
public class WaveProbe extends Instrumentation {
    private Activity activity;
    private WebView web;
    private File folder;
    private boolean baseline,legacyResources;
    private static final String LEVEL="System.get('chunks:///_virtual/levelController.ts').LevelPlay.component";
    @Override public void onCreate(Bundle args){super.onCreate(args);baseline=args!=null&&Boolean.parseBoolean(args.getString("baseline","false"));legacyResources=args!=null&&Boolean.parseBoolean(args.getString("legacy_resources","false"));start();}
    @Override public void onStart(){
        Bundle result=new Bundle();int code=Activity.RESULT_OK;
        try{
            folder=new File(getTargetContext().getExternalFilesDir(null),"wave-evidence");folder.mkdirs();
            if(legacyResources) installLegacyFixture();
            runOnMainSync(()->WebView.setWebContentsDebuggingEnabled(true));
            activity=startActivitySync(new Intent().setClassName(getTargetContext().getPackageName(),"com.pvzge.gardendless.GameActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            await(180000,()->{runOnMainSync(()->web=findWeb(activity.getWindow().getDecorView()));return web!=null;});
            if(baseline){runOnMainSync(()->{try{
                for(Field f:activity.getClass().getDeclaredFields())if(f.getType()==String.class){f.setAccessible(true);String s=(String)f.get(activity);if(s!=null&&(s.contains("window.PvzDirectTouch = api")||s.contains("window.PvzInput =")||s.contains("window.PvzPerformance =")))f.set(activity,"");}
                web.stopLoading();web.loadUrl("https://appassets.androidplatform.net/index.html");
            }catch(Exception e){throw new RuntimeException(e);}});}
            await(240000,()->Boolean.TRUE.equals(js("!!(window.System&&System.get('chunks:///_virtual/KeyListener.ts')?.KeyListener?.cp)")));
            js("window.__waveErrors=[];addEventListener('error',e=>__waveErrors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>__waveErrors.push(String(e.reason?.stack||e.reason)));true");
            await(180000,()->Boolean.TRUE.equals(js("System.get(System.resolve('cc')).director.getScene()?.name==='mainScene'")));
            Thread.sleep(15000);
            js("document.querySelectorAll('button').forEach(b=>{if(b.getClientRects().length)b.click()});true");
            await(60000,()->Boolean.TRUE.equals(js("!System.get('chunks:///_virtual/KeyListener.ts').KeyListener.screenColorTweening")));
            js("System.get('chunks:///_virtual/KeyListener.ts').KeyListener.goToLevel(['pirate1'],[],false,false).catch(e=>__waveErrors.push(String(e.stack||e)));true");
            await(120000,()->Boolean.TRUE.equals(js("!!(System.get('chunks:///_virtual/levelController.ts')?.LevelPlay.component?.currentLevelObjects.length)")));
            Thread.sleep(5000);
            // Complete the original narrative through its own end-of-flow handler.
            js("(()=>{const n=System.get('chunks:///_virtual/NPC_Controller.ts').npc_controller;if(n?.HasFlow()){n.CurrentFlowStep=n.CurrentFlow.length;n.RunFlow()}return true})()");
            await(90000,()->Boolean.TRUE.equals(js("(()=>{const U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;return U.cards.maxSlotCount>0&&U.cards.CUs.length>=U.cards.maxSlotCount})()")));
            js("(()=>{const L="+LEVEL+";L.carddeck_displayer.sendCardDeck(L.carddeck_displayer.RecommendedCardDecks[0]);L.letsRock();return true})()");
            await(60000,()->Boolean.TRUE.equals(js(""+LEVEL+".gameStarted")));
            long deadline=System.currentTimeMillis()+120000;int maxWave=0;
            while(System.currentTimeMillis()<deadline){
                JSONObject state=(JSONObject)js("(()=>{const L="+LEVEL+",U=System.get('chunks:///_virtual/UI.ts').UIInGame.component;return {wave:L.currentWave,progress:L.levelProgressPercentage,time:L.gamedTime,next:String(L.NextWaveCountdown),damage:String(L.WaveZombieDamageCountdown),threshold:String(L.NextWaveZombieHealthPercentage),health:L.WaveLeftHealth,zombies:System.get('chunks:///_virtual/CharacterManager.ts').ZombiePool.pool().length,started:L.gameStarted,gaming:L.gaming,paused:U.paused,tutorialStuck:L.Tutorial_Wave_Stuck,errors:__waveErrors,fix:window.PvzWaveFix?.state(),ua:navigator.userAgent,baseline:"+baseline+"}})()");
                append(state.toString());maxWave=Math.max(maxWave,state.getInt("wave"));
                if(maxWave>=3)break;
                Thread.sleep(2500);
            }
            capture("completed");
            if(maxWave<3)throw new AssertionError("Pirate1 did not reach wave 3; inspect state.jsonl and logcat");
            result.putString("result","PASS:wave:"+(baseline?"baseline":"adapter"));
        }catch(Throwable e){capture("failure");StringWriter out=new StringWriter();e.printStackTrace(new PrintWriter(out));result.putString("result","FAIL:wave:"+out);code=Activity.RESULT_CANCELED;}
        finish(code,result);
    }
    private void installLegacyFixture() throws Exception {
        File root=new File(getTargetContext().getFilesDir(),"pvzge_web");root.mkdirs();
        File source=new File(getTargetContext().getExternalFilesDir(null),"legacy.zip");
        try(java.util.zip.ZipInputStream in=new java.util.zip.ZipInputStream(new FileInputStream(source))){
            java.util.zip.ZipEntry entry;byte[] buffer=new byte[65536];
            while((entry=in.getNextEntry())!=null){File file=new File(root,entry.getName());
                if(!file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator))throw new IOException("Bad fixture path");
                if(entry.isDirectory())file.mkdirs();else{file.getParentFile().mkdirs();try(FileOutputStream out=new FileOutputStream(file)){int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}}
            }
        }
        source.delete();
        int version=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0).versionCode;
        getTargetContext().getSharedPreferences("app_data",Context.MODE_PRIVATE).edit().putInt("extracted_version",166).putInt("save_protection_version",version).commit();
    }
    private Object js(String expression)throws Exception{
        CountDownLatch done=new CountDownLatch(1);String[] value=new String[1];
        runOnMainSync(()->web.evaluateJavascript(expression,r->{value[0]=r;done.countDown();}));
        if(!done.await(30,TimeUnit.SECONDS))throw new AssertionError("WebView evaluation timed out");
        return new JSONTokener(value[0]).nextValue();
    }
    private void append(String line)throws Exception{try(FileWriter out=new FileWriter(new File(folder,"state.jsonl"),true)){out.write(line+"\n");}android.util.Log.i("WaveProbe",line);}
    private void capture(String name){try{if(folder!=null)getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(folder,name+".png")));}catch(Exception ignored){}}
    private WebView findWeb(View view){if(view instanceof WebView)return(WebView)view;if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView found=findWeb(group.getChildAt(i));if(found!=null)return found;}}return null;}
    private interface Check{boolean run()throws Exception;}
    private void await(long timeout,Check check)throws Exception{long end=System.currentTimeMillis()+timeout;while(System.currentTimeMillis()<end){if(check.run())return;Thread.sleep(500);}throw new AssertionError("Timed out waiting for game state");}
}
