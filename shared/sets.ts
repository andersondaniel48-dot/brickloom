// Set inventories: the shape of the data shared by the catalog build, the server and the app.

/** One line of a set's inventory: [part id, color id, quantity, flags]. */
export type SetPiece = [part: string, color: number, qty: number, flags: number];

/** The piece is an extra that ships in the box beyond what the model needs. */
export const SPARE = 1;
/** The piece belongs to a minifigure included in the set. */
export const MINIFIG = 2;

/** Columnar list of every set that has an inventory (public/catalog/sets.json). */
export interface SetColumns {
  nums: string[];
  names: string[];
  years: number[];
  /** Index into `themeNames`. */
  themes: number[];
  themeNames: string[];
  /** Pieces in the box, not counting spares. */
  counts: number[];
  /** Picture URL where it differs from the standard pattern. */
  images: Record<string, string>;
}

export const SET_IMAGE_BASE = 'https://cdn.rebrickable.com/media/sets/';

/**
 * Which of the 256 inventory files (public/sets/<shard>.json) holds a set.
 * A plain string hash, so the build and the app agree without a lookup table.
 */
export function setShard(num: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < num.length; i++) hash = Math.imul(hash ^ num.charCodeAt(i), 0x01000193);
  return ((hash >>> 0) & 0xff).toString(16).padStart(2, '0');
}

export interface SetOptions {
  spares: boolean;
  minifigs: boolean;
}

/** The pieces of a set that the given options include, merged per element. */
export function selectPieces(pieces: SetPiece[], options: SetOptions): { part: string; color: number; qty: number }[] {
  const merged = new Map<string, { part: string; color: number; qty: number }>();
  for (const [part, color, qty, flags] of pieces) {
    if (!options.spares && flags & SPARE) continue;
    if (!options.minifigs && flags & MINIFIG) continue;
    const key = `${part}|${color}`;
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { part, color, qty });
  }
  return [...merged.values()].sort((a, b) => b.qty - a.qty);
}
