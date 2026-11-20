// Stop packaging if an upstream game update removes the APIs used by direct touch.
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const required = {
  'UI.ts': ['UIInGame', 'tryChangingIndex', 'currentCF', 'indexLocked', 'willCostSun'],
  'Mouse.ts': ['Mouse', 'positionOrg', 'judgeInUITransform', 'mouseInLnC'],
  'Square.ts': ['Square', 'judgeLIndex', 'judgeCIndex', 'getLnC'],
  'LnC.ts': ['PlaceUIPlant', 'spawnPlantCost', 'putPlantAvailable', 'isInLawn'],
  'levelController.ts': ['LevelPlay', 'lastStandPrepareStarted'],
  'SunCount.ts': ['SunCount', 'CurrentValue'],
  'CharacterManager.ts': ['Rectangle', 'LineSegment', 'createRectangleNodeCenter', 'createLineLenDir'],
  'NodePools.ts': ['destroyNodeArrayPooly'],
  'dropping.ts': ['dropping', 'characterUpdate', 'characterOnDisable', 'collectable_after', 'mouseListen']
};
const starts = [...source.matchAll(/System\.register\("chunks:\/\/\/_virtual\/([^"/]+)"/g)];
for (const [name, symbols] of Object.entries(required)) {
  const i = starts.findIndex(m => m[1] === name);
  if (i < 0) throw Error('Missing module: ' + name);
  const code = source.slice(starts[i].index, starts[i + 1]?.index);
  for (const symbol of symbols) if (!code.includes(symbol)) throw Error('Changed game API: ' + name + ':' + symbol);
}
console.log('Direct-touch game API contract present');
