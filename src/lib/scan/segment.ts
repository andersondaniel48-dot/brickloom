// Finds individual pieces in a photo of bricks laid out on a plain surface.
// Pure typed-array image processing, fast enough to run on live camera frames.
import { rgbToLab, type Lab } from '../color.ts';

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
}

export interface Segmentation {
  regions: Region[];
  /** Estimated background color. */
  background: [number, number, number];
}

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
/** Share of the frame above which a single region is treated as one piece photographed up close. */
const CLOSE_UP_AREA = 0.2;
/** Lightness step between neighbouring pixels (L* units) that counts as an outline. */
const EDGE_CONTRAST = 15;
const cbrt = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** 3x3 binary dilation (grow=true) or erosion, repeated `times`. */
function morph(mask: Uint8Array, w: number, h: number, grow: boolean, times: number): Uint8Array {
  let src = mask;
  for (let t = 0; t < times; t++) {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = grow ? 0 : 1;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const v = src[yy * w + xx];
            if (grow ? v : !v) {
              hit = grow ? 1 : 0;
              dy = 2;
              break;
            }
          }
        }
        dst[y * w + x] = hit;
      }
    }
    src = dst;
  }
  return src;
}

/**
 * Separates pieces from the background of an image.
 * Works best on a plain, contrasting surface with the pieces not touching each other.
 */
export function segment(image: ImageData): Segmentation {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = LINEAR[data[p]];
    const g = LINEAR[data[p + 1]];
    const b = LINEAR[data[p + 2]];
    const fx = cbrt((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
    const fy = cbrt(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
    const fz = cbrt((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }

  // Background model from the image border: constant chroma, and lightness as a plane so that
  // uneven lighting across the surface is not mistaken for pieces.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const borderA: number[] = [];
  const borderB: number[] = [];
  const borderR: number[] = [];
  const borderG: number[] = [];
  const borderBl: number[] = [];
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.round(Math.min(w, h) / 160));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = y * w + x;
      borderA.push(A[i]);
      borderB.push(B[i]);
      borderR.push(data[i * 4]);
      borderG.push(data[i * 4 + 1]);
      borderBl.push(data[i * 4 + 2]);
      samples.push([x / w, y / h, L[i]]);
    }
  }
  const bgA = median(borderA);
  const bgB = median(borderB);
  const background: [number, number, number] = [median(borderR), median(borderG), median(borderBl)];

  // Least-squares plane L = px*x + py*y + pc, fitted twice so pieces that touch the border do not skew it.
  let px = 0, py = 0, pc = median(samples.map((s) => s[2]));
  for (let pass = 0; pass < 2; pass++) {
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, s1 = 0, sxl = 0, syl = 0, sl = 0;
    for (const [x, y, l] of samples) {
      if (Math.abs(l - (px * x + py * y + pc)) > 12) continue;
      sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; s1 += 1;
      sxl += x * l; syl += y * l; sl += l;
    }
    if (s1 < 12) break;
    // Solve the 3x3 normal equations by Cramer's rule.
    const det = sxx * (syy * s1 - sy * sy) - sxy * (sxy * s1 - sy * sx) + sx * (sxy * sy - syy * sx);
    if (Math.abs(det) < 1e-9) break;
    px = (sxl * (syy * s1 - sy * sy) - sxy * (syl * s1 - sy * sl) + sx * (syl * sy - syy * sl)) / det;
    py = (sxx * (syl * s1 - sy * sl) - sxl * (sxy * s1 - sy * sx) + sx * (sxy * sl - syl * sx)) / det;
    pc = (sxx * (syy * sl - sy * syl) - sxy * (sxy * sl - syl * sx) + sxl * (sxy * sy - syy * sx)) / det;
  }

  // Distance of every pixel from the background model. Lightness counts for less than chroma:
  // shadows change lightness a lot and chroma hardly at all.
  const dist = new Float32Array(n);
  const hist = new Uint32Array(128);
  for (let y = 0; y < h; y++) {
    const fy = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dl = (L[i] - (px * (x / w) + py * fy + pc)) * 0.55;
      const da = A[i] - bgA;
      const db = B[i] - bgB;
      const d = Math.sqrt(dl * dl + da * da + db * db);
      dist[i] = d;
      hist[Math.min(127, d | 0)]++;
    }
  }

  // Otsu's threshold on the distance histogram, kept within sensible bounds.
  let total = 0;
  for (let i = 0; i < 128; i++) total += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 12;
  for (let t = 0; t < 128; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  threshold = Math.min(26, Math.max(9, threshold * 0.8));

  // A pixel belongs to a piece if its color differs from the background, or if it sits on a sharp
  // lightness edge. The edge test is what finds a white piece on white paper: its outline and studs
  // are visible even though its faces match the background.
  let mask: Uint8Array = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let on = dist[i] > threshold;
      if (!on && x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        on = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]) > EDGE_CONTRAST;
      }
      mask[i] = on ? 1 : 0;
    }
  }
  // Join broken outlines, fill everything they enclose, shrink back, then drop specks.
  const k = Math.max(1, Math.round(Math.min(w, h) / 220));
  mask = morph(fillHoles(morph(mask, w, h, true, k + 1), w, h), w, h, false, k + 1);
  mask = morph(morph(mask, w, h, false, k), w, h, true, k);

  // Connected components by flood fill.
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const regions: Region[] = [];
  const minArea = Math.max(40, n * 0.0007);
  let label = 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let minX = w, maxX = 0, minY = h, maxY = 0, area = 0;
    const pixels: number[] = [];
    while (top) {
      const i = stack[--top];
      const x = i % w;
      const y = (i / w) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (pixels.length < 6000 || area % 3 === 0) pixels.push(i);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = label;
            stack[top++] = j;
          }
        }
      }
    }
    if (area < minArea || area > n * 0.85) continue;
    // One thing filling a large share of the frame is a single piece held up close.
    const closeUp = area > n * CLOSE_UP_AREA;
    // Otherwise, something hugging two or more edges of the frame is the table edge or a hand, not a piece.
    const edges = (minX <= 1 ? 1 : 0) + (minY <= 1 ? 1 : 0) + (maxX >= w - 2 ? 1 : 0) + (maxY >= h - 2 ? 1 : 0);
    if (edges >= 2 && !closeUp) continue;

    regions.push({
      x: minX / w,
      y: minY / h,
      w: (maxX - minX + 1) / w,
      h: (maxY - minY + 1) / h,
      area: area / n,
      rgb: pieceColor(pixels, data, L, A, B, background),
    });
  }

  // A close-up is scanned on its own: whatever else was found around it is shadow and clutter.
  const largest = regions.reduce<Region | null>((a, b) => (!a || b.area > a.area ? b : a), null);
  if (largest && largest.area > CLOSE_UP_AREA) return { regions: [largest], background };

  // Reading order: rows top to bottom, then left to right.
  regions.sort((a, b) => {
    const rowA = a.y + a.h / 2;
    const rowB = b.y + b.h / 2;
    return Math.abs(rowA - rowB) > Math.min(a.h, b.h) * 0.6 ? rowA - rowB : a.x - b.x;
  });
  return { regions, background };
}

