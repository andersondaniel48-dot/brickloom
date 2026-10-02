// Accounts and saving: Firebase Authentication (Google) plus one small Firestore area per person.
//
//   users/{uid}/state/inventory   the whole collection, as one document
//   users/{uid}/sets/{num}        each set that was added whole
//   users/{uid}/builds/{id}       each saved build
//
// The device's own database stays the source of truth for the interface. This module copies changes
// in both directions: local changes are pushed a moment after they happen, and the account is
// checked for changes from other devices at startup, when the app comes back to the foreground, and
// after each push. When the same thing was changed in two places, the most recent save wins.
// Deleted sets and builds are kept as small "deleted" markers so other devices learn of the deletion.
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore/lite';
import { isEmpty, mergeStates, summarize, type MergeChoice, type SyncState } from '../../../shared/cloud-merge.ts';
import { cloudConfig } from '../../cloud-config.ts';
import { db, type BuildRow, type InventoryRow, type OwnedSetRow } from '../db.ts';
import { applyRemote, changeVersion, clearDirty, currentDirty, hasDirty, onDirty, replaceDirty, resetDirty, type Dirty } from './dirty.ts';
import { takeSignInReply } from './google.ts';
import { useAccount } from './store.ts';

const app = initializeApp(cloudConfig.firebase);
// No pop-up or redirect helper: sign-in goes through google.ts, which keeps this bundle small.
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const store = getFirestore(app);

type Local = SyncState<InventoryRow, OwnedSetRow, BuildRow>;

// ---------------------------------------------------------------- per-device bookkeeping

const DEVICE_KEY = 'brickloom-device';
const deviceId = (() => {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) localStorage.setItem(DEVICE_KEY, (id = crypto.randomUUID()));
  return id;
})();

/** What this device has already seen of an account, so each check only fetches what is new. */
interface Link {
  /** Server time (ms) of the newest inventory save this device has applied or made. */
  inventorySeen: number;
  /** Server time (ms) of the newest set or build change this device has applied or made. */
  docsSeen: number;
}

const linkKey = (uid: string) => `brickloom-cloud-link:${uid}`;
const readLink = (uid: string): Link | null => {
  try {
    return JSON.parse(localStorage.getItem(linkKey(uid)) ?? 'null') as Link | null;
  } catch {
    return null;
  }
};
const writeLink = (uid: string, link: Link) => localStorage.setItem(linkKey(uid), JSON.stringify(link));

// ---------------------------------------------------------------- documents

const inventoryRef = (uid: string) => doc(store, 'users', uid, 'state', 'inventory');
const setsCol = (uid: string) => collection(store, 'users', uid, 'sets');
const buildsCol = (uid: string) => collection(store, 'users', uid, 'builds');

const millis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : 0);

/** Firestore rejects `undefined`, and nested arrays; lists are stored as JSON text, which is also compact. */
function buildDoc(build: BuildRow): DocumentData {
  const { parts, cover, ...rest } = build;
  return { ...rest, ...(cover ? { cover } : {}), parts: JSON.stringify(parts), deleted: false, device: deviceId, updatedAt: serverTimestamp() };
}
function setDocData(set: OwnedSetRow): DocumentData {
  const { pieces, ...rest } = set;
  return { ...rest, pieces: JSON.stringify(pieces), deleted: false, device: deviceId, updatedAt: serverTimestamp() };
}
const tombstone = (): DocumentData => ({ deleted: true, device: deviceId, updatedAt: serverTimestamp() });

function toBuild(id: string, data: DocumentData): BuildRow {
  return {
    id,
    name: data.name,
    description: data.description,
    prompt: data.prompt,
    engine: data.engine,
    repaired: data.repaired,
    createdAt: data.createdAt,
    step: data.step ?? 0,
    parts: JSON.parse(data.parts),
    ...(data.cover ? { cover: data.cover as string } : {}),
  };
}
function toSet(num: string, data: DocumentData): OwnedSetRow {
  return { num, name: data.name, year: data.year, theme: data.theme, image: data.image, copies: data.copies, addedAt: data.addedAt, pieces: JSON.parse(data.pieces) };
}

interface RemoteDoc<T> {
  id: string;
  deleted: boolean;
  fromHere: boolean;
  at: number;
  value: T | null;
}

interface Remote {
  inventory: { rows: InventoryRow[]; at: number; fromHere: boolean } | null;
  sets: RemoteDoc<OwnedSetRow>[];
  builds: RemoteDoc<BuildRow>[];
}

