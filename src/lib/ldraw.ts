// Real part geometry from the LDraw library, rendered with three.js.
// Each part's geometry is a static file fetched on first use, then cached per part and color.
import * as THREE from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { ldrawLine, type Placement, type Shapes } from '../../shared/build.ts';
import type { CatalogColor } from './catalog.ts';
import { luminance } from './color.ts';
import { asset } from './paths.ts';

// ---------------------------------------------------------------- loader

let loaderPromise: Promise<LDrawLoader> | null = null;

/** LDraw colour definitions generated from the catalog palette, so every catalog color renders exactly. */
function colourConfig(colors: CatalogColor[]): string {
  return colors
    .filter((c) => c.id !== 16 && c.id !== 24)
    .map((c) => {
      const name = c.name.replace(/[^A-Za-z0-9]+/g, '_');
      // Printed manuals outline parts in black, except black parts, which get a grey outline.
      const edge = luminance(c.rgb) < 0.02 ? '6B6F76' : '1B1D22';
      let finish = '';
      if (c.trans) finish = ' ALPHA 140';
      else if (/chrome/i.test(c.name)) finish = ' CHROME';
      else if (/pearl|satin/i.test(c.name)) finish = ' PEARLESCENT';
      else if (/metallic|silver|gold|copper/i.test(c.name)) finish = ' METAL';
      return `0 !COLOUR ${name} CODE ${c.id} VALUE #${c.rgb} EDGE #${edge}${finish}`;
    })
    .join('\n');
}

export function initLDraw(colors: CatalogColor[]): Promise<LDrawLoader> {
  loaderPromise ??= (async () => {
    const loader = new LDrawLoader();
    loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    // Everything a part needs arrives pre-packed (files the library lacks included, as empty ones),
    // so the loader should never fetch anything itself; if it does, this path has nothing to find.
    loader.setPartsLibraryPath(asset('ldraw/missing/'));
    loader.addDefaultMaterials();
    const url = URL.createObjectURL(new Blob([colourConfig(colors)], { type: 'text/plain' }));
    try {
      await loader.preloadMaterials(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    return loader;
  })();
  return loaderPromise;
}

function getLoader(): Promise<LDrawLoader> {
  if (!loaderPromise) throw new Error('initLDraw has not been called');
  return loaderPromise;
}

// ---------------------------------------------------------------- geometry fetching

/** Hands LDraw files to the loader, keyed the way it will ask for them. */
async function register(files: Record<string, string>) {
  const loader = await getLoader();
  // LDrawLoader keeps parsed files in an internal cache keyed by reference name; feeding it directly
  // is what lets a model reference library parts without the loader requesting each file itself.
  const cache = (loader as unknown as { partsCache: { parseCache: { _cache: Record<string, unknown>; setData(name: string, text: string): void } } }).partsCache.parseCache;
  for (const [ref, text] of Object.entries(files)) {
    // The loader rewrites these two sub-folder references before looking them up, so store them the same way.
    const name = ref.startsWith('s/') ? `parts/${ref}` : ref.startsWith('48/') ? `p/${ref}` : ref;
    if (!(name in cache._cache)) cache.setData(name, text);
  }
}

/** A JSON file shipped with the app, or null when it does not exist. */
async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  // A dev server answers unknown paths with the app's HTML rather than a 404, so check the type too.
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
  return (await res.json()) as T;
}

// Studs, cylinders and other primitives that most parts are built from: one shared file, fetched once.
let primitives: Promise<void> | null = null;
function loadPrimitives(): Promise<void> {
  primitives ??= fetchJson<Record<string, string>>(asset('ldraw/primitives.json')).then((files) => {
    if (!files) throw new Error('part geometry is missing; run `npm run data`');
    return register(files);
  });
  primitives.catch(() => (primitives = null)); // allow a retry later
  return primitives;
}

const geometry = new Map<string, Promise<boolean>>();

/** Makes sure the geometry for a part is loaded. Resolves false when the library has no such part. */
export function requestGeometry(geometryId: string): Promise<boolean> {
  const id = geometryId.toLowerCase();
  let pending = geometry.get(id);
  if (!pending) {
    pending = (async () => {
      try {
        const [files] = await Promise.all([fetchJson<Record<string, string>>(asset(`ldraw/parts/${encodeURIComponent(id)}.json`)), loadPrimitives()]);
        if (!files) return false;
        await register(files);
        return true;
      } catch (err) {
        console.warn('geometry fetch failed', id, err);
        geometry.delete(id); // allow a retry later
        return false;
      }
    })();
    geometry.set(id, pending);
  }
  return pending;
}

// ---------------------------------------------------------------- prototypes

const prototypes = new Map<string, Promise<THREE.Group | null>>();

/** A renderable part in a given color, in LDraw coordinates. Callers must clone it. */
function prototype(geometryId: string, color: number): Promise<THREE.Group | null> {
  const id = geometryId.toLowerCase();
  const key = `${id}|${color}`;
  let proto = prototypes.get(key);
  if (!proto) {
    proto = (async () => {
      if (!(await requestGeometry(id))) return null;
      const loader = await getLoader();
      return new Promise<THREE.Group | null>((resolve) => {
        loader.parse(
          `0 Part\n1 ${color} 0 0 0 1 0 0 0 1 0 0 0 1 ${id}.dat\n`,
          (group) => resolve(group),
          (err) => {
            console.warn(`could not build ${id}`, err);
            resolve(null);
          },
        );
      });
    })();
    prototypes.set(key, proto);
  }
  return proto;
}

/** A fresh instance of a part, standing upright in three.js coordinates (y up), or null if it has no geometry. */
export async function createPart(geometryId: string, color: number): Promise<THREE.Group | null> {
  const proto = await prototype(geometryId, color);
  if (!proto) return null;
  const root = new THREE.Group();
  root.add(proto.clone());
  root.rotation.x = Math.PI; // LDraw's -Y is up
  return root;
}

export interface BuiltModel {
  /** Whole model, upright in three.js coordinates. */
  root: THREE.Group;
  /** One node per placement, in order; null where a part's geometry is unavailable. */
  nodes: (THREE.Group | null)[];
}

/** Assembles a design into a scene graph with one node per placed part. */
export async function buildModel(parts: Placement[], shapes: Shapes): Promise<BuiltModel> {
  const root = new THREE.Group();
  root.rotation.x = Math.PI;
  const m = new THREE.Matrix4();
  const nodes = await Promise.all(
    parts.map(async (p) => {
      const shape = shapes[p.part];
      if (!shape) return null;
      const proto = await prototype(shape.id, p.color);
      if (!proto) return null;
      const node = proto.clone();
      const t = ldrawLine(p, shape).split(' ').map(Number);
      m.set(t[5], t[6], t[7], t[2], t[8], t[9], t[10], t[3], t[11], t[12], t[13], t[4], 0, 0, 0, 1);
      m.decompose(node.position, node.quaternion, node.scale);
      return node;
    }),
  );
  for (const node of nodes) if (node) root.add(node);
  return { root, nodes };
}

// ---------------------------------------------------------------- staging

/** Soft, even lighting that keeps part colors true, like the art in a printed manual. */
export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9ced6, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-0.5, 1, 0.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(0.9, 0.3, -0.4);
  scene.add(fill);
}

