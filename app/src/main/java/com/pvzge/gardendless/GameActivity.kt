// PvZ2 Gardendless Android Port
// Copyright (C) 2026  Open Source Gardendless Contributors
// Fullscreen and export bridge adapted from Caten Hu, copyright (C) 2026.
// License: GPL-3.0

package com.pvzge.gardendless

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import android.webkit.WebChromeClient.CustomViewCallback
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoader.InternalStoragePathHandler
import com.google.android.material.color.DynamicColors
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import androidx.lifecycle.withResumed
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream

class GameActivity : AppCompatActivity() {

    @Volatile private var performanceMode: PerformanceMode = PerformanceMode.ORIGINAL
    private lateinit var performanceScript: String
    private lateinit var inputScript: String
    private lateinit var directTouchScript: String
    private lateinit var exportScript: String
    private var protectingSave = false
    private var saveProtectionStatus: TextView? = null
    private var saveProtectionContinue: android.widget.Button? = null
    private var performanceDialog: android.app.Dialog? = null
    private var webviewReady = false
    private lateinit var aspectContainer: AspectRatioFrameLayout
    private val prefs by lazy { getSharedPreferences("app_data", MODE_PRIVATE) }
    private val EXPORT_SAVE_RESULT_CODE = 102
    private var pendingExport: ByteArray? = null
    private var exportWriting = false
    @Volatile private var pendingExportName: String? = null
    private var fullscreenCallback: CustomViewCallback? = null

    private companion object {
        const val PREF_FULLSCREEN = "webview_fullscreen"
        const val APP_URL = "https://appassets.androidplatform.net/index.html"
    }

    private lateinit var webView: WebView
    private val FILE_CHOOSER_RESULT_CODE = 101
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var extractionDialog: android.app.Dialog? = null
    private val NOTIFICATION_CHANNEL_ID = "gardendless_extraction"
    private val NOTIFICATION_ID = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        DynamicColors.applyToActivityIfAvailable(this)
        setupFullScreen()
        performanceMode = PerformanceMode.load(this)
        performanceScript = assets.open("android-performance.js").bufferedReader().use { it.readText() }
        inputScript = assets.open("android-input.js").bufferedReader().use { it.readText() }
        directTouchScript = assets.open("android-direct-touch.js").bufferedReader().use { it.readText() }
        exportScript = assets.open("android-export.js").bufferedReader().use { it.readText() }
        createNotificationChannel()

