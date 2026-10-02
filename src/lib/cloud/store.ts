// What the interface knows about the account: who is signed in and whether everything is saved.
// Deliberately small and free of the Firebase SDK, which is loaded separately (see index.ts).
import { create } from 'zustand';
import type { MergeChoice, StateSummary } from '../../../shared/cloud-merge.ts';

export interface AccountUser {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface MergePrompt {
  device: StateSummary;
  account: StateSummary;
  choose: (choice: MergeChoice) => void;
}

interface AccountState {
  /** False until the saved sign-in (if any) has been restored at startup. */
  ready: boolean;
  user: AccountUser | null;
  phase: SyncPhase;
  /** When the device and the account last agreed, as a timestamp. */
  savedAt: number | null;
  error: string | null;
  /** Set when a device with data signs in to an account that already has data: the person decides. */
  mergePrompt: MergePrompt | null;
}

export const useAccount = create<AccountState>(() => ({
  ready: false,
  user: null,
  phase: 'idle',
  savedAt: null,
  error: null,
  mergePrompt: null,
}));