/** Standard three-quarter view: above, in front, slightly to the right. */
export const VIEW_DIRECTION = new THREE.Vector3(0.62, 0.58, 0.78).normalize();

const corner = new THREE.Vector3();

/** Points an orthographic camera at a box from `direction` and sizes the frustum to fit it exactly. */
export function frame(camera: THREE.OrthographicCamera, box: THREE.Box3, direction: THREE.Vector3, aspect: number, margin = 1.14) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  camera.position.copy(center).addScaledVector(direction, radius * 6);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  const halfH = Math.max((maxY - minY) / 2, (maxX - minX) / 2 / aspect) * margin;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  camera.left = cx - halfH * aspect;
  camera.right = cx + halfH * aspect;
  camera.top = cy + halfH;
  camera.bottom = cy - halfH;
  camera.near = 0.1;
  camera.far = radius * 14;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- material variants

const faded = new WeakMap<THREE.Material, THREE.Material>();

/** A washed-out twin of a material, for parts placed in earlier steps. */
export function fadedMaterial(material: THREE.Material, toward: THREE.Color, amount: number): THREE.Material {
  let twin = faded.get(material);
  if (!twin) {
    twin = material.clone();
    const withColor = twin as THREE.Material & { color?: THREE.Color };
    if (withColor.color) withColor.color.lerp(toward, amount);
    if (twin instanceof THREE.ShaderMaterial && twin.uniforms.diffuse) {
      (twin.uniforms.diffuse.value as THREE.Color).lerp(toward, amount);
    }
    faded.set(material, twin);
  }
  return twin;
}

/** Swaps every material under `node` for its faded twin, or restores the originals. */
export function setFaded(node: THREE.Object3D, on: boolean, toward: THREE.Color, amount = 0.42) {
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    const d = child as THREE.Mesh | THREE.LineSegments;
    d.userData.original ??= d.material;
    const original = d.userData.original as THREE.Material | THREE.Material[];
    if (!on) d.material = original;
    else d.material = Array.isArray(original) ? original.map((m) => fadedMaterial(m, toward, amount)) : fadedMaterial(original, toward, amount);
  });
}