/** Everything in the account that changed after the given server times. */
async function fetchRemote(uid: string, since: Link): Promise<Remote> {
  const after = Timestamp.fromMillis(since.docsSeen);
  const [inventory, sets, builds] = await Promise.all([
    getDoc(inventoryRef(uid)),
    getDocs(query(setsCol(uid), where('updatedAt', '>', after))),
    getDocs(query(buildsCol(uid), where('updatedAt', '>', after))),
  ]);
  const data = inventory.data();
  const read = <T>(snapshot: typeof sets, convert: (id: string, d: DocumentData) => T): RemoteDoc<T>[] =>
    snapshot.docs.map((d) => {
      const value = d.data();
      const deleted = value.deleted === true;
      return { id: d.id, deleted, fromHere: value.device === deviceId, at: millis(value.updatedAt), value: deleted ? null : convert(d.id, value) };
    });
  return {
    inventory: data ? { rows: JSON.parse(data.rows) as InventoryRow[], at: millis(data.updatedAt), fromHere: data.device === deviceId } : null,
    sets: read(sets, toSet),
    builds: read(builds, toBuild),
  };
}

const readLocal = async (): Promise<Local> => {
  const [pieces, sets, builds] = await Promise.all([db.inventory.toArray(), db.sets.toArray(), db.builds.toArray()]);
  return { pieces, sets, builds };
};

async function replaceLocal(state: Local) {
  await applyRemote(() =>
    db.transaction('rw', db.inventory, db.sets, db.builds, async () => {
      await Promise.all([db.inventory.clear(), db.sets.clear(), db.builds.clear()]);
      await Promise.all([db.inventory.bulkPut(state.pieces), db.sets.bulkPut(state.sets), db.builds.bulkPut(state.builds)]);
    }),
  );
}

/** Saves the device's pending changes to the account. */
async function push(uid: string, changes: Dirty) {
  const writes: { ref: DocumentReference; data: DocumentData }[] = [];
  if (changes.inventory) {
    const rows = JSON.stringify(await db.inventory.toArray());
    // One Firestore document holds at most 1 MiB; a collection would need tens of thousands of different pieces to get there.
    if (rows.length > 950_000) throw new Error('This collection is too large to save to an account.');
    writes.push({ ref: inventoryRef(uid), data: { rows, device: deviceId, updatedAt: serverTimestamp() } });
  }
  const [builds, sets] = await Promise.all([db.builds.bulkGet(changes.builds), db.sets.bulkGet(changes.sets)]);
  for (const build of builds) if (build) writes.push({ ref: doc(buildsCol(uid), build.id), data: buildDoc(build) });
  for (const set of sets) if (set) writes.push({ ref: doc(setsCol(uid), set.num), data: setDocData(set) });
  for (const id of changes.deletedBuilds) writes.push({ ref: doc(buildsCol(uid), id), data: tombstone() });
  for (const num of changes.deletedSets) writes.push({ ref: doc(setsCol(uid), num), data: tombstone() });

  // A batch takes at most 500 writes; builds carry a picture, so keep batches well under the request size limit too.
  for (let i = 0; i < writes.length; i += 40) {
    const batch = writeBatch(store);
    for (const write of writes.slice(i, i + 40)) batch.set(write.ref, write.data);
    await batch.commit();
  }
}

// ---------------------------------------------------------------- first meeting of a device and an account

function askHowToMerge(device: Local, account: Local): Promise<MergeChoice> {
  return new Promise((resolve) => {
    useAccount.setState({
      mergePrompt: {
        device: summarize(device),
        account: summarize(account),
        choose: (choice) => {
          useAccount.setState({ mergePrompt: null });
          resolve(choice);
        },
      },
    });
  });
}

async function link(uid: string): Promise<Link> {
  const remote = await fetchRemote(uid, { inventorySeen: 0, docsSeen: 0 });
  const account: Local = {
    pieces: remote.inventory?.rows ?? [],
    sets: remote.sets.flatMap((s) => (s.value ? [s.value] : [])),
    builds: remote.builds.flatMap((b) => (b.value ? [b.value] : [])),
  };
  const device = await readLocal();

  let choice: MergeChoice;
  if (isEmpty(account)) choice = 'device';
  else if (isEmpty(device)) choice = 'account';
  else choice = await askHowToMerge(device, account);

  const all = (state: Local, deletedBuilds: string[] = [], deletedSets: string[] = []): Dirty => ({
    inventory: true,
    builds: state.builds.map((b) => b.id),
    sets: state.sets.map((s) => s.num),
    deletedBuilds,
    deletedSets,
  });

  if (choice === 'account') {
    await replaceLocal(account);
    resetDirty();
  } else if (choice === 'device') {
    // Whatever the account has that this device does not is removed from the account.
    const keptBuilds = new Set(device.builds.map((b) => b.id));
    const keptSets = new Set(device.sets.map((s) => s.num));
    replaceDirty(all(device, account.builds.filter((b) => !keptBuilds.has(b.id)).map((b) => b.id), account.sets.filter((s) => !keptSets.has(s.num)).map((s) => s.num)));
  } else {
    const merged = mergeStates(device, account);
    await replaceLocal(merged);
    replaceDirty(all(merged));
  }

  const seen = Math.max(0, ...remote.sets.map((s) => s.at), ...remote.builds.map((b) => b.at));
  const linked: Link = { inventorySeen: remote.inventory?.at ?? 0, docsSeen: seen };
  writeLink(uid, linked);
  return linked;
}

