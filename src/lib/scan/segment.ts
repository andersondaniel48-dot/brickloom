// Finds individual pieces in a photo of bricks laid out on a surface.
// Pure typed-array image processing, fast enough to run on live camera frames.
//
// The approach, in order:
//   1. Model the surface. It is whatever most of the picture looks like; its color is fitted as a
//      smooth gradient so uneven lighting and vignetting are not mistaken for pieces.
//   2. Measure how noisy that surface is (paper is quiet, wood grain is not) and set every
//      threshold relative to it.
//   3. Mark pixels that are "solid" evidence of a piece (a different color from the surface, or
//      much darker or lighter than it) and pixels on a sharp edge. Soft shadows are neither.
//   4. Close outlines, fill what they enclose, and take connected blobs.
//   5. A very large blob may be a second surface with pieces of its own (a sheet of paper on a
//      desk, the inside of a tray): if it looks like one, search inside it the same way.
//   6. Split blobs that are really several touching pieces: first where the color changes, then
//      where the shape pinches to a narrow neck.

export interface Region {
  /** Bounding box, as fractions of the image width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixels covered, as a fraction of the image. */
  area: number;
  /** Representative color of the piece (white-balanced against the background), or null if too few pixels. */
  rgb: [number, number, number] | null;
  /** The value this region's pixels have in the segmentation's `labels`. */
  label: number;
  /** Color of the surface the piece is lying on, at the piece. */
  surface: [number, number, number];
}

/** The pixels of a picture, as a canvas hands them out: RGBA, row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Segmentation {
  regions: Region[];
  /** Estimated background color. */
  background: [number, number, number];
  /** Which region each pixel of the image belongs to (0 = none), row by row. */
  labels: Int32Array;
  width: number;
  height: number;
}

/** Share of the frame above which a single region is treated as one piece photographed up close. */
const CLOSE_UP_AREA = 0.2;
/**
 * A part split off a blob must be at least this share of the blob's largest part to count as a
 * piece of its own. Smaller than that, it is a print, a highlight or a reflection on a piece.
 */
