// The build model shared by the designer (server) and the instruction viewer (client):
// placements on the stud grid, validation against physics and inventory, automatic repair,
// box filling with staggered bond, and step ordering for instructions.
import { type PartShape, type Rotation, isPlainBlock, ldrawPosition, rotatedCells, rotatedSize, rotationMatrix } from './shape.ts';

export type Shapes = Record<string, PartShape>;

export interface Placement {
  part: string;
  /** Rebrickable color id. */
  color: number;
  /** Min corner of the rotated footprint, in studs. */
  x: number;
  z: number;
  /** Height of the part's underside above the ground, in plates. */
  y: number;
  rot: Rotation;
}

export interface InventoryItem {
  part: string;
  color: number;
  qty: number;
}

export type FillKind = 'brick' | 'plate' | 'tile';

export type BuildOp =
  | ({ op: 'part' } & Omit<Placement, 'rot'> & { rot?: number })
  | { op: 'fill'; color: number; x: number; z: number; y: number; w: number; d: number; h?: number; kind?: FillKind; hollow?: boolean };

export interface Issue {
  kind: 'unknown-part' | 'inventory' | 'collision' | 'underground' | 'disconnected' | 'fill' | 'bounds' | 'empty';
  message: string;
  /** Indices into the placement list that the issue concerns. */
  parts: number[];
}

/** Largest build volume the designer may use: studs across and plates high. */
export const MAX_SPAN = 48;
export const MAX_HEIGHT = 150;

export const elementKey = (part: string, color: number) => `${part}|${color}`;

// ---------------------------------------------------------------- analysis

interface Voxel {
  part: number;
  /** True when this voxel is the bottom of a column that accepts a stud. */
  socket: boolean;
}

export interface Analysis {
  issues: Issue[];
  /** Pairs of part indices joined stud-to-socket. */
  links: [number, number][];
  /** Connected groups of part indices, largest first. */
  groups: number[][];
  size: { w: number; d: number; h: number };
}

const voxelKey = (x: number, z: number, y: number) => `${x},${z},${y}`;

/** Checks a build for everything that would stop it being built from the given inventory. */
export function analyze(parts: Placement[], shapes: Shapes, inventory?: InventoryItem[]): Analysis {
  const issues: Issue[] = [];
  const voxels = new Map<string, Voxel>();
  const studs: { part: number; x: number; z: number; y: number }[] = [];
  const valid: boolean[] = [];
  let maxX = 0;
  let maxZ = 0;
  let maxY = 0;

  if (parts.length === 0) issues.push({ kind: 'empty', message: 'The build has no parts.', parts: [] });

  parts.forEach((p, index) => {
    const shape = shapes[p.part];
    if (!shape) {
      issues.push({ kind: 'unknown-part', message: `Part "${p.part}" is not a buildable part.`, parts: [index] });
      valid.push(false);
      return;
    }
    const size = rotatedSize(shape, p.rot);
    if (p.y < 0) {
      issues.push({ kind: 'underground', message: `${describe(p, shape)} is below the ground (y must be 0 or more).`, parts: [index] });
      valid.push(false);
      return;
    }
    if (p.x < 0 || p.z < 0 || p.x + size.w > MAX_SPAN || p.z + size.d > MAX_SPAN || p.y + shape.h > MAX_HEIGHT) {
      issues.push({
        kind: 'bounds',
        message: `${describe(p, shape)} is outside the build area (x and z from 0 to ${MAX_SPAN - 1}, height up to ${MAX_HEIGHT} plates).`,
        parts: [index],
      });
      valid.push(false);
      return;
    }

    const cells = rotatedCells(shape, p.rot);
    const clash = new Set<number>();
    for (const c of cells) {
      for (let y = p.y + c.lo; y < p.y + c.hi; y++) {
        const hit = voxels.get(voxelKey(p.x + c.x, p.z + c.z, y));
        if (hit) clash.add(hit.part);
      }
    }
    if (clash.size) {
      const others = [...clash].slice(0, 3).map((i) => describe(parts[i], shapes[parts[i].part]));
      issues.push({ kind: 'collision', message: `${describe(p, shape)} overlaps ${others.join(' and ')}.`, parts: [index, ...clash] });
      valid.push(false);
      return;
    }
    for (const c of cells) {
      for (let y = p.y + c.lo; y < p.y + c.hi; y++) {
        voxels.set(voxelKey(p.x + c.x, p.z + c.z, y), { part: index, socket: c.recv && c.lo === 0 && y === p.y });
      }
      if (c.stud >= 0) studs.push({ part: index, x: p.x + c.x, z: p.z + c.z, y: p.y + c.stud });
    }
    valid.push(true);
    maxX = Math.max(maxX, p.x + size.w);
    maxZ = Math.max(maxZ, p.z + size.d);
    maxY = Math.max(maxY, p.y + shape.h);
  });

  // A stud joins two parts when the voxel directly above it is the socket of another part.
  const links: [number, number][] = [];
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const linked = new Set<string>();
  for (const s of studs) {
    const above = voxels.get(voxelKey(s.x, s.z, s.y));
    if (!above || !above.socket || above.part === s.part) continue;
    const key = `${s.part}-${above.part}`;
    if (!linked.has(key)) {
      linked.add(key);
      links.push([s.part, above.part]);
    }
    parent[find(s.part)] = find(above.part);
  }

  const byRoot = new Map<number, number[]>();
  parts.forEach((_, i) => {
    if (!valid[i]) return;
    const root = find(i);
    const group = byRoot.get(root);
    if (group) group.push(i);
    else byRoot.set(root, [i]);
  });
  const groups = [...byRoot.values()].sort((a, b) => b.length - a.length);
  for (const group of groups.slice(1)) {
    const names = group.slice(0, 4).map((i) => describe(parts[i], shapes[parts[i].part]));
    const more = group.length > 4 ? ` and ${group.length - 4} more` : '';
    issues.push({
      kind: 'disconnected',
      message:
        group.length === 1
          ? `${names[0]} is not attached to anything: none of its studs or sockets meets another part.`
          : `A group of ${group.length} parts is not attached to the rest of the build: ${names.join(', ')}${more}.`,
      parts: group,
    });
  }

  if (inventory) {
    const have = new Map(inventory.map((i) => [elementKey(i.part, i.color), i.qty]));
    const used = new Map<string, number[]>();
    parts.forEach((p, i) => {
      const key = elementKey(p.part, p.color);
      const list = used.get(key);
      if (list) list.push(i);
      else used.set(key, [i]);
    });
    for (const [key, indices] of used) {
      const owned = have.get(key) ?? 0;
      if (indices.length <= owned) continue;
      const p = parts[indices[0]];
      const shape = shapes[p.part];
      issues.push({
        kind: 'inventory',
        message: `Uses ${indices.length} of ${shape?.name ?? p.part} (${p.part}) in color ${p.color}, but only ${owned} are in the inventory.`,
        parts: indices.slice(owned),
      });
    }
  }

  return { issues, links, groups, size: { w: maxX, d: maxZ, h: maxY } };
}

