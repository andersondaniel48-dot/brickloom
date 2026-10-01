// Turns a collection into what a designer can work with: the buildable pieces, and a text listing of them.
import { elementKey, type InventoryItem } from './build.ts';
import type { DesignCatalog } from './design.ts';
import { isPlainBlock, rotatedCells, rotatedSize, type PartShape, type Rotation } from './shape.ts';

/**
 * The subset of an inventory the designer can build with. Printed parts count as their plain
 * mold, and a mold variant the designer has no shape for counts as one it does.
 */
export function buildableInventory(inventory: InventoryItem[], catalog: DesignCatalog): InventoryItem[] {
  const totals = new Map<string, InventoryItem>();
  for (const item of inventory) {
    if (!(item.qty > 0)) continue;
    let id: string | undefined = item.part;
    if (!catalog.shapes[id] && catalog.printOf[id]) id = catalog.printOf[id];
    if (!catalog.shapes[id]) id = catalog.variants[id]?.find((v) => catalog.shapes[v]);
    if (!id || !(item.color in catalog.colorNames)) continue;
    const key = elementKey(id, item.color);
    const existing = totals.get(key);
    if (existing) existing.qty += item.qty;
    else totals.set(key, { part: id, color: item.color, qty: item.qty });
  }
  return [...totals.values()];
}

function shapeMaps(shape: PartShape, rot: Rotation): { top: string; bottom: string } {
  const { w, d } = rotatedSize(shape, rot);
  const top = Array.from({ length: d }, () => new Array<string>(w).fill(' '));
  const bottom = Array.from({ length: d }, () => new Array<string>(w).fill(' '));
  for (const c of rotatedCells(shape, rot)) {
    top[c.z][c.x] = c.stud >= 0 ? 'o' : '-';
    bottom[c.z][c.x] = c.recv ? 'u' : '-';
  }
  // Back row first, matching the top views the validator prints.
  const rows = (grid: string[][]) => grid.map((r) => r.join('')).reverse().join('/');
  return { top: rows(top), bottom: rows(bottom) };
}

/** Text listing of the buildable inventory for the designer model. */
export function describePalette(items: InventoryItem[], catalog: DesignCatalog): string {
  const byPart = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const list = byPart.get(item.part);
    if (list) list.push(item);
    else byPart.set(item.part, [item]);
  }
  const lines: string[] = [];
  const parts = [...byPart.keys()].sort((a, b) => {
    const sa = catalog.shapes[a];
    const sb = catalog.shapes[b];
    return sa.name.localeCompare(sb.name, 'en', { numeric: true });
  });
  for (const id of parts) {
    const shape = catalog.shapes[id];
    const stock = byPart
      .get(id)!
      .sort((a, b) => b.qty - a.qty)
      .map((i) => `${catalog.colorNames[i.color]} (${i.color}) x${i.qty}`)
      .join(', ');
    let geometry = `${shape.w}x${shape.d} studs, ${shape.h} plates tall`;
    if (!isPlainBlock(shape)) {
      // Rotations that look identical (symmetric parts) are listed together.
      const byMaps = new Map<string, number[]>();
      for (const rot of [0, 1, 2, 3] as Rotation[]) {
        const m = shapeMaps(shape, rot);
        const key = `top[${m.top}] bottom[${m.bottom}]`;
        byMaps.set(key, [...(byMaps.get(key) ?? []), rot]);
      }
      const rotations = [...byMaps].map(([maps, rots]) => `${rots.length === 4 ? 'any rot' : `rot ${rots.join(',')}`} ${maps}`).join('  ');
      geometry += `; ${rotations}`;
    }
    lines.push(`${id} | ${shape.name} | ${geometry} | ${stock}`);
  }
  return lines.join('\n');
}