// ---------------------------------------------------------------- keeping in step

let running = false;
let again = false;

/** Brings the device and the account into agreement. Safe to call at any time; overlapping calls are folded together. */
export async function sync(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  useAccount.setState({ phase: 'syncing', error: null });
  try {
    do {
      again = false;
      const known = readLink(uid) ?? (await link(uid));
      const pending = currentDirty();

      // 1. Changes made on other devices. Anything also changed here is left alone: this device's
      //    version is the more recent intent and is about to be saved over it.
      const remote = await fetchRemote(uid, known);
      const next: Link = { ...known };
      await applyRemote(async () => {
        if (remote.inventory && remote.inventory.at > known.inventorySeen) {
          next.inventorySeen = remote.inventory.at;
          if (!remote.inventory.fromHere && !pending.inventory) {
            const rows = remote.inventory.rows;
            await db.transaction('rw', db.inventory, async () => {
              await db.inventory.clear();
              await db.inventory.bulkPut(rows);
            });
          }
        }
        for (const set of remote.sets) {
          next.docsSeen = Math.max(next.docsSeen, set.at);
          if (set.fromHere || pending.sets.includes(set.id) || pending.deletedSets.includes(set.id)) continue;
          if (set.value) await db.sets.put(set.value);
          else await db.sets.delete(set.id);
        }
        for (const build of remote.builds) {
          next.docsSeen = Math.max(next.docsSeen, build.at);
          if (build.fromHere || pending.builds.includes(build.id) || pending.deletedBuilds.includes(build.id)) continue;
          if (build.value) await db.builds.put(build.value);
          else await db.builds.delete(build.id);
        }
      });
      writeLink(uid, next);

      // 2. Changes made here.
      if (hasDirty()) {
        const version = changeVersion();
        const changes = currentDirty();
        await push(uid, changes);
        clearDirty(changes, version);
        if (hasDirty()) again = true;
      }
    } while (again);
    useAccount.setState({ phase: 'idle', savedAt: Date.now() });
  } catch (err) {
    console.error('sync failed', err);
    const offline = !navigator.onLine || (err as { code?: string }).code === 'unavailable';
    useAccount.setState({
      phase: offline ? 'offline' : 'error',
      error: offline ? null : (err as { code?: string }).code === 'permission-denied'
        ? 'The account storage refused access. Its security rules may not be set up yet.'
        : err instanceof Error ? err.message : 'Saving to your account failed.',
    });
  } finally {
    running = false;
  }
}

let pushTimer: number | undefined;
let lastCheck = 0;

/** Saves shortly after the last change, so a burst of edits becomes one save. */
function schedulePush() {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void sync(), 2500);
}

/** Checks the account for changes from other devices, but not more than once every half minute. */
function checkSoon() {
  if (Date.now() - lastCheck < 30_000 && !hasDirty()) return;
  lastCheck = Date.now();
  void sync();
}

// ---------------------------------------------------------------- signing in and out

function describe(user: User) {
  return { uid: user.uid, name: user.displayName ?? user.email ?? 'Signed in', email: user.email ?? '', photo: user.photoURL };
}

export async function signOut() {
  const uid = auth.currentUser?.uid;
  window.clearTimeout(pushTimer);
  await firebaseSignOut(auth);
  // The next sign-in on this device is treated as a first meeting again, so anything changed while
  // signed out is merged deliberately instead of being silently overwritten.
  if (uid) localStorage.removeItem(linkKey(uid));
  resetDirty();
}

/** Removes everything saved in the account, then signs out. The data on this device is untouched. */
export async function deleteAccountData() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const [sets, builds] = await Promise.all([getDocs(setsCol(uid)), getDocs(buildsCol(uid))]);
  const refs = [inventoryRef(uid), ...sets.docs.map((d) => d.ref), ...builds.docs.map((d) => d.ref)];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(store);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  await signOut();
}

/** Starts the account system: restores a saved sign-in, completes one in progress, and keeps things saved. */
export async function start() {
  onAuthStateChanged(auth, (user) => {
    useAccount.setState({ ready: true, user: user ? describe(user) : null, ...(user ? {} : { phase: 'idle', savedAt: null, error: null }) });
    if (user) {
      lastCheck = Date.now();
      void sync();
    }
  });
  onDirty(() => auth.currentUser && schedulePush());
  window.addEventListener('online', () => void sync());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && auth.currentUser && checkSoon());

  // Back from Google's sign-in page?
  const reply = takeSignInReply();
  if (reply && 'idToken' in reply) {
    try {
      await signInWithCredential(auth, GoogleAuthProvider.credential(reply.idToken));
    } catch (err) {
      console.error('sign-in failed', err);
      useAccount.setState({ ready: true, error: 'Signing in did not work. Please try again.' });
    }
  } else if (reply) {
    useAccount.setState({ error: reply.error });
  }
}
