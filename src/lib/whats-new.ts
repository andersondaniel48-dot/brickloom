// Tells people what changed when they first open the app after it has updated itself.
// The version last seen on this device is kept in the browser; anything newer is news.
import { create } from 'zustand';
import { RELEASES, VERSION, releasesSince, type Release } from '../../shared/changelog.ts';
import { db } from './db.ts';

const KEY = 'brickloom-version';
/**
 * Versions were first recorded in 1.3.0. Someone who used the app before that has no record, and
 * may have last opened it at any earlier version; they are shown everything since this one.
 */
const BEFORE_RECORDS = '1.1.0';

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage is switched off: nothing is remembered, and nothing is announced
  }
};

const remember = () => {
  try {
    localStorage.setItem(KEY, VERSION);
  } catch {
    // see above
  }
};

/** Has this device used the app before, as far as can be told from what it has stored? */
async function usedBefore(): Promise<boolean> {
  try {
    if (localStorage.getItem('brickloom-settings') !== null) return true;
    const counts = await Promise.all([db.inventory.count(), db.builds.count(), db.sets.count()]);
    return counts.some((n) => n > 0);
  } catch {
    return false;
  }
}

interface WhatsNew {
  /** The release notes on show, or null when the notice is closed. */
  releases: Release[] | null;
  /** Whether they are being shown as news after an update, or because they were asked for. */
  news: boolean;
  /** Opens the full history. */
  open: () => void;
  close: () => void;
}

export const useWhatsNew = create<WhatsNew>((set) => ({
  releases: null,
  news: false,
  open: () => set({ releases: RELEASES, news: false }),
  close: () => {
    remember();
    set({ releases: null });
  },
}));

let checked = false;

/** Call once the app is up: shows the notes for every version newer than the last one seen here. */
export async function announceUpdate(): Promise<void> {
  if (checked) return;
  checked = true;
  let seen = read();
  if (seen === VERSION) return;
  if (seen === null) {
    // A new install has nothing to be told: every feature is new to it.
    if (!(await usedBefore())) return remember();
    seen = BEFORE_RECORDS;
  }
  const releases = releasesSince(seen);
  if (releases.length) useWhatsNew.setState({ releases, news: true });
  else remember();
}
