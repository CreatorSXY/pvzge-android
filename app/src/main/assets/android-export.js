// Capture Blob objects before the game immediately revokes their download URLs.
(function () {
    'use strict';
    var bridge = window.GardendlessBridge;
    if (!bridge || typeof bridge.exportData !== 'function' || window.PvzExport) return;
    var blobs = new Map();
    var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    if (create) URL.createObjectURL = function (blob) {
        var url = create.apply(this, arguments); blobs.set(url, blob); return url;
    };
    if (revoke) URL.revokeObjectURL = function (url) {
        blobs.delete(url); return revoke.apply(this, arguments);
    };
    function error() { try { bridge.exportError(); } catch (_) {} }
    function send(url, name) {
        if (url.indexOf('data:') === 0) { bridge.exportData(url, name || 'gardendless.json'); return true; }
        if (url.indexOf('blob:') !== 0) return false;
        // Keep a strong reference: revokeObjectURL after anchor.click() is normal game behavior.
        var blob = blobs.get(url);
        if (!blob || blob.size > 16 * 1024 * 1024) { error(); return true; }
        var reader = new FileReader();
        reader.onload = function () { bridge.exportData(String(reader.result), name || 'gardendless.json'); };
        reader.onerror = error;
        reader.readAsDataURL(blob);
        return true;
    }
    var click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.download && send(this.href || this.getAttribute('href') || '', this.download)) return;
        return click.apply(this, arguments);
    };
    document.addEventListener('click', function (event) {
        var anchor = event.target && event.target.closest ? event.target.closest('a[download]') : null;
        if (anchor && send(anchor.href || anchor.getAttribute('href') || '', anchor.getAttribute('download'))) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    }, true);
    window.PvzExport = { installed: true };
})();
