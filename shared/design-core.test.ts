import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DesignSession, MAX_ROUNDS, parseSubmission, resilientTurn } from '../src/lib/design-core.ts';
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

// ---------------------------------------------------------------- surviving a lost connection

/** The app's surroundings, under the test's control. */
function surroundings(start: { hidden?: boolean; offline?: boolean } = {}) {
  const watchers = new Set<() => void>();
  const state = { hidden: start.hidden ?? false, offline: start.offline ?? false };
  return {
    hidden: () => state.hidden,
    offline: () => state.offline,
    watch: (changed: () => void) => (watchers.add(changed), () => void watchers.delete(changed)),
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      for (const changed of [...watchers]) changed();
    },
  };
}

class Dropped extends Error {}
const lostConnection = (err: unknown) => err instanceof Dropped;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Every wait is a thousandth of its real length.
const patience = 0.001;

test('a round that goes through is run once and says nothing', async () => {
  const events: DesignEvent[] = [];
  let runs = 0;
  const result = await resilientTurn(async () => (runs++, 'answer'), { emit: (e) => events.push(e), lostConnection, surroundings: surroundings(), patience });
  assert.equal(result, 'answer');
  assert.equal(runs, 1);
  assert.deepEqual(events, []);
});

test('a round cut off while the app is away waits, and is run again on return', async () => {
  const around = surroundings({ hidden: true });
  const events: DesignEvent[] = [];
  let runs = 0;
  const turn = resilientTurn(
    async () => {
      if (runs++ === 0) throw new Dropped();
      return 'answer';
    },
    { emit: (e) => events.push(e), lostConnection, surroundings: around, patience },
  );
  await pause(20);
  assert.deepEqual(events, [{ type: 'paused', reason: 'away' }]);
  assert.equal(runs, 1, 'nothing is retried while the app is away');
  around.set({ hidden: false });
  assert.equal(await turn, 'answer');
  assert.deepEqual(events.map((e) => e.type), ['paused', 'resumed']);
});

test('with no network, it says so and waits for it', async () => {
  const around = surroundings({ offline: true });
  const events: DesignEvent[] = [];
  let runs = 0;
  const turn = resilientTurn(async () => (runs++ === 0 ? Promise.reject(new Dropped()) : 'answer'), { emit: (e) => events.push(e), lostConnection, surroundings: around, patience });
  await pause(20);
  assert.deepEqual(events, [{ type: 'paused', reason: 'offline' }]);
  around.set({ offline: false });
  assert.equal(await turn, 'answer');
});

test('other failures are not retried', async () => {
  let runs = 0;
  await assert.rejects(
    resilientTurn(async () => (runs++, Promise.reject(new Error('the key was rejected'))), { emit: () => {}, lostConnection, surroundings: surroundings(), patience }),
    /key was rejected/,
  );
  assert.equal(runs, 1);
});

test('a connection that keeps failing with the app in plain view is given up on', async () => {
  let runs = 0;
  await assert.rejects(resilientTurn(async () => (runs++, Promise.reject(new Dropped())), { emit: () => {}, lostConnection, surroundings: surroundings(), patience }), Dropped);
  assert.equal(runs, 3);
});

test('a round that has gone quiet after the app comes back is cut short and run again', async () => {
  const around = surroundings();
  const events: DesignEvent[] = [];
  let runs = 0;
  const turn = resilientTurn(
    (signal) =>
      runs++ === 0
        ? // Never answers, like a connection the system has silently dropped.
          new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))))
        : Promise.resolve('answer'),
    { emit: (e) => events.push(e), lostConnection, surroundings: around, patience },
  );
  around.set({ hidden: true });
  await pause(30); // away for longer than the 5 "seconds" that count as having left
  around.set({ hidden: false });
  assert.equal(await turn, 'answer');
  assert.equal(runs, 2);
  assert.deepEqual(events.map((e) => e.type), ['paused', 'resumed']);
});

test('a round that keeps talking after the app comes back is left alone', async () => {
  const around = surroundings();
  let runs = 0;
  const turn = resilientTurn(
    async (_signal, alive) => {
      runs++;
      // Heard from every 20 "seconds" for three "minutes".
      for (let i = 0; i < 9; i++) (await pause(20), alive());
      return 'answer';
    },
    { emit: () => {}, lostConnection, surroundings: around, patience },
  );
  around.set({ hidden: true });
  await pause(30);
  around.set({ hidden: false });
  assert.equal(await turn, 'answer');
  assert.equal(runs, 1);
});

test('stopping the design stops the waiting too', async () => {
  const abort = new AbortController();
  const turn = resilientTurn(async () => Promise.reject(new Dropped()), { signal: abort.signal, emit: () => {}, lostConnection, surroundings: surroundings({ hidden: true }), patience });
  await pause(20);
  abort.abort(new Error('stopped'));
  await assert.rejects(turn, /stopped/);
});
