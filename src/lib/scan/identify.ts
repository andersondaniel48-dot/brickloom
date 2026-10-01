// Piece recognition via Brickognize (https://brickognize.com), a public recognition service that
// knows the whole BrickLink catalog. Each cropped piece is sent as a small JPEG; nothing else is shared.
import type { Catalog, PartInfo } from '../catalog.ts';

const ENDPOINT = 'https://api.brickognize.com/predict/';
const CONCURRENCY = 5;

export interface Candidate {
  /** Identifier in the recognition service's catalog (BrickLink numbering). */
  externalId: string;
  name: string;
  /** 0..1 confidence. */
  score: number;
  image: string;
  kind: 'part' | 'set' | 'fig' | 'sticker';
  /** The matching entry in our catalog, when there is one. */
  part: PartInfo | null;
}

interface BrickognizeResponse {
  items?: { id: string; name: string; img_url: string; type: Candidate['kind']; score: number }[];
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

/** Identifies the piece in an image. Returns the best candidates, most likely first. */
export function identify(image: Blob, catalog: Catalog, signal?: AbortSignal): Promise<Candidate[]> {
  return slot(async () => {
    const body = new FormData();
    body.append('query_image', image, 'piece.jpg');
    const res = await fetch(ENDPOINT, { method: 'POST', body, signal });
    if (!res.ok) throw new Error(`Recognition service returned ${res.status}`);
    const data = (await res.json()) as BrickognizeResponse;
    return (data.items ?? []).slice(0, 6).map((item) => ({
      externalId: item.id,
      name: item.name,
      score: item.score,
      image: item.img_url,
      kind: item.type,
      part: item.type === 'part' ? catalog.resolveExternalId(item.id) : null,
    }));
  });
}

/** Cuts a region (fractions of the source size) out of a canvas as a JPEG, padded and scaled for recognition. */
export function cropRegion(
  source: HTMLCanvasElement,
  region: { x: number; y: number; w: number; h: number },
  maxSize = 448,
): Promise<{ blob: Blob; url: string }> {
  const pad = Math.max(region.w * source.width, region.h * source.height) * 0.14;
  const sx = Math.max(0, region.x * source.width - pad);
  const sy = Math.max(0, region.y * source.height - pad);
  const sw = Math.min(source.width - sx, region.w * source.width + pad * 2);
  const sh = Math.min(source.height - sy, region.h * source.height + pad * 2);
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, url: canvas.toDataURL('image/jpeg', 0.8) }) : reject(new Error('could not encode crop'))),
      'image/jpeg',
      0.9,
    );
  });
}