const MIN_SHARE = 0.12;
/** Two thick parts joined by a neck are separate pieces when each is at least this many times thicker than the neck. */
const NECK_RATIO = 3;

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
// The cube-root-like curve of the Lab conversion, tabulated over 0..1.
const CURVE_STEPS = 4096;
const CURVE = new Float32Array(CURVE_STEPS + 2);
for (let i = 0; i < CURVE.length; i++) {
  const t = i / CURVE_STEPS;
  CURVE[i] = t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Median of the first `count` values of a buffer (which is reordered). */
function medianOf(buffer: Float32Array, count: number): number {
  if (!count) return 0;
  return buffer.subarray(0, count).sort()[count >> 1];
}

// ---------------------------------------------------------------- background model

/** Solves a small linear system in place by Gaussian elimination; null when it is singular. */
function solve(m: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    for (let row = col + 1; row < n; row++) {
      const f = m[row][col] / m[col][col];
      for (let k = col; k < n; k++) m[row][k] -= f * m[col][k];
      rhs[row] -= f * rhs[col];
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * out[k];
    out[row] = sum / m[row][row];
  }
  return out;
}

/** Coefficients of the smooth surface c0 + c1 x + c2 y + c3 x² + c4 xy + c5 y². */
type Surface = number[];

const surfaceAt = (c: Surface, x: number, y: number) => c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;

/** Least-squares fit of a surface through the values at the chosen sample points. */
function fitSurface(xs: Float32Array, ys: Float32Array, values: Float32Array, chosen: number[]): Surface {
  let mean = 0;
  for (const t of chosen) mean += values[t];
  mean /= Math.max(1, chosen.length);
  const flat = [mean, 0, 0, 0, 0, 0];
  if (chosen.length < 12) return flat;
  const m = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const rhs = new Array<number>(6).fill(0);
  const basis = new Array<number>(6);
  for (const t of chosen) {
    const x = xs[t];
    const y = ys[t];
    basis[0] = 1;
    basis[1] = x;
    basis[2] = y;
    basis[3] = x * x;
    basis[4] = x * y;
    basis[5] = y * y;
    for (let i = 0; i < 6; i++) {
      rhs[i] += basis[i] * values[t];
      for (let j = 0; j < 6; j++) m[i][j] += basis[i] * basis[j];
    }
  }
  return solve(m, rhs) ?? flat;
}

// ---------------------------------------------------------------- binary image tools

/**
 * Grows (or shrinks) the set pixels of a mask by `r` pixels in every direction.
 * Done as a sliding count along rows and then columns, so the cost does not depend on `r`.
 */
function morph(mask: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  const rowPass = new Uint8Array(w * h);
  const prefix = new Int32Array(w + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + mask[row + x];
    for (let x = 0; x < w; x++) {
      const lo = x - r < 0 ? 0 : x - r;
      const hi = x + r >= w ? w - 1 : x + r;
      const ones = prefix[hi + 1] - prefix[lo];
      rowPass[row + x] = (grow ? ones > 0 : ones === hi - lo + 1) ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  const counts = new Int32Array(w); // set pixels in the rows currently in reach of y
  for (let yy = 0; yy <= Math.min(r, h - 1); yy++) for (let x = 0; x < w; x++) counts[x] += rowPass[yy * w + x];
  for (let y = 0; y < h; y++) {
    const size = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = (grow ? counts[x] > 0 : counts[x] === size) ? 1 : 0;
    const entering = (y + 1 + r) * w;
    const leaving = (y - r) * w;
    if (y + 1 + r < h) for (let x = 0; x < w; x++) counts[x] += rowPass[entering + x];
    if (y - r >= 0) for (let x = 0; x < w; x++) counts[x] -= rowPass[leaving + x];
  }
  return out;
}

/** Sets every background pixel that cannot be reached from the image border, i.e. the inside of closed shapes. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const filled = new Uint8Array(n).fill(1); // everything, until proven to be outside
  const stack = new Int32Array(n);
  let top = 0;
  const visit = (i: number) => {
    if (!mask[i] && filled[i]) {
      filled[i] = 0;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) (visit(x), visit((h - 1) * w + x));
  for (let y = 0; y < h; y++) (visit(y * w), visit(y * w + w - 1));
  while (top) {
    const i = stack[--top];
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < n - w) visit(i + w);
  }
  return filled;
}

/** Working memory shared by the steps below; every user leaves it zeroed. */
interface Scratch {
  seen: Uint8Array;
  member: Uint8Array;
  label: Int32Array;
  depth: Int32Array;
  stack: Int32Array;
}

/**
 * Groups pixels into connected sets. `label[i]` says which class pixel i belongs to (0 = none);
 * only neighbouring pixels of the same class are joined. `pixels` limits the search to those
 * pixels (null = the whole image). Returns the pixel indices of each set.
 */
function components(label: Int32Array | Uint8Array, pixels: number[] | null, w: number, h: number, eight: boolean, scratch: Scratch): number[][] {
  const { seen, stack } = scratch;
  const out: number[][] = [];
  const count = pixels ? pixels.length : w * h;
  for (let s = 0; s < count; s++) {
    const start = pixels ? pixels[s] : s;
    const cls = label[start];
    if (!cls || seen[start]) continue;
    const blob: number[] = [];
    let top = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top) {
      const i = stack[--top];
      blob.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      const left = x > 0;
      const right = x < w - 1;
      if (left && !seen[i - 1] && label[i - 1] === cls) (seen[i - 1] = 1), (stack[top++] = i - 1);
      if (right && !seen[i + 1] && label[i + 1] === cls) (seen[i + 1] = 1), (stack[top++] = i + 1);
      for (let dy = -1; dy <= 1; dy += 2) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const j = i + dy * w;
        if (!seen[j] && label[j] === cls) (seen[j] = 1), (stack[top++] = j);
        if (eight) {
          if (left && !seen[j - 1] && label[j - 1] === cls) (seen[j - 1] = 1), (stack[top++] = j - 1);
          if (right && !seen[j + 1] && label[j + 1] === cls) (seen[j + 1] = 1), (stack[top++] = j + 1);
        }
      }
    }
    out.push(blob);
  }
  if (pixels) for (const i of pixels) seen[i] = 0;
  else seen.fill(0);
  return out;
}

/**
 * Hands every unclaimed pixel of a blob to the nearest of several seed groups, spreading outward
 * from the seeds through the blob. `label` holds the seed number (1-based) of claimed pixels.
 * Returns the pixels of each group, and clears `label`.
 */
function claim(blob: number[], groups: number, w: number, h: number, scratch: Scratch): number[][] {
  const { label, member } = scratch;
  for (const i of blob) member[i] = 1;
  let frontier = blob.filter((i) => label[i] > 0);
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const owner = label[i];
      if (x > 0 && member[i - 1] && !label[i - 1]) (label[i - 1] = owner), next.push(i - 1);
      if (x < w - 1 && member[i + 1] && !label[i + 1]) (label[i + 1] = owner), next.push(i + 1);
      if (i >= w && member[i - w] && !label[i - w]) (label[i - w] = owner), next.push(i - w);
      if (i < (h - 1) * w && member[i + w] && !label[i + w]) (label[i + w] = owner), next.push(i + w);
    }
    frontier = next;
  }
  const out: number[][] = Array.from({ length: groups }, () => []);
  for (const i of blob) {
    if (label[i] > 0) out[label[i] - 1].push(i);
    label[i] = 0;
    member[i] = 0;
  }
  return out;
}

// ---------------------------------------------------------------- splitting touching pieces

interface Planes {
  w: number;
  h: number;
  /** Lightness, and how much lighter than the background that is. */
  L: Float32Array;
  dL: Float32Array;
  /** Chroma, as the difference from the background's. */
  A: Float32Array;
  B: Float32Array;
  /**
   * What to add back to get a piece's own chroma. Warm room light tints everything, the surface
   * included, and that tint should be taken out; but a surface that is itself colored (a peach
   * tablecloth) must not make a black brick look blue. So a faint background tint is treated as
   * lighting and removed, and a strong one is treated as the color of the surface and left alone.
   */
  keepA: number;
  keepB: number;
  /** Pixels that are certainly not background or shadow. */
  solid: Uint8Array;
}