        val savedVersion = prefs.getInt("extracted_version", 0)
        startWithSaveProtection(savedVersion, BuildConfig.VERSION_CODE)
    }

    private fun startWithSaveProtection(savedVersion: Int, currentVersion: Int) {
        if (savedVersion > 0 && prefs.getInt("save_protection_version", 0) != currentVersion) {
            protectingSave = true
            val status = TextView(this).apply {
                text = getString(R.string.save_snapshot_working)
                setPadding(32, 32, 32, 32)
            }
            setContentView(status)
            // No WebView, game page or database is opened until this read-only snapshot verifies.
            lifecycleScope.launch {
                val snapshot = withContext(Dispatchers.IO) {
                    runCatching {
                        val directory = File(filesDir, "save-protection")
                        val previous = prefs.getString("save_snapshot_$currentVersion", null)
                            ?.let { File(directory, it.substringAfterLast('/')) }
                        if (previous != null && previous.isFile &&
                            SaveSnapshot.verify(previous).getProperty("targetVersion") == currentVersion.toString()) previous
                        else SaveSnapshot.create(File(applicationInfo.dataDir), directory, savedVersion, currentVersion)
                    }
                }
                snapshot.onSuccess { file ->
                    prefs.edit().putString("save_snapshot_$currentVersion", file.name).commit()
                    initializeWebView()
                    showSaveProtection(currentVersion)
                }.onFailure {
                    MaterialAlertDialogBuilder(this@GameActivity)
                        .setTitle(R.string.save_protection_title)
                        .setMessage(R.string.save_snapshot_failed)
                        .setPositiveButton(R.string.retry) { _, _ -> startWithSaveProtection(savedVersion, currentVersion) }
                        .setNegativeButton(R.string.close_app) { _, _ -> finish() }
                        .setCancelable(false).show()
                }
            }
        } else {
            initializeWebView()
            if (File(filesDir, "pvzge_web/index.html").isFile) setupWebview()
            else checkAndExtractAssets(currentVersion, prefs)
        }
    }

    private fun initializeWebView() {
        if (!::webView.isInitialized) webView = MouseGameWebView(this)
    }

    private fun showSaveProtection(currentVersion: Int) {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(40, 32, 40, 32)
        }
        val title = TextView(this).apply { text = getString(R.string.save_protection_title); textSize = 24f }
        val status = TextView(this).apply { text = getString(R.string.save_protection_message); setPadding(0, 20, 0, 20) }
        val export = android.widget.Button(this).apply {
            text = getString(R.string.save_export_all)
            tag = "save-protection-export"
            isEnabled = false
            setOnClickListener { exportAllPlayers() }
        }
        val continueButton = android.widget.Button(this).apply {
            text = getString(R.string.save_continue_existing)
            tag = "save-protection-continue"
            isEnabled = false
            setOnClickListener {
                protectingSave = false
                // Keep the installed game's files. This wrapper update does not replace them.
                if (File(filesDir, "pvzge_web/index.html").isFile) setupWebview()
                else checkAndExtractAssets(currentVersion, prefs)
            }
        }
        saveProtectionStatus = status
        saveProtectionContinue = continueButton
        layout.addView(title); layout.addView(status); layout.addView(export); layout.addView(continueButton)
        // An isolated page at the original origin reads storage without executing any game scripts.
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.visibility = View.INVISIBLE
        layout.addView(webView, android.widget.LinearLayout.LayoutParams(1, 1))
        setContentView(layout)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                export.isEnabled = true
            }
        }
        webView.loadDataWithBaseURL(APP_URL, "<html><body></body></html>", "text/html", null, APP_URL)
    }

    private fun exportAllPlayers() {
        if (!::webView.isInitialized || pendingExport != null || exportWriting) return
        val script = """
(function() {
    var module = window.System && System.get('chunks:///_virtual/PlayerProperties.ts');
    var players = module && module.AllPlayerProperties;
    if (players && players.allPlayers && players.allPlayers.length) players.savePP();
    return localStorage.getItem('PvZ2_PlayerProperties');
})();
        """.trimIndent()
        webView.evaluateJavascript(script) { encoded ->
            runCatching {
                val raw = org.json.JSONTokener(encoded).nextValue()
                require(raw is String && raw.length <= 16 * 1024 * 1024)
                val players = org.json.JSONArray(raw)
                require(players.length() > 0)
                val date = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))
                beginExport(raw.toByteArray(Charsets.UTF_8), "gardendless_all_players_$date.json", "application/json")
            }.onFailure {
                Toast.makeText(this, R.string.save_not_found, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun receiveExportData(data: String, name: String) {
        if ((pendingExport != null || exportWriting)) return
        runCatching {
            require(data.length <= 24 * 1024 * 1024 && data.startsWith("data:"))
            val comma = data.indexOf(',')
            require(comma > 0)
            val header = data.substring(5, comma)
            val bytes = if (header.endsWith(";base64", true)) Base64.decode(data.substring(comma + 1), Base64.DEFAULT)
                else Uri.decode(data.substring(comma + 1)).toByteArray(Charsets.UTF_8)
            require(bytes.size <= 16 * 1024 * 1024)
            val type = header.substringBefore(';').ifBlank { "application/octet-stream" }
            beginExport(bytes, name, type)
        }.onFailure {
            Toast.makeText(this, R.string.export_failed, Toast.LENGTH_LONG).show()
        }
    }

    private fun beginExport(bytes: ByteArray, name: String, type: String) {
        if ((pendingExport != null || exportWriting)) return
        val cleanName = name.substringAfterLast('/').substringAfterLast('\\')
            .filter { !it.isISOControl() }.take(150).ifBlank { "gardendless-save.json" }
        pendingExport = bytes
        try {
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                this.type = type
                addCategory(Intent.CATEGORY_OPENABLE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                putExtra(Intent.EXTRA_TITLE, cleanName)
            }, EXPORT_SAVE_RESULT_CODE)
        } catch (failure: Exception) {
            pendingExport = null
            Toast.makeText(this, R.string.export_failed, Toast.LENGTH_LONG).show()
        }
    }

    private fun checkAndExtractAssets(currentVersion: Int, sp: android.content.SharedPreferences) {
        // Get total size for progress tracking
        val zipPath = File(filesDir, "temp_game.zip")
        try {
            assets.open("pvzge_web.zip").use { input ->
                zipPath.outputStream().use { input.copyTo(it) }
            }
        } catch (e: Exception) {
            showExtractionError(currentVersion, sp)
            return
        }

        val zipFile = ZipFile(zipPath)
        val totalEntries = zipFile.entries().toList().size
        val totalSize = zipFile.entries().asSequence().map { it.size }.sum()
        zipFile.close()

        // Build extraction dialog with determinate progress
        val progressLayout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(50, 20, 50, 20)
        }
        val progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
        }
        val progressText = TextView(this).apply {
            text = getString(R.string.unzipping)
            setPadding(0, 10, 0, 0)
        }
        progressLayout.addView(progressBar)
        progressLayout.addView(progressText)

        extractionDialog = MaterialAlertDialogBuilder(this)
            .setTitle(R.string.unzipping)
            .setMessage(getString(R.string.description) + "\nv" + packageManager.getPackageInfo(packageName, 0).versionName)
            .setView(progressLayout)
            .setCancelable(false)
            .create()
        extractionDialog?.show()

        // Atomic extraction: extract to temp dir, swap on success, rollback on failure
        lifecycleScope.launch(Dispatchers.IO) {
            val destNew = File(filesDir, "pvzge_web_new")
            val destCurrent = File(filesDir, "pvzge_web")
            val destBackup = File(filesDir, "pvzge_web_backup")

            try {
                // Clean up stale temp dirs from previous failed attempts
                destNew.deleteRecursively()
                destBackup.deleteRecursively()

                // Extract to temp directory first
                var bytesExtracted = 0L
                ZipInputStream(zipPath.inputStream()).use { zis ->
                    var entry: ZipEntry? = zis.nextEntry
                    while (entry != null) {
                        val file = File(destNew, entry.name)
                        if (entry.isDirectory) {
                            file.mkdirs()
                        } else {
                            file.parentFile?.mkdirs()
                            file.outputStream().use { zis.copyTo(it) }
                            bytesExtracted += entry.size
                        }
                        // Update progress
                        if (totalSize > 0) {
                            val pct = ((bytesExtracted * 100) / totalSize).toInt()
                            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                                withContext(Dispatchers.Main) {
                                    progressBar.progress = pct
                                    progressText.text = getString(R.string.extraction_progress, pct)
                                }
                            }
                        }
                        entry = zis.nextEntry
                    }
                }

                // Atomic swap: backup old → move new into place → delete backup
                if (destCurrent.exists()) {
                    destCurrent.renameTo(destBackup)
                }
                val success = destNew.renameTo(destCurrent)
                if (!success) throw IllegalStateException("Failed to rename extraction directory")
                destBackup.deleteRecursively()

                sp.edit().putInt("extracted_version", currentVersion).apply()
                zipPath.delete()

                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    withContext(Dispatchers.Main) {
                        extractionDialog?.dismiss()
                        extractionDialog = null
                        setupWebview()
                        showExtractionNotification()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                // Rollback: restore backup if it exists
                destNew.deleteRecursively()
                if (destBackup.exists() && !destCurrent.exists()) {
                    destBackup.renameTo(destCurrent)
                }
                zipPath.delete()
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    withContext(Dispatchers.Main) {
                        extractionDialog?.dismiss()
                        extractionDialog = null
                        showExtractionError(currentVersion, sp)
                    }
                }
            }
        }
    }

    private fun showExtractionError(currentVersion: Int, sp: android.content.SharedPreferences) {
        // Error UI with retry
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.hint)
            .setMessage(R.string.extraction_error)
            .setPositiveButton(R.string.retry) { _, _ ->
                checkAndExtractAssets(currentVersion, sp)
            }
            .setNegativeButton(R.string.close_app) { _, _ -> finish() }
            .setCancelable(false)
            .show()
    }

    /**
     * Shows a warning dialog before updating game files. Save data may become
     * incompatible between game versions — same risk as noted in release notes.
     */
    private fun showPreUpdateWarning(currentVersion: Int, sp: android.content.SharedPreferences) {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.update_title)
            .setMessage(R.string.update_warning)
            .setPositiveButton(R.string.update_continue) { _, _ ->
                checkAndExtractAssets(currentVersion, sp)
            }
            .setNegativeButton(R.string.update_later) { _, _ ->
                // Keep using the old version this session
                setupWebview()
            }
            .setCancelable(false)
            .show()
    }

    private fun setupWebview() {
        // Attach the WebView only after any required save snapshot/export has completed.

        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.visibility = View.VISIBLE
        webView.clearHistory()
        aspectContainer = AspectRatioFrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            fullscreen = prefs.getBoolean(PREF_FULLSCREEN, false)
            maxRenderEdge = performanceMode.maxRenderEdge
            addView(webView, android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { gravity = android.view.Gravity.CENTER })
        }
        setContentView(aspectContainer)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler(
                "/",
                InternalStoragePathHandler(this, File(filesDir, "pvzge_web"))
            )
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true // Only user-selected document URIs receive Android read grants.
            mediaPlaybackRequiresUserGesture = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                setAlgorithmicDarkeningAllowed(false)
            }
            safeBrowsingEnabled = false
        }

        // Remote debugging in debug builds
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun setFullscreen(value: Boolean) {
                webView.post { setWebviewFullscreen(value) }
            }

            @JavascriptInterface
            fun setExportName(name: String) {
                pendingExportName = name.substringAfterLast('/').substringAfterLast('\\')
            }

            @JavascriptInterface
            fun exportData(data: String, name: String) {
                if (data.length > 24 * 1024 * 1024) return
                webView.post {
                    if (webView.url?.startsWith("https://appassets.androidplatform.net/") == true) receiveExportData(data, name)
                }
            }

            @JavascriptInterface
            fun exportError() {
                webView.post { Toast.makeText(this@GameActivity, R.string.export_failed, Toast.LENGTH_LONG).show() }
            }
        }, "GardendlessBridge")

        webView.setDownloadListener { url, _, disposition, mime, _ ->
            if (url.startsWith("data:")) {
                val name = pendingExportName ?: suggestFileName(disposition, mime ?: "application/json")
                pendingExportName = null
                receiveExportData(url, name)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("https://appassets.androidplatform.net/")) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                    return true
                } catch (e: Exception) { /* Keep external pages out of the bridged WebView. */ }
                return true
            }

            override fun onReceivedError(
                view: WebView?, request: WebResourceRequest?, error: WebResourceError?
            ) {
                error?.let {
                    android.util.Log.e("Gardendless", "WebView error: ${it.errorCode} ${it.description} for ${request?.url}")
                }
            }

            override fun onReceivedHttpError(
                view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?
            ) {
                android.util.Log.e("Gardendless", "HTTP ${errorResponse?.statusCode} for ${request?.url}")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Show gesture hints on first launch with a short delay
                webView.postDelayed({
                    val sp = getSharedPreferences("app_data", MODE_PRIVATE)
                    if (sp.getInt("extracted_version", 0) == 1) {
                        showGestureHints()
                    }
                }, 3000)
            }

            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? {
                val response = assetLoader.shouldInterceptRequest(request.url) ?: return null
                if (request.url.path == "/application.js") {
                    return injectPerformanceIntoApplication(response)
                }
                if (request.url.path == "/assets/main/index.js") {
                    val source = response.data.bufferedReader().use { it.readText() }
                    val prefix = "window.PvzDirectTouch && window.PvzDirectTouch.captureModules(System);\n"
                    return WebResourceResponse(response.mimeType, response.encoding, (prefix + source).byteInputStream())
                }
                // Install input and engine bridges before the page starts.
                if (request.url.toString() == "https://appassets.androidplatform.net/index.html") {
                    return injectTouchBlockerIntoHtml(response)
                }
                return response
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenCallback != null) {
                    callback.onCustomViewHidden()
                    return
                }
                fullscreenCallback = callback
                setWebviewFullscreen(true)
            }

            override fun onHideCustomView() {
                val callback = fullscreenCallback ?: return
                fullscreenCallback = null
                callback.onCustomViewHidden()
                setWebviewFullscreen(false)
            }

            override fun onConsoleMessage(msg: ConsoleMessage?): Boolean {
                msg?.let {
                    if (BuildConfig.DEBUG || it.messageLevel() == ConsoleMessage.MessageLevel.ERROR ||
                        it.messageLevel() == ConsoleMessage.MessageLevel.WARNING) {
                        android.util.Log.d("Gardendless", "[${it.messageLevel()}] ${it.message()}")
                    }
                }
                return true
            }

            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                this@GameActivity.filePathCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "application/octet-stream", "text/plain"))
                }
                return try {
                    startActivityForResult(intent, FILE_CHOOSER_RESULT_CODE)
                    true
                } catch (e: Exception) {
                    this@GameActivity.filePathCallback = null
                    false
                }
            }
        }

        webviewReady = true
        webView.loadUrl("https://appassets.androidplatform.net/index.html")
        setupBackNavigation()
        // Check for app updates in background (doesn't block game)
        checkForAppUpdate()
    }

    /** Install the canvas touch adapter before the engine attaches listeners. */
    private fun injectTouchBlockerIntoHtml(response: WebResourceResponse): WebResourceResponse {
        val html = response.data.bufferedReader().use { it.readText() }
        val head = Regex("<head(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE).find(html)
        val bridgeTag = "<script>window.PvzTargetFps=" + performanceMode.targetFps + ";" +
            performanceScript + directTouchScript + inputScript + exportScript + gameBridgeHookJs + "</script>"
        val hookedHtml = if (head != null) {
            html.replaceRange(head.range, head.value + bridgeTag)
        } else {
            bridgeTag + html
        }
        val modified = hookedHtml
        return WebResourceResponse(
            response.mimeType,
            response.encoding,
            modified.byteInputStream()
        )
    }
    private fun injectPerformanceIntoApplication(response: WebResourceResponse): WebResourceResponse {
        val source = response.data.bufferedReader().use { it.readText() }
        val marker = Regex("\\bcc\\s*=\\s*engine\\s*;")
        val assignment = marker.find(source)
        val modified = if (assignment != null) {
            source.replaceRange(assignment.range,
                assignment.value + "window.PvzPerformance && window.PvzPerformance.install(engine);" +
                    "window.PvzDirectTouch && window.PvzDirectTouch.installEngine(engine);")
        } else {
            android.util.Log.w("Gardendless", "Performance hook: unrecognized application bootstrap")
            source
        }
        return WebResourceResponse(response.mimeType, response.encoding, modified.byteInputStream())
    }

    private fun showPerformanceSettings() {
        val modes = PerformanceMode.entries
        var selected = modes.indexOf(performanceMode)
        performanceDialog = MaterialAlertDialogBuilder(this)
            .setTitle(R.string.performance_title)
            .setSingleChoiceItems(modes.map { getString(it.label) }.toTypedArray(), selected) { _, index ->
                selected = index
            }
            .setPositiveButton(R.string.performance_apply) { _, _ ->
                performanceMode = modes[selected]
                prefs.edit().putString("performance_mode", performanceMode.name).apply()
                aspectContainer.maxRenderEdge = performanceMode.maxRenderEdge
                webView.evaluateJavascript(
                    "window.PvzPerformance && window.PvzPerformance.setTargetFps(${performanceMode.targetFps});",
                    null
                )
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onPause() {
        if (webviewReady) {
            webView.evaluateJavascript("window.PvzInput && window.PvzInput.cancel();window.PvzPerformance && window.PvzPerformance.setPaused(true);", null)
            webView.onPause()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (webviewReady) {
            webView.onResume()
            webView.evaluateJavascript("window.PvzPerformance && window.PvzPerformance.setPaused(false);", null)
        }
    }

    // Gesture hint overlay for first-time users
    private fun showGestureHints() {
        val js = """
(function() {
    var overlay = document.createElement('div');
    overlay.id = 'gardendless-gesture-hints';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.7);z-index:99999;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;color:white;font-family:sans-serif;' +
        'transition:opacity 0.5s;pointer-events:none;';
    overlay.innerHTML = '<div style="font-size:24px;margin-bottom:30px;">Controls</div>' +
        '<div style="font-size:16px;margin:10px;">&#128070; ' +
            '${getString(R.string.gesture_click)}</div>' +
        '<div style="font-size:16px;margin:10px;">&#9995; ' +
            '${getString(R.string.gesture_scroll)}</div>' +
        '<div style="font-size:16px;margin:10px;">&#128076; ' +
            '${getString(R.string.gesture_rightclick)}</div>';
    document.body.appendChild(overlay);

    function dismiss() {
        overlay.style.opacity = '0';
        setTimeout(function() { overlay.remove(); }, 500);
    }
    setTimeout(dismiss, 8000);
    document.addEventListener('touchstart', function() { dismiss(); }, { once: true });
})();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            FILE_CHOOSER_RESULT_CODE -> {
                val result = data?.data?.takeIf { resultCode == RESULT_OK }?.let { arrayOf(it) }
                filePathCallback?.onReceiveValue(result)
                filePathCallback = null
            }
            EXPORT_SAVE_RESULT_CODE -> {
                val bytes = pendingExport
                pendingExport = null
                val uri = data?.data
                if (resultCode == RESULT_OK && bytes != null && uri != null) {
                    if (uri.authority == "$packageName.documents" || uri.authority == "$packageName.fileprovider") {
                        Toast.makeText(this, R.string.save_choose_external, Toast.LENGTH_LONG).show()
                        return
                    }
                    exportWriting = true
                    lifecycleScope.launch {
                        val ok = withContext(Dispatchers.IO) {
                            runCatching {
                                contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes); it.flush() }
                                    ?: throw java.io.IOException("Cannot open export destination")
                                val expected = SaveSnapshot.sha256(bytes.inputStream())
                                val input = contentResolver.openInputStream(uri)
                                    ?: throw java.io.IOException("Cannot verify exported document")
                                require(expected == SaveSnapshot.sha256(input)) { "Export read-back differs" }
                            }.isSuccess
                        }
                        exportWriting = false
                        if (ok) {
                            prefs.edit().putString("last_verified_save_export", uri.toString()).commit()
                            if (protectingSave) {
                                prefs.edit().putInt("save_protection_version", BuildConfig.VERSION_CODE).commit()
                                saveProtectionStatus?.text = getString(R.string.save_protection_verified)
                                saveProtectionContinue?.isEnabled = true
                            }
                        }
                        Toast.makeText(this@GameActivity,
                            if (ok) R.string.export_done else R.string.export_failed,
                            Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        performanceDialog?.dismiss()
        performanceDialog = null
        updateDialog?.dismiss()
        updateDialog = null
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("GardendlessBridge")
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun suggestFileName(contentDisposition: String?, mimeType: String): String {
        contentDisposition
            ?.let { Regex("""filename\*?=(?:UTF-8''|utf-8'')?"?([^";]+)"?""", RegexOption.IGNORE_CASE).find(it) }
            ?.groupValues?.get(1)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?.let { return it }

        val time = java.time.LocalDateTime.now()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))
        return "gardendless_$time.${mimeToExtension(mimeType)}"
    }

    private fun mimeToExtension(mimeType: String): String = when (val type = mimeType.substringBefore(';').trim()) {
        "application/json" -> "json"
        "text/plain" -> "txt"
        "application/octet-stream" -> "bin"
        else -> type.substringAfter('/').takeIf { it.all(Char::isLetterOrDigit) } ?: "bin"
    }

    private fun mimeFromExtension(fileName: String): String? {
        val ext = fileName.substringAfterLast('.', "")
            .takeIf { it.isNotBlank() && it != fileName } ?: return null
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase())
    }

    private fun setupFullScreen() {
        supportActionBar?.hide()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // FLAG_SECURE disabled by default, configurable via SharedPreferences
        if (getSharedPreferences("app_data", MODE_PRIVATE).getBoolean("flag_secure", false)) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    private val gameBridgeHookJs = """
(function() {
    if (window.__gdHooked) return;
    window.__gdHooked = true;

    var bridge = window.GardendlessBridge;


    // Ignore the initial game startup sync so the saved fullscreen preference survives.
    var bootGuard = true;
    setTimeout(function() { bootGuard = false; }, 6000);

    var setFullscreen = function(v) {
        if (bootGuard && !v) { bootGuard = false; return; }
        bootGuard = false;
        try { bridge.setFullscreen(!!v); } catch (e) { /* Bridge unavailable. */ }
    };

    var setExportName = function(name) {
        if (!name) return;
        try { bridge.setExportName(String(name)); } catch (e) { /* Bridge unavailable. */ }
    };

    var isDataHref = function(el) {
        return (el && el.getAttribute && (el.getAttribute('href') || '').indexOf('data:') === 0);
    };
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        if (this.download && isDataHref(this)) setExportName(this.download);
        return origClick.apply(this, arguments);
    };
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
        if (a && isDataHref(a)) setExportName(a.getAttribute('download'));
    }, true);

    var ep = Element.prototype;
    var req = ep.requestFullscreen || ep.webkitRequestFullscreen || ep.webkitRequestFullScreen;
    if (req) {
        ep.requestFullscreen = function() { setFullscreen(true); return req.apply(this, arguments); };
    }
    var dp = Document.prototype;
    var exit = dp.exitFullscreen || dp.webkitExitFullscreen || dp.webkitCancelFullScreen;
    if (exit) {
        dp.exitFullscreen = function() { setFullscreen(false); return exit.apply(this, arguments); };
    }

    var patchTauri = function() {
        var ti = window.__TAURI_INTERNALS__;
        if (!ti || !ti.invoke || ti.__gdHooked) return false;
        ti.__gdHooked = true;
        var orig = ti.invoke;
        ti.invoke = function(cmd, args) {
            if (cmd === 'plugin:window|set_fullscreen') {
                setFullscreen(!!(args && args.value));
                return Promise.resolve(null);
            }
            if (cmd === 'plugin:dialog|save') {

                var raw = args && (args.defaultPath || (args.options && args.options.defaultPath));
                var name = raw ? String(raw).split(/[\\/]/).pop() : '';
                if (name) {
                    setExportName(name);
                    return Promise.resolve(name);
                }
            }
            return orig.apply(this, arguments);
        };
        return true;
    };

    if (!patchTauri()) {
        var tries = 0;
        var timer = setInterval(function() {
            if (patchTauri() || ++tries > 100) clearInterval(timer);
        }, 50);
    }
})();
    """.trimIndent()

    private fun setWebviewFullscreen(enabled: Boolean) {
        aspectContainer.fullscreen = enabled
        prefs.edit().putBoolean(PREF_FULLSCREEN, enabled).apply()
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    showExitDialog()
                }
            }
        })
    }

    private fun showExitDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.game_menu)
            .setItems(arrayOf(getString(R.string.save_export_all), getString(R.string.performance_title), getString(R.string.yes))) { _, index ->
                when (index) {
                    0 -> exportAllPlayers()
                    1 -> showPerformanceSettings()
                    2 -> finish()
                }
            }
            .setNegativeButton(R.string.no, null)
            .show()
    }

    // Local notification when extraction completes
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notification_channel_extraction),
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "Extraction progress notifications" }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun showExtractionNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            androidx.core.content.ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.POST_NOTIFICATIONS
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(this, GameActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_extraction_done))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, notification)
    }

    private var updateCheckInProgress = false
    private var updateDownloadInProgress = false
    private var updateDialog: android.app.Dialog? = null
    private val updateApk by lazy { File(cacheDir, "updates/update.apk") }
    private val installPermissionLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) {
        if (packageManager.canRequestPackageInstalls()) {
            installDownloadedUpdate()
        } else {
            showUpdateError(getString(R.string.update_permission_required)) { installDownloadedUpdate() }
        }
    }

    private fun checkForAppUpdate() {
        if (updateCheckInProgress || updateDownloadInProgress) return
        val elapsed = System.currentTimeMillis() - prefs.getLong("last_update_check", 0)
        if (elapsed in 0 until 24 * 60 * 60 * 1000L) return
        updateCheckInProgress = true
        lifecycleScope.launch {
            try {
                val release = withContext(Dispatchers.IO) {
                    val conn = java.net.URL(
                        "https://api.github.com/repos/CreatorSXY/pvzge-android/releases/latest"
                    ).openConnection() as java.net.HttpURLConnection
                    try {
                        conn.setRequestProperty("Accept", "application/vnd.github+json")
                        conn.setRequestProperty("User-Agent", "Gardendless-Android")
                        conn.connectTimeout = 10000
                        conn.readTimeout = 10000
                        if (conn.responseCode != 200) throw java.io.IOException("HTTP ${conn.responseCode}")
                        conn.inputStream.bufferedReader().use { org.json.JSONObject(it.readText()) }
                    } finally {
                        conn.disconnect()
                    }
                }
                val version = release.getString("tag_name").removePrefix("v")
                val installed = packageManager.getPackageInfo(packageName, 0).versionName
                if (release.optBoolean("draft") || release.optBoolean("prerelease")) return@launch
                if (!UpdateVersion.isNewer(version, installed)) {
                    prefs.edit().putLong("last_update_check", System.currentTimeMillis()).apply()
                    return@launch
                }
                val assets = release.getJSONArray("assets")
                val apk = (0 until assets.length()).map { assets.getJSONObject(it) }
                    .firstOrNull { it.optString("name") == "app-release.apk" }
                    ?: (0 until assets.length()).map { assets.getJSONObject(it) }
                        .singleOrNull { it.optString("name").endsWith(".apk", true) }
                    ?: return@launch
                val url = apk.getString("browser_download_url")
                require(url.startsWith("https://github.com/CreatorSXY/pvzge-android/releases/download/"))
                val size = apk.getLong("size")
                require(size > 0)
                lifecycle.withResumed {
                    showUpdateDialog(version, release.optString("body").take(1000), url, size)
                }
                prefs.edit().putLong("last_update_check", System.currentTimeMillis()).apply()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                android.util.Log.w("Gardendless", "Update check failed", e)
            } finally {
                updateCheckInProgress = false
            }
        }
    }

    private fun showUpdateDialog(version: String, changelog: String, url: String, size: Long) {
        if (updateDialog?.isShowing == true) return
        updateDialog = MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.update_available, version,
                android.text.format.Formatter.formatFileSize(this, size)))
            .setMessage(changelog.ifBlank { getString(R.string.update_available_message) })
            .setPositiveButton(R.string.update_download) { _, _ -> downloadAndInstallApk(url, size) }
            .setNegativeButton(R.string.update_later, null)
            .show()
    }

    private fun downloadAndInstallApk(url: String, expectedSize: Long) {
        if (updateDownloadInProgress) return
        updateDownloadInProgress = true
        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
        }
        updateDialog = MaterialAlertDialogBuilder(this)
            .setTitle(R.string.update_downloading)
            .setView(progress)
            .setCancelable(false)
            .show()
        lifecycleScope.launch {
            val partial = File(cacheDir, "updates/update.apk.part")
            try {
                withContext(Dispatchers.IO) {
                    partial.parentFile?.mkdirs()
                    val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                    try {
                        conn.connectTimeout = 30000
                        conn.readTimeout = 30000
                        if (conn.responseCode != 200) throw java.io.IOException("HTTP ${conn.responseCode}")
                        var downloaded = 0L
                        var lastPercent = -1
                        conn.inputStream.use { input ->
                            partial.outputStream().use { output ->
                                val buffer = ByteArray(64 * 1024)
                                while (true) {
                                    kotlinx.coroutines.currentCoroutineContext().ensureActive()
                                    val count = input.read(buffer)
                                    if (count == -1) break
                                    downloaded += count
                                    if (downloaded > expectedSize) throw java.io.IOException("Unexpected APK size")
                                    output.write(buffer, 0, count)
                                    val percent = (downloaded * 100 / expectedSize).toInt()
                                    if (percent != lastPercent) {
                                        lastPercent = percent
                                        withContext(Dispatchers.Main) { progress.progress = percent }
                                    }
                                }
                            }
                        }
                        if (downloaded != expectedSize) throw java.io.IOException("Incomplete APK download")
                        validateUpdateApk(partial)
                        if (updateApk.exists() && !updateApk.delete()) throw java.io.IOException("Cannot replace APK")
                        if (!partial.renameTo(updateApk)) throw java.io.IOException("Cannot save APK")
                    } finally {
                        conn.disconnect()
                    }
                }
                updateDialog?.dismiss()
                lifecycle.withResumed { installDownloadedUpdate() }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                android.util.Log.w("Gardendless", "Update download failed", e)
                prefs.edit().remove("last_update_check").apply()
                updateDialog?.dismiss()
                lifecycle.withResumed {
                    showUpdateError(getString(R.string.update_download_failed))
                }
            } finally {
                withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { partial.delete() }
                updateDownloadInProgress = false
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun validateUpdateApk(file: File) {
        val archive = packageManager.getPackageArchiveInfo(file.path, 0)
            ?: throw java.io.IOException("Invalid APK")
        val installed = packageManager.getPackageInfo(packageName, 0)
        val archiveCode = androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(archive)
        val installedCode = androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(installed)
        if (archive.packageName != packageName || archiveCode <= installedCode) {
            throw java.io.IOException("APK is not an upgrade for this application")
        }
    }

    private fun installDownloadedUpdate() {
        try {
            validateUpdateApk(updateApk)
            if (!packageManager.canRequestPackageInstalls()) {
                installPermissionLauncher.launch(Intent(
                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    "package:$packageName".toUri()
                ))
                return
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", updateApk)
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = android.content.ClipData.newRawUri("Update APK", uri)
            })
        } catch (e: Exception) {
            android.util.Log.w("Gardendless", "Cannot install update", e)
            showUpdateError(getString(R.string.update_install_failed))
        }
    }

    private fun showUpdateError(message: String, retry: () -> Unit = {
        prefs.edit().remove("last_update_check").apply()
        checkForAppUpdate()
    }) {
        if (isFinishing || isDestroyed) return
        updateDialog = MaterialAlertDialogBuilder(this)
            .setTitle(R.string.update_error)
            .setMessage(message)
            .setPositiveButton(R.string.retry) { _, _ -> retry() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }
}
