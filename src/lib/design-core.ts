// What every AI designer has in common, whichever company's model is doing the designing: the
// brief it is given, the one tool it may call, and the checking of what it submits. The model
// proposes a build from the builder's inventory, the validator checks it against physics and
// stock, and the two go back and forth until the build is sound.
import {
  analyze,
  expandOps,
  normalize,
  renderViews,
  repair,
  type BuildOp,
  type FillKind,
  type InventoryItem,
  type Issue,
  type Placement,
} from '../../shared/build.ts';
import type { DesignCatalog, DesignEvent, DesignRequest, DesignResult, DesignSize } from '../../shared/design.ts';
import { buildableInventory, describePalette } from '../../shared/palette.ts';

export const MAX_ROUNDS = 5;

const SIZE_GUIDE: Record<DesignSize, string> = {
  small: 'Small: roughly 20 to 45 parts, something that fits in a hand.',
  medium: 'Medium: roughly 45 to 110 parts.',
  large: 'Large: roughly 110 to 260 parts, a centerpiece model.',
};

export const SYSTEM = `You are a master LEGO model designer. A builder describes what they want, and you design a model they can physically build right now from the bricks they own. Their inventory is the hard limit: you may only use parts and colors listed in it, and never more of an element than they have.

# The build grid

Models live on a stud grid. x runs left to right and z runs from the front (z=0, nearest the viewer) toward the back, both in studs. y is height in plates, with y=0 on the ground. One brick is 3 plates tall, one plate is 1.

A part is placed by the minimum-x, minimum-z corner of its footprint after rotation, and the y of its underside. rot is the number of quarter turns (0 to 3), clockwise when seen from above.

The inventory lists each part as: id | name | size | stock. Size is given at rot 0 as width (x) by depth (z) in studs and height in plates. Plain bricks and plates are full boxes with a stud on every top cell and a socket under every cell. Parts that are not plain boxes also list a top map and a bottom map for each rotation, drawn as seen from above: one row per z step separated by "/", back row first and front row (the part's lowest z) last, x left to right. Pick the rotation whose map puts the studs and slopes where you want them. In the top map "o" is a cell with a stud, "-" is a cell that is occupied but smooth on top (a slope face or a tile), and a space is empty. In the bottom map "u" is a cell that accepts a stud from below and "-" is a cell that does not (the overhang of an inverted slope, the opening of an arch).

# What makes a build valid

- Two parts hold together only where a stud of the lower part sits directly under a "u" cell of the upper part, with the upper part's underside at exactly the height of that stud. Parts that merely sit side by side are not connected.
- Every part must end up in one single connected assembly. A model that would fall into separate pieces when lifted is invalid.
- No two parts may occupy the same space, and nothing goes below y=0.
- Walls and stacks hold together only when joints are staggered from one course to the next, the way real brickwork overlaps.

# How to work

Call submit_build with the complete model. It is checked exactly, and you get back any problems plus top, front and side views of what you actually built. Read the views critically: confirm the model looks like the subject and that the proportions are right, then fix problems and improve the design by submitting the complete model again. Each submission replaces the previous one. You have at most ${MAX_ROUNDS} submissions, so make each one a real attempt.

"fills" are the efficient way to make bulk: a fill tiles a box (or just its outer walls when hollow is true) with the largest suitable pieces in stock, staggering joints automatically. Use fills for bases, walls, floors and solid masses, and individual "parts" for everything that gives the model its character: slopes, arches, round pieces, tiles, windows, accents. A fill of bricks stacks courses 3 plates tall, so its h must be a multiple of 3. Fills draw from what your individual parts leave in stock, and fail if the color runs out, so check stock before asking for large fills.

When the latest submission is valid and you are satisfied with how it looks, stop calling the tool and reply with one sentence describing the finished model.

# What makes a build good

Aim for something the builder will be delighted by. A recognisable silhouette matters most, then color used with intent, then detail. Work out the overall massing first, then refine. Use slopes, curves and round parts to break up blocky outlines where the inventory has them. Keep it sturdy: broad base, overlapped joints, nothing hanging by a single stud unless that is the point. Prefer a smaller model that is clearly the subject over a larger vague one, and let the inventory shape the design rather than fighting it. If the request cannot be met literally with these bricks, build the closest thing that captures its spirit.`;