function describe(p: Placement, shape?: PartShape): string {
  return `${shape?.name ?? p.part} (${p.part}) at x=${p.x} z=${p.z} y=${p.y}`;
}

/**
 * Makes a build valid by removing whatever breaks it: unknown, colliding and over-inventory parts,
 * then everything outside the largest connected group. Returns the surviving parts shifted to the origin.
 */
export function repair(parts: Placement[], shapes: Shapes, inventory?: InventoryItem[]): Placement[] {
  let current = parts;
  for (let pass = 0; pass < 6; pass++) {
    const { issues, groups } = analyze(current, shapes, inventory);
    if (!issues.length) break;
    const drop = new Set<number>();
    for (const issue of issues) {
      // For a collision only the later part (listed first) is removed; the part it hit stays.
      if (issue.kind === 'collision') drop.add(issue.parts[0]);
      else if (issue.kind !== 'disconnected' && issue.kind !== 'empty') issue.parts.forEach((i) => drop.add(i));
    }
    if (drop.size === 0) {
      const keep = new Set(groups[0] ?? []);
      current.forEach((_, i) => !keep.has(i) && drop.add(i));
    }
    if (drop.size === 0) break;
    current = current.filter((_, i) => !drop.has(i));
  }
  return normalize(current);
}

/** Shifts a build so it starts at x=0, z=0 and rests on the ground. */
export function normalize(parts: Placement[]): Placement[] {
  if (!parts.length) return parts;
  const minX = Math.min(...parts.map((p) => p.x));
  const minZ = Math.min(...parts.map((p) => p.z));
  const minY = Math.min(...parts.map((p) => p.y));
  return parts.map((p) => ({ ...p, x: p.x - minX, z: p.z - minZ, y: p.y - minY }));
}

// ---------------------------------------------------------------- fill

