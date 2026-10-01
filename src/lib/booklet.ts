// Renders every instruction step to an image, for printing the build as a booklet or saving it as a PDF.
import * as THREE from 'three';
import type { Placement, Shapes } from '../../shared/build.ts';
import { VIEW_DIRECTION, addLights, buildModel, frame, setFaded } from './ldraw.ts';

const WIDTH = 1500;
const HEIGHT = 1000;
const FADE_TOWARD = new THREE.Color('#dceaf6');

/** One image per step (plus a final image of the finished model), as data URLs with transparent backgrounds. */
export async function renderBooklet(
  parts: Placement[],
  steps: number[][],
  shapes: Shapes,
  onProgress?: (done: number, total: number) => void,
): Promise<{ steps: string[]; finished: string }> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  addLights(scene);
  const camera = new THREE.OrthographicCamera();

  try {
    const model = await buildModel(parts, shapes);
    scene.add(model.root);
    for (const node of model.nodes) if (node) node.visible = false;

    const images: string[] = [];
    const box = new THREE.Box3();
    for (const [s, step] of steps.entries()) {
      // Earlier steps fade back; this step's parts appear in full color.
      if (s > 0) for (const i of steps[s - 1]) if (model.nodes[i]) setFaded(model.nodes[i]!, true, FADE_TOWARD);
      for (const i of step) if (model.nodes[i]) model.nodes[i]!.visible = true;
      model.root.updateMatrixWorld(true);
      box.makeEmpty();
      for (const node of model.nodes) if (node?.visible) box.expandByObject(node);
      frame(camera, box, VIEW_DIRECTION, WIDTH / HEIGHT, 1.2);
      renderer.render(scene, camera);
      images.push(renderer.domElement.toDataURL('image/webp', 0.9));
      onProgress?.(s + 1, steps.length);
      // Yield so the page can paint progress between renders.
      await new Promise((resolve) => setTimeout(resolve));
    }

    for (const node of model.nodes) if (node) setFaded(node, false, FADE_TOWARD);
    frame(camera, new THREE.Box3().setFromObject(model.root), VIEW_DIRECTION, WIDTH / HEIGHT, 1.2);
    renderer.render(scene, camera);
    return { steps: images, finished: renderer.domElement.toDataURL('image/webp', 0.9) };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