/** Sets every background pixel that cannot be reached from the image border, i.e. the inside of closed shapes. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) (visit(x), visit((h - 1) * w + x));
  for (let y = 0; y < h; y++) (visit(y * w), visit(y * w + w - 1));
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < (h - 1) * w) visit(i + w);
  }
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

/**
 * Typical color of a piece, white-balanced to the background.
 * A colored piece is best represented by its most saturated pixels: highlights wash color out and
 * shadows dull it. A neutral piece (white, grey, black) has no saturation to go by, so its lit
 * mid-tones are used instead.
 */
function pieceColor(
  pixels: number[],
  data: Uint8ClampedArray,
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  background: [number, number, number],
): [number, number, number] | null {
  if (pixels.length < 12) return null;
  const chroma = (i: number) => Math.hypot(A[i], B[i]);
  const byChroma = pixels.slice().sort((a, b) => chroma(a) - chroma(b));
  const colored = chroma(byChroma[Math.floor(byChroma.length * 0.7)]) > 14;
  const sorted = colored ? byChroma : pixels.slice().sort((a, b) => L[a] - L[b]);
  const from = Math.floor(sorted.length * (colored ? 0.55 : 0.45));
  const to = Math.max(from + 1, Math.floor(sorted.length * (colored ? 0.97 : 0.9)));
  let r = 0, g = 0, b = 0;
  for (let i = from; i < to; i++) {
    const p = sorted[i] * 4;
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
  }
  const count = to - from;
  r /= count;
  g /= count;
  b /= count;

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

export const regionLab = (region: Region): Lab | null => (region.rgb ? rgbToLab(...region.rgb) : null);
