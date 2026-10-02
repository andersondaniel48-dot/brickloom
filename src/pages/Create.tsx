import { ArrowUp, Clock, KeyRound, LogOut, ScanLine, Sparkles, Square, Wand2, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { inWords } from '../../shared/estimate.ts';
import { ModelView } from '../components/ModelView.tsx';
import { Button, EmptyState, PageHeader, Segmented, Spinner, cx } from '../components/ui.tsx';
import { useCatalog } from '../lib/catalog.ts';
import { fractionDone, paceFor, timeLeft, useDesignJob, useNow, usualTotal } from '../lib/design-job.ts';
import type { DesignSize } from '../lib/designer.ts';
import { useInventory, useStats } from '../lib/inventory.ts';
import { designerFor, modelName, useSettings } from '../lib/settings.ts';

const IDEAS = [
  'A cozy cottage with a pitched roof',
  'A lighthouse on a rocky base',
  'A friendly robot',
  'A castle gate with two towers',
  'A sailboat',
  'A tree in autumn colors',
  'A rocket on its launch pad',
  'A duck',
];

const SIZES: { value: DesignSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export function CreatePage() {
  const catalog = useCatalog();
  const rows = useInventory();
  const stats = useStats(rows, catalog);
  const designer = designerFor(useSettings());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const job = useDesignJob();
  // A design that was stopped, or failed, leaves its request behind to try again with.
  const [prompt, setPrompt] = useState(params.get('prompt') ?? job.prompt);
  const [size, setSize] = useState<DesignSize>(job.prompt ? job.size : 'medium');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const inventory = useMemo(() => (rows ?? []).filter((r) => !r.part.startsWith('bl-')).map((r) => ({ part: r.part, color: r.color, qty: r.qty })), [rows]);

  // The design is finished: go and look at it.
  const { phase, build, clear } = job;
  useEffect(() => {
    if (phase !== 'ready' || !build) return;
    clear();
    navigate(`/builds/${build.id}`);
  }, [phase, build, clear, navigate]);

  if (!rows) return null;

  const generate = () => {
    const text = prompt.trim();
    if (text && job.phase !== 'working') job.start({ prompt: text, size, inventory }, catalog, designer);
  };

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Create" />
        <EmptyState
          icon={<Sparkles className="size-8" />}
          title="Designs start with your bricks"
          body="Once your collection has some pieces in it, describe anything and get a model built only from what you own."
          action={
            <Button variant="accent" onClick={() => navigate('/scan')}>
              <ScanLine className="size-5" /> Scan bricks
            </Button>
          }
        />
      </>
    );
  }

  if (job.phase !== 'idle') return <Designing />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="What shall we build?" subtitle={`Designed from the ${stats.buildable.toLocaleString()} pieces in your collection that are ready to build with.`} />

      <div className="card overflow-hidden shadow-card focus-within:border-ink">
        <textarea
          ref={textRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate();
          }}
          rows={3}
          placeholder="Describe a model: a lighthouse with a red top, a tiny house for a hedgehog..."
          className="block w-full resize-none bg-transparent px-5 pt-5 text-lg leading-relaxed outline-none placeholder:text-ink-3 sm:px-6 sm:text-xl"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-2 sm:px-5">
          <Segmented value={size} onChange={setSize} options={SIZES} />
          <Button variant="accent" size="md" disabled={!prompt.trim() || stats.buildable === 0} onClick={generate}>
            <Wand2 className="size-5" /> Design it <ArrowUp className="size-4 opacity-60" />
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {IDEAS.map((idea) => (
          <button
            key={idea}
            type="button"
            onClick={() => {
              setPrompt(idea);
              textRef.current?.focus();
            }}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink-2 transition hover:border-line-strong hover:text-ink active:scale-95"
          >
            {idea}
          </button>
        ))}
      </div>

      <div className={cx('mt-8 flex items-start gap-3 rounded-3xl border p-4 text-[15px]', designer ? 'border-line bg-surface-2' : 'border-brick-amber/30 bg-brick-amber/10')}>
        {designer ? (
          <>
            <Sparkles className="mt-0.5 size-5 shrink-0" />
            <p className="text-ink-2">
              <span className="font-semibold text-ink">Designed by {modelName(designer.provider, designer.model)}.</span> Every design is checked brick by brick: nothing overlaps, everything attaches, and it never asks for a piece you do not have. A {size} build takes {inWords(usualTotal(paceFor(designer.model, size).pace))}, and you can use the rest of the app while it is made.
            </p>
          </>
        ) : (
          <>
            <KeyRound className="mt-0.5 size-5 shrink-0 text-brick-amber" />
            <p>
              <span className="font-semibold">Running the offline quick-builder,</span> which only knows towers, houses and pyramids.{' '}
              <Link to="/settings" className="font-semibold underline underline-offset-2">
                Add an API key for Claude or ChatGPT
              </Link>{' '}
              to design anything you can describe.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- while it is being made

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** The design under way: the latest draft, what the designer is doing, how long is left, and whether it is safe to leave. */
function Designing() {
  const job = useDesignJob();
  const now = useNow();
  const left = timeLeft(job, now);
  const spent = Math.max(0, now - job.startedAt);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative overflow-hidden rounded-[32px] bg-paper">
        <div className="studs absolute inset-0 [--stud:rgba(40,80,120,0.08)]" />
        <div className="relative aspect-[4/3] sm:aspect-[16/10]">
          {job.draft && job.draft.length > 0 ? (
            <ModelView parts={job.draft} autoRotate className="size-full" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <div className="grid grid-cols-2 gap-2.5">
                {[0, 1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    className="size-9 rounded-full bg-[#15171c]"
                    animate={{ scale: [1, 0.55, 1], opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 text-center">
        <h1 className="flex items-center justify-center gap-3 text-2xl font-semibold">
          {job.paused === 'offline' ? <WifiOff className="size-6" /> : <Spinner />}
          {job.paused === 'offline' ? 'Waiting for the internet' : job.paused ? 'Picking up where it left off' : job.status}
        </h1>
        <p className="mx-auto mt-1.5 max-w-lg truncate text-ink-2">"{job.prompt}"</p>

        {job.by && (
          <div className="mx-auto mt-5 max-w-md">
            <div className="h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-label="Design progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={left === null ? undefined : Math.round(fractionDone(job, left, now) * 100)}>
              <div
                className={cx('h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear', left === null && 'opacity-50')}
                style={{ width: `${Math.round((left === null ? fractionDone(job, 60000, job.pausedAt ?? now) : fractionDone(job, left, now)) * 100)}%` }}
              />
            </div>
            <p className="tabular mt-2.5 flex items-center justify-center gap-2 text-[15px] font-semibold">
              <Clock className="size-4 text-ink-3" />
              {left === null ? (job.paused === 'offline' ? 'It carries on when you are back online' : 'Back in a moment') : <span className="first-letter:uppercase">{inWords(left)} left</span>}
              <span className="font-normal text-ink-3">· {clock(spent)} so far</span>
            </p>
            {!job.paceKnown && <p className="mt-1 text-xs text-ink-3">A first guess for {job.by}. The estimate learns from each design you make.</p>}
          </div>
        )}

        <div className="mx-auto mt-4 flex min-h-[60px] max-w-xl flex-col items-center justify-start gap-1 overflow-hidden text-sm leading-relaxed text-ink-3">
          <AnimatePresence initial={false} mode="popLayout">
            {job.note && (
              <motion.p key={job.note} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="line-clamp-3">
                {job.note}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <Button className="mt-2" onClick={job.stop}>
          <Square className="size-4" /> Stop
        </Button>
      </div>

      {job.by && (
        <div className="mt-8 flex items-start gap-3 rounded-3xl border border-line bg-surface-2 p-4 text-left text-[15px]">
          <LogOut className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1.5 text-ink-2">
            <p>
              <span className="font-semibold text-ink">You can leave this screen.</span> Scan, browse your collection or look at other builds: the design carries on, and you are told when it is ready.
            </p>
            <p>
              <span className="font-semibold text-ink">Keep Brickloom open, though.</span> If you switch to another app or the screen locks, the design pauses, and carries on from its last draft when you come back. Closing Brickloom cancels it.
              {job.awake && ' The screen is being kept on while it works.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
