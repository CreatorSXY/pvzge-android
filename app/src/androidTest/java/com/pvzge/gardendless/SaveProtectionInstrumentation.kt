package com.pvzge.gardendless

import android.app.Activity
import android.app.Instrumentation
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs against the actual old release, then again after adb install -r of the new release. */
class SaveProtectionInstrumentation : Instrumentation() {
    private var phase = ""
    private val origin = "https://appassets.androidplatform.net/index.html"
    private val save = "[{\"name\":\"存档保护测试\",\"fixture\":\"before-upgrade-20004\",\"progress\":42}]"
    private val originalGame = "<html><script>localStorage.clear();window.gameWasExecuted=true;</script></html>"

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        phase = arguments?.getString("phase") ?: ""
        start()
    }

    override fun onStart() {
        try {
            when (phase) {
                "seed" -> seedOldVersion()
                "verify" -> verifyNewVersion()
                else -> error("Unknown test phase")
            }
            finish(Activity.RESULT_OK, Bundle().apply { putString("result", "PASS:$phase") })
        } catch (failure: Throwable) {
            android.util.Log.e("SaveProtectionTest", "FAIL:$phase", failure)
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("result", "FAIL:$phase:${failure.stackTraceToString()}") })
        }
    }

    private fun seedOldVersion() {
        check(targetContext.packageManager.getPackageInfo(targetContext.packageName, 0).versionCode == 20004)
        val game = File(targetContext.filesDir, "pvzge_web/index.html")
        game.parentFile!!.mkdirs()
        game.writeText(originalGame)
        targetContext.getSharedPreferences("app_data", Context.MODE_PRIVATE).edit()
            .putInt("extracted_version", 20004).commit()
        val done = CountDownLatch(1)
        var view: WebView? = null
        var result: String? = null
        runOnMainSync {
            view = WebView(targetContext).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(v: WebView, url: String) {
                        v.evaluateJavascript("localStorage.setItem('PvZ2_PlayerProperties',${JSONObject.quote(save)});localStorage.getItem('PvZ2_PlayerProperties');") {
                            result = it; done.countDown()
                        }
                    }
                }
                loadDataWithBaseURL(origin, "<html><body>seed</body></html>", "text/html", null, origin)
            }
        }
        check(done.await(30, TimeUnit.SECONDS)) { "Old WebView storage did not initialize" }
        check(result == JSONObject.quote(save)) { "Old save was not written" }
        Thread.sleep(3000) // Let WebView commit its real LevelDB/WAL before the process is stopped.
        runOnMainSync { view?.destroy() }
        Thread.sleep(1000)
    }

    private fun verifyNewVersion() {
        val version = targetContext.packageManager.getPackageInfo(targetContext.packageName, 0).versionCode
        check(version > 20004)
        val activity = startActivitySync(Intent().setClassName(targetContext.packageName, "com.pvzge.gardendless.GameActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        var export: Button? = null
        waitUntil(45000) {
            runOnMainSync { export = activity.window.decorView.findViewWithTag("save-protection-export") }
            export?.isEnabled == true
        }
        val preferences = targetContext.getSharedPreferences("app_data", Context.MODE_PRIVATE)
        val name = preferences.getString("save_snapshot_$version", null) ?: error("No pre-WebView snapshot")
        val snapshot = File(targetContext.filesDir, "save-protection/$name")
        check(snapshot.isFile)
        // Reflection keeps this runner usable against the old APK during the seed phase.
        val snapshotClass = Class.forName("com.pvzge.gardendless.SaveSnapshot", true, targetContext.classLoader)
        snapshotClass.getMethod("verify", File::class.java).invoke(null, snapshot)
        check(File(targetContext.filesDir, "pvzge_web/index.html").readText() == originalGame) { "Game resources replaced before backup" }
        var continueButton: Button? = null
        runOnMainSync { continueButton = activity.window.decorView.findViewWithTag("save-protection-continue") }
        check(continueButton?.isEnabled == false) { "Game allowed before verified external backup" }
        runOnMainSync { export!!.performClick() }
        waitUntil(20000) { clickSave(uiAutomation.rootInActiveWindow) }
        waitUntil(20000) { preferences.getString("last_verified_save_export", null) != null }
        val uri = Uri.parse(preferences.getString("last_verified_save_export", null))
        val exported = targetContext.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }
        check(exported == save) { "Exported player data differs from the pre-upgrade save" }
        check(preferences.getInt("save_protection_version", 0) == version)
        runOnMainSync { continueButton = activity.window.decorView.findViewWithTag("save-protection-continue") }
        check(continueButton?.isEnabled == true)
        check(File(targetContext.filesDir, "pvzge_web/index.html").readText() == originalGame)
        // Had the old game page run, its test script would have cleared localStorage and this export would be empty.
        android.util.Log.i("SaveProtectionTest", "Verified old save survived signed update, snapshot verified, native JSON export round-tripped, original game files unchanged")
        runOnMainSync { activity.finish() }
    }

    private fun clickSave(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false
        if (node.isEnabled && node.isClickable && node.text?.toString()?.equals("Save", true) == true) {
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
        for (i in 0 until node.childCount) if (clickSave(node.getChild(i))) return true
        return false
    }

    private fun waitUntil(timeout: Long, predicate: () -> Boolean) {
        val until = System.currentTimeMillis() + timeout
        while (System.currentTimeMillis() < until) {
            if (predicate()) return
            Thread.sleep(200)
        }
        error("Timed out waiting for save protection UI")
    }
}