/**
 * Splits a blob where its color changes: a red brick touching a blue one is two pieces.
 * Deliberately conservative, because splitting one piece in two would count it twice: shading
 * changes lightness but hardly hue, so pieces are only separated by clearly different hues, or
 * by colored versus neutral, or by very dark versus very light neutrals. Only solid pixels are
 * judged, and a colorless patch only somewhat darker than the surface is left out too: under a
 * harsh light that is what a shadow looks like, and a shadow must not become a piece of its own.
 */
function splitByColor(blob: number[], planes: Planes, scratch: Scratch, minArea: number): number[][] {
  const { L, dL, A, B, keepA, keepB, solid, w, h } = planes;
  const { label } = scratch;
  const HUE_BINS = 36;
  // 0 = not judged, 1 = colored, 2 = neutral. Pixels that could be either are not judged; very
  // dark ones have no dependable hue, so for those the doubtful range is wide.
  const kind = (i: number) => {
    if (!solid[i]) return 0;
    const chroma = (A[i] + keepA) ** 2 + (B[i] + keepB) ** 2;
    if (chroma > (L[i] < 25 ? 484 : 169)) return 1;
    return chroma > 100 || (dL[i] < 0 && dL[i] > -45) ? 0 : 2;
  };
  const hueOf = (i: number) => {
    const deg = (Math.atan2(B[i] + keepB, A[i] + keepA) * 180) / Math.PI;
    return (((deg < 0 ? deg + 360 : deg) / 10) | 0) % HUE_BINS;
  };
  const histogram = new Float32Array(HUE_BINS);
  // Black is told from white and grey by a fixed lightness: the shaded side of a white brick is
  // far darker than its top, but never as dark as a black one.
  const BLACK = 30;
  let colored = 0;
  let dark = 0;
  let light = 0;
  for (const i of blob) {
    const k = kind(i);
    if (k === 1) {
      histogram[hueOf(i)]++;
      colored++;
    } else if (k === 2) {
      if (L[i] < BLACK) dark++;
      else light++;
    }
  }
  const solidCount = colored + dark + light;
  // Shares are judged against the size of a piece. Part of the blob may be far larger than any
  // piece (the floor beyond the table, with a brick lying against it), and must not set the bar.
  const cap = minArea * 64;
  // Too little to go on (a white piece on white paper is found by its outline alone).
  if (solidCount < blob.length * 0.25) return [blob];

  // Dominant hues: peaks of the smoothed histogram, far enough apart to be different colors.
  const smooth = new Float32Array(HUE_BINS);
  for (let b = 0; b < HUE_BINS; b++) {
    smooth[b] = histogram[(b + HUE_BINS - 1) % HUE_BINS] * 0.25 + histogram[b] * 0.5 + histogram[(b + 1) % HUE_BINS] * 0.25;
  }
  const peaks: number[] = [];
  const candidates = Array.from({ length: HUE_BINS }, (_, b) => b)
    .filter((b) => smooth[b] > 0 && smooth[b] >= Math.min(colored, cap) * 0.06 && smooth[b] >= smooth[(b + 1) % HUE_BINS] && smooth[b] >= smooth[(b + HUE_BINS - 1) % HUE_BINS])
    .sort((a, b) => smooth[b] - smooth[a]);
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), HUE_BINS - Math.abs(a - b));
  for (const c of candidates) if (peaks.every((p) => apart(p, c) >= 5)) peaks.push(c);

  const most = Math.min(Math.max(colored, dark, light), cap);
  const classes = peaks.length + (dark > most * MIN_SHARE ? 1 : 0) + (light > most * MIN_SHARE ? 1 : 0);
  if (classes < 2) return [blob];

  // Class per solid pixel: 1..n for hues, then neutral (dark, light).
  for (const i of blob) {
    const k = kind(i);
    if (!k) continue;
    if (k === 1 && peaks.length) {
      const hue = hueOf(i);
      let best = 0;
      for (let p = 1; p < peaks.length; p++) if (apart(peaks[p], hue) < apart(peaks[best], hue)) best = p;
      label[i] = best + 1;
    } else {
      label[i] = peaks.length + (L[i] < BLACK ? 1 : 2);
    }
  }
  const parts = components(label, blob, w, h, false, scratch);
  const largest = Math.min(parts.reduce((most, p) => Math.max(most, p.length), 0), cap);
  const big = parts.filter((p) => p.length >= Math.max(minArea * 0.6, largest * MIN_SHARE));
  for (const i of blob) label[i] = 0;
  if (big.length < 2) return [blob];

  // Highlights, edges, shadows and other fragments join whichever large part they touch.
  big.forEach((part, g) => part.forEach((i) => (label[i] = g + 1)));
  return absorbEnclosed(claim(blob, big.length, w, h, scratch).filter((p) => p.length), w, h, scratch);
}

/**
 * Joins a part to its neighbour when most of its outline runs along that neighbour rather than
 * along the surface. Such a part is not a piece lying beside another: it is something on or in a
 * piece, like the dark inside of a pin hole, a print, or a stud in shadow.
 */
