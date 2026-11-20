# Add project specific ProGuard rules here.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep WebView JS interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Stable snapshot verifier for recovery tools and signed upgrade instrumentation.
-keep class com.pvzge.gardendless.SaveSnapshot { *; }
