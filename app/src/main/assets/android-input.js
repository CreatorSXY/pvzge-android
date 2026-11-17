// Canvas-only touch adapter. DOM controls and physical mice keep their native input.
(function () {
    'use strict';
    if (window.PvzInput) return;
    var gesture = null;
    var slop = 12; // CSS pixels; independent of Android density and render profile.
    function point(t) { return { x: t.clientX, y: t.clientY }; }
    function center(t) { return { x: (t[0].clientX + t[1].clientX) / 2,
        y: (t[0].clientY + t[1].clientY) / 2 }; }
    function mouse(type, p, button, buttons) {
        gesture.canvas.dispatchEvent(new MouseEvent(type, {
            view: window, bubbles: true, cancelable: true,
            clientX: p.x, clientY: p.y, button: button, buttons: buttons
        }));
    }
    function move(p, buttons) { mouse('mousemove', p, 0, buttons); }
    function release() {
        if (gesture && gesture.down) {
            mouse('mouseup', gesture.last, 0, 0);
            gesture.down = false;
        }
    }
    function handle(e) {
        if (e.type === 'touchstart' && !gesture) {
            var canvas = document.getElementById('GameCanvas');
            if (!canvas || e.target !== canvas) return;
            gesture = { canvas: canvas, last: point(e.touches[0]), down: false, multi: false, moved: false, start: point(e.touches[0]), direct: null };
        }
        if (!gesture) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === 'touchstart') {
            if (e.touches.length === 1 && !gesture.multi) {
                // Update the engine's cached cursor BEFORE pressing at a new location.
                gesture.direct = window.PvzDirectTouch && window.PvzDirectTouch.begin(gesture.last);
                if (!gesture.direct) {
                    move(gesture.last, 0);
                    mouse('mousedown', gesture.last, 0, 1);
                    gesture.down = true;
                }
            } else if (e.touches.length >= 2) {
                if (gesture.direct) window.PvzDirectTouch.cancel(gesture.direct);
                release();
                gesture.multi = true;
                gesture.last = gesture.origin = center(e.touches);
                if (e.touches.length > 2) gesture.moved = true;
            }
        } else if (e.type === 'touchmove') {
            if (!gesture.multi && e.touches.length === 1) {
                gesture.last = point(e.touches[0]);
                if (Math.hypot(gesture.last.x - gesture.start.x, gesture.last.y - gesture.start.y) > slop) gesture.moved = true;
                if (gesture.direct) window.PvzDirectTouch.move(gesture.direct, gesture.last);
                else move(gesture.last, 1);
            } else if (gesture.multi && e.touches.length === 2) {
                var p = center(e.touches);
                if (gesture.moved || Math.hypot(p.x - gesture.origin.x, p.y - gesture.origin.y) > slop) {
                    gesture.moved = true;
                    move(p, 0);
                    gesture.canvas.dispatchEvent(new WheelEvent('wheel', {
                        view: window, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y,
                        deltaX: (gesture.last.x - p.x) * 2, deltaY: (gesture.last.y - p.y) * 2, deltaMode: 0
                    }));
                    gesture.last = p;
                }
            }
        } else if (e.type === 'touchcancel') {
            if (gesture.direct) window.PvzDirectTouch.cancel(gesture.direct);
            release();
            gesture = null;
        } else if (e.type === 'touchend' && e.touches.length === 0) {
            if (!gesture.multi) {
                if (e.changedTouches.length) gesture.last = point(e.changedTouches[0]);
                if (Math.hypot(gesture.last.x - gesture.start.x, gesture.last.y - gesture.start.y) > slop) gesture.moved = true;
                if (gesture.direct) window.PvzDirectTouch.end(gesture.direct, gesture.last, gesture.moved);
                else {
                    move(gesture.last, gesture.down ? 1 : 0);
                    release();
                    mouse('click', gesture.last, 0, 0);
                }
            } else if (!gesture.moved) {
                move(gesture.last, 0);
                mouse('mousedown', gesture.last, 2, 2);
                mouse('mouseup', gesture.last, 2, 0);
                mouse('contextmenu', gesture.last, 2, 0);
            }
            gesture = null;
        }
    }
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
        document.addEventListener(type, handle, { capture: true, passive: false });
    });
    function cancel() {
        if (gesture && gesture.direct) window.PvzDirectTouch.cancel(gesture.direct);
        release(); gesture = null;
    }
    window.addEventListener('blur', cancel);
    window.PvzInput = { cancel: cancel };
})();
