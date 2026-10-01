// Offline fallback designer for when no Anthropic API key is configured. It knows a few simple
// archetypes, tries them from most to least ambitious, and keeps the first one the validator accepts.
import { analyze, expandOps, fillKind, normalize, repair, type BuildOp, type Placement } from './build.ts';
import type { DesignCatalog, DesignRequest, DesignResult, DesignSize } from './design.ts';
import { buildableInventory } from './palette.ts';

type Family = 'tower' | 'house' | 'pyramid';

const SCALE: Record<DesignSize, number> = { small: 0, medium: 1, large: 2 };

function pickFamily(prompt: string): Family {
  if (/\b(tower|castle|lighthouse|turret|keep|fort|skyscraper|rocket)\b/i.test(prompt)) return 'tower';
  if (/\b(house|home|cottage|cabin|hut|barn|shop|store|garage|building|shed)\b/i.test(prompt)) return 'house';
  return 'pyramid';
}

function tower(side: number, courses: number, a: number, b: number): BuildOp[] {
  const ops: BuildOp[] = [];
  for (let c = 0; c < courses; c++) {
    // Two-course color bands; a single hollow fill per band keeps the joints staggered within it.
    if (c % 2 === 0) {
      const h = Math.min(2, courses - c) * 3;
      ops.push({ op: 'fill', color: Math.floor(c / 2) % 2 === 0 ? a : b, x: 0, z: 0, y: c * 3, w: side, d: side, h, hollow: true });
    }
  }
  // Battlements: a single brick on every other wall stud.
  for (let i = 0; i < side; i += 2) {
    for (const [x, z] of [[i, 0], [side - 1, i], [side - 1 - i, side - 1], [0, side - 1 - i]]) {
      ops.push({ op: 'part', part: '3005', color: b, x, z, y: courses * 3 });
    }
  }
  return ops;
}

function house(w: number, d: number, wall: number, roof: number): BuildOp[] {
  const ops: BuildOp[] = [{ op: 'fill', color: wall, x: 0, z: 0, y: 0, w, d, h: 9, hollow: true }];
  // Gable roof: solid courses that step in from the front and back.
  for (let k = 0; d - 2 * k > 0; k++) {
    ops.push({ op: 'fill', color: roof, x: 0, z: k, y: 9 + k * 3, w, d: d - 2 * k, h: 3 });
  }
  return ops;
}

function pyramid(base: number, a: number, b: number): BuildOp[] {
  const ops: BuildOp[] = [];
  for (let k = 0; base - 2 * k > 0; k++) {
    ops.push({ op: 'fill', color: k % 2 === 0 ? a : b, x: k, z: k, y: k * 3, w: base - 2 * k, d: base - 2 * k, h: 3 });
  }
  return ops;
}

function candidates(family: Family, scale: number, a: number, b: number): BuildOp[][] {
  const list: BuildOp[][] = [];
  for (let s = scale; s >= 0; s--) {
    if (family === 'tower') list.push(tower(4 + s * 2, 4 + s * 3, a, b), tower(4 + s, 3 + s * 2, a, b));
    else if (family === 'house') list.push(house(6 + s * 2, 6 + s * 2, a, b), house(6 + s * 2, 4 + s * 2, a, b));
    else list.push(pyramid(6 + s * 3, a, b), pyramid(4 + s * 2, a, b));
  }
  return list;
}

export function quickBuild(request: DesignRequest, catalog: DesignCatalog): DesignResult | null {
  const palette = buildableInventory(request.inventory, catalog);
  // Rank colors by how much brick area they can cover.
  const area = new Map<number, number>();
  for (const item of palette) {
    const shape = catalog.shapes[item.part];
    if (fillKind(shape) !== 'brick') continue;
    area.set(item.color, (area.get(item.color) ?? 0) + shape.w * shape.d * item.qty);
  }
  const colors = [...area].sort((x, y) => y[1] - x[1]).map(([color]) => color);
  if (!colors.length) return null;

  const requested = pickFamily(request.prompt);
  const families: Family[] = [requested, ...(['pyramid', 'tower', 'house'] as Family[]).filter((f) => f !== requested)];
  const pairs: [number, number][] = [];
  for (const a of colors.slice(0, 4)) for (const b of colors.slice(0, 4)) if (a !== b || colors.length === 1) pairs.push([a, b]);

  let fallback: { parts: Placement[]; family: Family } | null = null;
  for (const family of families) {
    // Archetypes are generated with color slots 0 (primary) and 1 (secondary), then mapped onto real colors.
    for (const ops of candidates(family, SCALE[request.size], 0, 1)) {
      for (const [a, b] of pairs) {
        const colored = ops.map((op) => ({ ...op, color: op.color === 0 ? a : b }));
        const expanded = expandOps(colored, catalog.shapes, palette);
        const issues = [...expanded.issues, ...analyze(expanded.parts, catalog.shapes, palette).issues];
        if (!issues.length) return describe(family, normalize(expanded.parts), false, requested);
        const salvaged = repair(expanded.parts, catalog.shapes, palette);
        if (salvaged.length > (fallback?.parts.length ?? 3)) fallback = { parts: salvaged, family };
      }
    }
    if (family === requested && fallback) break;
  }
  return fallback ? describe(fallback.family, fallback.parts, true, requested) : null;
}

function describe(family: Family, parts: Placement[], repaired: boolean, requested: Family): DesignResult {
  const label = { tower: 'Watchtower', house: 'Little House', pyramid: 'Step Pyramid' }[family];
  const note = family === requested ? '' : ' Your bricks suited this better than what you asked for.';
  return {
    name: label,
    description: `A simple ${label.toLowerCase()} assembled by the offline quick-builder from ${parts.length} of your pieces.${note} Add an Anthropic API key in Settings to design anything you can describe.`,
    parts,
    repaired,
    engine: 'quick',
  };
}
