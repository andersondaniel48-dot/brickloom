// Finds the pieces in the camera's view, frame after frame, without holding up the screen.
import { segment, type Region } from './segment.ts';

interface Answer {
  id: number;
  regions: Region[];
}

export class LiveFinder {
  private worker: Worker | null = null;
  private readonly waiting = new Map<number, (regions: Region[]) => void>();
  private sent = 0;
  private readonly canvas = document.createElement('canvas');

  constructor() {
    try {
      this.worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<Answer>) => {
        const done = this.waiting.get(event.data.id);
        this.waiting.delete(event.data.id);
        done?.(event.data.regions);
      };
      this.worker.onerror = () => this.fallBack();
    } catch {
      this.worker = null; // no workers here: frames are examined on the main thread instead
    }
  }

  /** Gives up on the worker; from now on frames are examined on the main thread. */
  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    for (const done of this.waiting.values()) done([]);
    this.waiting.clear();
  }

  /** The pieces in the frame the video is showing now, examined at `size` pixels on its longer side. */
  find(video: HTMLVideoElement, size: number): Promise<Region[]> {
    const scale = Math.min(1, size / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (!width || !height) return Promise.resolve([]);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);

    const worker = this.worker;
    if (!worker) return Promise.resolve(segment(image).regions);
    return new Promise((resolve) => {
      const id = ++this.sent;
      this.waiting.set(id, resolve);
      worker.postMessage({ id, width, height, pixels: image.data.buffer }, [image.data.buffer]);
      // A worker that never answers (it failed to load, say) must not freeze the viewfinder.
      setTimeout(() => this.waiting.has(id) && this.fallBack(), 4000);
    });
  }

  close() {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
  }
}
