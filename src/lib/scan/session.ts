// One scan: find the pieces in a photo, identify each, and work out its color.
import type { Catalog } from '../catalog.ts';
import { hexToLab, rankColors, rgbToLab, type ColorMatch } from '../color.ts';
import { getThumb } from '../thumbs.ts';
import { cropBox, cropRegion, identify, toJpeg, type Box, type Candidate, type Identification } from './identify.ts';
import { segment, type Region, type Segmentation } from './segment.ts';

export interface Detection {
  id: number;
  region: Region;
  /** The cropped photo of this piece. */
  crop: string;
  status: 'identifying' | 'done' | 'unknown' | 'error';
  candidates: Candidate[];
  /** Index into candidates of the accepted match. */
  choice: number;
  /** What the recognizer made of the color, as catalog color ids with confidence. */
  seen: { color: number; score: number }[];
  /** Most likely colors, best first. */
  colors: ColorMatch[];
  color: number | null;
  qty: number;
  included: boolean;
  /** Much larger than the other pieces in the photo: probably several pieces touching. */
  crowded: boolean;
}

/** Captures are kept at close to full camera resolution: the detail in each crop is what recognition depends on. */
const MAX_SOURCE = 4096;
const WORK_SIZE = 640;
const MAX_PIECES = 60;
/** Each piece is sent to the recognizer at up to this size. */
const CROP_SIZE = 512;
/** Below this confidence a match is shown but not added unless the builder says so. */
const MIN_CONFIDENCE = 0.45;
/** At most this many further pieces are looked for in one region where pieces touch. */
const MAX_TOUCHING = 4;
/** A piece picked out of a group of touching pieces is harder to get right, so it has to clear a higher bar to be added unasked. */
const MIN_CONFIDENCE_TOUCHING = 0.75;

/** Copies a video frame or image into a canvas, capped at `maxSize` on its longer side. */
export function toCanvas(source: HTMLVideoElement | ImageBitmap | HTMLCanvasElement, maxSize = MAX_SOURCE): HTMLCanvasElement {
  const sw = 'videoWidth' in source ? source.videoWidth : source.width;
  const sh = 'videoHeight' in source ? source.videoHeight : source.height;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** How crisp a frame is: mean squared brightness gradient over the middle of the picture. */
function sharpness(frame: HTMLCanvasElement): number {
  const w = frame.width >> 1;
  const h = frame.height >> 1;
  if (w < 8 || h < 8) return 0;
  const { data } = frame.getContext('2d', { willReadFrequently: true })!.getImageData(frame.width >> 2, frame.height >> 2, w, h);
  let sum = 0;
  let count = 0;
  for (let y = 2; y < h - 2; y += 3) {
    for (let x = 2; x < w - 2; x += 3) {
      const i = (y * w + x) * 4 + 1; // green carries most of the detail
      const gx = data[i + 4] - data[i - 4];
      const gy = data[i + w * 4] - data[i - w * 4];
      sum += gx * gx + gy * gy;
      count++;
    }
  }
  return sum / count;
}

const nextFrame = (video: HTMLVideoElement) =>
  new Promise<void>((resolve) => {
    // The timer covers browsers without frame callbacks, and a video that has stalled.
    const timer = window.setTimeout(resolve, 90);
    video.requestVideoFrameCallback?.(() => (window.clearTimeout(timer), resolve()));
  });

/**
 * Takes a still from the camera. A single video frame is often smeared by the hand holding the
 * phone, so a few consecutive frames are grabbed and the crispest kept.
 */
export async function captureStill(video: HTMLVideoElement, frames = 3): Promise<HTMLCanvasElement> {
  let best = toCanvas(video);
  let bestScore = sharpness(best);
  for (let i = 1; i < frames; i++) {
    await nextFrame(video);
    const frame = toCanvas(video);
    const score = sharpness(frame);
    if (score > bestScore) {
      best = frame;
      bestScore = score;
    }
  }
  return best;
}

function locate(source: HTMLVideoElement | HTMLCanvasElement, workSize: number): Segmentation | null {
  const small = toCanvas(source, workSize);
  if (!small.width || !small.height) return null;
  const found = segment(small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height));
  found.regions.length = Math.min(found.regions.length, MAX_PIECES);
  return found;
}

/** Locates pieces in a frame. Used for both the live overlay and the captured photo. */
export const findPieces = (source: HTMLVideoElement | HTMLCanvasElement, workSize = WORK_SIZE): Region[] => locate(source, workSize)?.regions ?? [];

