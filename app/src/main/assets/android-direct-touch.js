// Game-level touch actions for the official Cocos build. GPL-3.0.
(function () {
    'use strict';
    if (window.PvzDirectTouch) return;
    var engine = null;
    var refs = {};
    var held = new Set(), foreground = null, armed = null, armedTool = null, contacts = new Map(), drops = new Set();
    var freeUses = new WeakMap();
    var mice = new Map(), mouseForeground = null;
    var selectionFields = ['index', 'currentCF', 'currentFreeCF', 'currentDroppedPlantCard',
        'willCostSun', 'currentPlantStartingHeight'];
    var exportsByModule = {
        'chunks:///_virtual/UI.ts': ['UIInGame'],
        'chunks:///_virtual/Mouse.ts': ['Mouse'],
        'chunks:///_virtual/Square.ts': ['Square'],
        'chunks:///_virtual/levelController.ts': ['LevelPlay'],
        'chunks:///_virtual/SunCount.ts': ['SunCount'],
        'chunks:///_virtual/CharacterManager.ts': ['Rectangle', 'LineSegment'],
        'chunks:///_virtual/NodePools.ts': ['destroyNodeArrayPooly', 'destroyPooly'],
        'chunks:///_virtual/Conveyor.ts': ['Conveyor'],
        'chunks:///_virtual/dropping.ts': ['dropping']
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
        // Teleporting the shared display cursor between fingers is not a swept path.
        var component = ui.mouse && ui.mouse.getComponent && ui.mouse.getComponent(refs.Mouse);
        if (component) component.oldMousePos = new engine.Vec2(point.x, point.y);
        if (refs.LineSegment) M.moveLine = line(point, point);
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
        function hit(card) {
            var node = card && card.node;
            if (!node || !node.activeInHierarchy) return false;
            var transform = node.getComponent(engine.UITransform);
            return transform && refs.Mouse.judgeInUITransform(transform);
        }
        var cards = ui.cards && ui.cards.CFs || [];
        for (var i = 0; i < cards.length && i < 8; i++) {
            if (hit(cards[i])) return { index: i, card: cards[i] };
        }
        var dropped = ui.DroppedCards || [];
        for (var d = dropped.length - 1; d >= 0; d--) {
            if (hit(dropped[d].cf)) return { index: 8, card: dropped[d].cf, dropped: dropped[d] };
        }
        var conveyor = refs.Conveyor && refs.Conveyor.component;
        if (conveyor && conveyor.node.activeInHierarchy) {
            var free = conveyor.getCards();
            for (var f = free.length - 1; f >= 0; f--) {
                if (hit(free[f])) return { index: 8, card: free[f], conveyor: conveyor };
            }
        }
        return hit(ui.currentFreeCF) ? { index: 8, card: ui.currentFreeCF } : null;
    }
    function snapshot(ui) {
        var value = {};
        selectionFields.forEach(function (key) { value[key] = ui[key]; });
        return value;
    }
    function apply(ui, value) { selectionFields.forEach(function (key) { ui[key] = value[key]; }); }
    function valid(token) {
        return !!(token && !token.cancelled && usable(token.ui) && refs.UIInGame.component === token.ui &&
            refs.LevelPlay.component === token.level && token.card && token.card.node.activeInHierarchy &&
            (token.index === 8 ? token.freeUse === (freeUses.get(token.card) || 0) : token.ui.cards.CFs[token.index] === token.card));
    }
    function tokenFor(ui, value, p, fromCard, id) {
        return { ui: ui, level: refs.LevelPlay.component, selection: value, index: value.index,
            card: value.currentCF, last: p, fromCard: fromCard, id: id, cancelled: false,
            freeUse: value.currentCF ? freeUses.get(value.currentCF) || 0 : 0 };
    }
    function activate(token, visual) {
        var ui = token.ui, changed = ui.currentCF !== token.card || ui.index !== token.index;
        apply(ui, token.selection);
        // Prices and cooldowns can change while another finger spends resources.
        if (typeof token.card.SUNCOST === 'number') ui.willCostSun = token.card.SUNCOST;
        if (visual && changed && ui.plantInHand) {
            if (refs.destroyNodeArrayPooly) refs.destroyNodeArrayPooly(ui.plantInHandLayer.children);
            ui.plantInHand(token.card);
            if (ui.cardSelect) ui.cardSelect();
        }
        locate(ui, token.last);
    }
    function restore(ui) {
        var next = valid(foreground) && held.has(foreground) ? foreground : null;
        held.forEach(function (token) { if (!next && valid(token)) next = token; });
        if (!next && valid(armed)) next = armed;
        foreground = next && held.has(next) ? next : null;
        if (next) activate(next, true);
        else if (usable(ui)) {
            if (restoreMouse(ui)) return;
            if (selected(ui)) ui.tryChangingIndex(-1);
            if (armedTool && armedTool.ui === ui) { apply(ui, armedTool.selection); locate(ui, armedTool.last); }
        }
    }
    function restoreMouse(ui) {
        var next = mouseForeground && mice.get(mouseForeground.id) === mouseForeground && mouseForeground.ui === ui ? mouseForeground : null;
        mice.forEach(function (token) { if (!next && token.ui === ui && token.last) next = token; });
        if (!next || !next.last) return false;
        mouseForeground = next;
        apply(ui, next.selection); ui.mouseDown = next.down; locate(ui, next.last);
        return true;
    }
    function canSpend(token) {
        var ca = token.card.ca, ui = token.ui;
        var upper = ui.cards.cardsUIUpper && ui.cards.cardsUIUpper[token.index];
        var refreshed = upper && typeof upper.cardUpdate === 'function';
        // Refresh original affordability/cooldown logic without advancing game time.
        if (refreshed) upper.cardUpdate(0);
        if (!ca || !ca.getSelectable()) return false;
        var cost = Number(token.card.SUNCOST);
        if (!refreshed && !ca.free && refs.SunCount && Number.isFinite(cost) && refs.SunCount.Value < cost) return false;
        return !(upper && upper.CD > 0);
    }
    function world(p) {
        var M = refs.Mouse, old = M._position, screen = position(p);
        try { M._position = screen; var value = M.position; return new engine.Vec2(value.x, value.y); }
        finally { M._position = old; }
    }
    function line(a, b) {
        var delta = new engine.Vec2(b.x - a.x, b.y - a.y);
        var distance = Math.hypot(delta.x, delta.y);
        return refs.LineSegment.createLineLenDir(a, distance, distance ? delta : new engine.Vec2(1, 0));
    }
    function rectangle(drop) {
        var transform = drop.node.getComponent(engine.UITransform);
        if (!transform) return null;
        var size = transform.width * drop.originalScale * drop.dpScale;
        return refs.Rectangle.createRectangleNodeCenter(drop.node, size, size);
    }
    function pickup(drop, paths) {
        if (!drop.node || !drop.node.activeInHierarchy || !drop.mouseListen || !drop.collectable() || !drop.collectable_after()) return false;
        var rect = rectangle(drop);
        if (rect && paths.some(function (p) { return rect.judgeInRecP(p.current) ||
            (refs.LineSegment && (p.segments || []).some(function (segment) {
                return rect.judgeCrossLine(line(segment[0], segment[1]));
            })); })) {
            drop.collect(); return true;
        }
        return false;
    }
    function collectAt(p) {
        if (!refs.Rectangle || !refs.Mouse) return false;
        var current = world(p), hit = false;
        drops.forEach(function (drop) { if (pickup(drop, [{ current: current, previous: current }])) hit = true; });
        return hit;
    }
    function installDrops(Type) {
        if (!Type || Type.prototype.__pvzMultiTouch) return;
        var original = Type.prototype.characterUpdate;
        var disable = Type.prototype.characterOnDisable;
        Type.prototype.characterUpdate = function () {
            drops.add(this);
            var paths = Array.from(contacts.values()), M = refs.Mouse;
            if (!paths.length || !M || !usable(refs.UIInGame && refs.UIInGame.component)) return original.apply(this, arguments);
            var old = M._position, oldLine = M.moveLine;
            try {
                // The original collector sees one real finger, never a line between two fingers.
                M._position = paths[0].screen;
                M.moveLine = refs.LineSegment ? line(paths[0].current, paths[0].current) : oldLine;
                var result = original.apply(this, arguments);
                if (refs.Rectangle) pickup(this, paths);
                return result;
            } finally { M._position = old; M.moveLine = oldLine; }
        };
        Type.prototype.characterOnDisable = function () {
            drops.delete(this); return disable && disable.apply(this, arguments);
        };
        Type.prototype.__pvzMultiTouch = true;
    }
    function installPreview(Type) {
        if (!Type || !Type.prototype || Type.prototype.__pvzPreviewInstalled) return;
        var original = Type.prototype.plantInHand;
        if (typeof original !== 'function') return;
        function clean(ui, destroyLoose) {
            var loose = destroyLoose && ui.plantReady && !ui.plantReady.parent ? ui.plantReady : null;
            if (refs.destroyNodeArrayPooly) refs.destroyNodeArrayPooly(ui.plantInHandLayer.children);
            if (loose && refs.destroyPooly) refs.destroyPooly(loose);
            ui.plantReady = null;
        }
        Type.prototype.plantInHand = function (card, preview) {
            var ui = this;
            var queue = ui.__pvzPreviewQueue || (ui.__pvzPreviewQueue = { version: 0, pending: false, desired: null });
            queue.version++; queue.desired = preview === false ? null : card;
            clean(ui);
            function start() {
                var version = queue.version, desired = queue.desired;
                queue.pending = true;
                return Promise.resolve(original.call(ui, desired, true)).then(function (value) {
                    queue.pending = false;
                    if (queue.version !== version) {
                        clean(ui, true);
                        if (queue.desired && ui.currentCF === queue.desired) return start();
                    }
                    return value;
                }, function (error) { queue.pending = false; throw error; });
            }
            if (!card || preview === false || queue.pending) {
                var result = original.call(ui, card, false);
                if (card) {
                    ui.willCostSun = card.SUNCOST;
                    ui.currentPlantStartingHeight = Number(card.Prop && card.Prop.StartingHeight) || 0;
                }
                return result;
            }
            return start();
        };
        Type.prototype.__pvzPreviewInstalled = true;
    }
    var api = {
        installEngine: function (cc) {
            engine = cc;
            if (cc.director && cc.Director) cc.director.on(cc.Director.EVENT_BEFORE_UPDATE, function () {
                held.forEach(function (token) { if (!valid(token)) { token.cancelled = true; held.delete(token); } });
            });
            if (cc.director && cc.Director) cc.director.on(cc.Director.EVENT_AFTER_UPDATE, function () {
                contacts.forEach(function (path) { path.segments = []; });
            });
        },
        captureModules: function (system) {
            if (!system || system.__pvzDirectTouchCapture) return;
            var register = system.register;
            system.register = function (name, deps, declare) {
                var expected = exportsByModule[name];
                if (!expected) return register.apply(this, arguments);
                return register.call(this, name, deps, function (publish, context) {
                    return declare.call(this, function (key, value) {
                        var result = publish.apply(this, arguments);
                        expected.forEach(function (symbol) {
                            if (key === symbol) refs[symbol] = value;
                            else if (key && typeof key === 'object' && key[symbol]) refs[symbol] = key[symbol];
                        });
                        if (refs.dropping) installDrops(refs.dropping);
                        if (refs.UIInGame) installPreview(refs.UIInGame);
                        return result;
                    }, context);
                });
            };
            system.__pvzDirectTouchCapture = true;
        },
        begin: function (p, id) {
            var ui = refs.UIInGame && refs.UIInGame.component;
            if (!usable(ui)) return null;
            if (!held.size && armed && (ui.index !== armed.index || ui.currentCF !== armed.card)) armed = null;
            if (collectAt(p)) return { kind: 'collect', ui: ui, level: refs.LevelPlay.component, cancelled: false };
            var cell = locate(ui, p);
            var hit = cardAt(ui), card = hit && hit.index;
            if (hit) {
                var value;
                var upper = ui.cards.cardsUIUpper && ui.cards.cardsUIUpper[card];
                if (upper && typeof upper.cardUpdate === 'function') upper.cardUpdate(0);
                if (!held.size) {
                    if (hit.dropped) hit.dropped.choose();
                    else if (hit.conveyor) hit.conveyor.chooseCard(hit.card, hit.card.ca);
                    else ui.tryChangingIndex(card);
                    value = snapshot(ui); armed = null; armedTool = null;
                }
                else {
                    value = snapshot(ui); value.index = card;
                    value.currentCF = hit.card;
                    value.currentFreeCF = card === 8 ? hit.card : null;
                    value.currentDroppedPlantCard = hit.dropped || null;
                    value.willCostSun = value.currentCF && value.currentCF.SUNCOST;
                    value.currentPlantStartingHeight = Number(hit.card.Prop && hit.card.Prop.StartingHeight) || 0;
                }
                var token = tokenFor(ui, value, p, true, id);
                if (value.index !== card || !valid(token) || !canSpend(token)) { token.cancelled = true; return token; }
                held.add(token); foreground = token; activate(token, true); return token;
            }
            var choice = valid(armed) ? armed.selection : !held.size && selected(ui) ? snapshot(ui) : null;
            if (cell && choice) {
                var lawn = tokenFor(ui, Object.assign({}, choice), p, false, id);
                lawn.armed = armed;
                held.add(lawn); foreground = lawn; activate(lawn, true); return lawn;
            }
            return null; // Other game controls continue through the existing mouse adapter.
        },
        move: function (token, p) {
            if (token.cancelled) return;
            if (token.kind === 'collect') { if (usable(token.ui) && refs.LevelPlay.component === token.level) collectAt(p); return; }
            if (!valid(token)) { api.cancel(token); return; }
            token.last = p; foreground = token; activate(token, true);
        },
        end: function (token, p, dragged) {
            if (token.cancelled) return false;
            if (token.kind === 'collect') { api.move(token, p); token.cancelled = true; return false; }
            var allowed = valid(token); held.delete(token);
            token.cancelled = true;
            if (!allowed) { restore(token.ui); return false; }
            token.last = p;
            if (token.fromCard && !dragged) {
                armed = tokenFor(token.ui, token.selection, p, false, token.id);
                restore(token.ui); return false;
            }
            var committed = false;
            try {
                if (!canSpend(token)) return false;
                activate(token, false);
                var cell = locate(token.ui, p);
                if (!cell || typeof cell.PlaceUIPlant !== 'function' || !cell.isInLawn() || cell.spawningPromiseCount > 0) return false;
                cell.PlaceUIPlant();
                committed = token.ui.index !== token.index;
                if (committed && token.index === 8) freeUses.set(token.card, token.freeUse + 1);
                if (committed && armed === token.armed) armed = null;
                return committed;
            } finally {
                if (!committed && !armed) armed = tokenFor(token.ui, token.selection, p, false, token.id);
                restore(token.ui);
            }
        },
        cancel: function (token) {
            if (!token) return;
            token.cancelled = true; held.delete(token);
            if (token.ui) restore(token.ui);
        },
        setContacts: function (points) {
            var next = new Map();
            if (engine && refs.Mouse) points.forEach(function (p) {
                var current = world(p), old = contacts.get(p.id);
                var segments = old ? old.segments.slice() : [];
                if (old && (current.x !== old.current.x || current.y !== old.current.y)) segments.push([old.current, current]);
                next.set(p.id, { screen: position(p), current: current, segments: segments });
            });
            contacts = next;
            mice.forEach(function (token, id) { if (!next.has(id)) mice.delete(id); });
            if (refs.Rectangle && usable(refs.UIInGame && refs.UIInGame.component)) {
                var paths = Array.from(contacts.values());
                drops.forEach(function (drop) { pickup(drop, paths); });
            }
        },
        mouseToken: function (id) {
            var ui = refs.UIInGame && refs.UIInGame.component;
            var tool = armedTool && armedTool.ui === ui ? armedTool.selection : null;
            var value = ui && Object.assign({}, tool || snapshot(ui));
            if (value && held.size && !tool) { value.index = -1; value.currentCF = null; value.willCostSun = 0; }
            var token = { id: id, ui: ui, selection: value, down: false, first: true };
            mice.set(id, token); return token;
        },
        mouseAction: function (token, p, fn) {
            if (token) {
                token.last = p;
                if (token.ending) mice.delete(token.id);
                else mouseForeground = token;
            }
            var ui = refs.UIInGame && refs.UIInGame.component;
            if (!token || !usable(ui)) { if (!token || token.ui === ui) fn(); return; }
            if (token.ui !== ui) return;
            var down = ui.mouseDown, cool = ui.MouseClickCoolingDown, listen = ui.MouseListenOffThisTick;
            var immediate = engine.input && engine.input._dispatchImmediately;
            try {
                if (engine.input) engine.input._dispatchImmediately = true;
                apply(ui, token.selection); ui.mouseDown = token.down;
                if (token.first) { ui.MouseClickCoolingDown = 0; ui.MouseListenOffThisTick = false; token.first = false; }
                locate(ui, p); fn(); token.selection = snapshot(ui); token.down = ui.mouseDown;
                if (!held.size) armed = selected(ui) ? tokenFor(ui, token.selection, p, false, token.id) : null;
                if (ui.index < -1) { armedTool = { ui: ui, selection: token.selection, last: p }; armed = null; }
                else if (!held.size) armedTool = null;
            } finally {
                ui.mouseDown = down; ui.MouseClickCoolingDown = cool; ui.MouseListenOffThisTick = listen;
                if (engine.input) engine.input._dispatchImmediately = immediate;
                if (held.size || valid(armed)) restore(ui);
                else if (!restoreMouse(ui)) ui.mouseDown = false;
            }
        },
        state: function () {
            var ui = refs.UIInGame && refs.UIInGame.component;
            return { ready: usable(ui), selected: ui ? ui.index : null,
                row: refs.Mouse ? refs.Mouse.mouseInL : null,
                column: refs.Mouse ? refs.Mouse.mouseInC : null, fingers: held.size, contacts: contacts.size };
        }
    };
    window.PvzDirectTouch = api;
})();
