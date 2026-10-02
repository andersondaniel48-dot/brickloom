// Keeps track of what has changed on this device since it was last saved to the account.
// Registered at startup so no change is missed while the (larger) sync code is still loading, and
// stored in localStorage so changes made offline are still saved after the app is closed and reopened.
import { cloudConfigured } from '../../cloud-config.ts';
import { db } from '../db.ts';

export interface Dirty {
  inventory: boolean;
  builds: string[];
  sets: string[];
  deletedBuilds: string[];
  deletedSets: string[];
}

const KEY = 'brickloom-cloud-dirty';
const empty = (): Dirty => ({ inventory: false, builds: [], sets: [], deletedBuilds: [], deletedSets: [] });

function load(): Dirty {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Dirty>) };
  } catch {
    return empty();
  }
}

let dirty = load();
let applyingRemote = false;
// Counts local changes, so a save can tell whether anything changed while it was in flight.
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  localStorage.setItem(KEY, JSON.stringify(dirty));
  listeners.forEach((listener) => listener());
}

const add = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
const remove = (list: string[], id: string) => list.filter((item) => item !== id);

function touch(kind: 'builds' | 'sets', id: string, deleted: boolean) {
  if (applyingRemote) return;
  version++;
  const live = kind;
  const gone = kind === 'builds' ? 'deletedBuilds' : 'deletedSets';
  dirty = deleted
    ? { ...dirty, [live]: remove(dirty[live], id), [gone]: add(dirty[gone], id) }
    : { ...dirty, [live]: add(dirty[live], id), [gone]: remove(dirty[gone], id) };
  changed();
}

function touchInventory() {
  if (applyingRemote) return;
  version++;
  if (dirty.inventory) return;
  dirty = { ...dirty, inventory: true };
  changed();
}

if (cloudConfigured) {
  db.inventory.hook('creating', () => touchInventory());
  db.inventory.hook('updating', () => touchInventory());
  db.inventory.hook('deleting', () => touchInventory());
  db.builds.hook('creating', (id) => touch('builds', String(id), false));
  db.builds.hook('updating', (_mods, id) => touch('builds', String(id), false));
  db.builds.hook('deleting', (id) => touch('builds', String(id), true));
  db.sets.hook('creating', (id) => touch('sets', String(id), false));
  db.sets.hook('updating', (_mods, id) => touch('sets', String(id), false));
  db.sets.hook('deleting', (id) => touch('sets', String(id), true));
}

export const currentDirty = (): Dirty => dirty;
export const hasDirty = () => dirty.inventory || dirty.builds.length + dirty.sets.length + dirty.deletedBuilds.length + dirty.deletedSets.length > 0;

export const changeVersion = () => version;

/**
 * Forgets the given changes once they have been saved. If anything changed on the device after
 * `versionWhenRead` (the save was built from older data), everything stays marked and is saved again.
 */
export function clearDirty(saved: Dirty, versionWhenRead: number) {
  if (version !== versionWhenRead) return;
  dirty = {
    inventory: saved.inventory ? false : dirty.inventory,
    builds: dirty.builds.filter((id) => !saved.builds.includes(id)),
    sets: dirty.sets.filter((id) => !saved.sets.includes(id)),
    deletedBuilds: dirty.deletedBuilds.filter((id) => !saved.deletedBuilds.includes(id)),
    deletedSets: dirty.deletedSets.filter((id) => !saved.deletedSets.includes(id)),
  };
  localStorage.setItem(KEY, JSON.stringify(dirty));
}

export function replaceDirty(next: Dirty) {
  dirty = next;
  changed();
}

export const resetDirty = () => {
  dirty = empty();
  localStorage.setItem(KEY, JSON.stringify(dirty));
};

/** Calls `listener` whenever something new needs saving. Returns a function that stops it. */
export function onDirty(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs database writes that come from the account, so they are not mistaken for local changes. */
export async function applyRemote<T>(work: () => Promise<T>): Promise<T> {
  applyingRemote = true;
  try {
    return await work();
  } finally {
    applyingRemote = false;
  }
}