/** The designer's one tool, described in JSON Schema so that any provider can be handed it. */
export const SUBMIT_TOOL: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } } = {
  name: 'submit_build',
  description:
    'Submit the complete model for validation. Returns problems (overlaps, unattached parts, inventory overruns) and text views of the result. Each call replaces the previous submission.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short display name for the model, like a set name.' },
      description: { type: 'string', description: 'One or two sentences describing the model for the builder.' },
      parts: {
        type: 'array',
        description: 'Individually placed parts.',
        items: {
          type: 'object',
          properties: {
            part: { type: 'string', description: 'Part id from the inventory.' },
            color: { type: 'integer', description: 'Color id from the inventory.' },
            x: { type: 'integer' },
            z: { type: 'integer' },
            y: { type: 'integer', description: 'Height of the underside in plates.' },
            rot: { type: 'integer', description: 'Quarter turns, 0 to 3. Defaults to 0.' },
          },
          required: ['part', 'color', 'x', 'z', 'y'],
        },
      },
      fills: {
        type: 'array',
        description: 'Boxes to tile automatically with rectangular pieces of one color.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['brick', 'plate', 'tile'], description: 'Piece family to tile with. Defaults to brick.' },
            color: { type: 'integer' },
            x: { type: 'integer' },
            z: { type: 'integer' },
            y: { type: 'integer' },
            w: { type: 'integer', description: 'Size along x in studs.' },
            d: { type: 'integer', description: 'Size along z in studs.' },
            h: { type: 'integer', description: 'Height in plates. Multiple of 3 for bricks. Defaults to one course.' },
            hollow: { type: 'boolean', description: 'Tile only the one-stud-thick outer walls of the box.' },
          },
          required: ['color', 'x', 'z', 'y', 'w', 'd'],
        },
      },
    },
    required: ['name', 'description'],
  },
};

interface Submission {
  name: string;
  description: string;
  ops: BuildOp[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Checks a submission by hand: providers do not all hold the model to the schema. Returns what is wrong with it, if anything. */
export function parseSubmission(input: unknown): Submission | string {
  if (typeof input !== 'object' || input === null) return 'input must be an object';
  const o = input as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.description !== 'string') return 'name and description are required strings';
  const ops: BuildOp[] = [];
  for (const [i, raw] of (Array.isArray(o.parts) ? o.parts : []).entries()) {
    const p = raw as Record<string, unknown>;
    if (typeof p?.part !== 'string' || !isInt(p.color) || !isInt(p.x) || !isInt(p.z) || !isInt(p.y)) {
      return `parts[${i}] needs part (string) and integer color, x, z, y`;
    }
    ops.push({ op: 'part', part: p.part, color: p.color, x: p.x, z: p.z, y: p.y, rot: isInt(p.rot) ? p.rot : 0 });
  }
  for (const [i, raw] of (Array.isArray(o.fills) ? o.fills : []).entries()) {
    const f = raw as Record<string, unknown>;
    if (!isInt(f?.color) || !isInt(f.x) || !isInt(f.z) || !isInt(f.y) || !isInt(f.w) || !isInt(f.d)) {
      return `fills[${i}] needs integer color, x, z, y, w, d`;
    }
    const kind = f.kind === 'plate' || f.kind === 'tile' || f.kind === 'brick' ? (f.kind as FillKind) : undefined;
    ops.push({ op: 'fill', color: f.color, x: f.x, z: f.z, y: f.y, w: f.w, d: f.d, h: isInt(f.h) ? f.h : undefined, kind, hollow: f.hollow === true });
  }
  if (!ops.length) return 'the build is empty: provide parts and/or fills';
  return { name: o.name.slice(0, 80), description: o.description.slice(0, 400), ops };
}

function report(parts: Placement[], issues: Issue[], catalog: DesignCatalog, palette: InventoryItem[], roundsLeft: number): string {
  const lines: string[] = [];
  if (issues.length) {
    lines.push(`INVALID: ${issues.length} problem${issues.length === 1 ? '' : 's'}.`);
    for (const issue of issues.slice(0, 30)) lines.push(`- ${issue.message}`);
    if (issues.length > 30) lines.push(`- ...and ${issues.length - 30} more.`);
  } else {
    lines.push(`VALID: ${parts.length} parts, all connected, all in stock.`);
  }
  lines.push('', renderViews(parts, catalog.shapes, catalog.colorNames));

  const used = new Map<string, number>();
  for (const p of parts) used.set(`${p.part}|${p.color}`, (used.get(`${p.part}|${p.color}`) ?? 0) + 1);
  const leftover = palette.reduce((sum, i) => sum + Math.max(0, i.qty - (used.get(`${i.part}|${i.color}`) ?? 0)), 0);
  lines.push('', `${leftover} pieces remain unused in the inventory.`);
  lines.push(
    roundsLeft > 0
      ? `You have ${roundsLeft} submission${roundsLeft === 1 ? '' : 's'} left.`
      : 'That was your last submission. Reply with one sentence describing the model.',
  );
  return lines.join('\n');
}

interface Attempt {
  submission: Submission;
  parts: Placement[];
  issues: Issue[];
}

/** What to tell the model about a tool call it made. */
export interface ToolReply {
  text: string;
  /** The call itself was faulty (unknown tool, malformed input, out of submissions), as opposed to a build with problems. */
  error: boolean;
}

/**
 * One design, from the opening brief to the finished model. The provider-specific code carries
 * messages to and from its model; everything about the build itself happens here.
 */
export class DesignSession {
  private readonly palette: InventoryItem[];
  private latest: Attempt | null = null;
  private lastValid: Attempt | null = null;
  private rounds = 0;

