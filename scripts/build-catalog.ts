// Turns the raw downloads in ./data into the compact catalog the app ships with (public/catalog):
//   colors.json, categories.json   reference tables
//   parts.json                     every catalogued part, columnar
//   part-colors.json               which colors each part was ever produced in
//   relations.json                 print -> plain part, mold/alternate groups
//   shapes.json                    stud-grid model of every part the designer can build with
//   sets.json                      every set with an inventory (see build-sets.ts)
// and, next to it, public/ldraw (part geometry, see build-geometry.ts) and public/sets (set inventories).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LDrawLibrary, normalizeRef } from './ldraw-lib.ts';
import { PLATE, STUD, type PartShape } from '../shared/shape.ts';
import { buildGeometry } from './build-geometry.ts';
import { buildSets } from './build-sets.ts';
import { readCsv } from './csv.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
const outDir = path.join(publicDir, 'catalog');
const verbose = process.argv.includes('--verbose');

// ---------------------------------------------------------------- LDraw geometry

// Primitives that are a stud on top of a part. Underside tubes ("Stud Tube ...") are ordinary body geometry.
const TOP_STUDS = new Set(
  [
    'stud', 'stud2', 'stud2a', 'studa', 'studp01', 'studel', 'stud6', 'stud6a', 'stud9', 'stud10', 'stud13',
    'stud15', 'stud17', 'stud17a', 'stud26', 'studh', 'studhl', 'studhr', 'studx', 'studxa', 'studline',
    'stud-logo', 'stud-logo2', 'stud-logo3', 'stud-logo4', 'stud-logo5',
    'stud2-logo', 'stud2-logo2', 'stud2-logo3', 'stud2-logo4', 'stud2-logo5',
  ].flatMap((n) => [`${n}.dat`, `8/${n}.dat`, `48/${n}.dat`]),
);
// Other building systems (Duplo, Quatro, Scala): never compatible with the System grid.
const FOREIGN_STUDS = /^(?:8\/|48\/)?stud(?:5|7a?|8a?|8s2|11|14|19|20|24|25|27a?|28a?)\.dat$/;

/** Affine transform as [a b c d e f g h i x y z] (row-major 3x3 followed by translation). */
type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function compose(p: Mat, c: Mat): Mat {
  return [
    p[0] * c[0] + p[1] * c[3] + p[2] * c[6], p[0] * c[1] + p[1] * c[4] + p[2] * c[7], p[0] * c[2] + p[1] * c[5] + p[2] * c[8],
    p[3] * c[0] + p[4] * c[3] + p[5] * c[6], p[3] * c[1] + p[4] * c[4] + p[5] * c[7], p[3] * c[2] + p[4] * c[5] + p[5] * c[8],
    p[6] * c[0] + p[7] * c[3] + p[8] * c[6], p[6] * c[1] + p[7] * c[4] + p[8] * c[7], p[6] * c[2] + p[7] * c[5] + p[8] * c[8],
    p[0] * c[9] + p[1] * c[10] + p[2] * c[11] + p[9],
    p[3] * c[9] + p[4] * c[10] + p[5] * c[11] + p[10],
    p[6] * c[9] + p[7] * c[10] + p[8] * c[11] + p[11],
  ];
}

interface ParsedFile {
  /** Triangles in file-local space, 9 numbers each. */
  tris: number[];
  refs: { m: Mat; name: string }[];
}

const parsedFiles = new Map<string, ParsedFile>();

function parseFile(name: string, text: string): ParsedFile {
  let parsed = parsedFiles.get(name);
  if (parsed) return parsed;
  parsed = { tris: [], refs: [] };
  for (const line of text.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === '1' && t.length >= 15) {
      const n = t.slice(2, 14).map(Number);
      parsed.refs.push({
        m: [n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[0], n[1], n[2]],
        name: normalizeRef(t.slice(14).join(' ')),
      });
    } else if (t[0] === '3' && t.length >= 11) {
      parsed.tris.push(...t.slice(2, 11).map(Number));
    } else if (t[0] === '4' && t.length >= 14) {
      const v = t.slice(2, 14).map(Number);
      parsed.tris.push(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
      parsed.tris.push(v[0], v[1], v[2], v[6], v[7], v[8], v[9], v[10], v[11]);
    }
  }
  parsedFiles.set(name, parsed);
  return parsed;
}

interface Flat {
  tris: number[];
  studs: { x: number; y: number; z: number; up: boolean }[];
  foreign: boolean;
}

