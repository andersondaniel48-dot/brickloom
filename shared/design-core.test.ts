import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DesignSession, MAX_ROUNDS, parseSubmission } from '../src/lib/design-core.ts';
import type { Shapes } from './build.ts';
import type { DesignCatalog, DesignEvent, DesignRequest } from './design.ts';

const shapes: Shapes = JSON.parse(readFileSync(new URL('../public/catalog/shapes.json', import.meta.url), 'utf8'));
const catalog: DesignCatalog = { shapes, colorNames: { 4: 'Red' }, printOf: {}, variants: {} };
const request: DesignRequest = { prompt: 'a small tower', size: 'small', inventory: [{ part: '3001', color: 4, qty: 12 }] };

/** A session, and everything it tells the builder. */
function start(overrides: Partial<DesignRequest> = {}) {
  const events: DesignEvent[] = [];
  return { session: new DesignSession({ ...request, ...overrides }, catalog, (event) => events.push(event)), events };
}

const tower = { name: 'Red Tower', description: 'A narrow red tower.', fills: [{ color: 4, x: 0, z: 0, y: 0, w: 2, d: 4, h: 9 }] };

test('a submission needs a name, a description and something to build', () => {
  assert.equal(typeof parseSubmission(null), 'string');
  assert.equal(typeof parseSubmission({ name: 'x' }), 'string');
  assert.match(parseSubmission({ name: 'x', description: 'y' }) as string, /empty/);
  assert.match(parseSubmission({ name: 'x', description: 'y', parts: [{ part: '3001', color: 4, x: 0, z: 0 }] }) as string, /parts\[0\]/);
  const ok = parseSubmission({ name: 'x', description: 'y', parts: [{ part: '3001', color: 4, x: 0, z: 0, y: 0 }] });
  assert.equal(typeof ok, 'object');
});

test('the brief tells the model what was asked for and what there is to build with', () => {
  const { session } = start();
  assert.ok(session.ready());
  const brief = session.brief();
  assert.match(brief, /a small tower/);
  assert.match(brief, /12 usable pieces/);
  assert.match(brief, /3001/);
});

test('with nothing to build from, the builder is told and no model is asked', () => {
  const { session, events } = start({ inventory: [] });
  assert.equal(session.ready(), false);
  assert.equal(events[0].type, 'error');
});

test('a sound build is reported as valid and becomes the result', () => {
  const { session, events } = start();
  const reply = session.call('submit_build', tower);
  assert.equal(reply.error, false);
  assert.match(reply.text, /^VALID: 3 parts/);
  assert.match(reply.text, new RegExp(`${MAX_ROUNDS - 1} submissions left`));
  assert.deepEqual(events.map((e) => e.type), ['draft', 'status']);

  session.finish('openai');
  const done = events.at(-1)!;
  assert.equal(done.type, 'done');
  if (done.type === 'done') {
    assert.equal(done.design.engine, 'openai');
    assert.equal(done.design.name, 'Red Tower');
    assert.equal(done.design.parts.length, 3);
    assert.equal(done.design.repaired, false);
  }
});

test('a build that asks for more than is in stock comes back with its problems', () => {
  const { session } = start({ inventory: [{ part: '3001', color: 4, qty: 1 }] });
  const reply = session.call('submit_build', tower);
  assert.equal(reply.error, false);
  assert.match(reply.text, /^INVALID/);
});

test('a faulty call is answered as an error and does not use up a submission', () => {
  const { session } = start();
  assert.ok(session.call('delete_everything', {}).error);
  assert.ok(session.call('submit_build', { name: 'x' }).error);
  for (let i = 0; i < MAX_ROUNDS; i++) assert.equal(session.call('submit_build', tower).error, false, `submission ${i + 1} should count`);
  const extra = session.call('submit_build', tower);
  assert.ok(extra.error);
  assert.match(extra.text, /No submissions left/);
});

test('the last sound build wins over a later broken one', () => {
  const { session, events } = start();
  session.call('submit_build', tower);
  // Two bricks side by side are not attached to each other.
  session.call('submit_build', { name: 'Broken', description: 'Falls apart.', parts: [{ part: '3001', color: 4, x: 0, z: 0, y: 0 }, { part: '3001', color: 4, x: 6, z: 0, y: 0 }] });
  session.finish('claude');
  const done = events.at(-1)!;
  assert.equal(done.type, 'done');
  if (done.type === 'done') assert.equal(done.design.name, 'Red Tower');
});

test('when no model ever submits a build, the builder is told', () => {
  const { session, events } = start();
  session.finish('claude');
  assert.equal(events.at(-1)!.type, 'error');
});