  constructor(
    private readonly request: DesignRequest,
    private readonly catalog: DesignCatalog,
    private readonly emit: (event: DesignEvent) => void,
  ) {
    this.palette = buildableInventory(request.inventory, catalog);
  }

  /** Whether there is anything to design with. Says so to the builder when there is not. */
  ready(): boolean {
    if (this.palette.length) return true;
    this.emit({ type: 'error', message: 'None of the pieces in your collection can be used by the designer yet. Scan some bricks, plates or slopes first.' });
    return false;
  }

  /** The builder's request and inventory, as the first message to the model. */
  brief(): string {
    const pieceCount = this.palette.reduce((n, i) => n + i.qty, 0);
    return [
      `Design this for me: ${this.request.prompt}`,
      `Target size. ${SIZE_GUIDE[this.request.size]}`,
      `My inventory (${pieceCount} usable pieces):`,
      describePalette(this.palette, this.catalog),
    ].join('\n\n');
  }

  /** Handles one tool call from the model, and says what to answer it. */
  call(name: string, input: unknown): ToolReply {
    if (name !== SUBMIT_TOOL.name) return { text: `Unknown tool ${name}.`, error: true };
    if (this.rounds >= MAX_ROUNDS) return { text: 'No submissions left. Reply with one sentence describing the model.', error: true };
    const submission = parseSubmission(input);
    if (typeof submission === 'string') return { text: JSON.stringify({ INVALID_JSON: JSON.stringify(input), problem: submission }), error: true };

    this.rounds++;
    const expanded = expandOps(submission.ops, this.catalog.shapes, this.palette);
    const issues = [...expanded.issues, ...analyze(expanded.parts, this.catalog.shapes, this.palette).issues];
    this.latest = { submission, parts: expanded.parts, issues };
    if (!issues.length) this.lastValid = this.latest;
    this.emit({ type: 'draft', round: this.rounds, parts: repair(expanded.parts, this.catalog.shapes, this.palette), issues: issues.length });
    this.emit({
      type: 'status',
      message: issues.length ? `Draft ${this.rounds}: fixing ${issues.length} problem${issues.length === 1 ? '' : 's'}` : `Draft ${this.rounds} holds together, refining`,
    });
    return { text: report(expanded.parts, issues, this.catalog, this.palette, MAX_ROUNDS - this.rounds), error: false };
  }

