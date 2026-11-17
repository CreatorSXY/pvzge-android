// Copyright (C) 2026 Open Source Gardendless Contributors
// License: GPL-3.0
package com.pvzge.gardendless

import android.content.Context
import android.util.AttributeSet
import android.webkit.WebView

/** Touch-to-mouse conversion lives in android-input.js, in CSS coordinates.
 * Never forward a touch AND inject a mouse event for the same physical input.
 * HTML controls, physical mice and accessibility keep WebView's normal dispatch.
 */
class MouseGameWebView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : WebView(context, attrs)