function absorbEnclosed(parts: number[][], w: number, h: number, scratch: Scratch): number[][] {
  if (parts.length < 2) return parts;
  const { label } = scratch;
  parts.forEach((part, g) => part.forEach((i) => (label[i] = g + 1)));
  // For every part: how much of its outline is open, and how much runs along each other part.
  const open = new Array<number>(parts.length).fill(0);
  const along = parts.map(() => new Map<number, number>());
  parts.forEach((part, g) => {
    for (const i of part) {
      const x = i % w;
      const y = (i / w) | 0;
      for (let side = 0; side < 4; side++) {
        const inFrame = side === 0 ? x > 0 : side === 1 ? x < w - 1 : side === 2 ? y > 0 : y < h - 1;
        const other = inFrame ? label[side === 0 ? i - 1 : side === 1 ? i + 1 : side === 2 ? i - w : i + w] : 0;
        if (other === g + 1) continue;
        if (other) along[g].set(other - 1, (along[g].get(other - 1) ?? 0) + 1);
        else open[g]++;
      }
    }
  });
  for (const part of parts) for (const i of part) label[i] = 0;

  // Smallest first, so that a part inside a part inside a part ends up in the outermost.
  const into = parts.map((_, g) => g);
  const root = (g: number): number => (into[g] === g ? g : (into[g] = root(into[g])));
  for (const g of parts.map((_, i) => i).sort((a, b) => parts[a].length - parts[b].length)) {
    let shared = 0;
    let host = -1;
    let most = 0;
    for (const [other, length] of along[g]) {
      shared += length;
      if (length > most) (most = length), (host = other);
    }
    if (host >= 0 && shared > (shared + open[g]) * 0.8 && root(host) !== g) into[g] = root(host);
  }
  const out = new Map<number, number[]>();
  parts.forEach((part, g) => {
    const r = root(g);
    const joined = out.get(r);
    if (joined) for (const i of part) joined.push(i);
    else out.set(r, part);
  });
  return [...out.values()];
}

/**
 * Measures how deep inside a blob each of its pixels lies, by peeling layers off its outline
 * (city-block distance). Fills `scratch.depth` for the blob's pixels, which the caller must zero
 * again, and returns the depth of the deepest pixel.
 */
function peel(blob: number[], w: number, h: number, scratch: Scratch): number {
  const { member, depth } = scratch;
  for (const i of blob) member[i] = 1;
  let layer = blob.filter((i) => {
    const x = i % w;
    return x === 0 || x === w - 1 || i < w || i >= (h - 1) * w || !member[i - 1] || !member[i + 1] || !member[i - w] || !member[i + w];
  });
  let level = 0;
  while (layer.length) {
    level++;
    for (const i of layer) depth[i] = level;
    const next: number[] = [];
    for (const i of layer) {
      const x = i % w;
      if (x > 0 && member[i - 1] && !depth[i - 1]) (depth[i - 1] = -1), next.push(i - 1);
      if (x < w - 1 && member[i + 1] && !depth[i + 1]) (depth[i + 1] = -1), next.push(i + 1);
      if (i >= w && member[i - w] && !depth[i - w]) (depth[i - w] = -1), next.push(i - w);
      if (i < (h - 1) * w && member[i + w] && !depth[i + w]) (depth[i + w] = -1), next.push(i + w);
    }
    layer = next;
  }
  for (const i of blob) member[i] = 0;
  return level;
}

/**
 * Splits a blob where it pinches to a narrow neck: two bricks of the same color touching at a
 * corner. The neck has to be much thinner than what it joins, so that a single piece with a
 * waist (an arch, a bracket) stays whole.
 */
function splitByShape(blob: number[], planes: Planes, scratch: Scratch, minArea: number, rounds = 2): number[][] {
  const { w, h } = planes;
  const { depth, label } = scratch;
  const thickest = peel(blob, w, h, scratch);

  let result: number[][] | null = null;
  // Shave the blob down one layer at a time until it falls apart into thick cores.
  let inner = blob;
  for (let cut = 1; cut * NECK_RATIO <= thickest && !result; cut++) {
    inner = inner.filter((i) => depth[i] > cut);
    for (const i of inner) label[i] = 1;
    const cores = components(label, inner, w, h, false, scratch).filter((core) => {
      if (core.length < Math.max(4, blob.length * 0.03)) return false;
      let deepest = 0;
      for (const i of core) if (depth[i] > deepest) deepest = depth[i];
      return deepest >= cut * NECK_RATIO && deepest >= cut + 2;
    });
    for (const i of inner) label[i] = 0;
    if (cores.length < 2) continue;
    cores.forEach((core, g) => core.forEach((i) => (label[i] = g + 1)));
    const parts = claim(blob, cores.length, w, h, scratch);
    // A thin sliver left over means the "neck" was just a bump on one piece.
    const largest = parts.reduce((most, p) => Math.max(most, p.length), 0);
    if (parts.every((p) => p.length >= Math.max(minArea, largest * MIN_SHARE))) result = parts;
  }
  for (const i of blob) depth[i] = 0;
  if (!result) return [blob];
  return rounds > 1 ? result.flatMap((part) => splitByShape(part, planes, scratch, minArea, rounds - 1)) : result;
}

/**
 * The thick parts of a blob, without whatever thin thing joins them to each other or to the edge
 * of the picture. A brick lying against the line where the table ends comes out as the brick.
 */
