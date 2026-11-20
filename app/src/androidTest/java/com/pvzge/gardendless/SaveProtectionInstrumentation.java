package com.pvzge.gardendless;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Framework/Java only: must not depend on the old release's obfuscated Kotlin runtime. */
public class SaveProtectionInstrumentation extends Instrumentation {
    private String phase;
    private static final String ORIGIN = "https://appassets.androidplatform.net/index.html";
    private static final String SAVE = "[{\"name\":\"存档保护测试\",\"fixture\":\"before-upgrade-20004\",\"progress\":42}]";
    private static final String ORIGINAL_GAME = "<html><script>localStorage.clear();window.gameWasExecuted=true;</script></html>";

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        phase = arguments == null ? "" : arguments.getString("phase", "");
        start();
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        int code = Activity.RESULT_OK;
        try {
            if ("seed".equals(phase)) seedOldVersion();
            else if ("verify".equals(phase)) verifyNewVersion();
            else throw new IllegalArgumentException("Unknown phase");
            result.putString("result", "PASS:" + phase);
        } catch (Throwable error) {
            android.util.Log.e("SaveProtectionTest", "FAIL:" + phase, error);
            StringWriter trace = new StringWriter();
            error.printStackTrace(new PrintWriter(trace));
            result.putString("result", "FAIL:" + phase + ":" + trace);
            code = Activity.RESULT_CANCELED;
        }
        finish(code, result);
    }
    private void seedOldVersion() throws Exception {
        require(getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(), 0).versionCode == 20004,
            "Seed requires actual 20004 release");
        File game = gameFile();
        require(game.getParentFile().isDirectory() || game.getParentFile().mkdirs(), "Cannot create fixture folder");
        try (OutputStream out = new FileOutputStream(game)) { out.write(ORIGINAL_GAME.getBytes(StandardCharsets.UTF_8)); }
        preferences().edit().putInt("extracted_version", 20004).commit();
        CountDownLatch done = new CountDownLatch(1);
        WebView[] view = new WebView[1];
        String[] result = new String[1];
        runOnMainSync(() -> {
            view[0] = new WebView(getTargetContext());
            view[0].getSettings().setJavaScriptEnabled(true);
            view[0].getSettings().setDomStorageEnabled(true);
            view[0].setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView v, String url) {
                    v.evaluateJavascript("localStorage.setItem('PvZ2_PlayerProperties'," + JSONObject.quote(SAVE) +
                        ");localStorage.getItem('PvZ2_PlayerProperties');", encoded -> { result[0] = encoded; done.countDown(); });
                }
            });
            view[0].loadDataWithBaseURL(ORIGIN, "<html><body>seed</body></html>", "text/html", null, ORIGIN);
        });
        require(done.await(30, TimeUnit.SECONDS), "Old WebView storage did not initialize");
        require(SAVE.equals(new JSONTokener(result[0]).nextValue()), "Old save was not written");
        Thread.sleep(3000);
        runOnMainSync(() -> view[0].destroy());
        Thread.sleep(1000);
    }
    private void verifyNewVersion() throws Exception {
        Context context = getTargetContext();
        int version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionCode;
        require(version > 20004, "Expected signed upgrade");
        Activity activity = startActivitySync(new Intent().setClassName(context.getPackageName(),
            "com.pvzge.gardendless.GameActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Button[] export = new Button[1];
        waitUntil(45000, () -> {
            runOnMainSync(() -> export[0] = activity.getWindow().getDecorView().findViewWithTag("save-protection-export"));
            return export[0] != null && export[0].isEnabled();
        });
        SharedPreferences prefs = preferences();
        String name = prefs.getString("save_snapshot_" + version, null);
        require(name != null, "No pre-WebView snapshot");
        File snapshot = new File(context.getFilesDir(), "save-protection/" + name);
        require(snapshot.isFile(), "Snapshot missing");
        Class<?> snapshotClass = Class.forName("com.pvzge.gardendless.SaveSnapshot", true, context.getClassLoader());
        snapshotClass.getMethod("verify", File.class).invoke(null, snapshot);
        require(ORIGINAL_GAME.equals(read(new FileInputStream(gameFile()))), "Game resources replaced before backup");
        Button[] proceed = new Button[1];
        runOnMainSync(() -> proceed[0] = activity.getWindow().getDecorView().findViewWithTag("save-protection-continue"));
        require(proceed[0] != null && !proceed[0].isEnabled(), "Game allowed before verified external backup");
        runOnMainSync(() -> export[0].performClick());
        waitUntil(20000, () -> clickSave(getUiAutomation().getRootInActiveWindow()));
        waitUntil(20000, () -> prefs.getString("last_verified_save_export", null) != null);
        Uri uri = Uri.parse(prefs.getString("last_verified_save_export", null));
        require(SAVE.equals(read(context.getContentResolver().openInputStream(uri))), "Export differs from pre-upgrade save");
        require(prefs.getInt("save_protection_version", 0) == version, "Backup not acknowledged");
        runOnMainSync(() -> proceed[0] = activity.getWindow().getDecorView().findViewWithTag("save-protection-continue"));
        require(proceed[0].isEnabled(), "Continue not enabled after verified export");
        require(ORIGINAL_GAME.equals(read(new FileInputStream(gameFile()))), "Existing game resources changed");
        android.util.Log.i("SaveProtectionTest", "Verified old save survived signed update, snapshot verified, native JSON export round-tripped, original game files unchanged");
        runOnMainSync(activity::finish);
    }
    private File gameFile() { return new File(getTargetContext().getFilesDir(), "pvzge_web/index.html"); }
    private SharedPreferences preferences() { return getTargetContext().getSharedPreferences("app_data", Context.MODE_PRIVATE); }
    private static String read(InputStream stream) throws IOException {
        if (stream == null) throw new IOException("Missing input");
        try (InputStream input = stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int length;
            while ((length = input.read(buffer)) != -1) bytes.write(buffer, 0, length);
            return bytes.toString("UTF-8");
        }
    }
    private boolean clickSave(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isEnabled() && node.isClickable() && node.getText() != null && "Save".equalsIgnoreCase(node.getText().toString()))
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        for (int i = 0; i < node.getChildCount(); i++) if (clickSave(node.getChild(i))) return true;
        return false;
    }
    private interface Condition { boolean isTrue() throws Exception; }
    private static void waitUntil(long timeout, Condition condition) throws Exception {
        long until = System.currentTimeMillis() + timeout;
        while (System.currentTimeMillis() < until) {
            if (condition.isTrue()) return;
            Thread.sleep(200);
        }
        throw new AssertionError("Timed out waiting for save protection UI");
    }
    private static void require(boolean value, String message) { if (!value) throw new AssertionError(message); }
}