/** Which fill family a shape belongs to, if it is a plain rectangular brick, plate or tile. */
export function fillKind(shape: PartShape): FillKind | null {
  if (/^Brick \d+ x \d+$/.test(shape.name) && shape.h === 3 && isPlainBlock(shape)) return 'brick';
  if (/^Plate \d+ x \d+$/.test(shape.name) && shape.h === 1 && isPlainBlock(shape)) return 'plate';
  if (/^Tile \d+ x \d+( with Groove)?$/.test(shape.name) && shape.h === 1) {
    for (let i = 0; i < shape.w * shape.d; i++) {
      if (shape.lo[i] !== 0 || shape.hi[i] !== 1 || shape.stud[i] !== -1 || shape.recv[i] !== 1) return null;
    }
    return 'tile';
  }
  return null;
}

interface FillResult {
  parts: Placement[];
  /** Set when the region could not be completed with the pieces that are left. */
  error?: string;
}

/**
 * Tiles a box (or its one-stud-thick perimeter when hollow) with rectangular pieces of one color,
 * staggering the joints from course to course so the result holds together.
 * `stock` is the remaining inventory and is decremented as pieces are used.
 */
export function fill(
  op: Extract<BuildOp, { op: 'fill' }>,
  shapes: Shapes,
  stock: Map<string, number>,
): FillResult {
  const { color, x, z, y, w, d } = op;
  const kind: FillKind = op.kind ?? 'brick';
  const courseHeight = kind === 'brick' ? 3 : 1;
  const height = op.h ?? courseHeight;
  if (w < 1 || d < 1 || height < 1) return { parts: [], error: 'fill needs w, d and h of at least 1.' };
  if (height % courseHeight !== 0) {
    return { parts: [], error: `fill with bricks needs h to be a multiple of 3 plates (got ${height}); use kind "plate" for thinner layers.` };
  }

  // Candidate pieces in this color, biggest first, in both orientations.
  const pieces: { id: string; w: number; d: number; rot: Rotation; area: number }[] = [];
  for (const shape of Object.values(shapes)) {
    if (fillKind(shape) !== kind) continue;
    if ((stock.get(elementKey(shape.id, color)) ?? 0) <= 0) continue;
    pieces.push({ id: shape.id, w: shape.w, d: shape.d, rot: 0, area: shape.w * shape.d });
    if (shape.w !== shape.d) pieces.push({ id: shape.id, w: shape.d, d: shape.w, rot: 1, area: shape.w * shape.d });
  }
  if (!pieces.length) return { parts: [], error: `No ${kind}s in color ${color} are left in the inventory.` };

  const inRegion = (cx: number, cz: number) =>
    cx >= 0 && cz >= 0 && cx < w && cz < d && (!op.hollow || cx === 0 || cz === 0 || cx === w - 1 || cz === d - 1);

  const taken = new Map<string, number>(); // local stock deltas, committed only on success
  const left = (id: string) => (stock.get(elementKey(id, color)) ?? 0) - (taken.get(id) ?? 0);
  type Piece = (typeof pieces)[number];

  const placed: Placement[] = [];
  let below: Int32Array | null = null; // piece index per cell in the previous course, -1 for empty
  const courses = height / courseHeight;
  for (let course = 0; course < courses; course++) {
    const grid = new Int32Array(w * d).fill(-1);
    const layer: { piece: Piece; cx: number; cz: number }[] = [];
    // Largest-first is usually right but can paint itself into a corner (a 6x6 plate leaving a strip
    // nothing fits), so the search backtracks, within a budget that keeps huge fills responsive.
    let budget = 20000;

    /** Pieces that fit with their corner at (cx, cz), most desirable first. */
    const candidatesAt = (cx: number, cz: number): Piece[] => {
      const scored: { piece: Piece; score: number }[] = [];
      for (const piece of pieces) {
        if (left(piece.id) <= 0) continue;
        let fits = true;
        const covered = new Set<number>();
        for (let pz = cz; pz < cz + piece.d && fits; pz++) {
          for (let px = cx; px < cx + piece.w; px++) {
            if (!inRegion(px, pz) || grid[pz * w + px] !== -1) {
              fits = false;
              break;
            }
            if (below) covered.add(below[pz * w + px]);
          }
        }
        if (!fits) continue;

        // Joints that line up with a joint in the course below are what make a wall fall apart.
        let aligned = 0;
        if (below) {
          const ex = cx + piece.w;
          if (ex < w) {
            for (let pz = cz; pz < cz + piece.d; pz++) {
              if (inRegion(ex, pz) && below[pz * w + ex - 1] !== below[pz * w + ex]) aligned++;
            }
          }
          const ez = cz + piece.d;
          if (ez < d) {
            for (let px = cx; px < cx + piece.w; px++) {
              if (inRegion(px, ez) && below[(ez - 1) * w + px] !== below[ez * w + px]) aligned++;
            }
          }
        }
        const alongX = piece.w >= piece.d;
        scored.push({
          piece,
          score: piece.area + 3 * Math.max(0, covered.size - 1) - 4 * aligned + (alongX === (course % 2 === 0) ? 0.5 : 0),
        });
      }
      return scored.sort((a, b) => b.score - a.score).map((c) => c.piece);
    };

    const solve = (from: number): boolean => {
      let i = from;
      while (i < w * d && (!inRegion(i % w, (i / w) | 0) || grid[i] !== -1)) i++;
      if (i >= w * d) return true;
      if (budget-- <= 0) return false;
      const cx = i % w;
      const cz = (i / w) | 0;
      for (const piece of candidatesAt(cx, cz)) {
        for (let pz = cz; pz < cz + piece.d; pz++) {
          for (let px = cx; px < cx + piece.w; px++) grid[pz * w + px] = layer.length;
        }
        taken.set(piece.id, (taken.get(piece.id) ?? 0) + 1);
        layer.push({ piece, cx, cz });
        if (solve(i + 1)) return true;
        layer.pop();
        taken.set(piece.id, taken.get(piece.id)! - 1);
        for (let pz = cz; pz < cz + piece.d; pz++) {
          for (let px = cx; px < cx + piece.w; px++) grid[pz * w + px] = -1;
        }
        if (budget <= 0) return false;
      }
      return false;
    };

    if (!solve(0)) {
      const available = Object.values(shapes)
        .filter((shape) => fillKind(shape) === kind && (stock.get(elementKey(shape.id, color)) ?? 0) > 0)
        .map((shape) => `${shape.name} x${stock.get(elementKey(shape.id, color))}`)
        .join(', ');
      return {
        parts: [],
        error: `Cannot fill ${w}x${d}x${height}${op.hollow ? ' (hollow)' : ''} at x=${x} z=${z} y=${y} with the ${kind}s left in color ${color}. In stock before this fill: ${available}.`,
      };
    }
    for (const { piece, cx, cz } of layer) {
      placed.push({ part: piece.id, color, x: x + cx, z: z + cz, y: y + course * courseHeight, rot: piece.rot });
    }
    below = grid;
  }

  for (const [id, n] of taken) stock.set(elementKey(id, color), (stock.get(elementKey(id, color)) ?? 0) - n);
  return { parts: placed };
}

