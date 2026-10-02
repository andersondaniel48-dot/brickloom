// How long a design still has to go.
//
// A design is a few rounds: the model thinks and submits a draft, reads what the checker says,
// and submits another, until it is satisfied or out of rounds. How long that takes depends on the
// model, on the size asked for, and on how many rounds it turns out to need, none of which is
// known in advance. So the estimate starts from the usual pace (a guess at first, then what this
// builder's own designs actually took) and is corrected as the design goes: by how long its first
// round took compared with the usual, and by how long its later rounds are taking.

import type { DesignSize } from './design.ts';

/** How a design usually goes for one model at one size. Times in milliseconds. */
export interface Pace {
  /** From the start to the first draft: reading the inventory, thinking, and writing a whole build. */
  first: number;
  /** Each round after that. */
  next: number;
  /** How many drafts it takes. */
  rounds: number;
}

/** Where a design in progress has got to. Times in milliseconds, with any time spent paused left out. */
export interface Progress {
  /** How long the first round took, or null while it is still going. */
  firstTook: number | null;
  /** How long each later round took. */
  laterTook: number[];
  /** Whether the latest draft passed the checker. */
  lastValid: boolean;
  /** Time spent so far in the round now under way. */
  inRound: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** After its last draft a model still reads the verdict and writes a closing line. */
const closing = (round: number) => round * 0.25;

/**
 * What is left of something expected to take `expected` when `spent` has gone by. Once it is
 * overdue the answer is "a little longer", growing slowly, rather than zero: nothing is more
 * discouraging than an estimate that says "any second now" for three minutes.
 */
const left = (expected: number, spent: number) => Math.max(expected - spent, spent * 0.2, 5000);

/** A guess at the pace of a model nobody has designed with on this device yet. */
export function usualPace(model: string, size: DesignSize): Pace {
  // Not measured: rough figures from how fast each family of model writes. They only matter
  // for the first design or two with a model; after that the builder's own designs set the pace.
  const speed = /fable|astra/.test(model) ? 1.5 : /sonnet|sol/.test(model) ? 0.7 : /haiku|luna|mini|nano/.test(model) ? 0.45 : 1;
  const scale = speed * { small: 0.7, medium: 1, large: 1.5 }[size];
  return { first: 100_000 * scale, next: 60_000 * scale, rounds: 3 };
}

/** The time a design still needs, in milliseconds. */
export function remaining(pace: Pace, progress: Progress, maxRounds: number): number {
  if (progress.firstTook === null) {
    return left(pace.first, progress.inRound) + Math.max(0, pace.rounds - 1) * pace.next + closing(pace.next);
  }
  const done = 1 + progress.laterTook.length;
  // How this design compares with the usual: a first round twice as slow promises slow later rounds.
  const run = clamp(progress.firstTook / pace.first, 0.4, 3);
  const round = progress.laterTook.length ? mean(progress.laterTook) * 0.7 + pace.next * run * 0.3 : pace.next * run;
  const roundsLeft = maxRounds - done;
  if (roundsLeft <= 0) return left(closing(round), progress.inRound);
  // A draft with problems will be followed by another. A sound one may be the last, or may be
  // refined: go by how many drafts designs usually take.
  const more = progress.lastValid ? clamp(pace.rounds - done, 0.3, roundsLeft) : clamp(pace.rounds - done, 1, roundsLeft);
  return left(more * round + closing(round), progress.inRound);
}

/** The usual pace, brought up to date with a design that has just finished. */
export function learn(pace: Pace, known: boolean, finished: { firstTook: number; laterTook: number[] }): Pace {
  // The first real design replaces the guess outright; later ones nudge the average.
  const weight = known ? 0.4 : 1;
  const blend = (old: number, seen: number) => old + (seen - old) * weight;
  return {
    first: blend(pace.first, finished.firstTook),
    // With no later rounds to go by, keep their proportion to the first.
    next: blend(pace.next, finished.laterTook.length ? mean(finished.laterTook) : (pace.next / pace.first) * finished.firstTook),
    rounds: blend(pace.rounds, 1 + finished.laterTook.length),
  };
}

/** The time a whole design usually takes, in milliseconds. */
export const usualTotal = (pace: Pace) => pace.first + Math.max(0, pace.rounds - 1) * pace.next + closing(pace.next);

/** A length of time the way people say it: to the minute, because the estimate is no better than that. */
export function inWords(ms: number): string {
  if (ms < 45_000) return 'less than a minute';
  if (ms < 90_000) return 'about a minute';
  return `about ${Math.round(ms / 60_000)} minutes`;
}
