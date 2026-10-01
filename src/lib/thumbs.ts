// Part thumbnails, rendered on demand from real geometry in the piece's own color and cached on the device.
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { db } from './db.ts';
import { VIEW_DIRECTION, addLights, createPart, frame } from './ldraw.ts';

const SIZE = 288;
const VERSION = 'v1';

const memory = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

let stage: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera } | null = null;

function getStage() {
  if (!stage) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    addLights(scene);
    stage = { renderer, scene, camera: new THREE.OrthographicCamera() };
  }
  return stage;
}

/**
 * Renders a scene to an image with the shared off-screen renderer. Synchronous, so it cannot
 * interleave with a thumbnail render. Used for pictures of whole builds; resizing an on-screen
 * canvas for that would disturb what the viewer is looking at.
 */
export function renderOffscreen(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): string {
  const { renderer } = getStage();
  renderer.setSize(width, height, false);
  renderer.render(scene, camera);
  const data = renderer.domElement.toDataURL('image/webp', 0.9);
  renderer.setSize(SIZE, SIZE, false);
  return data;
}

// One render at a time: they share a WebGL context.
let chain: Promise<unknown> = Promise.resolve();

async function render(geometryId: string, color: number): Promise<string | null> {
  const part = await createPart(geometryId, color);
  if (!part) return null;
  const job = chain.then(() => {
    const { renderer, scene, camera } = getStage();
    scene.add(part);
    part.updateMatrixWorld(true);
    frame(camera, new THREE.Box3().setFromObject(part), VIEW_DIRECTION, 1, 1.1);
    renderer.render(scene, camera);
    scene.remove(part);
    return renderer.domElement.toDataURL('image/webp', 0.92);
  });
  chain = job.catch(() => undefined);
  return job;
}

/** Thumbnail for a part in a color: a data URL, or null when the part has no 3D geometry. */
export function getThumb(geometryId: string | null, color: number): Promise<string | null> {
  if (!geometryId) return Promise.resolve(null);
  const key = `${geometryId}|${color}|${VERSION}`;
  const cached = memory.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const stored = await db.thumbs.get(key).catch(() => undefined);
      let data = stored?.data ?? null;
      if (!data) {
        data = await render(geometryId, color).catch((err) => {
          console.warn('thumbnail failed', geometryId, err);
          return null;
        });
        if (data) void db.thumbs.put({ key, data }).catch(() => undefined);
      }
      memory.set(key, data);
      pending.delete(key);
      return data;
    })();
    pending.set(key, job);
  }
  return job;
}

/** undefined while loading, null when unavailable. Pass `active: false` to defer work for off-screen items. */
export function useThumb(geometryId: string | null, color: number, active = true): string | null | undefined {
  const key = geometryId ? `${geometryId}|${color}|${VERSION}` : null;
  const [state, setState] = useState<{ key: string | null; url: string | null | undefined }>(() => ({
    key,
    url: key ? memory.get(key) : null,
  }));

  useEffect(() => {
    if (!key) return setState({ key, url: null });
    const cached = memory.get(key);
    if (cached !== undefined) return setState({ key, url: cached });
    if (!active) return;
    let live = true;
    void getThumb(geometryId, color).then((url) => live && setState({ key, url }));
    return () => {
      live = false;
    };
  }, [key, geometryId, color, active]);

  return state.key === key ? state.url : key ? memory.get(key) : null;
}