/**
 * Cuts a region out of the photo for recognition, with every other piece that shows in the cut
 * painted out in the color of the surface. On a crowded tray the neighbours crowd into the cut,
 * and the recognizer would otherwise sometimes name one of them instead.
 */
function isolate(photo: HTMLCanvasElement, region: Region, located: Segmentation | null, maxSize: number): HTMLCanvasElement {
  const crop = cropRegion(photo, region, maxSize);
  if (!located || !region.label) return crop;
  const area = cropBox(photo, region);
  const { labels, width, height } = located;
  const x0 = Math.max(0, Math.floor(area.x * width));
  const y0 = Math.max(0, Math.floor(area.y * height));
  const w = Math.min(width, Math.ceil((area.x + area.w) * width)) - x0;
  const h = Math.min(height, Math.ceil((area.y + area.h) * height)) - y0;
  if (w < 1 || h < 1) return crop;

  // Where the others are, taken one pixel generously so their rims go too.
  const others = new ImageData(w, h);
  const foreign = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] !== 0 && labels[y * width + x] !== region.label;
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + x;
      const py = y0 + y;
      if (labels[py * width + px] === region.label) continue;
      if (foreign(px, py) || foreign(px - 1, py) || foreign(px + 1, py) || foreign(px, py - 1) || foreign(px, py + 1)) {
        others.data[(y * w + x) * 4 + 3] = 255;
        any = true;
      }
    }
  }
  if (!any) return crop;
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  mask.getContext('2d')!.putImageData(others, 0, 0);

  // A sheet of surface color, cut to the shape of the others (scaled up smoothly, so with soft edges).
  const sheet = document.createElement('canvas');
  sheet.width = crop.width;
  sheet.height = crop.height;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = `rgb(${region.surface.map(Math.round).join(',')})`;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, ((x0 / width - area.x) / area.w) * crop.width, ((y0 / height - area.y) / area.h) * crop.height, (w / width / area.w) * crop.width, (h / height / area.h) * crop.height);
  crop.getContext('2d')!.drawImage(sheet, 0, 0);
  return crop;
}

/** Average color of the middle of a region of the photo. */
function centerColor(canvas: HTMLCanvasElement, region: Box): [number, number, number] {
  const w = Math.max(1, Math.round(canvas.width * region.w * 0.3));
  const h = Math.max(1, Math.round(canvas.height * region.h * 0.3));
  const x = Math.round(canvas.width * (region.x + region.w / 2) - w / 2);
  const y = Math.round(canvas.height * (region.y + region.h / 2) - h / 2);
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(Math.max(0, x), Math.max(0, y), w, h).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / 4;
  return [r / n, g / n, b / n];
}

/**
 * Looks in a crop for something that clearly is not the surface and lies outside the pieces found
 * so far: another piece, touching the first. Returns where the largest such thing is, or null when
 * what is left over is too little to be a piece. Only points for which `mine` holds are examined
 * (neighbouring pieces show in the crop too). `surface` is the color of what the pieces lie on.
 */
function leftover(crop: HTMLCanvasElement, mine: (x: number, y: number) => boolean, found: Box[], surface: [number, number, number]): Box | null {
  const scale = 96 / Math.max(crop.width, crop.height);
  const w = Math.max(8, Math.round(crop.width * scale));
  const h = Math.max(8, Math.round(crop.height * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(crop, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const [sl, sa, sb] = rgbToLab(...surface);

  const open = new Uint8Array(w * h); // 1 = stands out from the surface and belongs to no piece yet
  let all = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      const fy = (y + 0.5) / h;
      if (!mine(fx, fy)) continue;
      const p = (y * w + x) * 4;
      const [l, a, b] = rgbToLab(data[p], data[p + 1], data[p + 2]);
      // The same test as when finding pieces: a different color, or far darker or lighter. Not a shadow.
      if (Math.hypot(a - sa, b - sb) < 14 && l - sl > -26 && l - sl < 18) continue;
      all++;
      // Boxes are taken a little generously: the rim of a piece just outside its box is not another piece.
      if (!found.some((f) => fx > f.x - 0.04 && fx < f.x + f.w + 0.04 && fy > f.y - 0.04 && fy < f.y + f.h + 0.04)) open[y * w + x] = 1;
    }
  }
  if (all < 40) return null;

  // The largest connected patch of it.
  let best: { count: number; minX: number; maxX: number; minY: number; maxY: number } | null = null;
  const stack: number[] = [];
  for (let start = 0; start < open.length; start++) {
    if (open[start] !== 1) continue;
    const patch = { count: 0, minX: w, maxX: 0, minY: h, maxY: 0 };
    open[start] = 2;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;
      patch.count++;
      if (x < patch.minX) patch.minX = x;
      if (x > patch.maxX) patch.maxX = x;
      if (y < patch.minY) patch.minY = y;
      if (y > patch.maxY) patch.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || open[yy * w + xx] !== 1) continue;
          open[yy * w + xx] = 2;
          stack.push(yy * w + xx);
        }
      }
    }
    if (!best || patch.count > best.count) best = patch;
  }
  // A thin strip, or a small share of what is in the region, is the rim or shadow of a piece already found.
  if (!best || best.count < Math.max(24, all * 0.1) || Math.min(best.maxX - best.minX, best.maxY - best.minY) < 5) return null;
  return { x: best.minX / w, y: best.minY / h, w: (best.maxX - best.minX + 1) / w, h: (best.maxY - best.minY + 1) / h };
}

