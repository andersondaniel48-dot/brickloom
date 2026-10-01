// A three.js stage for showing a brick model: orbit camera, step-by-step reveal, snapshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Placement, Shapes } from '../../shared/build.ts';
import { VIEW_DIRECTION, addLights, buildModel, createPart, frame, setFaded, type BuiltModel } from './ldraw.ts';
import { renderOffscreen } from './thumbs.ts';

const FADE_TOWARD = new THREE.Color('#dceaf6');
const DROP = 90; // LDU a new part falls into place from
const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface StepState {
  /** Part indices per step. */
  steps: number[][];
  /** Steps shown, 1-based: parts of steps[0..index-1] are visible, steps[index-1] is the newest. */
  index: number;
  /** Wash out parts from earlier steps so the new ones stand out. */
  emphasize: boolean;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private controls: OrbitControls | null = null;
  private model: BuiltModel | null = null;
  private dirty = true;
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private tweens: ((now: number) => boolean)[] = [];
  private disposed = false;
  private direction = VIEW_DIRECTION.clone();
  private shownStep = 0;
  private framed = false;
  autoRotate = false;

  constructor(
    private canvas: HTMLCanvasElement,
    options: { interactive?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    this.renderer.setClearColor(0x000000, 0);
    addLights(this.scene);

    if (options.interactive !== false) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.1;
      this.controls.minZoom = 0.5;
      this.controls.maxZoom = 6;
      // Keep the camera above the table: looking up from underneath is never useful.
      this.controls.maxPolarAngle = Math.PI * 0.55;
      this.controls.addEventListener('change', () => (this.dirty = true));
      this.controls.addEventListener('start', () => (this.autoRotate = false));
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private get aspect() {
    // A canvas that has not been laid out yet reports 0; treat it as square rather than dividing by it.
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight) || 1;
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    // Preserve the vertical extent and adapt the horizontal one to the new shape.
    const halfH = (this.camera.top - this.camera.bottom) / 2;
    const cx = (this.camera.left + this.camera.right) / 2;
    this.camera.left = cx - halfH * this.aspect;
    this.camera.right = cx + halfH * this.aspect;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private loop(now: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.tweens.length) {
      this.tweens = this.tweens.filter((tween) => tween(now));
      this.dirty = true;
    }
    if (this.autoRotate && this.controls && this.model) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, 0.0035);
      this.camera.position.copy(this.controls.target).add(offset);
      this.dirty = true;
    }
    if (this.controls?.update()) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Replaces the model on stage. Resolves once it is built and framed. */
  async setModel(parts: Placement[], shapes: Shapes): Promise<void> {
    this.swap(await buildModel(parts, shapes));
  }

  /** Puts a single part on stage. Resolves false when the part has no 3D geometry. */
  async setPart(geometryId: string, color: number): Promise<boolean> {
    const root = await createPart(geometryId, color);
    if (root) this.swap({ root, nodes: [] });
    return Boolean(root);
  }

  private swap(model: BuiltModel) {
    if (this.disposed) return;
    if (this.model) this.scene.remove(this.model.root);
    this.model = model;
    this.shownStep = 0;
    for (const node of model.nodes) if (node) node.userData.home = node.position.clone();
    this.scene.add(model.root);
    model.root.updateMatrixWorld(true);
    this.frameBox(new THREE.Box3().setFromObject(model.root), false);
  }

  private pose(box: THREE.Box3): CameraPose {
    const probe = this.camera.clone();
    // Keep whatever angle the builder has turned the model to (once there is a view to keep).
    if (this.controls && this.framed) this.direction.copy(this.camera.position).sub(this.controls.target).normalize();
    frame(probe, box, this.direction, this.aspect);
    return {
      position: probe.position.clone(),
      target: box.getCenter(new THREE.Vector3()),
      left: probe.left,
      right: probe.right,
      top: probe.top,
      bottom: probe.bottom,
    };
  }

  private applyPose(p: CameraPose) {
    this.camera.position.copy(p.position);
    this.camera.left = p.left;
    this.camera.right = p.right;
    this.camera.top = p.top;
    this.camera.bottom = p.bottom;
    this.camera.near = 0.1;
    this.camera.far = p.position.distanceTo(p.target) * 4;
    this.camera.zoom = 1;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p.target);
    this.camera.updateProjectionMatrix();
    this.controls?.target.copy(p.target);
    this.framed = true;
    this.dirty = true;
  }

  private frameBox(box: THREE.Box3, animate: boolean) {
    if (box.isEmpty()) return;
    const to = this.pose(box);
    if (!animate) return this.applyPose(to);
    const from: CameraPose = {
      position: this.camera.position.clone(),
      target: this.controls?.target.clone() ?? to.target.clone(),
      // Fold any user zoom into the starting frustum so the tween starts from what is on screen.
      left: this.camera.left / this.camera.zoom,
      right: this.camera.right / this.camera.zoom,
      top: this.camera.top / this.camera.zoom,
      bottom: this.camera.bottom / this.camera.zoom,
    };
    const start = performance.now();
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    this.tweens.push((now) => {
      const t = easeOut(Math.min(1, (now - start) / 520));
      this.applyPose({
        position: from.position.clone().lerp(to.position, t),
        target: from.target.clone().lerp(to.target, t),
        left: lerp(from.left, to.left, t),
        right: lerp(from.right, to.right, t),
        top: lerp(from.top, to.top, t),
        bottom: lerp(from.bottom, to.bottom, t),
      });
      return t < 1;
    });
  }

  /** Shows the model as it stands after a given step, dropping the newest parts into place. */
  showStep(state: StepState | null) {
    const model = this.model;
    if (!model) return;
    if (!state) {
      for (const node of model.nodes) {
        if (!node) continue;
        node.visible = true;
        node.position.copy(node.userData.home);
        setFaded(node, false, FADE_TOWARD);
      }
      this.dirty = true;
      return;
    }

    const visibleBox = new THREE.Box3();
    const forward = state.index > this.shownStep;
    state.steps.forEach((step, s) => {
      const shown = s < state.index;
      const newest = s === state.index - 1;
      step.forEach((partIndex, order) => {
        const node = model.nodes[partIndex];
        if (!node) return;
        const home = node.userData.home as THREE.Vector3;
        node.visible = shown;
        node.position.copy(home);
        setFaded(node, state.emphasize && shown && !newest, FADE_TOWARD);
        if (!shown) return;
        if (newest && forward) {
          // LDraw's -Y is up inside the model root, so "above" means a smaller y.
          const start = performance.now() + order * 70;
          node.position.y = home.y - DROP;
          this.tweens.push((now) => {
            const t = Math.min(1, Math.max(0, (now - start) / 420));
            node.position.y = home.y - DROP * (1 - easeOut(t));
            return t < 1;
          });
        }
      });
    });
    model.root.updateMatrixWorld(true);
    // Frame what will be on the table once the animation settles.
    for (const node of model.nodes) {
      if (!node?.visible) continue;
      const y = node.position.y;
      node.position.copy(node.userData.home);
      node.updateMatrixWorld(true);
      visibleBox.expandByObject(node);
      node.position.y = y;
      node.updateMatrixWorld(true);
    }
    this.frameBox(visibleBox, this.shownStep > 0);
    this.shownStep = state.index;
    this.dirty = true;
  }

  /** Returns the camera to the standard three-quarter view of whatever is visible. */
  resetView() {
    const model = this.model;
    if (!model) return;
    this.direction.copy(VIEW_DIRECTION);
    if (this.controls) {
      // pose() reads the direction from the live camera, so move it first.
      this.camera.position.copy(this.controls.target).addScaledVector(VIEW_DIRECTION, this.camera.position.distanceTo(this.controls.target));
    }
    const box = new THREE.Box3();
    for (const node of model.nodes) if (node?.visible) box.expandByObject(node);
    this.frameBox(box, true);
  }

  /** Renders the current view to an image at the given pixel size, without touching the on-screen canvas. */
  snapshot(width: number, height: number): string {
    const camera = this.camera.clone();
    const halfH = (camera.top - camera.bottom) / 2;
    const cx = (camera.left + camera.right) / 2;
    camera.left = cx - (halfH * width) / height;
    camera.right = cx + (halfH * width) / height;
    camera.updateProjectionMatrix();
    return renderOffscreen(this.scene, camera, width, height);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer.dispose();
  }
}
