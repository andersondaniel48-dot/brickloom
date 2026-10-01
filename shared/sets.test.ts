import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MINIFIG, SPARE, selectPieces, type SetPiece } from './sets.ts';

const box: SetPiece[] = [
  ['3001', 4, 6, 0],
  ['3024', 4, 2, SPARE],
  ['3626c', 14, 1, MINIFIG],
  ['3001', 4, 1, MINIFIG],
  ['3024', 14, 1, MINIFIG | SPARE],
];
const total = (options: { spares: boolean; minifigs: boolean }) => selectPieces(box, options).reduce((n, p) => n + p.qty, 0);

test('spares and minifigure parts are only included when asked for', () => {
  assert.equal(total({ spares: false, minifigs: false }), 6);
  assert.equal(total({ spares: true, minifigs: false }), 8);
  assert.equal(total({ spares: false, minifigs: true }), 8);
  assert.equal(total({ spares: true, minifigs: true }), 11);
});

test('the same element from different sources is merged into one line', () => {
  const pieces = selectPieces(box, { spares: false, minifigs: true });
  assert.deepEqual(pieces.find((p) => p.part === '3001'), { part: '3001', color: 4, qty: 7 });
  assert.equal(pieces.length, 2);
});
