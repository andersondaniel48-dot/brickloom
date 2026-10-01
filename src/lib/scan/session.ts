// One scan: find the pieces in a photo, identify each, and match its color.
import type { Catalog } from '../catalog.ts';
import { rankColors, rgbToLab, type ColorMatch } from '../color.ts';
import { getThumb } from '../thumbs.ts';
import { cropRegion, identify, type Candidate } from './identify.ts';
import { segment, type Region } from './segment.ts';

export interface Detection {
  id: number;
  region: Region;
  /** The cropped photo of this piece. */
  crop: string;
  status: 'identifying' | 'done' | 'unknown' | 'error';
  candidates: Candidate[];
  /** Index into candidates of the accepted match. */
  choice: number;
  /** Closest palette colors to the photographed color, best first. */
  colors: ColorMatch[];
  color: number | null;
  qty: number;
  included: boolean;
  /** Much larger than the other pieces in the photo: probably several pieces touching. */
  crowded: boolean;
}

const MAX_SOURCE = 1800;
const WORK_SIZE = 640;
const MAX_PIECES = 48;

/** Copies a video frame or image into a canvas, capped at a size that keeps processing quick. */
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

/** Locates pieces in a frame. Used for both the live overlay and the captured photo. */
export function findPieces(source: HTMLVideoElement | HTMLCanvasElement, workSize = WORK_SIZE): Region[] {
  const small = toCanvas(source, workSize);
  if (!small.width || !small.height) return [];
  const image = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height);
  return segment(image).regions.slice(0, MAX_PIECES);
}

/** Average color of the middle of the image, for when the whole photo is one piece. */
function centerColor(canvas: HTMLCanvasElement): [number, number, number] {
  const w = Math.max(1, Math.round(canvas.width * 0.2));
  const h = Math.max(1, Math.round(canvas.height * 0.2));
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData((canvas.width - w) >> 1, (canvas.height - h) >> 1, w, h).data;
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
 * Runs a scan on a captured photo. `onChange` is called with the full list each time any piece
 * updates, so results can appear one by one.
 */
export async function runScan(
  photo: HTMLCanvasElement,
  catalog: Catalog,
  onChange: (detections: Detection[]) => void,
  signal: AbortSignal,
): Promise<void> {
  let regions = findPieces(photo);
  if (!regions.length) {
    // No separable pieces (busy background, or one piece held up close): let the recognizer look at the whole frame.
    regions = [{ x: 0, y: 0, w: 1, h: 1, area: 1, rgb: centerColor(photo) }];
  }

  // Pieces that touch come out as one oversized region. Those are shown, but left out until the builder says otherwise.
  const areas = regions.map((r) => r.area).sort((a, b) => a - b);
  const typical = areas[areas.length >> 1];
  const detections: Detection[] = [];
  for (const [id, region] of regions.entries()) {
    const { url } = await cropRegion(photo, region, 200);
    const crowded = regions.length >= 4 && region.area > typical * 3.5;
    detections.push({ id, region, crop: url, status: 'identifying', candidates: [], choice: 0, colors: [], color: null, qty: 1, included: !crowded, crowded });
  }
  const publish = () => !signal.aborted && onChange(detections.map((d) => ({ ...d })));
  publish();

  await Promise.all(
    detections.map(async (detection) => {
      try {
        const { blob } = await cropRegion(photo, detection.region);
        const candidates = await identify(blob, catalog, signal);
        detection.candidates = candidates;
        // Prefer the best candidate we can catalog, unless a clearly better one is something else (a minifigure, a set).
        const firstPart = candidates.findIndex((c) => c.part);
        detection.choice = firstPart > 0 && candidates[0].score - candidates[firstPart].score < 0.15 ? firstPart : 0;
        detection.status = candidates.length ? 'done' : 'unknown';
        await matchColor(detection, catalog);
      } catch (err) {
        if (signal.aborted) return;
        console.warn('identification failed', err);
        detection.status = 'error';
        detection.included = false;
      }
      if (detection.status === 'unknown') detection.included = false;
      publish();
    }),
  );
}

/** Ranks colors for a detection's current match and picks the best one. Also warms the thumbnail. */
export async function matchColor(detection: Detection, catalog: Catalog): Promise<void> {
  const part = detection.candidates[detection.choice]?.part ?? null;
  const made = part ? await catalog.colorsFor(part.id) : [];
  if (detection.region.rgb) {
    detection.colors = rankColors(rgbToLab(...detection.region.rgb), catalog.colorList, new Set(made)).slice(0, 8);
  } else {
    detection.colors = made.slice(0, 8).map((id) => ({ color: catalog.color(id), distance: 0 }));
  }
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
