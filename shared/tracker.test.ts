import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Tracker, type Box } from '../src/lib/scan/tracker.ts';

const middle: Box = { x: 0.45, y: 0.45, w: 0.1, h: 0.1 };
const corner: Box = { x: 0.02, y: 0.02, w: 0.1, h: 0.1 };
const shifted = (box: Box, dx: number, dy = 0): Box => ({ ...box, x: box.x + dx, y: box.y + dy });

test('a piece is shown at once, and locked after a few sightings', () => {
  const tracker = new Tracker();
  assert.deepEqual(tracker.update([middle]).map((t) => t.locked), [false]);
  tracker.update([middle]);
  assert.deepEqual(tracker.update([middle]).map((t) => t.locked), [true]);
});

test('a locked piece stays on show through frames that miss it', () => {
  const tracker = new Tracker();
  for (let i = 0; i < 3; i++) tracker.update([middle]);
  for (let i = 0; i < 8; i++) {
    const shown = tracker.update([]);
    assert.equal(shown.length, 1, `gone after ${i + 1} missed frames`);
    assert.ok(shown[0].held);
  }
  assert.equal(tracker.locked().length, 1);
  // ... and is simply picked up again when it reappears.
  const [again] = tracker.update([middle]);
  assert.ok(again.locked && !again.held);
});

test('but not for ever, and less long near the edge of the view', () => {
  const tracker = new Tracker();
  for (let i = 0; i < 3; i++) tracker.update([middle, corner]);
  let shown = tracker.update([]);
  for (let i = 0; i < 6; i++) shown = tracker.update([]);
  assert.equal(shown.length, 1, 'the piece in the corner should have gone, the one in the middle not yet');
  for (let i = 0; i < 6; i++) shown = tracker.update([]);
  assert.equal(shown.length, 0);
});

test('a piece seen only every other frame still locks', () => {
  const tracker = new Tracker();
  let shown = tracker.update([middle]);
  for (let i = 0; i < 6; i++) shown = tracker.update(i % 2 ? [middle] : []);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].locked);
});

test('a piece keeps its identity as the camera moves', () => {
  const tracker = new Tracker();
  const [first] = tracker.update([middle]);
  let shown = [first];
  for (let i = 1; i <= 6; i++) shown = tracker.update([shifted(middle, i * 0.02)]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, first.id);
  assert.ok(Math.abs(shown[0].x - (middle.x + 0.12)) < 0.02, 'the outline should have kept up');
});

test('a piece that goes unseen moves along with the ones around it', () => {
  const tracker = new Tracker();
  const others: Box[] = [
    { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
    { x: 0.7, y: 0.3, w: 0.1, h: 0.1 },
    { x: 0.3, y: 0.7, w: 0.1, h: 0.1 },
  ];
  for (let i = 0; i < 3; i++) tracker.update([middle, ...others]);
  // The camera drifts right; the middle piece is missed in these frames.
  for (let i = 1; i <= 3; i++) tracker.update(others.map((o) => shifted(o, i * 0.03)));
  const held = tracker.locked().find((t) => t.held);
  assert.ok(held, 'the missed piece should still be held');
  assert.ok(Math.abs(held.x - (middle.x + 0.09)) < 0.02, `it should have moved with the scene, but is at ${held.x}`);
});

test('pointing the camera somewhere else lets go of everything', () => {
  const tracker = new Tracker();
  const scene: Box[] = [0.1, 0.3, 0.5, 0.7].map((x) => ({ x, y: 0.45, w: 0.1, h: 0.1 }));
  for (let i = 0; i < 3; i++) tracker.update(scene);
  const shown = tracker.update([{ x: 0.4, y: 0.1, w: 0.2, h: 0.2 }]);
  assert.equal(shown.length, 1);
  assert.ok(!shown[0].locked);
});

test('a second outline over a locked piece is not shown as another piece', () => {
  const tracker = new Tracker();
  const left: Box = { x: 0.3, y: 0.4, w: 0.1, h: 0.1 };
  const right: Box = { x: 0.42, y: 0.4, w: 0.1, h: 0.1 };
  for (let i = 0; i < 3; i++) tracker.update([left, right]);
  // For one frame the two are found as a single blob.
  const shown = tracker.update([{ x: 0.3, y: 0.4, w: 0.22, h: 0.1 }]);
  assert.equal(shown.length, 2);
  assert.ok(shown.every((t) => t.locked));
});

test('two readings of the same spot do not take turns, or pile up', () => {
  const tracker = new Tracker();
  const left: Box = { x: 0.3, y: 0.4, w: 0.1, h: 0.1 };
  const right: Box = { x: 0.42, y: 0.4, w: 0.1, h: 0.1 };
  const both: Box = { x: 0.3, y: 0.4, w: 0.22, h: 0.1 };
  for (let i = 0; i < 3; i++) tracker.update([left, right]);
  // From here on the pair is found as one blob every other frame.
  for (let i = 0; i < 20; i++) {
    const shown = tracker.update(i % 2 ? [left, right] : [both]);
    assert.equal(shown.length, 2, `frame ${i}`);
    assert.equal(tracker.locked().length, 2, `frame ${i}`);
  }
  // If the pair is only ever seen as one from now on, that reading takes over.
  let shown = tracker.update([both]);
  for (let i = 0; i < 14; i++) shown = tracker.update([both]);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].locked && shown[0].w > 0.2);
});

test('overlapping outlines seen together are both pieces', () => {
  // A brick lying across a larger one: its outline sits mostly inside the other's.
  const tracker = new Tracker();
  const under: Box = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
  const across: Box = { x: 0.35, y: 0.35, w: 0.12, h: 0.3 };
  let shown = tracker.update([under, across]);
  for (let i = 0; i < 3; i++) shown = tracker.update([under, across]);
  assert.equal(shown.length, 2);
  assert.ok(shown.every((t) => t.locked));
});