  /** The conversation is over: hands the builder the best build that came out of it. */
  finish(engine: DesignResult['engine']): void {
    const chosen = this.lastValid ?? this.latest;
    if (!chosen) {
      this.emit({ type: 'error', message: 'The designer did not produce a build. Please try again.' });
      return;
    }
    const parts = chosen === this.lastValid ? normalize(chosen.parts) : repair(chosen.parts, this.catalog.shapes, this.palette);
    if (!parts.length) {
      this.emit({ type: 'error', message: 'The designer could not find a build that holds together with these pieces. Try a simpler idea or a smaller size.' });
      return;
    }
    this.emit({
      type: 'done',
      design: { name: chosen.submission.name, description: chosen.submission.description, parts, repaired: chosen !== this.lastValid, engine },
    });
  }
}

/** Feeds a model's running commentary to the builder a sentence at a time, so the wait is informative. */
export function sentenceFeed(emit: (event: DesignEvent) => void): (delta: string) => void {
  let pending = '';
  return (delta) => {
    pending += delta;
    const end = Math.max(pending.lastIndexOf('. '), pending.lastIndexOf('\n'));
    if (end > 40) {
      emit({ type: 'note', text: pending.slice(0, end + 1).trim() });
      pending = pending.slice(end + 1);
    }
  };
}

// ---------------------------------------------------------------- surviving a lost connection

/** After the builder comes back to the app, a model silent for this long is taken to have been cut off. */
const SILENCE_AFTER_RETURN = 60_000;
/** A connection that fails with the app in plain view is retried this often before giving up. */
const QUICK_RETRIES = 2;
/** Every return to the app may find the connection gone; this many in one round is enough. */
const MAX_RESUMES = 12;

/** What a round needs to know of the app's surroundings: is it on screen, is the device online. */
export interface Surroundings {
  hidden(): boolean;
  offline(): boolean;
  /** Calls back whenever either may have changed. Returns a function that stops it doing so. */
  watch(changed: () => void): () => void;
}

interface Listenable {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
// Spelled out rather than taken from the browser's own types, which the tests are compiled without.
const world = globalThis as unknown as Partial<Listenable> & { document?: Listenable & { hidden: boolean }; navigator?: { onLine?: boolean } };

/** The surroundings as the browser reports them. Outside a browser: always on screen, always online. */
export const BROWSER: Surroundings = {
  hidden: () => Boolean(world.document?.hidden),
  offline: () => world.navigator?.onLine === false,
  watch: (changed) => {
    world.document?.addEventListener('visibilitychange', changed);
    world.addEventListener?.('online', changed);
    return () => {
      world.document?.removeEventListener('visibilitychange', changed);
      world.removeEventListener?.('online', changed);
    };
  },
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/** Resolves once the app is on screen and the device is online. */
function backInView(around: Surroundings, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (around.hidden() || around.offline()) return;
      stop();
      resolve();
    };
    const abort = () => (stop(), reject(signal!.reason));
    const unwatch = around.watch(check);
    const stop = () => {
      unwatch();
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort);
    check();
  });
}

/**
 * Runs one round of the conversation, and runs it again if the connection to the model is lost
 * on the way. That happens whenever a phone stops attending to the app: the screen locks, or the
 * builder switches to another app, and the system cuts the app's connections. The answer under
 * way is lost with it, but nothing before it is, so the round is simply asked for again once
 * the app is back on screen.
 *
 * `run` is given a signal that cancels it, and should call `alive` whenever the model is heard from.
 * (`patience` scales every wait, so that tests need not take minutes.)
 */
export async function resilientTurn<T>(
  run: (signal: AbortSignal, alive: () => void) => Promise<T>,
  options: { signal?: AbortSignal; emit: (event: DesignEvent) => void; lostConnection: (err: unknown) => boolean; surroundings?: Surroundings; patience?: number },
): Promise<T> {
  const { signal, emit, lostConnection, surroundings: around = BROWSER, patience = 1 } = options;
  let quick = 0;
  for (let resumes = 0; ; resumes++) {
    const turn = new AbortController();
    const cancel = () => turn.abort();
    signal?.addEventListener('abort', cancel);

    // A connection cut while the app was away does not always fail: it can just go quiet. So
    // after a return, the model has to be heard from now and then, or the round is cut short.
    let wasAway = around.hidden();
    let leftAt: number | null = wasAway ? Date.now() : null;
    let silent = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const listen = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ((silent = true), turn.abort()), SILENCE_AFTER_RETURN * patience);
    };
    const onVisibility = () => {
      if (around.hidden()) {
        leftAt = Date.now();
        clearTimeout(watchdog);
        watchdog = undefined;
      } else if (leftAt !== null) {
        if (Date.now() - leftAt > 5000 * patience) (wasAway = true), listen();
        leftAt = null;
      }
    };
    const unwatch = around.watch(onVisibility);

    try {
      return await run(turn.signal, () => watchdog && listen());
    } catch (err) {
      if (signal?.aborted) throw err;
      const lost = silent || lostConnection(err);
      const away = silent || wasAway || around.hidden() || around.offline();
      // With the app in plain view and online, a failed connection is a real failure sooner.
      if (!lost || resumes >= MAX_RESUMES || (!away && quick++ >= QUICK_RETRIES)) throw err;
      emit({ type: 'paused', reason: around.offline() ? 'offline' : 'away' });
    } finally {
      clearTimeout(watchdog);
      unwatch();
      signal?.removeEventListener('abort', cancel);
    }
    await backInView(around, signal);
    // A moment for the network to come back up; longer each time it fails with the app in view.
    await wait((1000 + quick * 2500) * patience, signal);
    emit({ type: 'resumed' });
  }
}
