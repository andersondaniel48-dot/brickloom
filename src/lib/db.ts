// Local storage for the collection and saved builds (IndexedDB via Dexie). Nothing leaves the device.
import Dexie, { type EntityTable } from 'dexie';
import type { Placement } from '../../shared/build.ts';

export interface InventoryRow {
  /** `${part}|${color}` */
  key: string;
  part: string;
  color: number;
  qty: number;
  addedAt: number;
  updatedAt: number;
  /** For pieces the catalog does not know: what the scanner called it and a picture of it. */
  name?: string;
  image?: string;
}

export interface BuildRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  engine: 'claude' | 'quick';
  repaired: boolean;
  createdAt: number;
  parts: Placement[];
  /** Step the builder last had open, so instructions resume where they left off. */
  step: number;
  /** Rendered preview (data URL). */
  cover?: string;
}

/** A set whose pieces were added to the collection in one go. */
export interface OwnedSetRow {
  num: string;
  name: string;
  year: number;
  theme: string;
  image: string;
  /** How many of this set were added. */
  copies: number;
  /** Exactly what was added (all copies together), so removing the set takes the same pieces back out. */
  pieces: [part: string, color: number, qty: number][];
  addedAt: number;
}

interface ThumbRow {
  key: string;
  data: string;
}

export const db = new Dexie('brickloom') as Dexie & {
  inventory: EntityTable<InventoryRow, 'key'>;
  builds: EntityTable<BuildRow, 'id'>;
  thumbs: EntityTable<ThumbRow, 'key'>;
  sets: EntityTable<OwnedSetRow, 'num'>;
};

db.version(1).stores({
  inventory: 'key, part, color, updatedAt',
  builds: 'id, createdAt',
  thumbs: 'key',
});
db.version(2).stores({ sets: 'num, addedAt' });

export const inventoryKey = (part: string, color: number) => `${part}|${color}`;

export interface NewPiece {
  part: string;
  color: number;
  qty: number;
  name?: string;
  image?: string;
}

/** Merges pieces into the inventory. Must run inside a transaction that includes `db.inventory`. */
async function mergeIntoInventory(pieces: NewPiece[]): Promise<void> {
  const now = Date.now();
  const merged = new Map<string, NewPiece>();
  for (const piece of pieces) {
    if (piece.qty <= 0) continue;
    const key = inventoryKey(piece.part, piece.color);
    const seen = merged.get(key);
    if (seen) seen.qty += piece.qty;
    else merged.set(key, { ...piece });
  }
  const keys = [...merged.keys()];
  const existing = await db.inventory.bulkGet(keys);
  await db.inventory.bulkPut(
    keys.map((key, i) => {
      const piece = merged.get(key)!;
      const row = existing[i];
      return row
        ? { ...row, qty: row.qty + piece.qty, updatedAt: now }
        : { key, part: piece.part, color: piece.color, qty: piece.qty, addedAt: now, updatedAt: now, name: piece.name, image: piece.image };
    }),
  );
}

/** Adds pieces to the collection, merging with what is already there. */
export async function addPieces(pieces: NewPiece[]): Promise<void> {
  await db.transaction('rw', db.inventory, () => mergeIntoInventory(pieces));
}

/** Adds every piece of a set (already multiplied by the number of copies) and remembers the set. */
export async function addSet(set: Omit<OwnedSetRow, 'pieces' | 'addedAt'>, pieces: NewPiece[]): Promise<void> {
  await db.transaction('rw', db.inventory, db.sets, async () => {
    await mergeIntoInventory(pieces);
    const record = new Map<string, [string, number, number]>();
    const previous = await db.sets.get(set.num);
    for (const [part, color, qty] of previous?.pieces ?? []) record.set(inventoryKey(part, color), [part, color, qty]);
    for (const p of pieces) {
      const key = inventoryKey(p.part, p.color);
      const seen = record.get(key);
      if (seen) seen[2] += p.qty;
      else record.set(key, [p.part, p.color, p.qty]);
    }
    await db.sets.put({ ...set, copies: (previous?.copies ?? 0) + set.copies, pieces: [...record.values()], addedAt: Date.now() });
  });
}

/** Takes a set's pieces back out of the collection (never below zero) and forgets the set. */
export async function removeSet(num: string): Promise<number> {
  return db.transaction('rw', db.inventory, db.sets, async () => {
    const set = await db.sets.get(num);
    if (!set) return 0;
    const keys = set.pieces.map(([part, color]) => inventoryKey(part, color));
    const rows = await db.inventory.bulkGet(keys);
    const now = Date.now();
    const keep: InventoryRow[] = [];
    const drop: string[] = [];
    let removed = 0;
    set.pieces.forEach(([, , qty], i) => {
      const row = rows[i];
      if (!row) return;
      removed += Math.min(qty, row.qty);
      if (row.qty > qty) keep.push({ ...row, qty: row.qty - qty, updatedAt: now });
      else drop.push(row.key);
    });
    await db.inventory.bulkPut(keep);
    await db.inventory.bulkDelete(drop);
    await db.sets.delete(num);
    return removed;
  });
}

/** Sets the count of one element; zero or less removes it. */
export async function setQuantity(key: string, qty: number): Promise<void> {
  if (qty <= 0) await db.inventory.delete(key);
  else await db.inventory.update(key, { qty, updatedAt: Date.now() });
}

/** Moves a whole element to another color, merging if that color is already owned. */
export async function recolor(key: string, color: number): Promise<void> {
  await db.transaction('rw', db.inventory, async () => {
    const row = await db.inventory.get(key);
    if (!row || row.color === color) return;
    await db.inventory.delete(key);
    const targetKey = inventoryKey(row.part, color);
    const target = await db.inventory.get(targetKey);
    if (target) await db.inventory.update(targetKey, { qty: target.qty + row.qty, updatedAt: Date.now() });
    else await db.inventory.add({ ...row, key: targetKey, color, updatedAt: Date.now() });
  });
}