function flatten(name: string, files: Record<string, string>, m: Mat, out: Flat) {
  if (FOREIGN_STUDS.test(name)) {
    out.foreign = true;
    return;
  }
  if (TOP_STUDS.has(name)) {
    // A stud points along its local -Y; it is usable when that is still straight up after transforming.
    const vertical = Math.abs(m[1]) < 0.02 && Math.abs(m[7]) < 0.02;
    if (m[4] > -0.5) {
      // Hollow studs are sometimes stretched downward into the part, so locate the stud by its top
      // (4 LDU tall at scale 1) rather than by the primitive's origin.
      out.studs.push({ x: m[9], y: m[10] - 4 * m[4] + 4, z: m[11], up: vertical && m[4] > 0.4 && m[4] < 4 });
      return;
    }
    // Upside down (possibly sheared to follow a slope): the primitive models an underside tube, so it is body geometry.
  }
  const text = files[name];
  if (text === undefined) return;
  const file = parseFile(name, text);
  const t = file.tris;
  for (let i = 0; i < t.length; i += 3) {
    out.tris.push(
      m[0] * t[i] + m[1] * t[i + 1] + m[2] * t[i + 2] + m[9],
      m[3] * t[i] + m[4] * t[i + 1] + m[5] * t[i + 2] + m[10],
      m[6] * t[i] + m[7] * t[i + 1] + m[8] * t[i + 2] + m[11],
    );
  }
  for (const ref of file.refs) flatten(ref.name, files, compose(m, ref.m), out);
}

/** Y range of a triangle inside an axis-aligned column, by clipping against the column's four sides. */
function yRangeInColumn(tri: number[], x0: number, x1: number, z0: number, z1: number): [number, number] | null {
  let poly = [
    [tri[0], tri[1], tri[2]],
    [tri[3], tri[4], tri[5]],
    [tri[6], tri[7], tri[8]],
  ];
  const planes: [number, number, number][] = [
    [0, x0, 1],
    [0, x1, -1],
    [2, z0, 1],
    [2, z1, -1],
  ];
  for (const [axis, bound, sign] of planes) {
    const next: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = (a[axis] - bound) * sign;
      const db = (b[axis] - bound) * sign;
      if (da >= 0) next.push(a);
      if (da >= 0 !== db >= 0) {
        const k = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      }
    }
    poly = next;
    if (poly.length < 3) return null;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    if (p[1] < lo) lo = p[1];
    if (p[1] > hi) hi = p[1];
  }
  return [lo, hi];
}

const nearInt = (v: number, tol: number) => Math.abs(v - Math.round(v)) <= tol;

