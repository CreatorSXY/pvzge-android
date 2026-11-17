// Game-level touch actions for the official Cocos build. GPL-3.0.
(function () {
    'use strict';
    if (window.PvzDirectTouch) return;
    var engine = null;
    var refs = {};
    var exportsByModule = {
        'chunks:///_virtual/UI.ts': 'UIInGame',
        'chunks:///_virtual/Mouse.ts': 'Mouse',
        'chunks:///_virtual/Square.ts': 'Square',
        'chunks:///_virtual/levelController.ts': 'LevelPlay'
    };
    function usable(ui) {
        var level = refs.LevelPlay && refs.LevelPlay.component;
        return !!(engine && refs.Mouse && refs.Square && refs.Square.component && ui &&
            ui.node && ui.node.activeInHierarchy && level && level.node && level.node.activeInHierarchy &&
            (ui.gameStarted || level.lastStandPrepareStarted) && !ui.paused && !ui.indexLocked &&
            !ui.uiHidden && !level.gameLost && !level.gameOver && !level.gameWon);
    }
    function selected(ui) { return ui.index >= 0 && ui.index <= 8 && !!ui.currentCF; }
    function position(p) {
        var canvas = document.getElementById('GameCanvas');
        var screen = engine.view.convertToLocationInView(p.x, p.y, canvas.getBoundingClientRect(), new engine.Vec2());
        // Cocos converts screen pixels to its design/UI coordinates, including viewport scaling.
        return new engine.Touch(screen.x, screen.y, 0).getUILocation();
    }
    function locate(ui, p) {
        var M = refs.Mouse, S = refs.Square;
        var point = position(p);
        M._position = new engine.Vec2(point.x, point.y);
        if (ui.mouse) ui.mouse.worldPosition = new engine.Vec3(point.x, point.y, 0);
        if (ui.plantInHandLayer) ui.plantInHandLayer.worldPosition = new engine.Vec3(point.x, point.y, 0);
        var world = M.position;
        var row = S.judgeLIndex(world.y), column = S.judgeCIndex(world.x);
        var candidate = S.getLnC(row, column);
        var cell = candidate && candidate.isInLawn() ? candidate : null;
        M.mouseInL = row;
        M.mouseInC = column;
        if (M.mouseInLnC !== cell) {
            if (M.mouseInLnC) M.mouseInLnC.onMouseLeave();
            M.mouseInLnC = cell;
            if (cell) cell.onMouseEnter();
        }
        return cell;
    }
    function cardAt(ui) {
        var cards = ui.cards && ui.cards.CFs || [];
        for (var i = 0; i < cards.length && i < 8; i++) {
            var node = cards[i] && cards[i].node;
            if (!node || !node.activeInHierarchy) continue;
            var transform = node.getComponent(engine.UITransform);
            if (transform && refs.Mouse.judgeInUITransform(transform)) return i;
        }
        var free = ui.currentFreeCF && ui.currentFreeCF.node;
        if (free && free.activeInHierarchy) {
            var freeTransform = free.getComponent(engine.UITransform);
            if (freeTransform && refs.Mouse.judgeInUITransform(freeTransform)) return 8;
        }
        return -1;
    }
    function sameSelection(token) {
        return usable(token.ui) && refs.UIInGame.component === token.ui &&
            token.ui.index === token.index && token.ui.currentCF === token.card;
    }
    var api = {
        installEngine: function (cc) { engine = cc; },
        captureModules: function (system) {
            if (!system || system.__pvzDirectTouchCapture) return;
            var register = system.register;
            system.register = function (name, deps, declare) {
                var expected = exportsByModule[name];
                if (!expected) return register.apply(this, arguments);
                return register.call(this, name, deps, function (publish, context) {
                    return declare.call(this, function (key, value) {
                        var result = publish.apply(this, arguments);
                        if (key === expected) refs[expected] = value;
                        else if (key && typeof key === 'object' && key[expected]) refs[expected] = key[expected];
                        return result;
                    }, context);
                });
            };
            system.__pvzDirectTouchCapture = true;
        },
        begin: function (p) {
            var ui = refs.UIInGame && refs.UIInGame.component;
            if (!usable(ui)) return null;
            var cell = locate(ui, p);
            var card = cardAt(ui);
            if (card >= 0) {
                ui.tryChangingIndex(card);
                return { ui: ui, fromCard: true, index: ui.index, card: ui.currentCF,
                    cancelled: false };
            }
            if (cell && selected(ui)) {
                return { ui: ui, fromCard: false, index: ui.index, card: ui.currentCF,
                    cancelled: false };
            }
            return null; // Other game controls continue through the existing mouse adapter.
        },
        move: function (token, p) {
            if (token.cancelled || !sameSelection(token)) return;
            locate(token.ui, p);
        },
        end: function (token, p, dragged) {
            if (token.cancelled) return false;
            token.cancelled = true; // Exactly one commit, even if end is delivered twice.
            if (!sameSelection(token) || !selected(token.ui) || (token.fromCard && !dragged)) return false;
            var cell = locate(token.ui, p);
            if (!cell || typeof cell.PlaceUIPlant !== 'function' || !cell.isInLawn()) return false;
            var ca = token.card && token.card.ca;
            if (!ca || !ca.getSelectable()) return false;
            cell.PlaceUIPlant(); // Original sun cost, cooldown, terrain and occupancy checks.
            return true;
        },
        cancel: function (token) { if (token) token.cancelled = true; },
        state: function () {
            var ui = refs.UIInGame && refs.UIInGame.component;
            return { ready: usable(ui), selected: ui ? ui.index : null,
                row: refs.Mouse ? refs.Mouse.mouseInL : null,
                column: refs.Mouse ? refs.Mouse.mouseInC : null };
        }
    };
    window.PvzDirectTouch = api;
})();