/** Expands designer operations into individual placements, drawing fills from the inventory. */
export function expandOps(ops: BuildOp[], shapes: Shapes, inventory: InventoryItem[]): { parts: Placement[]; issues: Issue[] } {
  const stock = new Map(inventory.map((i) => [elementKey(i.part, i.color), i.qty]));
  const parts: Placement[] = [];
  const issues: Issue[] = [];
  // Single parts first so fills only use what the explicit placements leave over.
  for (const op of ops) {
    if (op.op !== 'part') continue;
    const rot = ((((op.rot ?? 0) % 4) + 4) % 4) as Rotation;
    parts.push({ part: op.part, color: op.color, x: op.x, z: op.z, y: op.y, rot });
    const key = elementKey(op.part, op.color);
    stock.set(key, (stock.get(key) ?? 0) - 1);
  }
  for (const op of ops) {
    if (op.op !== 'fill') continue;
    const result = fill(op, shapes, stock);
    if (result.error) issues.push({ kind: 'fill', message: result.error, parts: [] });
    parts.push(...result.parts);
  }
  return { parts, issues };
}

// ---------------------------------------------------------------- instructions

/**
 * Orders a valid build into instruction steps: bottom-up, never asking the builder to place a part
 * that has nothing to attach to yet, and grouping a few neighbouring parts per step.
 * Returns part indices per step.
 */
export function planSteps(parts: Placement[], shapes: Shapes): number[][] {
  const { links } = analyze(parts, shapes);
  const neighbours: number[][] = parts.map(() => []);
  for (const [a, b] of links) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }

  const total = parts.length;
  const perStep = total <= 16 ? 2 : total <= 50 ? 3 : total <= 110 ? 4 : total <= 220 ? 6 : 8;
  const ground = Math.min(...parts.map((p) => p.y));
  const placed = new Set<number>();
  const steps: number[][] = [];

  while (placed.size < total) {
    const ready: number[] = [];
    for (let i = 0; i < total; i++) {
      if (placed.has(i)) continue;
      if (parts[i].y === ground || neighbours[i].some((n) => placed.has(n))) ready.push(i);
    }
    // Nothing attachable (should not happen in a connected build): take the lowest remaining part.
    if (!ready.length) {
      let lowest = -1;
      for (let i = 0; i < total; i++) if (!placed.has(i) && (lowest < 0 || parts[i].y < parts[lowest].y)) lowest = i;
      ready.push(lowest);
    }

    const level = Math.min(...ready.map((i) => parts[i].y));
    const row = ready.filter((i) => parts[i].y === level);
    // Identical pieces go together, then back-to-front and left-to-right like a printed manual.
    row.sort((a, b) => {
      const pa = parts[a];
      const pb = parts[b];
      return pa.part.localeCompare(pb.part) || pa.color - pb.color || pb.z - pa.z || pa.x - pb.x;
    });
    for (let i = 0; i < row.length; i += perStep) {
      const step = row.slice(i, i + perStep);
      steps.push(step);
      step.forEach((p) => placed.add(p));
    }
  }
  return steps;
}