/** Why a part cannot be modelled on the stud grid, or its shape when it can. */
function analyze(id: string, name: string, files: Record<string, string>): PartShape | string {
  const flat: Flat = { tris: [], studs: [], foreign: false };
  flatten(`${id.toLowerCase()}.dat`, files, IDENTITY, flat);
  if (flat.foreign) return 'other building system';
  if (flat.tris.length === 0) return 'no geometry';
  if (flat.studs.some((s) => !s.up)) return 'studs not pointing up';

  const t = flat.tris;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.length; i += 3) {
    if (t[i] < minX) minX = t[i];
    if (t[i] > maxX) maxX = t[i];
    if (t[i + 1] < minY) minY = t[i + 1];
    if (t[i + 1] > maxY) maxY = t[i + 1];
    if (t[i + 2] < minZ) minZ = t[i + 2];
    if (t[i + 2] > maxZ) maxZ = t[i + 2];
  }
  const wf = (maxX - minX) / STUD;
  const df = (maxZ - minZ) / STUD;
  const hf = (maxY - minY) / PLATE;
  if (!nearInt(wf, 0.04) || !nearInt(df, 0.04)) return 'footprint off grid';
  if (!nearInt(hf, 0.07)) return 'height off grid';
  const w = Math.round(wf);
  const d = Math.round(df);
  const h = Math.round(hf);
  if (w < 1 || d < 1 || h < 1) return 'degenerate';
  if (w > 16 || d > 16 || h > 18) return 'too large';

  // Column occupancy: clip every triangle to each cell (inset slightly so shared walls do not bleed over).
  const INSET = 2;
  const n = w * d;
  const top = new Array<number>(n).fill(-Infinity); // highest point, LDU above the part's bottom
  const bottom = new Array<number>(n).fill(Infinity); // lowest point, LDU above the part's bottom
  const tri = new Array<number>(9);
  for (let i = 0; i < t.length; i += 9) {
    for (let k = 0; k < 9; k++) tri[k] = t[i + k];
    const cx0 = Math.max(0, Math.floor((Math.min(tri[0], tri[3], tri[6]) - minX) / STUD));
    const cx1 = Math.min(w - 1, Math.floor((Math.max(tri[0], tri[3], tri[6]) - minX) / STUD));
    const cz0 = Math.max(0, Math.floor((Math.min(tri[2], tri[5], tri[8]) - minZ) / STUD));
    const cz1 = Math.min(d - 1, Math.floor((Math.max(tri[2], tri[5], tri[8]) - minZ) / STUD));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const x0 = minX + cx * STUD + INSET;
        const z0 = minZ + cz * STUD + INSET;
        const range = yRangeInColumn(tri, x0, x0 + STUD - 2 * INSET, z0, z0 + STUD - 2 * INSET);
        if (!range) continue;
        const c = cz * w + cx;
        top[c] = Math.max(top[c], maxY - range[0]);
        bottom[c] = Math.min(bottom[c], maxY - range[1]);
      }
    }
  }

  const lo = new Array<number>(n).fill(-1);
  const hi = new Array<number>(n).fill(-1);
  const stud = new Array<number>(n).fill(-1);
  const recv = new Array<number>(n).fill(0);
  for (let c = 0; c < n; c++) {
    if (top[c] === -Infinity) continue;
    lo[c] = Math.max(0, Math.floor(bottom[c] / PLATE + 0.05));
    hi[c] = Math.min(h, Math.max(lo[c] + 1, Math.ceil(top[c] / PLATE - 0.05)));
    recv[c] = bottom[c] <= 0.5 ? 1 : 0;
  }

  for (const s of flat.studs) {
    const fx = (s.x - minX) / STUD - 0.5;
    const fz = (s.z - minZ) / STUD - 0.5;
    const fh = (maxY - s.y) / PLATE;
    if (!nearInt(fx, 0.1) || !nearInt(fz, 0.1)) return 'studs off grid';
    if (!nearInt(fh, 0.07)) return 'stud height off grid';
    const cx = Math.round(fx);
    const cz = Math.round(fz);
    if (cx < 0 || cx >= w || cz < 0 || cz >= d) return 'stud outside footprint';
    const c = cz * w + cx;
    const sh = Math.round(fh);
    if (hi[c] > sh) return 'stud under overhang';
    if (lo[c] < 0) lo[c] = Math.max(0, sh - 1);
    hi[c] = sh;
    stud[c] = sh;
  }

  if (!stud.some((s) => s >= 0) && !recv.some((r) => r === 1)) return 'no connection points';
  // A part that only rests on a sliver of its footprint (pins, axles, feet) is not a stud-grid part.
  if (!recv.some((r) => r === 1)) return 'no sockets';

  const round = (v: number) => Math.round(v * 100) / 100;
  return { id, name, w, d, h, lo, hi, stud, recv, ox: round(minX), oy: round(maxY), oz: round(minZ) };
}

// ---------------------------------------------------------------- main

// Categories whose parts sit on the stud grid often enough to be worth analysing.
const BUILD_CATEGORIES = new Set([3, 5, 6, 8, 9, 11, 14, 15, 16, 19, 20, 21, 23, 32, 37, 49, 67]);
// Attachments the grid model cannot represent; a part that needs one to be useful is left out.
const UNSUPPORTED_NAME =
  /(clips?|handles?|hinge|towball|hook|magnet|electric|light|suction|bracket|turntable|wheel|(?<!bottom )pins?(?! holes?)|axle(?! holes?)|ball|socket|crane|winch|propeller|string|sticker|pattern|print)/i;

