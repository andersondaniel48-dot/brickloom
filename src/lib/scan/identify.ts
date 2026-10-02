// Piece recognition via Brickognize (https://brickognize.com), a public recognition service that
// knows the whole BrickLink catalog. Each cropped piece is sent as a small JPEG; nothing else is shared.
import type { Catalog, PartInfo } from '../catalog.ts';

// Parts only (the general endpoint also proposes whole sets and minifigures, which a loose piece
// on a table never is), with the service's own color prediction and a few runner-up candidates.
const ENDPOINT = 'https://api.brickognize.com/predict/parts/?predict_color=true&top_k_items=8&top_k_colors=6&min_similarity_items=0.3';
// The service turns requests away once they arrive faster than about twenty a second (measured;
// it is not documented). Stay under that, and try again when one is refused anyway: several
// people scanning from the same network share the allowance.
const PER_SECOND = 16;
const BURST = 5;
const CONCURRENCY = 8;
const RETRIES = 3;

export interface Candidate {
  /** Identifier in the recognition service's catalog (BrickLink numbering). */
  externalId: string;
  name: string;
  /** 0..1 confidence. */
  score: number;
  image: string;
  /** The matching entry in our catalog, when there is one. */
  part: PartInfo | null;
}

export interface Identification {
  candidates: Candidate[];
  /** Colors the recognizer thinks the piece is, as catalog color ids with confidence, best first. */
  colors: { color: number; score: number }[];
  /** Where in the submitted image the recognizer saw the piece, as fractions of its size. */
  box: Box | null;
}

interface BrickognizeResponse {
  bounding_box?: { left: number; upper: number; right: number; lower: number; image_width: number; image_height: number };
  items?: { id: string; name: string; img_url: string; score: number }[];
  colors?: { id: string; name: string; score: number }[];
}

let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

// Requests are paced by a budget that refills steadily and allows a small head start.
let budget = BURST;
let refilled = performance.now();

async function turn(signal?: AbortSignal): Promise<void> {
  for (;;) {
    const now = performance.now();
    budget = Math.min(BURST, budget + ((now - refilled) / 1000) * PER_SECOND);
    refilled = now;
    if (budget >= 1) {
      budget--;
      return;
    }
    await pause(((1 - budget) / PER_SECOND) * 1000, signal);
  }
}

/** Sends an image to the service, waiting for a turn and trying again if it is refused. */
async function ask(image: Blob, signal?: AbortSignal): Promise<BrickognizeResponse> {
  for (let attempt = 0; ; attempt++) {
    await turn(signal);
    let failure: unknown;
    try {
      const body = new FormData();
      body.append('query_image', image, 'piece.jpg');
      const res = await fetch(ENDPOINT, { method: 'POST', body, signal });
      if (res.ok) return (await res.json()) as BrickognizeResponse;
      failure = new Error(`Recognition service returned ${res.status}`);
      // Anything but "slow down" or a fault on their side will fail the same way next time.
      if (res.status !== 429 && res.status < 500) throw failure;
    } catch (err) {
      // A refusal for arriving too fast comes back without the headers a browser needs to read it,
      // so it looks just like a dropped connection.
      if (signal?.aborted || err === failure) throw err;
      failure = err;
    }
    if (attempt >= RETRIES) throw failure;
    budget = Math.min(budget, 0); // everyone waits a moment
    await pause(350 * 2 ** attempt + Math.random() * 250, signal);
  }
}

/** Identifies the piece in an image: likely parts and likely colors, most likely first. */
export function identify(image: Blob, catalog: Catalog, signal?: AbortSignal): Promise<Identification> {
  return slot(async () => {
    const data = await ask(image, signal);

    // Several of the service's ids can be the same part to us (mold variants); keep the best of each.
    const candidates: Candidate[] = [];
    for (const item of data.items ?? []) {
      const part = catalog.resolveExternalId(item.id);
      if (part && candidates.some((c) => c.part?.id === part.id)) continue;
      candidates.push({ externalId: item.id, name: item.name, score: item.score, image: item.img_url, part });
    }

    const colors: Identification['colors'] = [];
    for (const c of data.colors ?? []) {
      const color = catalog.colorByName(c.name);
      if (color && !colors.some((seen) => seen.color === color.id)) colors.push({ color: color.id, score: c.score });
    }

    const b = data.bounding_box;
    const box = b && b.image_width && b.image_height
      ? { x: b.left / b.image_width, y: b.upper / b.image_height, w: (b.right - b.left) / b.image_width, h: (b.lower - b.upper) / b.image_height }
      : null;
    return { candidates: candidates.slice(0, 6), colors, box };
  });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The area cut out for a region: the region plus a margin, as fractions of the source size. */
export function cropBox(source: HTMLCanvasElement, region: Box): Box {
  const pad = Math.max(region.w * source.width, region.h * source.height) * 0.14;
  const x = Math.max(0, region.x - pad / source.width);
  const y = Math.max(0, region.y - pad / source.height);
  return { x, y, w: Math.min(1, region.x + region.w + pad / source.width) - x, h: Math.min(1, region.y + region.h + pad / source.height) - y };
}

/** Cuts a region (fractions of the source size) out of a canvas, with a margin, scaled to at most `maxSize`. */
export function cropRegion(source: HTMLCanvasElement, region: Box, maxSize: number): HTMLCanvasElement {
  const box = cropBox(source, region);
  const sx = box.x * source.width;
  const sy = box.y * source.height;
  const sw = box.w * source.width;
  const sh = box.h * source.height;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export const toJpeg = (canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode image'))), 'image/jpeg', quality));