function thickParts(blob: number[], w: number, h: number, scratch: Scratch, thin: number, minArea: number): number[][] {
  const { depth, label, member } = scratch;
  const thickest = peel(blob, w, h, scratch);
  let parts: number[][] = [];
  if (thickest > thin + 1) {
    const inner = blob.filter((i) => depth[i] > thin);
    for (const i of inner) label[i] = 1;
    parts = components(label, inner, w, h, false, scratch).filter((core) => core.length >= minArea * 0.5);
    for (const i of inner) label[i] = 0;
    // Give each core back the layers that were shaved off it, and no more.
    for (const i of blob) member[i] = 1;
    for (const core of parts) for (const i of core) member[i] = 2;
    for (const core of parts) {
      let frontier = core.slice();
      for (let round = 0; round < thin && frontier.length; round++) {
        const next: number[] = [];
        for (const i of frontier) {
          const x = i % w;
          for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
            if (j >= 0 && j < w * h && member[j] === 1) (member[j] = 2), next.push(j), core.push(j);
          }
        }
        frontier = next;
      }
    }
    for (const i of blob) member[i] = 0;
  }
  for (const i of blob) depth[i] = 0;
  return parts;
}

// ---------------------------------------------------------------- finding pieces on a surface

type RGB = [number, number, number];

/** The picture being examined, converted once and shared by every level of the search. */
interface Frame {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
  scratch: Scratch;
  minArea: number;
}

interface Piece {
  pixels: number[];
  rgb: RGB | null;
  surface: RGB;
  /** Share of the piece that is solid evidence, as opposed to outline and shadow. */
  solidShare: number;
  /** Share of the piece's outline that runs along the rim of the area that was searched. */
  rimShare: number;
}

interface Search {
  pieces: Piece[];
  background: RGB;
  /** Share of the searched area that looks like one continuous surface. */
  surfaceShare: number;
}

/** How many of the picture's four edges a set of pixels reaches. */
function edgesReached(pixels: number[], w: number, h: number): number {
  let left = 0, right = 0, top = 0, bottom = 0;
  for (const i of pixels) {
    const x = i % w;
    if (x <= 1) left = 1;
    else if (x >= w - 2) right = 1;
    if (i < 2 * w) top = 1;
    else if (i >= (h - 2) * w) bottom = 1;
  }
  return left + right + top + bottom;
}

/** Nothing this large is examined as a surface in its own right more than this many levels down. */
const MAX_DEPTH = 2;
/** A blob covering this share of the picture may be a second surface (a sheet of paper on a desk) rather than a piece. */
const SURFACE_AREA = 0.12;

/**
 * Finds the pieces lying on one surface: the whole picture (`within` null), or the part of it
 * marked in `within`, which is how a sheet of paper on a desk, or the inside of a tray, gets
 * searched when the picture as a whole is mostly something else.
 */