async function main() {
  const started = Date.now();
  await mkdir(outDir, { recursive: true });

  const [partRows, colorRows, categoryRows, relationRows, elementRows] = await Promise.all(
    ['parts', 'colors', 'part_categories', 'part_relationships', 'elements'].map((name) =>
      readCsv(path.join(dataDir, 'rebrickable', `${name}.csv.gz`)),
    ),
  );
  const lib = await LDrawLibrary.open(path.join(dataDir, 'ldraw', 'complete.zip'));

  // Reference tables
  const colors = colorRows
    .filter((c) => Number(c.id) >= 0 && c.id !== '9999')
    .map((c) => ({ id: Number(c.id), name: c.name, rgb: c.rgb.toUpperCase(), trans: c.is_trans === 'True' || c.is_trans === 't' }));
  const categories = categoryRows.map((c) => ({ id: Number(c.id), name: c.name }));

  // Colors each part exists in; the count doubles as a popularity signal for search ranking.
  const partColorSets = new Map<string, Set<number>>();
  for (const e of elementRows) {
    let set = partColorSets.get(e.part_num);
    if (!set) partColorSets.set(e.part_num, (set = new Set()));
    set.add(Number(e.color_id));
  }

  // Relationships. P/T: printed or patterned child of a plain parent. A/M: interchangeable variants.
  const printOf: Record<string, string> = {};
  const variants = new Map<string, Set<string>>();
  for (const r of relationRows) {
    if (r.rel_type === 'P' || r.rel_type === 'T') printOf[r.child_part_num] = r.parent_part_num;
    else if (r.rel_type === 'A' || r.rel_type === 'M') {
      for (const [a, b] of [[r.child_part_num, r.parent_part_num], [r.parent_part_num, r.child_part_num]]) {
        let set = variants.get(a);
        if (!set) variants.set(a, (set = new Set()));
        set.add(b);
      }
    }
  }

  // Which LDraw file draws each catalog part: its own, its plain parent's, or an interchangeable mold's.
  const geometryFor = (id: string): string | null => {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (lib.hasPart(cur)) return cur.toLowerCase();
      if (printOf[cur]) queue.push(printOf[cur]);
      for (const v of variants.get(cur) ?? []) queue.push(v);
      if (seen.size > 12) break;
    }
    return null;
  };

  const ids: string[] = [];
  const names: string[] = [];
  const cats: number[] = [];
  const pop: number[] = [];
  const geo: (string | 0 | 1)[] = []; // 1 = own LDraw file, 0 = none, string = borrowed geometry id
  let withGeometry = 0;
  for (const p of partRows) {
    ids.push(p.part_num);
    names.push(p.name);
    cats.push(Number(p.part_cat_id));
    pop.push(partColorSets.get(p.part_num)?.size ?? 0);
    const g = geometryFor(p.part_num);
    if (g) withGeometry++;
    geo.push(g === null ? 0 : g === p.part_num.toLowerCase() ? 1 : g);
  }

  // Shapes for the designer
  const shapes: Record<string, PartShape> = {};
  const rejected = new Map<string, number>();
  const perCategory = new Map<number, number>();
  const candidates = partRows.filter(
    (p) =>
      BUILD_CATEGORIES.has(Number(p.part_cat_id)) &&
      p.part_material === 'Plastic' &&
      !printOf[p.part_num] &&
      !UNSUPPORTED_NAME.test(p.name) &&
      lib.hasPart(p.part_num),
  );
  for (const p of candidates) {
    const packed = await lib.pack(p.part_num);
    if (!packed) continue;
    const result = analyze(p.part_num, p.name, packed.files);
    if (typeof result === 'string') {
      rejected.set(result, (rejected.get(result) ?? 0) + 1);
      if (verbose) console.log(`  skip ${p.part_num.padEnd(12)} ${result.padEnd(24)} ${p.name}`);
    } else {
      shapes[p.part_num] = result;
      perCategory.set(Number(p.part_cat_id), (perCategory.get(Number(p.part_cat_id)) ?? 0) + 1);
    }
  }
  // Geometry files for every LDraw part the catalog draws with (a part's own, or the one it borrows).
  const geometry = await buildGeometry(
    lib,
    ids.flatMap((id, i) => (geo[i] === 1 ? [id.toLowerCase()] : typeof geo[i] === 'string' ? [geo[i] as string] : [])),
    publicDir,
  );
  lib.close();

  const partColors: Record<string, number[]> = {};
  for (const [id, set] of partColorSets) partColors[id] = [...set].sort((a, b) => a - b);

  const variantGroups: Record<string, string[]> = {};
  for (const [id, set] of variants) variantGroups[id] = [...set];

  const sets = await buildSets(dataDir, publicDir);

  const write = (file: string, value: unknown) => writeFile(path.join(outDir, file), JSON.stringify(value));
  await Promise.all([
    write('colors.json', colors),
    write('categories.json', categories),
    write('parts.json', { ids, names, cats, pop, geo }),
    write('part-colors.json', partColors),
    write('relations.json', { printOf, variants: variantGroups }),
    write('shapes.json', shapes),
    write('meta.json', {
      builtAt: new Date().toISOString(),
      parts: ids.length,
      partsWithGeometry: withGeometry,
      colors: colors.length,
      buildable: Object.keys(shapes).length,
      sets: sets?.sets ?? 0,
    }),
  ]);

  console.log(`catalog: ${ids.length} parts (${withGeometry} with 3D geometry), ${colors.length} colors`);
  console.log(`designer: ${Object.keys(shapes).length} buildable parts from ${candidates.length} candidates`);
  for (const [cat, count] of [...perCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${categories.find((c) => c.id === cat)?.name}`);
  }
  console.log('rejected:', Object.fromEntries([...rejected].sort((a, b) => b[1] - a[1])));
  console.log(`geometry: ${geometry.parts} part files, ${(geometry.bytes / 1e6).toFixed(0)} MB`);
  console.log(sets ? `sets: ${sets.sets} sets, ${sets.rows} inventory lines` : 'sets: skipped (set files not downloaded; run npm run data:fetch)');
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

await main();
