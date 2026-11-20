// Each physical contact owns a gesture. Never infer identity from TouchList order.
(function () {
    'use strict';
    if (window.PvzInput) return;
    var contacts = new Map();
    var nativeId = 1000000; // Keep routed touches distinct from Cocos' physical-mouse touch 0.
    var slop = 12;
    function point(t) { return { x: t.clientX, y: t.clientY }; }
    function bridge() { return window.PvzDirectTouch; }
    function mouse(g, type, button, buttons) {
        g.canvas.dispatchEvent(new MouseEvent(type, {
            view: window, bubbles: true, cancelable: true,
            clientX: g.last.x, clientY: g.last.y, button: button, buttons: buttons
        }));
    }
    function scoped(g, fn) {
        var api = bridge();
        if (api && api.mouseAction) api.mouseAction(g.mouse, g.last, fn);
        else fn();
    }
    function touch(g, type) {
        if (!g.native) return;
        function asTouch(contact) {
            return new window.Touch({ identifier: contact.nativeId, target: contact.canvas,
                clientX: contact.last.x, clientY: contact.last.y,
                pageX: contact.last.x + (window.scrollX || 0), pageY: contact.last.y + (window.scrollY || 0),
                screenX: contact.last.x, screenY: contact.last.y, force: contact.mouse.ending ? 0 : 1 });
        }
        var active = Array.from(contacts.values()).filter(function (contact) { return contact.native; }).map(asTouch);
        var event = new window.TouchEvent(type, { view: window, bubbles: true, cancelable: true,
            touches: active, targetTouches: active, changedTouches: [asTouch(g)] });
        event.__pvzForwarded = true;
        g.canvas.dispatchEvent(event);
    }
    function sync() {
        var api = bridge();
        if (api && api.setContacts) api.setContacts(Array.from(contacts.values()).map(function (g) {
            return { id: g.id, x: g.last.x, y: g.last.y };
        }));
    }
    function finish(g, cancelled) {
        var api = bridge();
        if (g.direct) {
            if (cancelled) api.cancel(g.direct);
            else api.end(g.direct, g.last, g.moved);
        } else if (g.down) {
            if (g.mouse) g.mouse.ending = true;
            var delivered = false;
            scoped(g, function () {
                delivered = true;
                mouse(g, 'mousemove', 0, 1); mouse(g, 'mouseup', 0, 0);
                touch(g, cancelled ? 'touchcancel' : 'touchend');
                if (!cancelled) mouse(g, 'click', 0, 0);
            });
            // A scene change suppresses stale mouse callbacks, but the engine must
            // still release the routed touch ID rather than exhausting its touch pool.
            if (!delivered && g.native) {
                var cancelTouch = function () { touch(g, 'touchcancel'); };
                if (api && api.nativeAction) api.nativeAction(g.mouse, cancelTouch);
                else cancelTouch();
            }
            g.down = false;
        }
    }
    function handle(e) {
        if (e.__pvzForwarded) return;
        var canvas = document.getElementById('GameCanvas');
        var changed = Array.from(e.changedTouches);
        var owned = changed.filter(function (t) {
            return contacts.has(t.identifier) || (e.type === 'touchstart' && (t.target || e.target) === canvas);
        });
        if (!canvas || !owned.length) return;
        if (owned.length === changed.length && e.target === canvas) {
            e.preventDefault(); e.stopImmediatePropagation();
        }
        owned.forEach(function (t) {
            var id = t.identifier, g = contacts.get(id);
            if (e.type === 'touchstart') {
                if (g) return;
                g = { id: id, canvas: canvas, last: point(t), start: point(t), moved: false, down: false };
                contacts.set(id, g);
                var api = bridge();
                g.direct = api && api.begin(g.last, id);
                if (!g.direct) {
                    g.mouse = api && api.mouseToken ? api.mouseToken(id) : null;
                    g.native = !!(g.mouse && g.mouse.nativeTouch);
                    if (g.native) g.nativeId = nativeId++;
                    scoped(g, function () { mouse(g, 'mousemove', 0, 0); mouse(g, 'mousedown', 0, 1); touch(g, 'touchstart'); });
                    g.down = true;
                }
            } else if (g) {
                g.last = point(t);
                if (Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) > slop) g.moved = true;
                if (e.type === 'touchmove') {
                    if (g.direct) bridge().move(g.direct, g.last);
                    else scoped(g, function () { mouse(g, 'mousemove', 0, 1); touch(g, 'touchmove'); });
                } else {
                    contacts.delete(id);
                    finish(g, e.type === 'touchcancel');
                }
            }
        });
        sync();
    }
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
        document.addEventListener(type, handle, { capture: true, passive: false });
    });
    function cancel() {
        var old = Array.from(contacts.values()); contacts.clear();
        old.forEach(function (g) { finish(g, true); }); sync();
    }
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', function () { if (document.hidden) cancel(); });
    window.PvzInput = { cancel: cancel, state: function () {
        return Array.from(contacts.values()).map(function (g) {
            return { id: g.id, x: g.last.x, y: g.last.y, planting: !!g.direct && g.direct.kind !== 'collect', down: g.down };
        });
    } };
})();
