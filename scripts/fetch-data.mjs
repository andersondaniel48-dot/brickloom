// Downloads the open datasets Brickloom is built on into ./data.
//   - Rebrickable catalog CSVs (parts, colors, categories, relationships, elements, set inventories)
//   - LDraw complete parts library (3D geometry for every part)
// Files that already exist are skipped; pass --force to re-download.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const force = process.argv.includes('--force');

const REBRICKABLE = 'https://cdn.rebrickable.com/media/downloads';
const files = [
  ...[
    'parts', 'colors', 'part_categories', 'part_relationships', 'elements',
    // Set inventories, for adding a whole set to the collection at once
    'sets', 'themes', 'inventories', 'inventory_parts', 'inventory_minifigs', 'inventory_sets',
  ].map((name) => ({
    url: `${REBRICKABLE}/${name}.csv.gz`,
    dest: path.join(dataDir, 'rebrickable', `${name}.csv.gz`),
  })),
  {
    url: 'https://library.ldraw.org/library/updates/complete.zip',
    dest: path.join(dataDir, 'ldraw', 'complete.zip'),
  },
];

const exists = (p) => stat(p).then(() => true, () => false);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function download({ url, dest }) {
  const label = path.relative(root, dest);
  if (!force && (await exists(dest))) {
    console.log(`skip  ${label} (already downloaded)`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'Brickloom/0.1 (catalog sync)' } });
  if (!res.ok || !res.body) throw new Error(`${url} -> HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let seen = 0;
  let lastLog = 0;
  const progress = new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (total > 20e6 && Date.now() - lastLog > 2000) {
        lastLog = Date.now();
        console.log(`      ${label}: ${mb(seen)} / ${mb(total)}`);
      }
      controller.enqueue(chunk);
    },
  });

  // Write to a temp name so an interrupted download is never mistaken for a complete one.
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body.pipeThrough(progress)), createWriteStream(tmp));
  if (total && seen !== total) {
    await rm(tmp, { force: true });
    throw new Error(`${label}: expected ${total} bytes, received ${seen}`);
  }
  await rename(tmp, dest);
  console.log(`saved ${label} (${mb(seen)})`);
}

for (const file of files) await download(file);
console.log('done');
