// Runs the piece finder off the main thread, so the viewfinder stays smooth while its frames are examined.
import { segment } from './segment.ts';

addEventListener('message', (event: MessageEvent<{ id: number; width: number; height: number; pixels: ArrayBuffer }>) => {
  const { id, width, height, pixels } = event.data;
  const { regions } = segment({ width, height, data: new Uint8ClampedArray(pixels) });
  postMessage({ id, regions });
});
