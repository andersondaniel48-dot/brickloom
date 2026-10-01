import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze, expandOps, fill, ldrawLine, planSteps, repair, type InventoryItem, type Placement, type Shapes } from './build.ts';
import { STUD, PLATE, rotatedCells, type Rotation } from './shape.ts';

const shapes: Shapes = JSON.parse(readFileSync(new URL('../public/catalog/shapes.json', import.meta.url), 'utf8'));
const RED = 4;
const brick = (part: string, x: number, z: number, y: number, rot: Rotation = 0): Placement => ({ part, color: RED, x, z, y, rot });

test('stacked bricks connect, neighbours do not', () => {
  const stacked = analyze([brick('3001', 0, 0, 0), brick('3001', 2, 0, 3)], shapes);
  assert.equal(stacked.issues.length, 0);
  assert.equal(stacked.groups.length, 1);

  const apart = analyze([brick('3001', 0, 0, 0), brick('3001', 4, 0, 0)], shapes);
  assert.deepEqual(apart.issues.map((i) => i.kind), ['disconnected']);
});

test('overlapping parts collide', () => {
  const { issues } = analyze([brick('3001', 0, 0, 0), brick('3003', 3, 1, 2)], shapes);
  assert.equal(issues[0].kind, 'collision');
});

test('a tile gives nothing to attach to', () => {
  const { issues } = analyze([brick('3068b', 0, 0, 0), brick('3003', 0, 0, 1)], shapes);
  assert.deepEqual(issues.map((i) => i.kind), ['disconnected']);
});

test('inventory limits are enforced', () => {
  const inventory: InventoryItem[] = [{ part: '3001', color: RED, qty: 1 }];
  const { issues } = analyze([brick('3001', 0, 0, 0), brick('3001', 2, 0, 3)], shapes, inventory);
  assert.deepEqual(issues.map((i) => i.kind), ['inventory']);
});

test('grid cells agree with the LDraw transform for every rotation', () => {
  for (const id of ['3001', '3040b', '3660', '2420', '3747a', '6564', '3039']) {
    const shape = shapes[id];
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      const p: Placement = { part: id, color: RED, x: 5, z: 7, y: 4, rot };
      const t = ldrawLine(p, shape).split(' ').map(Number);
      const expected = new Set(rotatedCells(shape, rot).filter((c) => c.stud >= 0).map((c) => `${p.x + c.x},${p.z + c.z},${p.y + c.stud}`));
      const actual = new Set<string>();
      for (let cz = 0; cz < shape.d; cz++) {
        for (let cx = 0; cx < shape.w; cx++) {
          const s = shape.stud[cz * shape.w + cx];
          if (s < 0) continue;
          // Stud position in part-local LDraw space, then through the placement matrix.
          const lx = shape.ox + (cx + 0.5) * STUD;
          const ly = shape.oy - s * PLATE;
          const lz = shape.oz + (cz + 0.5) * STUD;
          const wx = t[5] * lx + t[6] * ly + t[7] * lz + t[2];
          const wy = t[8] * lx + t[9] * ly + t[10] * lz + t[3];
          const wz = t[11] * lx + t[12] * ly + t[13] * lz + t[4];
          actual.add(`${Math.floor(wx / STUD)},${Math.floor(wz / STUD)},${-wy / PLATE}`);
        }
      }
      assert.deepEqual([...actual].sort(), [...expected].sort(), `${id} rot ${rot}`);
    }
  }
});

test('hollow fill builds interlocked walls', () => {
  const stock = new Map([['3010|4', 40], ['3004|4', 40], ['3005|4', 40], ['3009|4', 10]]);
  const { parts, error } = fill({ op: 'fill', color: RED, x: 0, z: 0, y: 0, w: 10, d: 7, h: 12, hollow: true }, shapes, stock);
  assert.equal(error, undefined);
  const result = analyze(parts, shapes);
  assert.equal(result.issues.length, 0, result.issues.map((i) => i.message).join('\n'));
  assert.equal(result.groups.length, 1);
});

test('solid fill staggers joints and respects stock', () => {
  const stock = new Map([['3001|4', 6], ['3003|4', 8], ['3002|4', 4]]);
  const { parts, error } = fill({ op: 'fill', color: RED, x: 0, z: 0, y: 0, w: 6, d: 4, h: 6 }, shapes, stock);
  assert.equal(error, undefined);
  assert.equal(analyze(parts, shapes).groups.length, 1);
  assert.ok([...stock.values()].every((n) => n >= 0));

  const tooFew = fill({ op: 'fill', color: RED, x: 0, z: 0, y: 0, w: 16, d: 16, h: 9 }, shapes, new Map([['3003|4', 3]]));
  assert.match(tooFew.error ?? '', /Cannot fill/);

  // Largest-first would start with the 6x6 and strand a strip; two 4x6 plates side by side is the answer.
  const awkward = fill({ op: 'fill', kind: 'plate', color: RED, x: 0, z: 0, y: 0, w: 8, d: 6, h: 1 }, shapes, new Map([['3958|4', 2], ['3032|4', 2], ['3031|4', 2]]));
  assert.equal(awkward.error, undefined);
  assert.equal(awkward.parts.length, 2);
});

test('repair leaves a valid, connected build', () => {
  const inventory: InventoryItem[] = [{ part: '3001', color: RED, qty: 3 }, { part: '3003', color: RED, qty: 1 }];
  const messy = [brick('3001', 0, 0, 0), brick('3001', 2, 0, 3), brick('3001', 2, 0, 3), brick('3003', 20, 20, 0), brick('nope', 0, 0, 9)];
  const fixed = repair(messy, shapes, inventory);
  assert.equal(fixed.length, 2);
  assert.equal(analyze(fixed, shapes, inventory).issues.length, 0);
});

test('steps never place a part before something it can attach to', () => {
  const { parts } = expandOps(
    [
      { op: 'fill', color: RED, x: 0, z: 0, y: 0, w: 8, d: 6, h: 1, kind: 'plate' },
      { op: 'fill', color: RED, x: 0, z: 0, y: 1, w: 8, d: 6, h: 9, hollow: true },
      { op: 'part', part: '3660', color: RED, x: 3, z: 4, y: 10, rot: 0 },
    ],
    shapes,
    [
      { part: '3035', color: RED, qty: 1 }, { part: '3020', color: RED, qty: 2 }, { part: '3010', color: RED, qty: 30 },
      { part: '3004', color: RED, qty: 30 }, { part: '3005', color: RED, qty: 30 }, { part: '3660', color: RED, qty: 1 },
    ],
  );
  const { issues, links } = analyze(parts, shapes);
  assert.equal(issues.length, 0, issues.map((i) => i.message).join('\n'));
  const steps = planSteps(parts, shapes);
  assert.equal(steps.flat().length, parts.length);
  const ground = Math.min(...parts.map((p) => p.y));
  const placed = new Set<number>();
  for (const step of steps) {
    for (const i of step) {
      const attached = links.some(([a, b]) => (a === i && placed.has(b)) || (b === i && placed.has(a)));
      assert.ok(parts[i].y === ground || attached, `part ${i} placed with nothing to attach to`);
    }
    step.forEach((i) => placed.add(i));
  }
});
