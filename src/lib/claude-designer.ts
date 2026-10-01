// The AI designer: Claude proposes a build from the user's inventory, the validator checks it
// against physics and stock, and the two iterate until the build is sound.
// Runs in the browser and calls the Anthropic API directly with the key the builder entered in
// Settings, so the app needs no server of its own. The key is the builder's own and stays on
// their device; that is what makes `dangerouslyAllowBrowser` acceptable here.
import Anthropic from '@anthropic-ai/sdk';
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
import type { DesignCatalog, DesignEvent, DesignRequest, DesignSize } from '../../shared/design.ts';
import { buildableInventory, describePalette } from '../../shared/palette.ts';

const MODEL = 'claude-opus-5-5';
const MAX_ROUNDS = 5;

const SIZE_GUIDE: Record<DesignSize, string> = {
  small: 'Small: roughly 20 to 45 parts, something that fits in a hand.',
  medium: 'Medium: roughly 45 to 110 parts.',
  large: 'Large: roughly 110 to 260 parts, a centerpiece model.',
};

const SYSTEM = `You are a master LEGO model designer. A builder describes what they want, and you design a model they can physically build right now from the bricks they own. Their inventory is the hard limit: you may only use parts and colors listed in it, and never more of an element than they have.

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

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: 'submit_build',
  description:
    'Submit the complete model for validation. Returns problems (overlaps, unattached parts, inventory overruns) and text views of the result. Each call replaces the previous submission.',
  eager_input_streaming: true,
  input_schema: {
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

/** Validates a tool input by hand: with eager input streaming the API no longer checks it against the schema. */
function parseSubmission(input: unknown): Submission | string {
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

/** Runs the design conversation, emitting progress as it goes. */
export async function designWithClaude(
  request: DesignRequest,
  catalog: DesignCatalog,
  emit: (event: DesignEvent) => void,
  options: { apiKey: string; signal?: AbortSignal },
): Promise<void> {
  const palette = buildableInventory(request.inventory, catalog);
  if (!palette.length) {
    emit({ type: 'error', message: 'None of the pieces in your collection can be used by the designer yet. Scan some bricks, plates or slopes first.' });
    return;
  }
  const pieceCount = palette.reduce((n, i) => n + i.qty, 0);

  const client = new Anthropic({ apiKey: options.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: [
        `Design this for me: ${request.prompt}`,
        `Target size. ${SIZE_GUIDE[request.size]}`,
        `My inventory (${pieceCount} usable pieces):`,
        describePalette(palette, catalog),
      ].join('\n\n'),
    },
  ];

  type Attempt = { submission: Submission; parts: Placement[]; issues: Issue[] };
  let latest = null as Attempt | null;
  let lastValid = null as Attempt | null;
  let rounds = 0;
  let jsonRetries = 0;

  emit({ type: 'status', message: 'Studying your collection' });

  while (true) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM,
        tools: [SUBMIT_TOOL],
        messages,
      },
      { signal: options.signal },
    );

    let note = '';
    stream.on('thinking', (delta) => {
      note += delta;
      // Surface the designer's reasoning a sentence at a time so the wait is informative.
      const end = Math.max(note.lastIndexOf('. '), note.lastIndexOf('\n'));
      if (end > 40) {
        emit({ type: 'note', text: note.slice(0, end + 1).trim() });
        note = note.slice(end + 1);
      }
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming a tool input that is not parseable JSON rejects here; re-issue the turn.
      if (err instanceof Anthropic.APIError || options.signal?.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: 'The designer declined this request. Try describing the model differently.' });
      return;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    // A tool input cut off at max_tokens can parse as a valid partial object, so never run it.
    if (!toolUses.length || message.stop_reason === 'max_tokens') break;

    messages.push({ role: 'assistant', content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (use.name !== 'submit_build') {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}.` });
        continue;
      }
      if (rounds >= MAX_ROUNDS) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'No submissions left. Reply with one sentence describing the model.' });
        continue;
      }
      const submission = parseSubmission(use.input);
      if (typeof submission === 'string') {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: JSON.stringify({ INVALID_JSON: JSON.stringify(use.input), problem: submission }),
        });
        continue;
      }
      rounds++;
      const expanded = expandOps(submission.ops, catalog.shapes, palette);
      const issues = [...expanded.issues, ...analyze(expanded.parts, catalog.shapes, palette).issues];
      latest = { submission, parts: expanded.parts, issues };
      if (!issues.length) lastValid = latest;
      emit({ type: 'draft', round: rounds, parts: repair(expanded.parts, catalog.shapes, palette), issues: issues.length });
      emit({
        type: 'status',
        message: issues.length ? `Draft ${rounds}: fixing ${issues.length} problem${issues.length === 1 ? '' : 's'}` : `Draft ${rounds} holds together, refining`,
      });
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: report(expanded.parts, issues, catalog, palette, MAX_ROUNDS - rounds),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  const chosen = lastValid ?? latest;
  if (!chosen) {
    emit({ type: 'error', message: 'The designer did not produce a build. Please try again.' });
    return;
  }
  const parts = chosen === lastValid ? normalize(chosen.parts) : repair(chosen.parts, catalog.shapes, palette);
  if (!parts.length) {
    emit({ type: 'error', message: 'The designer could not find a build that holds together with these pieces. Try a simpler idea or a smaller size.' });
    return;
  }
  emit({
    type: 'done',
    design: {
      name: chosen.submission.name,
      description: chosen.submission.description,
      parts,
      repaired: chosen !== lastValid,
      engine: 'claude',
    },
  });
}

/** Turns an SDK failure into a message a builder can act on. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check the key in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the designer model.';
  if (err instanceof Anthropic.RateLimitError) return 'The designer is rate limited right now. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `The designer hit an API error (${err.status ?? 'unknown'}). Please try again.`;
  return err instanceof Error ? err.message : 'Something went wrong while designing.';
}
