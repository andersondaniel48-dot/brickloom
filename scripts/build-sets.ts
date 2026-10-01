// Builds the set data: which pieces come in every set, so a whole set can be added to a collection at once.
//   public/catalog/sets.json   searchable list of sets (columnar)
//   public/sets/00.json ...    set inventories, spread over 256 files so the app only downloads the one it needs
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MINIFIG, SET_IMAGE_BASE, SPARE, setShard, type SetColumns, type SetPiece } from '../shared/sets.ts';
import { readCsv, streamCsv } from './csv.ts';

const FILES = ['sets', 'themes', 'inventories', 'inventory_parts', 'inventory_minifigs', 'inventory_sets'];

export async function buildSets(dataDir: string, publicDir: string): Promise<{ sets: number; rows: number } | null> {
  const csv = (name: string) => path.join(dataDir, 'rebrickable', `${name}.csv.gz`);
  if (FILES.some((name) => !existsSync(csv(name)))) return null;

  const [setRows, themeRows, inventoryRows, minifigRows, subsetRows] = await Promise.all(
    ['sets', 'themes', 'inventories', 'inventory_minifigs', 'inventory_sets'].map((name) => readCsv(csv(name))),
  );

  // A set can have several inventory versions (corrections, re-releases); the latest one is current.
  const latest = new Map<string, { id: string; version: number }>();
  for (const inv of inventoryRows) {
    const version = Number(inv.version);
    const current = latest.get(inv.set_num);
    if (!current || version > current.version) latest.set(inv.set_num, { id: inv.id, version });
  }
  const wanted = new Set([...latest.values()].map((v) => v.id));

  const partsOf = new Map<string, [part: string, color: number, qty: number, spare: boolean][]>();
  await streamCsv(csv('inventory_parts'), ([inventoryId, part, color, qty, spare]) => {
    if (!wanted.has(inventoryId) || Number(color) < 0) return;
    let list = partsOf.get(inventoryId);
    if (!list) partsOf.set(inventoryId, (list = []));
    list.push([part, Number(color), Number(qty), spare === 'True' || spare === 't']);
  });

  const group = (rows: Record<string, string>[], key: string) => {
    const map = new Map<string, [num: string, qty: number][]>();
    for (const row of rows) {
      if (!wanted.has(row.inventory_id)) continue;
      const list = map.get(row.inventory_id);
      const entry: [string, number] = [row[key], Number(row.quantity)];
      if (list) list.push(entry);
      else map.set(row.inventory_id, [entry]);
    }
    return map;
  };
  const figsOf = group(minifigRows, 'fig_num');
  const subsetsOf = group(subsetRows, 'set_num');

  /** Every piece in the box: the set's own parts, its minifigures taken apart, and any sets packed inside it. */
  const expand = (setNum: string, times: number, flags: number, depth: number, out: Map<string, SetPiece>) => {
    const inventory = latest.get(setNum);
    if (!inventory || depth > 3) return;
    for (const [part, color, qty, spare] of partsOf.get(inventory.id) ?? []) {
      const f = flags | (spare ? SPARE : 0);
      const key = `${part}|${color}|${f}`;
      const existing = out.get(key);
      if (existing) existing[2] += qty * times;
      else out.set(key, [part, color, qty * times, f]);
    }
    for (const [fig, qty] of figsOf.get(inventory.id) ?? []) expand(fig, times * qty, flags | MINIFIG, depth + 1, out);
    for (const [sub, qty] of subsetsOf.get(inventory.id) ?? []) expand(sub, times * qty, flags, depth + 1, out);
  };

  // Theme names as "Parent / Child" so a search for the parent finds its sub-themes too.
  const themes = new Map(themeRows.map((t) => [t.id, t]));
  const themeName = (id: string): string => {
    const names: string[] = [];
    for (let t = themes.get(id), hops = 0; t && hops < 4; t = themes.get(t.parent_id), hops++) names.unshift(t.name);
    return names.join(' / ');
  };

  const columns: SetColumns = { nums: [], names: [], years: [], themes: [], themeNames: [], counts: [], images: {} };
  const themeIndex = new Map<string, number>();
  const shards = new Map<string, Record<string, SetPiece[]>>();
  let rows = 0;

  for (const set of setRows) {
    const pieces = new Map<string, SetPiece>();
    expand(set.set_num, 1, 0, 0, pieces);
    if (!pieces.size) continue; // books, gear and other things with nothing to build

    const list = [...pieces.values()].sort((a, b) => a[3] - b[3] || b[2] - a[2]);
    const shard = setShard(set.set_num);
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)![set.set_num] = list;
    rows += list.length;

    const theme = themeName(set.theme_id);
    if (!themeIndex.has(theme)) {
      themeIndex.set(theme, columns.themeNames.length);
      columns.themeNames.push(theme);
    }
    columns.nums.push(set.set_num);
    columns.names.push(set.name);
    columns.years.push(Number(set.year));
    columns.themes.push(themeIndex.get(theme)!);
    columns.counts.push(list.reduce((n, p) => n + (p[3] & SPARE ? 0 : p[2]), 0));
    if (set.img_url && set.img_url !== `${SET_IMAGE_BASE}${set.set_num}.jpg`) columns.images[set.set_num] = set.img_url;
  }

  const setsDir = path.join(publicDir, 'sets');
  await rm(setsDir, { recursive: true, force: true });
  await mkdir(setsDir, { recursive: true });
  await Promise.all([
    ...[...shards].map(([shard, sets]) => writeFile(path.join(setsDir, `${shard}.json`), JSON.stringify(sets))),
    writeFile(path.join(publicDir, 'catalog', 'sets.json'), JSON.stringify(columns)),
  ]);
  return { sets: columns.nums.length, rows };
}