/** Paints over a box (fractions of the canvas) in the given color, with soft edges so that no outline is left to be mistaken for a piece. */
function paintOut(canvas: HTMLCanvasElement, box: Box, color: [number, number, number]) {
  const ctx = canvas.getContext('2d')!;
  const fill = `rgb(${color.map(Math.round).join(',')})`;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.shadowColor = fill;
  ctx.shadowBlur = Math.max(canvas.width, canvas.height) * 0.03;
  ctx.fillRect(box.x * canvas.width, box.y * canvas.height, box.w * canvas.width, box.h * canvas.height);
  ctx.restore();
}

/** Of the pieces' pixels inside a box of the photo, the share that belongs to the region with this label. */
function ownShare(located: Segmentation, label: number, box: Box): number {
  const { labels, width, height } = located;
  let own = 0;
  let others = 0;
  for (let y = Math.max(0, Math.floor(box.y * height)); y < Math.min(height, Math.ceil((box.y + box.h) * height)); y++) {
    for (let x = Math.max(0, Math.floor(box.x * width)); x < Math.min(width, Math.ceil((box.x + box.w) * width)); x++) {
      const l = labels[y * width + x];
      if (l === label) own++;
      else if (l) others++;
    }
  }
  return own + others ? own / (own + others) : 0;
}

/** A box of the photo, as a box within a cut of the photo. */
const inCropOf = (box: Box, within: Box): Box => ({ x: (box.x - within.x) / within.w, y: (box.y - within.y) / within.h, w: box.w / within.w, h: box.h / within.h });

/** How much two boxes overlap, as a share of the smaller one. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w <= 0 || h <= 0 ? 0 : (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Runs a scan on a captured photo. `onChange` is called with the full list each time any piece
 * updates, so results can appear one by one.
 */
