import { Check, WifiOff, X } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { inWords } from '../../shared/estimate.ts';
import { timeLeft, useDesignJob, useNow } from '../lib/design-job.ts';
import { Spinner, cx } from './ui.tsx';

/**
 * News of the design under way, on every screen but the one it is made on: how long it still
 * needs while it is being made, and where to find it when it is done.
 */
export function DesignChip() {
  const phase = useDesignJob((s) => s.phase);
  const { pathname } = useLocation();
  if (phase === 'idle' || pathname === '/create') return null;
  return (
    <div
      className={cx(
        'pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 short:left-[var(--rail)] lg:left-64',
        // Clear of the tab bar; and on the scanner, clear of the shutter instead.
        pathname === '/scan' ? 'top-16' : 'bottom-24 short:bottom-3 lg:bottom-6',
      )}
    >
      {phase === 'working' ? <Working /> : <Ready />}
    </div>
  );
}

const pill = 'pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full bg-ink py-2.5 pl-3.5 pr-4 text-sm font-semibold text-bg shadow-float';

function Working() {
  const job = useDesignJob();
  const left = timeLeft(job, useNow());
  return (
    <Link to="/create" className={pill}>
      {job.paused === 'offline' ? <WifiOff className="size-4 shrink-0" /> : <Spinner className="size-4 shrink-0" />}
      <span className="truncate">
        {job.paused === 'offline' ? 'Design waiting for the internet' : job.paused ? 'Picking the design back up' : left !== null && job.by ? `Designing: ${inWords(left)} left` : 'Designing your build'}
      </span>
    </Link>
  );
}

function Ready() {
  const build = useDesignJob((s) => s.build);
  const clear = useDesignJob((s) => s.clear);
  if (!build) return null;
  return (
    <div className={cx(pill, 'pr-1.5')}>
      <Link to={`/builds/${build.id}`} onClick={clear} className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
          <Check className="size-3.5" strokeWidth={3.5} />
        </span>
        <span className="truncate">
          {build.name} is ready. <span className="underline underline-offset-2">See it</span>
        </span>
      </Link>
      <button type="button" aria-label="Dismiss" onClick={clear} className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-bg/15">
        <X className="size-4" />
      </button>
    </div>
  );
}
