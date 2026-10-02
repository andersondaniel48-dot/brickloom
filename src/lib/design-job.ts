// The design under way, if there is one. It belongs to the app rather than to the Create screen,
// so it carries on while the builder looks at something else, and anything on screen can show how
// it is getting on and how much longer it should take.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { InventoryItem, Placement } from '../../shared/build.ts';
import type { DesignSize } from '../../shared/design.ts';
import { learn, remaining, usualPace, usualTotal, type Pace } from '../../shared/estimate.ts';
import { toast } from '../components/ui.tsx';
import type { Catalog } from './catalog.ts';
import { db } from './db.ts';
import { MAX_ROUNDS } from './design-core.ts';
import { runDesign, type DesignEvent } from './designer.ts';
import { modelName, type Designer } from './settings.ts';

interface DesignJob {
  phase: 'idle' | 'working' | 'ready';
  prompt: string;
  size: DesignSize;
  /** The model designing it, by the name people know it; null for the offline quick-builder. */
  by: string | null;
  status: string;
  note: string | null;
  draft: Placement[] | null;
  /** Why it is waiting, when the connection to the model has been lost. */
  paused: 'away' | 'offline' | null;

  // What the time estimate goes by. Clock readings are from Date.now().
  startedAt: number;
  roundStartedAt: number;
  pausedAt: number | null;
  firstTook: number | null;
  laterTook: number[];
  lastValid: boolean;
  pace: Pace;
  /** Whether the pace comes from this builder's own designs, or is a first guess. */
  paceKnown: boolean;

  /** Whether the screen is being kept from dimming and locking while this runs. */
  awake: boolean;

  /** The finished build, until the builder has gone to see it. */
  build: { id: string; name: string } | null;

  start: (request: { prompt: string; size: DesignSize; inventory: InventoryItem[] }, catalog: Catalog, designer: Designer) => void;
  stop: () => void;
  /** The builder has seen the finished build (or the news of it). */
  clear: () => void;
}

// ---------------------------------------------------------------- the usual pace, remembered

const PACE_KEY = 'brickloom-design-pace';

function knownPaces(): Record<string, Pace> {
  try {
    return JSON.parse(localStorage.getItem(PACE_KEY) ?? '{}') as Record<string, Pace>;
  } catch {
    return {};
  }
}

/** How long designs take with a model at a size: from this device's own designs if there are any, else a guess. */
export function paceFor(model: string, size: DesignSize): { pace: Pace; known: boolean } {
  const known = knownPaces()[`${model}|${size}`];
  return known ? { pace: known, known: true } : { pace: usualPace(model, size), known: false };
}

function rememberPace(model: string, size: DesignSize, pace: Pace) {
  try {
    localStorage.setItem(PACE_KEY, JSON.stringify({ ...knownPaces(), [`${model}|${size}`]: pace }));
  } catch {
    // storage is off: the next design starts from the guess again
  }
}

// ---------------------------------------------------------------- keeping the screen on

// A phone that dims and locks cuts the design off (it carries on afterwards, but from the last
// draft). While a design is running and the app is on screen, ask for the screen to stay awake.
interface WakeLock {
  release: () => Promise<void>;
}
let wakeLock: WakeLock | null = null;

async function keepAwake(on: boolean) {
  const locks = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } }).wakeLock;
  try {
    if (on && !wakeLock && locks && !document.hidden) wakeLock = await locks.request('screen');
    else if (!on && wakeLock) {
      const held = wakeLock;
      wakeLock = null;
      await held.release();
    }
  } catch {
    wakeLock = null; // refused (low battery, or not supported): the design still works without it
  }
  useDesignJob.setState({ awake: wakeLock !== null });
}

// ---------------------------------------------------------------- the job

let abort: AbortController | null = null;

