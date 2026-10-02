import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inWords, learn, remaining, usualPace, usualTotal, type Pace, type Progress } from './estimate.ts';

const pace: Pace = { first: 100_000, next: 60_000, rounds: 3 };
const MAX = 5;
const at = (progress: Partial<Progress>) => remaining(pace, { firstTook: null, laterTook: [], lastValid: false, inRound: 0, ...progress }, MAX);

test('at the start, the estimate is the usual length of a design', () => {
  assert.equal(at({}), usualTotal(pace));
  assert.equal(usualTotal(pace), 100_000 + 2 * 60_000 + 15_000);
});

test('it counts down while a round is under way', () => {
  assert.equal(at({}) - at({ inRound: 40_000 }), 40_000);
});

test('an overdue round is given a little longer, never zero', () => {
  const late = at({ inRound: 150_000 });
  const later = at({ inRound: 300_000 });
  assert.ok(late > 2 * 60_000, 'the later rounds are still to come');
  assert.ok(later >= late, 'and the estimate does not shrink toward nothing while the wait goes on');
});

test('a slow first round means slow rounds to come', () => {
  const usual = at({ firstTook: 100_000, lastValid: false });
  const slow = at({ firstTook: 200_000, lastValid: false });
  assert.ok(slow > usual * 1.8 && slow < usual * 2.2, `expected about double, got ${slow / usual}`);
});

test('a draft with problems has more ahead of it than a sound one', () => {
  const after = (lastValid: boolean) => at({ firstTook: 100_000, laterTook: [60_000, 60_000], lastValid });
  assert.ok(after(false) > after(true));
  // Three drafts in, with the usual being three: a sound draft is nearly done.
  assert.ok(after(true) < 60_000);
  assert.ok(after(false) >= 60_000);
});

test('after the last round there is only the closing line to wait for', () => {
  const done = at({ firstTook: 100_000, laterTook: [60_000, 60_000, 60_000, 60_000], lastValid: false });
  assert.ok(done <= 20_000);
});

test('the rounds this design has actually taken outweigh the usual', () => {
  const quick = at({ firstTook: 100_000, laterTook: [20_000], lastValid: false });
  const slow = at({ firstTook: 100_000, laterTook: [120_000], lastValid: false });
  assert.ok(slow > quick * 2);
});

test('the first real design replaces the guess, later ones nudge it', () => {
  const first = learn(pace, false, { firstTook: 40_000, laterTook: [20_000, 30_000] });
  assert.deepEqual(first, { first: 40_000, next: 25_000, rounds: 3 });
  const second = learn(first, true, { firstTook: 60_000, laterTook: [] });
  assert.equal(second.first, 48_000);
  assert.ok(second.rounds < 3 && second.rounds > 1);
});

test('bigger builds and bigger models are expected to take longer', () => {
  assert.ok(usualTotal(usualPace('claude-opus-5-5', 'large')) > usualTotal(usualPace('claude-opus-5-5', 'small')));
  assert.ok(usualTotal(usualPace('claude-fable-5-1', 'medium')) > usualTotal(usualPace('claude-haiku-4-5-20251001', 'medium')));
  assert.ok(usualTotal(usualPace('gpt-6-astra', 'medium')) > usualTotal(usualPace('gpt-6-luna', 'medium')));
});

test('times are said to the minute', () => {
  assert.equal(inWords(20_000), 'less than a minute');
  assert.equal(inWords(70_000), 'about a minute');
  assert.equal(inWords(200_000), 'about 3 minutes');
});