export async function runScan(
  photo: HTMLCanvasElement,
  catalog: Catalog,
  onChange: (detections: Detection[]) => void,
  signal: AbortSignal,
): Promise<void> {
  // Let the review screen appear before the heavy lifting starts.
  await new Promise((resolve) => setTimeout(resolve));
  if (signal.aborted) return;
  const located = locate(photo, WORK_SIZE);
  let regions = located?.regions ?? [];
  // No separable pieces (busy background, or one piece filling the frame): let the recognizer look
  // at the whole photo. It reports where it saw the piece, which then becomes the region.
  const wholeFrame = regions.length === 0;
  if (wholeFrame) regions = [{ x: 0, y: 0, w: 1, h: 1, area: 1, rgb: null, label: 0, surface: [128, 128, 128] }];

  // Pieces that touch and could not be told apart come out as one oversized region. Those are
  // shown, but left out until the builder says otherwise.
  const areas = regions.map((r) => r.area).sort((a, b) => a - b);
  const typical = areas[areas.length >> 1];

  const thumb = document.createElement('canvas');
  const thumbnail = (crop: HTMLCanvasElement) => {
    const scale = Math.min(1, 160 / Math.max(crop.width, crop.height));
    thumb.width = Math.max(1, Math.round(crop.width * scale));
    thumb.height = Math.max(1, Math.round(crop.height * scale));
    thumb.getContext('2d')!.drawImage(crop, 0, 0, thumb.width, thumb.height);
    return thumb.toDataURL('image/jpeg', 0.8);
  };

  const detections: Detection[] = [];
  const add = (region: Region, crop: HTMLCanvasElement, crowded: boolean): Detection => {
    const detection: Detection = {
      id: detections.length,
      region,
      crop: thumbnail(crop),
      status: 'identifying',
      candidates: [],
      choice: 0,
      seen: [],
      colors: [],
      color: null,
      qty: 1,
      included: !crowded,
      crowded,
    };
    detections.push(detection);
    return detection;
  };
  const publish = () => !signal.aborted && onChange(detections.map((d) => ({ ...d })));

  /** Records what the recognizer made of a detection. */
  const settle = async (detection: Detection, result: Identification) => {
    detection.candidates = result.candidates;
    detection.seen = result.colors;
    // Prefer the best candidate that is in our catalog, unless an uncatalogued one is clearly a better match.
    const firstPart = result.candidates.findIndex((c) => c.part);
    detection.choice = firstPart > 0 && result.candidates[0].score - result.candidates[firstPart].score < 0.15 ? firstPart : 0;
    detection.status = result.candidates.length ? 'done' : 'unknown';
    if (detection.status === 'unknown' || result.candidates[detection.choice].score < MIN_CONFIDENCE) detection.included = false;
    await matchColor(detection, catalog);
    publish();
  };

  const scanRegion = async (detection: Detection, crop: HTMLCanvasElement) => {
    const original = detection.region;
    const area = cropBox(photo, original);
    const labelled = !wholeFrame && located && original.label ? located : null;
    /** A box within some cut of the photo, as a box of the photo. */
    const place = (box: Box, within: Box): Box => ({ x: within.x + box.x * within.w, y: within.y + box.y * within.h, w: box.w * within.w, h: box.h * within.h });
    const asRegion = (box: Box): Region => ({ ...original, ...box, area: box.w * box.h, rgb: centerColor(photo, box) });
    /** Does this point of the crop belong to this region (and not to a neighbour that shows in the crop)? */
    const mine = (x: number, y: number) => {
      if (!labelled) return true;
      const px = Math.floor((area.x + x * area.w) * labelled.width);
      const py = Math.floor((area.y + y * area.h) * labelled.height);
      return px >= 0 && py >= 0 && px < labelled.width && py < labelled.height && labelled.labels[py * labelled.width + px] === original.label;
    };
    /** Did the recognizer look at something other than this region: a neighbour, or the bare surface? */
    const astray = (seen: Box | null) => Boolean(labelled && seen && ownShare(labelled, original.label, seen) < 0.5);

    try {
      let first = await identify(await toJpeg(crop), catalog, signal);
      if (astray(first.box && place(first.box, area))) {
        // On a crowded tray the neighbours show in the cut, and the recognizer has named one of them.
        // Ask again with everything else painted out.
        first = await identify(await toJpeg(isolate(photo, original, located, CROP_SIZE)), catalog, signal);
      }
      if (wholeFrame && first.box) detection.region = asRegion(place(first.box, area));
      await settle(detection, first);
      if (!first.box || !first.candidates.length || !labelled) return;

      // Pieces that touch come through as one region. The recognizer says where in the crop the
      // piece it identified is; whatever else in the region stands out from the surface is cut out
      // and identified in turn, until the whole region is accounted for.
      const found = [first.box];
      for (let extra = 0; extra < MAX_TOUCHING; extra++) {
        const rest = leftover(crop, mine, found, original.surface);
        if (!rest) break;
        const restRegion = asRegion(place(rest, area));
        const within = cropBox(photo, restRegion);
        // The piece has to be something new: not one already accounted for, here or next door.
        const stale = (seen: Box | null) => !seen || astray(seen) || found.some((f) => overlap(f, inCropOf(seen, area)) > 0.5);

        let next = await identify(await toJpeg(cropRegion(photo, restRegion, CROP_SIZE)), catalog, signal);
        let seen = next.box && place(next.box, within);
        if (stale(seen)) {
          // The pieces already identified show in this cut too. Paint them out, and the neighbours, and ask again.
          const view = isolate(photo, restRegion, located, CROP_SIZE);
          for (const f of found) paintOut(view, inCropOf(place(f, area), within), original.surface);
          next = await identify(await toJpeg(view), catalog, signal);
          seen = next.box && place(next.box, within);
        }
        const fresh = seen && !stale(seen) && next.candidates.length ? seen : null;
        // Whatever comes of it, this patch has now been dealt with.
        found.push(rest);
        if (!fresh) continue;
        found.push(inCropOf(fresh, area));

        if (detection.region === original) {
          // The region held more than one piece after all: the first is only its own part of it.
          detection.region = asRegion(place(first.box, area));
          detection.crowded = false;
          detection.included = detection.candidates[detection.choice].score >= MIN_CONFIDENCE;
          await matchColor(detection, catalog);
        }
        const region = asRegion(fresh);
        const piece = add(region, cropRegion(photo, region, 200), false);
        await settle(piece, next);
        if (piece.included && piece.candidates[piece.choice].score < MIN_CONFIDENCE_TOUCHING) {
          piece.included = false;
          publish();
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      console.warn('identification failed', err);
      if (detection.status === 'identifying') {
        detection.status = 'error';
        detection.included = false;
      }
      publish();
    }
  };

  const crops = regions.map((region) => cropRegion(photo, region, CROP_SIZE));
  for (const [i, region] of regions.entries()) add(region, crops[i], regions.length >= 4 && region.area > typical * 4);
  publish();
  await Promise.all(crops.map((crop, i) => scanRegion(detections[i], crop)));
}

/**
 * Decides a detection's color from four kinds of evidence: what the recognizer saw, how close each
 * palette color is to the color measured in the photo, which colors the matched part was ever
 * actually made in, and how common each color is. Also warms the thumbnail for the result.
 *
 * The first two are good at different things. How light and how saturated a piece looks in a
 * photo is at the mercy of shade and exposure (the shaded side of a white brick measures as grey,
 * a red brick in shadow as dark red), and the recognizer copes with that far better than a
 * measurement can. Hue survives shade, and there the measurement is the steadier of the two. So
 * the measurement is compared mostly on hue.
 */
export async function matchColor(detection: Detection, catalog: Catalog): Promise<void> {
  const part = detection.candidates[detection.choice]?.part ?? null;
  const made = new Set(part ? await catalog.colorsFor(part.id) : []);
  const use = await catalog.colorUse();
  const sample = detection.region.rgb ? rgbToLab(...detection.region.rgb) : null;

  // The colors in the running: the recognizer's, and the palette colors nearest the measurement.
  const seen = new Map<number, number>();
  for (const { color, score } of detection.seen) seen.set(color, score);
  if (sample) for (const { color } of rankColors(sample, catalog.colorList, made).slice(0, 10)) if (!seen.has(color.id)) seen.set(color.id, 0);
  if (!seen.size) for (const id of [...made].slice(0, 8)) seen.set(id, 0);

  const off = new Map<number, number>();
  if (sample) {
    const chroma = Math.hypot(sample[1], sample[2]);
    for (const id of seen.keys()) {
      const [l, a, b] = hexToLab(catalog.color(id).rgb);
      const c = Math.hypot(a, b);
      // Split the difference in color into a change of saturation and a change of hue.
      const hue = Math.sqrt(Math.max(0, (a - sample[1]) ** 2 + (b - sample[2]) ** 2 - (c - chroma) ** 2));
      off.set(id, Math.hypot((l - sample[0]) * 0.35, (c - chroma) * 0.35, hue));
    }
  }
  // Lighting shifts every color in a photo, so what counts is being nearer than the alternatives.
  const nearest = Math.min(...off.values());

  detection.colors = [...seen]
    .map(([id, seenScore]) => {
      const measured = sample ? Math.exp(-(off.get(id)! - nearest) / 10) : 0;
      // A part that was never produced in a color is very unlikely to be that color.
      const exists = !made.size || made.has(id) ? 0.15 : 0;
      return { color: catalog.color(id), distance: 2 - (seenScore + measured + exists + 0.2 * (use.get(id) ?? 0)) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
  detection.color = detection.colors[0]?.color.id ?? null;
  if (part && detection.color !== null) void getThumb(part.geometry, detection.color);
}

/** Draws a tray of rendered pieces to practice scanning with when no real bricks are at hand. */
export async function sampleTray(catalog: Catalog): Promise<HTMLCanvasElement> {
  const pieces: [string, number][] = [
    ['3001', 4], ['3003', 1], ['3040b', 14], ['3020', 2], ['3062b', 15], ['3039', 4],
    ['3004', 25], ['3068b', 71], ['3010', 1], ['3660', 0], ['4589', 25], ['3023', 14],
  ];
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  // A sheet of paper under a desk lamp: slightly warm, brighter toward one corner.
  const paper = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  paper.addColorStop(0, '#f3efe6');
  paper.addColorStop(1, '#dedad0');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cols = 4;
  const cellW = canvas.width / cols;
  const cellH = canvas.height / 3;
  for (const [i, [part, color]] of pieces.entries()) {
    const url = await getThumb(catalog.part(part)?.geometry ?? null, color);
    if (!url) continue;
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 210 + ((i * 37) % 60);
    const cx = (i % cols) * cellW + cellW / 2 + (((i * 53) % 70) - 35);
    const cy = Math.floor(i / cols) * cellH + cellH / 2 + (((i * 29) % 60) - 30);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((((i * 67) % 50) - 25) * (Math.PI / 180));
    ctx.shadowColor = 'rgba(40, 30, 10, 0.28)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  return canvas;
}
