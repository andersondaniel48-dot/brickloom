// Read-side helpers for the collection.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { Catalog } from './catalog.ts';
import { db, type InventoryRow } from './db.ts';

export function useInventory(): InventoryRow[] | undefined {
  return useLiveQuery(() => db.inventory.toArray(), []);
}

export interface CollectionStats {
  pieces: number;
  elements: number;
  parts: number;
  colors: number;
  /** Pieces the designer can build with. */
  buildable: number;
  /** Piece count per color, largest first. */
  byColor: { color: number; qty: number }[];
}

export function useStats(rows: InventoryRow[] | undefined, catalog: Catalog): CollectionStats {
  return useMemo(() => {
    const byColor = new Map<number, number>();
    const parts = new Set<string>();
    let pieces = 0;
    let buildable = 0;
    for (const row of rows ?? []) {
      pieces += row.qty;
      parts.add(row.part);
      byColor.set(row.color, (byColor.get(row.color) ?? 0) + row.qty);
      if (catalog.isBuildable(row.part)) buildable += row.qty;
    }
    return {
      pieces,
      elements: rows?.length ?? 0,
      parts: parts.size,
      colors: byColor.size,
      buildable,
      byColor: [...byColor].map(([color, qty]) => ({ color, qty })).sort((a, b) => b.qty - a.qty),
    };
  }, [rows, catalog]);
}

/** Display name of an inventory row: the catalog name, or what the scanner called it. */
export function rowName(row: InventoryRow, catalog: Catalog): string {
  return catalog.part(row.part)?.name ?? row.name ?? row.part;
}
