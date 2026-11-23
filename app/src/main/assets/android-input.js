// Each physical contact owns a gesture. Never infer identity from TouchList order.
(function () {
    'use strict';
    if (window.PvzInput) return;
    var contacts = new Map();
    var nativeId = 1000000; // Keep routed touches distinct from Cocos' physical-mouse touch 0.
    var slop = 12;
    var pair = null;
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
        if (api && api.setContacts) api.setContacts(Array.from(contacts.values()).filter(function (g) {
            return !pair && !g.pending;
        }).map(function (g) {
            return { id: g.id, x: g.last.x, y: g.last.y };
        }));
    }
    function begin(g) {
        var api = bridge();
        g.direct = api && api.begin(g.last, g.id);
        if (g.direct) return;
        g.mouse = api && api.mouseToken ? api.mouseToken(g.id) : null;
        g.native = !!(g.mouse && g.mouse.nativeTouch);
        if (g.native) g.nativeId = nativeId++;
        scoped(g, function () { mouse(g, 'mousemove', 0, 0); mouse(g, 'mousedown', 0, 1); touch(g, 'touchstart'); });
        g.down = true;
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
    function midpoint(first, second) {
        return { x: (first.last.x + second.last.x) / 2, y: (first.last.y + second.last.y) / 2 };
    }
    function updatePair(type) {
        var api = bridge(), scope = pair.first.pending;
        if (type === 'touchcancel' || !api.specialGestureActive(scope)) pair.cancelled = true;
        if (!pair.cancelled && scope.kind === 'puzzle') {
            if (pair.first.moved || pair.second.moved) pair.cancelled = true;
            if (!pair.cancelled && !contacts.size) {
                var first = pair.first;
                // The first finger targets the slot; the second acts as a modifier.
                first.last = first.start;
                api.nativeAction({ nativeTouch: true }, function () {
                    mouse(first, 'mousemove', 0, 0);
                    mouse(first, 'mousedown', 2, 2);
                    mouse(first, 'mouseup', 2, 0);
                });
            }
        } else if (!pair.cancelled && type === 'touchmove' &&
            contacts.has(pair.first.id) && contacts.has(pair.second.id)) {
            var center = midpoint(pair.first, pair.second);
            var dx = Math.abs(center.x - pair.origin.x), dy = Math.abs(center.y - pair.origin.y);
            if (scope.kind === 'worlds' && !pair.swiped && dx >= 36 && dx > dy) {
                api.swipeSpecial(scope, pair.origin, center);
                pair.swiped = true;
            } else if (scope.kind === 'settings' && (pair.swiped || dy >= slop && dy > dx)) {
                api.swipeSpecial(scope, pair.last, center);
                pair.last = center;
                pair.swiped = true;
            }
        }
        if (!contacts.size) pair = null;
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
                var previous = contacts.size === 1 && contacts.values().next().value;
                g = { id: id, canvas: canvas, last: point(t), start: point(t), moved: false, down: false };
                contacts.set(id, g);
                if (pair) { pair.cancelled = true; return; }
                if (previous && previous.pending) {
                    var origin = midpoint(previous, g);
                    pair = { first: previous, second: g, origin: origin, last: origin, swiped: false, cancelled: false };
                    return;
                }
                var api = bridge();
                // Defer the first press only where a second finger can turn it into a gesture.
                g.pending = contacts.size === 1 && api && api.specialGesture && api.specialGesture(g.start);
                if (!g.pending) begin(g);
            } else if (g) {
                g.last = point(t);
                if (Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) > slop) g.moved = true;
                if (pair) {
                    if (e.type !== 'touchmove') contacts.delete(id);
                    return;
                }
                if (g.pending) {
                    if (e.type === 'touchcancel' || !bridge().specialGestureActive(g.pending)) {
                        contacts.delete(id);
                        return;
                    }
                    if (e.type === 'touchmove' && !g.moved) return;
                    var last = g.last;
                    g.last = g.start;
                    g.pending = null;
                    begin(g);
                    g.last = last;
                }
                if (e.type === 'touchmove') {
                    if (g.direct) bridge().move(g.direct, g.last);
                    else scoped(g, function () { mouse(g, 'mousemove', 0, 1); touch(g, 'touchmove'); });
                } else {
                    contacts.delete(id);
                    finish(g, e.type === 'touchcancel');
                }
            }
        });
        if (pair) updatePair(e.type);
        sync();
    }
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
        document.addEventListener(type, handle, { capture: true, passive: false });
    });
    function cancel() {
        var old = Array.from(contacts.values()); contacts.clear();
        pair = null;
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
