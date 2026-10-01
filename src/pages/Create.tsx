import { ArrowUp, KeyRound, ScanLine, Sparkles, Square, Wand2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Placement } from '../../shared/build.ts';
import { ModelView } from '../components/ModelView.tsx';
import { Button, EmptyState, PageHeader, Segmented, Spinner, cx, toast } from '../components/ui.tsx';
import { useCatalog } from '../lib/catalog.ts';
import { db } from '../lib/db.ts';
import { runDesign, type DesignEvent, type DesignSize } from '../lib/designer.ts';
import { useInventory, useStats } from '../lib/inventory.ts';
import { useSettings } from '../lib/settings.ts';

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
  const apiKey = useSettings((s) => s.apiKey);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [prompt, setPrompt] = useState(params.get('prompt') ?? '');
  const [size, setSize] = useState<DesignSize>('medium');

  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState<Placement[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const usesClaude = apiKey !== '';
  const inventory = useMemo(() => (rows ?? []).filter((r) => !r.part.startsWith('bl-')).map((r) => ({ part: r.part, color: r.color, qty: r.qty })), [rows]);

  if (!rows) return null;

  const generate = async () => {
    const text = prompt.trim();
    if (!text || working) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setWorking(true);
    setStatus('Starting');
    setNotes([]);
    setDraft(null);
    const onEvent = (event: DesignEvent) => {
      if (abort.signal.aborted) return;
      if (event.type === 'status') setStatus(event.message);
      else if (event.type === 'note') setNotes((n) => [...n.slice(-2), event.text]);
      else if (event.type === 'draft') setDraft(event.parts);
      else if (event.type === 'error') toast(event.message, 'error');
      else if (event.type === 'done') {
        const id = crypto.randomUUID();
        void db.builds
          .add({
            id,
            name: event.design.name,
            description: event.design.description,
            prompt: text,
            engine: event.design.engine,
            repaired: event.design.repaired,
            createdAt: Date.now(),
            parts: event.design.parts,
            step: 0,
          })
          .then(() => navigate(`/builds/${id}`));
      }
    };
    try {
      await runDesign({ prompt: text, size, inventory }, catalog, { apiKey, signal: abort.signal, onEvent });
    } catch (err) {
      console.error(err);
      if (!abort.signal.aborted) toast('The designer could not start. Check your connection and try again.', 'error');
    } finally {
      setWorking(false);
    }
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

  if (working) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-[32px] bg-paper">
          <div className="studs absolute inset-0 [--stud:rgba(40,80,120,0.08)]" />
          <div className="relative aspect-[4/3] sm:aspect-[16/10]">
            {draft && draft.length > 0 ? (
              <ModelView parts={draft} autoRotate className="size-full" />
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
            <Spinner /> {status}
          </h1>
          <p className="mx-auto mt-1.5 max-w-lg truncate text-ink-2">"{prompt.trim()}"</p>
          <div className="mx-auto mt-4 flex min-h-[72px] max-w-xl flex-col items-center justify-start gap-1 overflow-hidden text-sm leading-relaxed text-ink-3">
            <AnimatePresence initial={false} mode="popLayout">
              {notes.slice(-1).map((note) => (
                <motion.p key={note} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="line-clamp-3">
                  {note}
                </motion.p>
              ))}
            </AnimatePresence>
          </div>
          <Button className="mt-4" onClick={() => abortRef.current?.abort()}>
            <Square className="size-4" /> Stop
          </Button>
        </div>
      </div>
    );
  }

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

      <div className={cx('mt-8 flex items-start gap-3 rounded-3xl border p-4 text-[15px]', usesClaude ? 'border-line bg-surface-2' : 'border-brick-amber/30 bg-brick-amber/10')}>
        {usesClaude ? (
          <>
            <Sparkles className="mt-0.5 size-5 shrink-0" />
            <p className="text-ink-2">
              <span className="font-semibold text-ink">Designed by Claude.</span> Every design is checked brick by brick: nothing overlaps, everything attaches, and it never asks for a piece you do not have.
            </p>
          </>
        ) : (
          <>
            <KeyRound className="mt-0.5 size-5 shrink-0 text-brick-amber" />
            <p>
              <span className="font-semibold">Running the offline quick-builder,</span> which only knows towers, houses and pyramids.{' '}
              <Link to="/settings" className="font-semibold underline underline-offset-2">
                Add an Anthropic API key
              </Link>{' '}
              to design anything you can describe.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