function search(frame: Frame, within: Uint8Array | null, depth: number): Search | null {
  const { w, h, data, L, A, B, scratch, minArea } = frame;
  const n = w * h;

  // The area to look at, and which of its pixels may count: not the rim of the area itself,
  // where the surface ends and something else begins.
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  let eligible: Uint8Array | null = null;
  const k = Math.max(1, Math.round(Math.min(w, h) / 220));
  if (within) {
    x0 = w;
    y0 = h;
    x1 = y1 = 0;
    for (let i = 0; i < n; i++) {
      if (!within[i]) continue;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
    }
    if (x1 <= x0) return null;
    eligible = morph(within, w, h, k + 1, false);
  }

  // ---- 1. Model of the surface, from a grid of tiles.
  const tile = Math.max(6, Math.round(Math.min(x1 - x0, y1 - y0) / 26));
  const cols = Math.ceil((x1 - x0) / tile);
  const rows = Math.ceil((y1 - y0) / tile);
  const tiles = cols * rows;
  const tileX = new Float32Array(tiles);
  const tileY = new Float32Array(tiles);
  const tileL = new Float32Array(tiles);
  const tileA = new Float32Array(tiles);
  const tileB = new Float32Array(tiles);
  const tileRgb = [new Float32Array(tiles), new Float32Array(tiles), new Float32Array(tiles)];
  const capacity = (Math.ceil(tile / 3) + 1) ** 2;
  const bufL = new Float32Array(capacity);
  const bufA = new Float32Array(capacity);
  const bufB = new Float32Array(capacity);
  const usable: number[] = []; // tiles that lie mostly inside the area
  for (let ty = 0, t = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++, t++) {
      let count = 0;
      let seen = 0;
      let r = 0, g = 0, b = 0;
      const yEnd = Math.min(y1, y0 + (ty + 1) * tile);
      const xEnd = Math.min(x1, x0 + (tx + 1) * tile);
      for (let y = y0 + ty * tile; y < yEnd; y += 3) {
        for (let x = x0 + tx * tile; x < xEnd; x += 3) {
          const i = y * w + x;
          seen++;
          if (eligible && !eligible[i]) continue;
          bufL[count] = L[i];
          bufA[count] = A[i];
          bufB[count] = B[i];
          r += data[i * 4];
          g += data[i * 4 + 1];
          b += data[i * 4 + 2];
          count++;
        }
      }
      if (count < Math.max(3, seen * 0.4)) continue;
      usable.push(t);
      tileRgb[0][t] = r / count;
      tileRgb[1][t] = g / count;
      tileRgb[2][t] = b / count;
      tileX[t] = (x0 + (tx + 0.5) * tile) / w;
      tileY[t] = (y0 + (ty + 0.5) * tile) / h;
      tileL[t] = medianOf(bufL, count);
      tileA[t] = medianOf(bufA, count);
      tileB[t] = medianOf(bufB, count);
    }
  }
  if (usable.length < 12) return null;

  // The surface is whatever most tiles look like. Start from the typical tile, then refit a few
  // times, each time keeping only the tiles that agree with the current fit.
  const typical = (values: Float32Array) => medianOf(Float32Array.from(usable, (t) => values[t]), usable.length);
  let surfL: Surface = [typical(tileL), 0, 0, 0, 0, 0];
  let surfA: Surface = [typical(tileA), 0, 0, 0, 0, 0];
  let surfB: Surface = [typical(tileB), 0, 0, 0, 0, 0];
  let backgroundTiles = usable;
  for (let pass = 0; pass < 3; pass++) {
    const tolerance = pass === 0 ? 14 : 8;
    const agree: number[] = [];
    for (const t of usable) {
      const x = tileX[t];
      const y = tileY[t];
      const off = Math.hypot((tileL[t] - surfaceAt(surfL, x, y)) * 0.5, tileA[t] - surfaceAt(surfA, x, y), tileB[t] - surfaceAt(surfB, x, y));
      if (off < tolerance) agree.push(t);
    }
    if (agree.length < usable.length * 0.15) break;
    backgroundTiles = agree;
    surfL = fitSurface(tileX, tileY, tileL, agree);
    surfA = fitSurface(tileX, tileY, tileA, agree);
    surfB = fitSurface(tileX, tileY, tileB, agree);
  }

  // Per-pixel differences from the surface, and edge strength.
  const dL = new Float32Array(n);
  const dA = new Float32Array(n);
  const dB = new Float32Array(n);
  const edge = new Float32Array(n);
  for (let y = y0; y < y1; y++) {
    const fy = y / h;
    // Along a row the surface is a plain quadratic in x.
    const l0 = surfL[0] + surfL[2] * fy + surfL[5] * fy * fy, l1 = surfL[1] + surfL[4] * fy, l2 = surfL[3];
    const a0 = surfA[0] + surfA[2] * fy + surfA[5] * fy * fy, a1 = surfA[1] + surfA[4] * fy, a2 = surfA[3];
    const b0 = surfB[0] + surfB[2] * fy + surfB[5] * fy * fy, b1 = surfB[1] + surfB[4] * fy, b2 = surfB[3];
    const near = y > 0 && y < h - 1;
    const far = y > 1 && y < h - 2;
    for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
      const fx = x / w;
      dL[i] = L[i] - (l0 + (l1 + l2 * fx) * fx);
      dA[i] = A[i] - (a0 + (a1 + a2 * fx) * fx);
      dB[i] = B[i] - (b0 + (b1 + b2 * fx) * fx);
      if (near && x > 0 && x < w - 1) {
        let step = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
        // The same step measured across a wider gap: an edge that is out of focus is spread over
        // several pixels, and shows up here when it no longer does between neighbours.
        if (far && x > 1 && x < w - 2) {
          const wide = Math.abs(L[i + 2] - L[i - 2]) + Math.abs(L[i + 2 * w] - L[i - 2 * w]);
          if (wide > step) step = wide;
        }
        edge[i] = step;
      }
    }
  }

  // ---- 2. How noisy is the surface? Sampled inside the tiles that fit the model.
  const samples = backgroundTiles.length * 5;
  const noiseL = new Float32Array(samples);
  const noiseC = new Float32Array(samples);
  const noiseE = new Float32Array(samples);
  let taken = 0;
  for (const t of backgroundTiles) {
    const cx = Math.round(tileX[t] * w);
    const cy = Math.round(tileY[t] * h);
    for (let s = 0; s < 5; s++) {
      const x = clamp(cx + (s === 0 ? 0 : s & 1 ? -2 : 2), 2, w - 3);
      const y = clamp(cy + (s === 0 ? 0 : s < 3 ? -2 : 2), 2, h - 3);
      const i = y * w + x;
      if (eligible && !eligible[i]) continue;
      noiseL[taken] = Math.abs(dL[i]);
      noiseC[taken] = Math.hypot(dA[i], dB[i]);
      noiseE[taken] = edge[i];
      taken++;
    }
  }
  const sigmaL = medianOf(noiseL, taken) * 1.48;
  const sigmaC = medianOf(noiseC, taken) * 1.48;
  const edgeNoise = medianOf(noiseE, taken);
  // The surface's color as the camera recorded it, for painting over things and for white balance.
  const surfRgb = tileRgb.map((channel) => fitSurface(tileX, tileY, channel, backgroundTiles));
  const surfaceColor = (x: number, y: number) => surfRgb.map((c) => clamp(surfaceAt(c, x, y), 0, 255)) as RGB;
  const background = surfaceColor((x0 + x1) / 2 / w, (y0 + y1) / 2 / h);

  const colorLimit = clamp(7 + 4 * sigmaC, 10, 26);
  // A soft shadow darkens the surface by up to about a third; only something clearly darker than that is a piece.
  const darkLimit = clamp(18 + 4 * sigmaL, 24, 50);
  const brightLimit = clamp(12 + 4 * sigmaL, 16, 40);
  // On a quiet surface even a faint sharp step counts: it is all there is to see of a white piece
  // on white paper. The edge of a soft shadow is too gradual to register.
  const edgeLimit = clamp(5 + 5 * edgeNoise, 9, 48);

  // ---- 3. Which pixels belong to pieces?
  const solid = new Uint8Array(n);
  let mask: Uint8Array = new Uint8Array(n);
  const colorLimit2 = colorLimit * colorLimit;
  for (let y = y0; y < y1; y++) {
    for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
      if (eligible && !eligible[i]) continue;
      const firm = dA[i] * dA[i] + dB[i] * dB[i] > colorLimit2 || dL[i] < -darkLimit || dL[i] > brightLimit;
      if (firm) solid[i] = mask[i] = 1;
      else if (edge[i] > edgeLimit) mask[i] = 1;
    }
  }

  if (eligible) {
    // Whatever is joined to the rim of the area is the rim: the lip of a tray, the edge of the
    // sheet. Left in, it would be an outline around everything, and all of it would be filled.
    // (Done before outlines are thickened, or pieces lying close together near the rim would
    // all count as joined to it.)
    const { stack } = scratch;
    let top = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
        if (mask[i] !== 1) continue;
        if ((x > 0 && !eligible[i - 1]) || (x < w - 1 && !eligible[i + 1]) || (y > 0 && !eligible[i - w]) || (y < h - 1 && !eligible[i + w]) || !eligible[i]) {
          mask[i] = 0;
          stack[top++] = i;
        }
      }
    }
    while (top) {
      const i = stack[--top];
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) continue;
          mask[yy * w + xx] = 0;
          stack[top++] = yy * w + xx;
        }
      }
    }
  }
  // ---- 4. Join broken outlines, fill everything they enclose, shrink back, then drop specks.
  mask = morph(fillHoles(morph(mask, w, h, k + 1, true), w, h), w, h, k + 1, false);
  mask = morph(morph(mask, w, h, k, false), w, h, k, true);

  const tintA = surfaceAt(surfA, (x0 + x1) / 2 / w, (y0 + y1) / 2 / h);
  const tintB = surfaceAt(surfB, (x0 + x1) / 2 / w, (y0 + y1) / 2 / h);
  const kept = clamp((Math.hypot(tintA, tintB) - 8) / 8, 0, 1);
  const planes: Planes = { w, h, L, dL, A: dA, B: dB, keepA: tintA * kept, keepB: tintB * kept, solid };

  const pieces: Piece[] = [];
  const piece = (pixels: number[]): Piece => {
    let minX = w, maxX = 0, minY = h, maxY = 0, firm = 0, outline = 0, rim = 0;
    for (const i of pixels) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (solid[i]) firm++;
    }
    if (eligible) {
      // How much of the outline lies against the rim of the area, where nothing could be seen.
      for (const i of pixels) scratch.member[i] = 1;
      for (const i of pixels) {
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= n || scratch.member[j]) continue;
          outline++;
          if (!eligible[j]) rim++;
        }
      }
      for (const i of pixels) scratch.member[i] = 0;
    }
    return {
      pixels,
      rgb: pieceColor(pixels, data, planes, background),
      surface: surfaceColor((minX + maxX + 1) / 2 / w, (minY + maxY + 1) / 2 / h),
      solidShare: firm / pixels.length,
      rimShare: outline ? rim / outline : 0,
    };
  };

  for (const blob of components(mask, null, w, h, true, scratch)) {
    if (blob.length < minArea) continue;

    // ---- 5. Something this large, or reaching across the picture, may not be a piece at all
    // but a second surface with pieces of its own on it: a sheet of paper on a desk, the inside
    // of a tray, a mat. It is one if most of it looks alike and several things on it clearly do
    // not, and lie well inside it. (The top and the side of one big brick are not a surface and a
    // piece; nor are a tire and the wheel inside it, which is why one thing is not enough unless
    // the area is far larger than a piece held close would be.)
    const sprawling = edgesReached(blob, w, h) >= 2;
    if ((blob.length > n * SURFACE_AREA || (sprawling && blob.length > n * 0.04)) && depth < MAX_DEPTH) {
      const area = new Uint8Array(n);
      for (const i of blob) area[i] = 1;
      const inner = search(frame, area, depth + 1);
      if (inner && inner.surfaceShare >= 0.5) {
        const clear = inner.pieces.filter((p) => p.solidShare >= 0.3 && p.rimShare < 0.2);
        const covered = clear.reduce((sum, p) => sum + p.pixels.length, 0);
        if (clear.length >= (blob.length > n * 0.3 ? 1 : 2) && covered < blob.length * 0.5) {
          for (const p of inner.pieces) if (p.rimShare < 0.5) pieces.push(p);
          continue;
        }
      }
    }
    if (blob.length > n * 0.85) continue;

    // ---- 6. One blob may be several touching pieces.
    for (const part of splitByColor(blob, planes, scratch, minArea).flatMap((p) => splitByShape(p, planes, scratch, minArea))) {
      // One thing filling a large share of the frame is a single piece held up close. Otherwise,
      // something reaching two or more edges of the frame is the table edge or a hand, not a piece;
      // but a piece may be lying against it.
      if (part.length <= n * CLOSE_UP_AREA && edgesReached(part, w, h) >= 2) {
        for (const core of thickParts(part, w, h, scratch, Math.max(2, Math.round(Math.min(w, h) / 80)), minArea)) {
          if (core.length >= minArea && edgesReached(core, w, h) < 2) pieces.push(piece(core));
        }
        continue;
      }
      pieces.push(piece(part));
    }
  }

  return { pieces, background, surfaceShare: backgroundTiles.length / usable.length };
}

