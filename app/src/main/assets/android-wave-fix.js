// Compatibility with retained older game resources. GPL-3.0.
(function () {
    'use strict';
    if (window.PvzWaveFix) return;
    var engine, controller, objects, Range;
    var legacy = null, applied = false;
    function install() {
        if (applied || legacy !== true || !engine || !controller || !objects || !Range) return;
        var original = controller.prototype.judgeWaveCount;
        if (typeof original !== 'function') return;
        // Matches the upstream Promise.all implementation. In the old implementation,
        // a manually counted Promise never resolves when an RTID matches zero objects
        // (e.g. pirate1's intentionally disabled //Wave1Event).
        controller.prototype.judgeWaveCount = async function () {
            var wave = this.waveManagerProps.Waves[this.currentWave];
            if (!Array.isArray(wave)) return original.apply(this, arguments);
            this.WaveToughness = 0.01;
            this._ZombiesInThisWave = [];
            this.kongfuChiHoleThisWave = [];
            this.MustKillAllThisWave = false;
            var count = this.waveManagerProps.Waves.length;
            var interval = this.waveManagerProps.FlagWaveInterval;
            var total = Math.max(1, Math.floor(count / interval)) * interval;
            var index = this.currentWave;
            this.currentWave++;
            engine.tween(this).to(0.8, { levelProgressPercentage: this.currentWave / total },
                { easing: 'cubicInOut' }).start();
            var level = this;
            this.levelSchedulers.slice().forEach(function (task) {
                while (task.EndingWave < 0) task.EndingWave += count;
                while (task.EndingWave >= count) task.EndingWave -= count;
                if (task.EndingWave === index) {
                    var at = level.levelSchedulers.indexOf(task);
                    if (at >= 0) level.levelSchedulers.splice(at, 1);
                }
            });
            this.NextWaveCountdown = this.isCowboyMinigame ? Infinity : 25 + 5 * Math.random();
            if (this.currentWave % interval === 0) this.NextWaveCountdown += 10;
            await Promise.all(wave.map(async function (reference) {
                await Promise.all(objects.getObjectsByRTID(reference).map(async function (action) {
                    await level.readWave(action);
                    level.addPlantFood(action.objdata);
                }));
            }));
            this.NextWaveZombieHealthPercentage = this.MustKillAllThisWave || this.isCowboyMinigame ? 0 :
                Range.getRandomFromRange(new Range(this.waveManagerProps.MaxNextWaveHealthPercentage,
                    this.waveManagerProps.MinNextWaveHealthPercentage));
            this.WaveZombieDamageCountdown = this.isCowboyMinigame ? 0 : 4 + Math.random();
        };
        applied = true;
    }
    window.PvzWaveFix = {
        installEngine: function (cc) { engine = cc; install(); },
        captureModules: function (system) {
            if (!system || system.__pvzWaveCapture) return;
            var register = system.register;
            system.register = function (name, dependencies, declare) {
                var levelModule = name === 'chunks:///_virtual/levelController.ts';
                if (!levelModule && name !== 'chunks:///_virtual/JSONs.ts' &&
                    name !== 'chunks:///_virtual/ArrayGet.ts') return register.apply(this, arguments);
                if (levelModule) {
                    var source = Function.prototype.toString.call(declare);
                    var start = source.indexOf('.judgeWaveCount=');
                    var end = source.indexOf('.nextWave=', start + 1);
                    var method = start >= 0 && end > start ? source.slice(start, end) : '';
                    // Unknown or already-fixed factories are left intact.
                    legacy = method.includes('Promise.all') ? false :
                        method.includes('new Promise') && method.includes('.forEach(') ? true : null;
                }
                return register.call(this, name, dependencies, function (publish, context) {
                    return declare.call(this, function (key, value) {
                        var result = publish.apply(this, arguments);
                        function capture(symbol, callback) {
                            if (key === symbol) callback(value);
                            else if (key && typeof key === 'object' && key[symbol]) callback(key[symbol]);
                        }
                        if (levelModule) capture('levelController', function (type) { controller = type; });
                        if (name === 'chunks:///_virtual/JSONs.ts') capture('PvZ2Object', function (type) { objects = type; });
                        if (name === 'chunks:///_virtual/ArrayGet.ts') capture('ValueRange', function (type) { Range = type; });
                        install();
                        return result;
                    }, context);
                });
            };
            system.__pvzWaveCapture = true;
        },
        state: function () { return { legacy: legacy, applied: applied }; }
    };
})();
