// Writes the 3D geometry the app draws parts from, as plain files a static host can serve:
//   public/ldraw/primitives.json    the building blocks (studs, cylinders, boxes) that most parts share
//   public/ldraw/parts/<id>.json    everything else one part needs
// Each part file plus the shared primitives is a complete, self-contained description of the part.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LDrawLibrary } from './ldraw-lib.ts';

/** A primitive goes in the shared file when at least this many parts use it; rarer ones travel with their parts. */
const SHARED_THRESHOLD = 15;

export async function buildGeometry(lib: LDrawLibrary, geometryIds: Iterable<string>, publicDir: string): Promise<{ parts: number; bytes: number }> {
  const packs = new Map<string, Record<string, string>>();
  const uses = new Map<string, number>();
  for (const id of new Set(geometryIds)) {
    const packed = await lib.pack(id);
    if (!packed) continue;
    packs.set(id, packed.files);
    for (const ref of Object.keys(packed.files)) {
      if (lib.resolve(ref)?.startsWith('p/')) uses.set(ref, (uses.get(ref) ?? 0) + 1);
    }
  }

  const shared: Record<string, string> = {};
  const outDir = path.join(publicDir, 'ldraw');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'parts'), { recursive: true });

  let bytes = 0;
  const writes: Promise<void>[] = [];
  for (const [id, files] of packs) {
    const own: Record<string, string> = {};
    for (const [ref, text] of Object.entries(files)) {
      if ((uses.get(ref) ?? 0) >= SHARED_THRESHOLD) shared[ref] = text;
      else own[ref] = text;
    }
    const json = JSON.stringify(own);
    bytes += json.length;
    writes.push(writeFile(path.join(outDir, 'parts', `${id}.json`), json));
    // Keep the number of files open at once well within what the operating system allows.
    if (writes.length >= 64) await Promise.all(writes.splice(0));
  }
  await Promise.all(writes);

  const primitives = JSON.stringify(shared);
  await writeFile(path.join(outDir, 'primitives.json'), primitives);
  return { parts: packs.size, bytes: bytes + primitives.length };
}