// ---------------------------------------------------------------- main entry

/**
 * Separates pieces from the background of an image.
 * Works best on a plain, contrasting surface; pieces that touch are separated where their color
 * or outline makes it clear they are different pieces.
 */
export function segment(image: Pixels): Segmentation {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = LINEAR[data[p]];
    const g = LINEAR[data[p + 1]];
    const b = LINEAR[data[p + 2]];
    const fx = CURVE[((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * (CURVE_STEPS / 0.95047)) | 0];
    const fy = CURVE[((r * 0.2126729 + g * 0.7151522 + b * 0.072175) * CURVE_STEPS) | 0];
    const fz = CURVE[((r * 0.0193339 + g * 0.119192 + b * 0.9503041) * (CURVE_STEPS / 1.08883)) | 0];
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  const scratch: Scratch = { seen: new Uint8Array(n), member: new Uint8Array(n), label: new Int32Array(n), depth: new Int32Array(n), stack: new Int32Array(n) };
  const found = search({ w, h, data, L, A, B, scratch, minArea: Math.max(30, n * 0.0006) }, null, 0);

  const labels = new Int32Array(n);
  const regions: Region[] = [];
  for (const { pixels, rgb, surface } of found?.pieces ?? []) {
    let minX = w, maxX = 0, minY = h, maxY = 0;
    const label = regions.length + 1;
    for (const i of pixels) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      labels[i] = label;
    }
    regions.push({ x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h, area: pixels.length / n, rgb, label, surface });
  }
  const background: RGB = found?.background ?? [128, 128, 128];

  // A close-up is scanned on its own: whatever else was found around it is shadow and clutter.
  let largest: Region | null = null;
  let covered = 0;
  for (const region of regions) {
    covered += region.area;
    if (!largest || region.area > largest.area) largest = region;
  }
  if (largest && largest.area > CLOSE_UP_AREA && largest.area > covered * 0.75) return { regions: [largest], background, labels, width: w, height: h };

  // Reading order: rows top to bottom, then left to right.
  regions.sort((a, b) => {
    const rowA = a.y + a.h / 2;
    const rowB = b.y + b.h / 2;
    return Math.abs(rowA - rowB) > Math.min(a.h, b.h) * 0.6 ? rowA - rowB : a.x - b.x;
  });
  return { regions, background, labels, width: w, height: h };
}

