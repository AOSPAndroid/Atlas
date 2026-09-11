const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const {applyFurnitureCorrections} = await import(pathToFileURL(path.join(root, 'atlas/map-furniture.js')));
  const data = JSON.parse(fs.readFileSync(path.join(root, 'atlas/official-data.json'), 'utf8'));
  const before = new Map(data.floors.map(f => [f.level, f.geometry.doorSwings.length]));
  const source = fs.readFileSync(path.join(root, 'atlas/official-app.js'), 'utf8');
  const triangulate = vm.runInNewContext(source.slice(source.indexOf('function triangulate('), source.indexOf('function polygonMesh(')) + '\ntriangulate');
  applyFurnitureCorrections(data);
  const once = JSON.stringify(data);
  applyFurnitureCorrections(data);
  assert.equal(JSON.stringify(data), once, 'Repeated loading must not duplicate tables');
  const exclusions = {2: 0, 3: 1, 4: 1, 5: 0, 6: 1, 7: 2};
  let count = 0;
  for (const floor of data.floors) {
    if (!(floor.level in exclusions)) continue;
    assert.equal(floor.geometry.doorSwings.length, before.get(floor.level) - exclusions[floor.level], 'Keep real door swings');
    for (const points of floor.geometry.curvedTables) {
      const triangles = triangulate(points);
      assert.equal(triangles.length, points.length - 2, `Floor ${floor.level} table must render in 3D`);
      count++;
    }
  }
  const tables = data.floors.find(f => f.level === 3).geometry.curvedTables;
  const containsBounds = (x, y) => tables.some(p => Math.min(...p.map(v => v[0])) < x && Math.max(...p.map(v => v[0])) > x && Math.min(...p.map(v => v[1])) < y && Math.max(...p.map(v => v[1])) > y);
  assert(containsBounds(780, 315), 'Oval private-office table recovered');
  assert(containsBounds(835, 905), 'Rounded private-office desk recovered');
  console.log(`PASS: ${count} curved tables triangulate; both reference shapes recovered; real doors retained`);
})().catch(error => { console.error(error); process.exitCode = 1; });
