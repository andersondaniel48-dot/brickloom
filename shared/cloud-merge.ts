// Combining what is on a device with what is saved in an account, the first time the two meet.
// Pure functions, so the rules can be tested without a browser or a network.

export interface SyncPiece {
  key: string;
  part: string;
  color: number;
  qty: number;
  addedAt: number;
  updatedAt: number;
  name?: string;
  image?: string;
}

export interface SyncSet {
  num: string;
  copies: number;
  addedAt: number;
}

export interface SyncBuild {
  id: string;
  createdAt: number;
  step: number;
}

export interface SyncState<P extends SyncPiece = SyncPiece, S extends SyncSet = SyncSet, B extends SyncBuild = SyncBuild> {
  pieces: P[];
  sets: S[];
  builds: B[];
}

/** How to reconcile a device that already has data with an account that already has data. */
export type MergeChoice = 'merge' | 'account' | 'device';

/**
 * Merges two copies of a collection without double counting.
 *
 * The same collection is often on both sides (signing in on the device it was first entered on, or
 * a second device restored from an export), so counts are not added together: each piece keeps the
 * larger of its two counts. Merging the same data twice therefore changes nothing.
 */
export function mergeStates<P extends SyncPiece, S extends SyncSet, B extends SyncBuild>(
  device: SyncState<P, S, B>,
  account: SyncState<P, S, B>,
): SyncState<P, S, B> {
  const pieces = new Map<string, P>();
  for (const piece of [...account.pieces, ...device.pieces]) {
    const seen = pieces.get(piece.key);
    if (!seen) pieces.set(piece.key, piece);
    else {
      pieces.set(piece.key, {
        ...seen,
        ...piece,
        qty: Math.max(seen.qty, piece.qty),
        addedAt: Math.min(seen.addedAt, piece.addedAt),
        updatedAt: Math.max(seen.updatedAt, piece.updatedAt),
      });
    }
  }

  const sets = new Map<string, S>();
  for (const set of [...account.sets, ...device.sets]) {
    const seen = sets.get(set.num);
    if (!seen || set.copies > seen.copies) sets.set(set.num, set);
  }

  // A build is the same design on both sides; keep whichever copy is further along.
  const builds = new Map<string, B>();
  for (const build of [...account.builds, ...device.builds]) {
    const seen = builds.get(build.id);
    if (!seen || build.step > seen.step) builds.set(build.id, build);
  }

  return { pieces: [...pieces.values()], sets: [...sets.values()], builds: [...builds.values()] };
}

export interface StateSummary {
  pieces: number;
  sets: number;
  builds: number;
}

export function summarize(state: SyncState): StateSummary {
  return { pieces: state.pieces.reduce((n, p) => n + p.qty, 0), sets: state.sets.length, builds: state.builds.length };
}

export const isEmpty = (state: SyncState) => !state.pieces.length && !state.sets.length && !state.builds.length;