/** One LDraw sub-file line for a placement. */
export function ldrawLine(p: Placement, shape: PartShape): string {
  const pos = ldrawPosition(shape, p.rot, p.x, p.z, p.y);
  return `1 ${p.color} ${pos.x} ${pos.y} ${pos.z} ${rotationMatrix(p.rot).join(' ')} ${shape.id}.dat`;
}

/** Bill of materials: unique elements with counts, most used first. */
export function partsList(parts: Placement[]): InventoryItem[] {
  const counts = new Map<string, InventoryItem>();
  for (const p of parts) {
    const key = elementKey(p.part, p.color);
    const item = counts.get(key);
    if (item) item.qty++;
    else counts.set(key, { part: p.part, color: p.color, qty: 1 });
  }
  return [...counts.values()].sort((a, b) => b.qty - a.qty || a.part.localeCompare(b.part) || a.color - b.color);
}

// ---------------------------------------------------------------- text views for the designer model

/**
 * ASCII projections of a build (top, front, right) so a language model can check what it made.
 * Each color gets a letter; '.' is empty space.
 */
export function renderViews(parts: Placement[], shapes: Shapes, colorNames: Record<number, string>): string {
  if (!parts.length) return '(empty build)';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const letterOf = new Map<number, string>();
  const voxels = new Map<string, number>();
  let w = 0;
  let d = 0;
  let h = 0;
  for (const p of parts) {
    const shape = shapes[p.part];
    if (!shape) continue;
    if (!letterOf.has(p.color)) letterOf.set(p.color, letters[letterOf.size % letters.length]);
    for (const c of rotatedCells(shape, p.rot)) {
      for (let y = p.y + c.lo; y < p.y + c.hi; y++) voxels.set(voxelKey(p.x + c.x, p.z + c.z, y), p.color);
      w = Math.max(w, p.x + c.x + 1);
      d = Math.max(d, p.z + c.z + 1);
      h = Math.max(h, p.y + c.hi);
    }
  }
  const at = (x: number, z: number, y: number) => voxels.get(voxelKey(x, z, y));
  const cell = (color: number | undefined) => (color === undefined ? '.' : letterOf.get(color)!);

  // LDraw space is right-handed with the viewer in front at low z, so a true top view has the back row first.
  const top: string[] = [];
  for (let z = d - 1; z >= 0; z--) {
    let row = '';
    for (let x = 0; x < w; x++) {
      let color: number | undefined;
      for (let y = h - 1; y >= 0 && color === undefined; y--) color = at(x, z, y);
      row += cell(color);
    }
    top.push(row);
  }
  const front: string[] = [];
  const right: string[] = [];
  for (let y = h - 1; y >= 0; y--) {
    let f = '';
    for (let x = 0; x < w; x++) {
      let color: number | undefined;
      for (let z = 0; z < d && color === undefined; z++) color = at(x, z, y);
      f += cell(color);
    }
    front.push(f);
    let r = '';
    for (let z = 0; z < d; z++) {
      let color: number | undefined;
      for (let x = w - 1; x >= 0 && color === undefined; x--) color = at(x, z, y);
      r += cell(color);
    }
    right.push(r);
  }

  const legend = [...letterOf].map(([color, letter]) => `${letter}=${colorNames[color] ?? color}`).join('  ');
  return [
    `Size: ${w} studs wide (x), ${d} studs deep (z), ${h} plates tall. Legend: ${legend}`,
    `TOP VIEW (looking down; x left to right, back row z=${d - 1} first, front row z=0 last):`,
    ...top,
    `FRONT VIEW (standing in front, looking toward the back; x left to right, one row per plate, ground at the bottom):`,
    ...front,
    `RIGHT VIEW (standing at the right side, looking left; front z=0 on the left, back on the right):`,
    ...right,
  ].join('\n');
}