export const useDesignJob = create<DesignJob>((set, get) => ({
  phase: 'idle',
  prompt: '',
  size: 'medium',
  by: null,
  status: '',
  note: null,
  draft: null,
  paused: null,
  startedAt: 0,
  roundStartedAt: 0,
  pausedAt: null,
  firstTook: null,
  laterTook: [],
  lastValid: false,
  pace: usualPace('', 'medium'),
  paceKnown: false,
  awake: false,
  build: null,

  start: (request, catalog, designer) => {
    if (get().phase === 'working') return;
    const run = new AbortController();
    abort = run;
    const now = Date.now();
    const { pace, known } = paceFor(designer?.model ?? '', request.size);
    set({
      phase: 'working',
      prompt: request.prompt,
      size: request.size,
      by: designer ? modelName(designer.provider, designer.model) : null,
      status: 'Starting',
      note: null,
      draft: null,
      paused: null,
      startedAt: now,
      roundStartedAt: now,
      pausedAt: null,
      firstTook: null,
      laterTook: [],
      lastValid: false,
      pace,
      paceKnown: known,
      build: null,
    });
    void keepAwake(true);

    // Whether the designer has had its say: a finished build, or the reason there is none.
    let settled = false;
    const onEvent = (event: DesignEvent) => {
      if (run.signal.aborted) return;
      const at = Date.now();
      const job = get();
      if (event.type === 'status') set({ status: event.message });
      else if (event.type === 'note') set({ note: event.text });
      else if (event.type === 'draft') {
        // A draft ends a round. How long each one took is what the estimate is built from.
        const took = at - job.roundStartedAt;
        set({
          draft: event.parts,
          lastValid: event.issues === 0,
          roundStartedAt: at,
          ...(job.firstTook === null ? { firstTook: took } : { laterTook: [...job.laterTook, took] }),
        });
      } else if (event.type === 'paused') set({ paused: event.reason, pausedAt: at });
      // The interrupted round starts over, so its clock does too.
      else if (event.type === 'resumed') set({ paused: null, pausedAt: null, roundStartedAt: at });
      else if (event.type === 'error') {
        settled = true;
        toast(event.message, 'error');
        set({ phase: 'idle' });
      } else if (event.type === 'done') {
        settled = true;
        const id = crypto.randomUUID();
        const { design } = event;
        if (designer && job.firstTook !== null) rememberPace(designer.model, request.size, learn(job.pace, job.paceKnown, { firstTook: job.firstTook, laterTook: job.laterTook }));
        void db.builds
          .add({ id, name: design.name, description: design.description, prompt: request.prompt, engine: design.engine, repaired: design.repaired, createdAt: Date.now(), parts: design.parts, step: 0 })
          .then(() => !run.signal.aborted && set({ phase: 'ready', build: { id, name: design.name } }));
      }
    };

    void runDesign(request, catalog, { designer, signal: run.signal, onEvent })
      .catch((err: unknown) => {
        console.error(err);
        if (!run.signal.aborted) toast('The designer could not start. Check your connection and try again.', 'error');
      })
      .finally(() => {
        if (abort === run) abort = null;
        void keepAwake(false);
        if (!settled && !run.signal.aborted) set({ phase: 'idle' });
      });
  },

  stop: () => {
    abort?.abort();
    abort = null;
    void keepAwake(false);
    set({ phase: 'idle', paused: null });
  },

  clear: () => set({ phase: 'idle', build: null }),
}));

// The system takes the wake lock away whenever the app leaves the screen; ask again on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) (wakeLock = null), useDesignJob.setState({ awake: false });
  else if (useDesignJob.getState().phase === 'working') void keepAwake(true);
});

// ---------------------------------------------------------------- how long is left

/** The time a design under way still needs, in milliseconds; null while it is paused. */
export function timeLeft(job: Pick<DesignJob, 'roundStartedAt' | 'pausedAt' | 'firstTook' | 'laterTook' | 'lastValid' | 'pace'>, now: number): number | null {
  if (job.pausedAt !== null) return null;
  return remaining(job.pace, { firstTook: job.firstTook, laterTook: job.laterTook, lastValid: job.lastValid, inRound: Math.max(0, now - job.roundStartedAt) }, MAX_ROUNDS);
}

/** How far along a design is, from 0 to 1, going by the time spent and the time left. */
export function fractionDone(job: Pick<DesignJob, 'startedAt'>, left: number, now: number): number {
  const spent = Math.max(0, now - job.startedAt);
  return spent / (spent + left);
}

export { usualTotal };

/** The time now, refreshed every so often, for anything on screen that counts down. */
export function useNow(every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
