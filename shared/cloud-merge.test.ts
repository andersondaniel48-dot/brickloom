import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmpty, mergeStates, summarize, type SyncState } from './cloud-merge.ts';

const piece = (part: string, color: number, qty: number, at = 1) => ({ key: `${part}|${color}`, part, color, qty, addedAt: at, updatedAt: at });

const device: SyncState = {
  pieces: [piece('3001', 4, 10, 5), piece('3003', 1, 2)],
  sets: [{ num: '31058-1', copies: 1, addedAt: 1 }],
  builds: [{ id: 'a', createdAt: 1, step: 7 }],
};
const account: SyncState = {
  pieces: [piece('3001', 4, 6, 2), piece('3020', 2, 3)],
  sets: [{ num: '31058-1', copies: 2, addedAt: 1 }, { num: '10696-1', copies: 1, addedAt: 1 }],
  builds: [{ id: 'a', createdAt: 1, step: 3 }, { id: 'b', createdAt: 2, step: 0 }],
};

test('merging keeps the larger count of each piece instead of adding them', () => {
  const merged = mergeStates(device, account);
  const qty = Object.fromEntries(merged.pieces.map((p) => [p.key, p.qty]));
  assert.deepEqual(qty, { '3001|4': 10, '3020|2': 3, '3003|1': 2 });
  const red = merged.pieces.find((p) => p.key === '3001|4')!;
  assert.equal(red.addedAt, 2);
  assert.equal(red.updatedAt, 5);
});

test('sets and builds are combined, keeping the fuller copy of each', () => {
  const merged = mergeStates(device, account);
  assert.deepEqual(Object.fromEntries(merged.sets.map((s) => [s.num, s.copies])), { '31058-1': 2, '10696-1': 1 });
  assert.deepEqual(Object.fromEntries(merged.builds.map((b) => [b.id, b.step])), { a: 7, b: 0 });
});

test('merging the same data again changes nothing', () => {
  const once = mergeStates(device, account);
  const twice = mergeStates(once, account);
  assert.deepEqual(summarize(twice), summarize(once));
  assert.deepEqual(summarize(mergeStates(device, device)), summarize(device));
});

test('summaries count pieces, not kinds of piece', () => {
  assert.deepEqual(summarize(device), { pieces: 12, sets: 1, builds: 1 });
  assert.equal(isEmpty({ pieces: [], sets: [], builds: [] }), true);
  assert.equal(isEmpty(device), false);
});