/**
 * Typical color of a piece, white-balanced to the background.
 * A colored piece is best represented by its most saturated pixels: highlights wash color out and
 * shadows dull it. A neutral piece (white, grey, black) has no saturation to go by, so its lit
 * mid-tones are used instead.
 */
function pieceColor(pixels: number[], data: Uint8ClampedArray, planes: Planes, background: [number, number, number]): [number, number, number] | null {
  const { L, A, B, keepA, keepB, solid } = planes;
  if (pixels.length < 12) return null;
  // Where there is enough of it, judge by the part of the region that is certainly piece and not its shadow.
  let pool = pixels.filter((i) => solid[i]);
  if (pool.length < Math.max(12, pixels.length * 0.2)) pool = pixels;
  // Large pieces have far more pixels than needed to judge a color.
  const stride = Math.max(1, Math.ceil(pool.length / 1500));
  const count = Math.floor(pool.length / stride);
  // Each entry packs a sort key (chroma or lightness, in steps of 1/16) above the sample's position.
  const SLOTS = 2048;
  const byChroma = new Float64Array(count);
  const byLight = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    const i = pool[s * stride];
    byChroma[s] = Math.round(Math.hypot(A[i] + keepA, B[i] + keepB) * 16) * SLOTS + s;
    byLight[s] = Math.round(L[i] * 16) * SLOTS + s;
  }
  byChroma.sort();
  const colored = byChroma[Math.floor(count * 0.7)] / SLOTS / 16 > 14;
  const order = colored ? byChroma : byLight.sort();
  const from = Math.floor(count * (colored ? 0.55 : 0.45));
  const to = Math.max(from + 1, Math.floor(count * (colored ? 0.97 : 0.9)));
  let r = 0, g = 0, b = 0;
  for (let s = from; s < to; s++) {
    const p = pool[(order[s] % SLOTS) * stride] * 4;
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
  }
  r /= to - from;
  g /= to - from;
  b /= to - from;

  // If the background is close to neutral (paper, a grey desk), use it as a white-balance reference.
  const [br, bg, bb] = background;
  const grey = (br + bg + bb) / 3;
  const spread = Math.max(br, bg, bb) - Math.min(br, bg, bb);
  if (grey > 70 && spread < 45) {
    r = Math.min(255, (r * grey) / br);
    g = Math.min(255, (g * grey) / bg);
    b = Math.min(255, (b * grey) / bb);
  }
  return [r, g, b];
}
