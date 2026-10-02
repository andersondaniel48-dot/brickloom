import { Check, CloudOff, CloudUpload, LogOut, RefreshCw, Smartphone, Trash2, TriangleAlert, UserRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { MergeChoice, StateSummary } from '../../shared/cloud-merge.ts';
import { accountsEnabled, deleteAccountData, signIn, signOut, syncNow, useAccount } from '../lib/cloud/index.ts';
import { Button, Sheet, Spinner, cx, toast } from './ui.tsx';

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function Avatar({ photo, name, size }: { photo: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  return photo && !failed ? (
    <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded-full" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-accent font-display font-bold text-accent-ink" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.trim().charAt(0).toUpperCase() || <UserRound className="size-1/2" />}
    </span>
  );
}

/** "Saved just now", "Saved 5 minutes ago": refreshed as time passes. */
function useAgo(timestamp: number | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!timestamp) return null;
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago` : new Date(timestamp).toLocaleDateString();
}

function SyncStatus() {
  const { phase, savedAt, error } = useAccount();
  const ago = useAgo(savedAt);
  if (phase === 'syncing') {
    return (
      <span className="inline-flex items-center gap-2 text-ink-2">
        <Spinner className="size-3.5 border-2" /> Saving
      </span>
    );
  }
  if (phase === 'offline') {
    return (
      <span className="inline-flex items-center gap-2 text-ink-2">
        <CloudOff className="size-4" /> Offline. Changes will be saved when you are back online.
      </span>
    );
  }
  if (phase === 'error') {
    return (
      <span className="inline-flex items-start gap-2 text-brick-red">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error ?? 'Saving to your account failed.'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-ink-2">
      <span className="flex size-4 items-center justify-center rounded-full bg-brick-green text-white">
        <Check className="size-3" strokeWidth={3.5} />
      </span>
      {ago ? `Saved to your account ${ago}` : 'Saved to your account'}
    </span>
  );
}

/** The account card in Settings: sign in, see that everything is saved, sign out. */
export function AccountSection() {
  const { ready, user, phase, error } = useAccount();
  if (!accountsEnabled) return null;

  return (
    <section className="card mb-4 p-5 sm:p-6">
      <h2 className="text-xl font-semibold">Account</h2>
      {!ready ? (
        <div className="mt-4 flex items-center gap-3 text-ink-2">
          <Spinner className="size-4 border-2" /> Checking
        </div>
      ) : user ? (
        <>
          <div className="mt-4 flex items-center gap-3.5">
            <Avatar photo={user.photo} name={user.name} size={48} />
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-semibold leading-tight">{user.name}</div>
              <div className="truncate text-sm text-ink-3">{user.email}</div>
            </div>
          </div>
          <p className="mt-3 text-[15px]">
            <SyncStatus />
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button onClick={() => void syncNow()} disabled={phase === 'syncing'}>
              <RefreshCw className="size-4" /> Sync now
            </Button>
            <Button
              onClick={async () => {
                await signOut();
                toast('Signed out. Your collection is still on this device.');
              }}
            >
              <LogOut className="size-4" /> Sign out
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm('Delete everything saved in your account? What is on this device stays, and you will be signed out.')) return;
                try {
                  await deleteAccountData();
                  toast('Your saved data was deleted from the account');
                } catch {
                  toast('The saved data could not be deleted. Check your connection and try again.', 'error');
                }
              }}
            >
              <Trash2 className="size-4" /> Delete saved data
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2">
            Sign in to save your collection and builds to your Google account, and pick them up on any phone, tablet or computer.
          </p>
          <button
            type="button"
            onClick={signIn}
            className="mt-4 inline-flex h-11 items-center gap-3 rounded-full border border-[#747775] bg-white px-5 text-[15px] font-semibold text-[#1f1f1f] transition active:scale-[0.97]"
          >
            <GoogleMark className="size-5" /> Sign in with Google
          </button>
          {error && <p className="mt-3 text-sm text-brick-red">{error}</p>}
        </>
      )}
    </section>
  );
}

/** Compact account indicator for the sidebar: who is signed in, or an invitation to. */
export function AccountChip({ onOpen }: { onOpen: () => void }) {
  const { ready, user, phase } = useAccount();
  if (!accountsEnabled || !ready) return null;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-ink/5">
      {user ? (
        <>
          <Avatar photo={user.photo} name={user.name} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className={cx('block text-xs', phase === 'error' ? 'text-brick-red' : 'text-ink-3')}>
              {phase === 'syncing' ? 'Saving' : phase === 'offline' ? 'Offline' : phase === 'error' ? 'Not saved' : 'Saved'}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-ink/8 text-ink-2">
            <CloudUpload className="size-4" />
          </span>
          <span className="text-sm font-semibold text-ink-2">Sign in to save</span>
        </>
      )}
    </button>
  );
}

const describe = (s: StateSummary) =>
  [
    `${s.pieces.toLocaleString()} piece${s.pieces === 1 ? '' : 's'}`,
    s.sets ? `${s.sets} set${s.sets === 1 ? '' : 's'}` : null,
    s.builds ? `${s.builds} build${s.builds === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ');

/**
 * Shown the first time a device that already has a collection signs in to an account that already
 * has one. Nothing is changed until the person chooses.
 */
export function MergeDialog() {
  const prompt = useAccount((s) => s.mergePrompt);
  const choose = (choice: MergeChoice) => prompt?.choose(choice);

  const options: { choice: MergeChoice; icon: ReactNode; title: string; body: string }[] = [
    {
      choice: 'merge',
      icon: <RefreshCw className="size-5" />,
      title: 'Combine them',
      body: 'Keep everything from both. Where both have the same piece, the larger count is kept, so nothing is counted twice.',
    },
    {
      choice: 'account',
      icon: <CloudUpload className="size-5" />,
      title: 'Use what is in my account',
      body: 'Replace what is on this device with the account. What is on this device now is discarded.',
    },
    {
      choice: 'device',
      icon: <Smartphone className="size-5" />,
      title: 'Use what is on this device',
      body: 'Replace what is in the account with this device. What is in the account now is discarded.',
    },
  ];

  return (
    // Closing without choosing combines, the one option that cannot lose anything.
    <Sheet open={Boolean(prompt)} onClose={() => choose('merge')} title="You have a collection in both places">
      {prompt && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface-2 p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">This device</div>
              <div className="mt-1 text-[15px] font-semibold">{describe(prompt.device)}</div>
            </div>
            <div className="rounded-2xl bg-surface-2 p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Your account</div>
              <div className="mt-1 text-[15px] font-semibold">{describe(prompt.account)}</div>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-2.5">
            {options.map((option, i) => (
              <li key={option.choice}>
                <button
                  type="button"
                  onClick={() => choose(option.choice)}
                  className={cx(
                    'flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition hover:border-ink',
                    i === 0 ? 'border-ink bg-surface-2' : 'border-line',
                  )}
                >
                  <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', i === 0 ? 'bg-accent text-accent-ink' : 'bg-ink/7 text-ink-2')}>{option.icon}</span>
                  <span>
                    <span className="block font-display text-lg font-semibold leading-tight">{option.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{option.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
