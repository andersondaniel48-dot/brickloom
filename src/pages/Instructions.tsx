import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Focus, Lightbulb, LightbulbOff, PartyPopper, Printer, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { partsList, planSteps, type InventoryItem } from '../../shared/build.ts';
import { ModelView, type ModelViewHandle } from '../components/ModelView.tsx';
import { PartThumb } from '../components/PartThumb.tsx';
import { Spinner, cx, toast } from '../components/ui.tsx';
import { renderBooklet } from '../lib/booklet.ts';
import { useCatalog } from '../lib/catalog.ts';
import { db } from '../lib/db.ts';
import { getThumb } from '../lib/thumbs.ts';

const INK = '#15171c';

interface Booklet {
  steps: string[];
  finished: string;
  thumbs: Map<string, string>;
}

export function InstructionsPage() {
  const { id = '' } = useParams();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const build = useLiveQuery(() => db.builds.get(id).then((b) => b ?? null), [id]);
  const view = useRef<ModelViewHandle>(null);

  const partsKey = build ? `${build.id}:${build.parts.length}` : '';
  // The placements never change while following instructions; keep one array (keyed on the build,
  // not on the live-query object) so the 3D model is built once.
  const parts = useMemo(() => build?.parts ?? [], [partsKey]);
  const steps = useMemo(() => (parts.length ? planSteps(parts, catalog.shapes) : []), [parts, catalog]);
  const callouts = useMemo(() => steps.map((step) => partsList(step.map((i) => parts[i]))), [steps, parts]);

  const [index, setIndex] = useState<number | null>(null);
  const [emphasize, setEmphasize] = useState(true);
  const [booklet, setBooklet] = useState<Booklet | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  const total = steps.length;
  // One past the last step is the "finished" page.
  const current = index ?? 1;
  const finished = current > total;

  // Resume where the builder left off.
  useEffect(() => {
    if (build && index === null && total) setIndex(Math.min(Math.max(build.step, 1), total));
  }, [build, index, total]);

  const go = useCallback(
    (next: number) => {
      if (!total) return;
      const clamped = Math.min(Math.max(next, 1), total + 1);
      setIndex(clamped);
      void db.builds.update(id, { step: clamped > total ? 0 : clamped });
    },
    [id, total],
  );

  const close = useCallback(() => navigate(`/builds/${id}`), [navigate, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') (e.preventDefault(), go(current + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') (e.preventDefault(), go(current - 1));
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, current, close]);

  const step = useMemo(() => ({ steps, index: Math.min(current, total), emphasize: emphasize && !finished }), [steps, current, total, emphasize, finished]);

  const print = async () => {
    if (!build || printing) return;
    try {
      setPrinting('Drawing pages');
      const images = await renderBooklet(parts, steps, catalog.shapes, (done, all) => setPrinting(`Drawing page ${done} of ${all}`));
      const thumbs = new Map<string, string>();
      for (const item of partsList(parts)) {
        const url = await getThumb(catalog.part(item.part)?.geometry ?? null, item.color);
        if (url) thumbs.set(`${item.part}|${item.color}`, url);
      }
      setBooklet({ ...images, thumbs });
    } catch (err) {
      console.error(err);
      toast('The booklet could not be prepared', 'error');
      setPrinting(null);
    }
  };

  // Once the booklet is in the DOM and its images have decoded, hand it to the browser's print dialog.
  useEffect(() => {
    if (!booklet) return;
    let live = true;
    const images = [...document.querySelectorAll<HTMLImageElement>('.print-only img')];
    void Promise.all(images.map((img) => img.decode().catch(() => undefined))).then(() => {
      if (!live) return;
      setPrinting(null);
      window.print();
      setBooklet(null);
    });
    return () => {
      live = false;
    };
  }, [booklet]);

  if (build === undefined) return null;
  if (build === null || !total) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">There is nothing to build here</h1>
        <button type="button" onClick={() => navigate('/builds')} className="font-semibold underline">
          Back to builds
        </button>
      </div>
    );
  }

  const callout = finished ? [] : callouts[current - 1];

  return (
    <>
      <div className="screen-only fixed inset-0 flex select-none flex-col overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 35%, #e6f1fa 0%, #d3e5f3 60%, #c3daec 100%)', color: INK }}>
        {/* Top bar */}
        <header className="relative z-20 flex shrink-0 items-center gap-2 px-3 pt-3 sm:px-5 sm:pt-4">
          <PaperButton label="Close instructions" onClick={close}>
            <X className="size-5" />
          </PaperButton>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate font-display text-lg font-bold leading-tight">{build.name}</div>
            <div className="tabular text-sm font-medium text-[#4d6a82]">{finished ? 'Finished' : `Step ${current} of ${total}`}</div>
          </div>
          <PaperButton label={emphasize ? 'Show every piece in full color' : 'Highlight the new pieces'} onClick={() => setEmphasize(!emphasize)} active={emphasize}>
            {emphasize ? <Lightbulb className="size-5" /> : <LightbulbOff className="size-5" />}
          </PaperButton>
          <PaperButton label="Reset the view" onClick={() => view.current?.resetView()}>
            <Focus className="size-5" />
          </PaperButton>
          <PaperButton label="Print or save as PDF" onClick={print} disabled={Boolean(printing)}>
            {printing ? <Spinner className="size-4" /> : <Printer className="size-5" />}
          </PaperButton>
        </header>

        {/* Page */}
        <div className="relative min-h-0 flex-1">
          <ModelView ref={view} parts={parts} step={step} autoRotate={finished} className={cx('absolute inset-x-0 bottom-0', finished ? 'top-36 sm:top-44' : 'top-0')} />

          {!finished && (
            <div className="pointer-events-none absolute left-3 top-1 flex max-w-[calc(100%-1.5rem)] items-start gap-3 sm:left-6 sm:top-2 sm:gap-5">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={current}
                  initial={{ opacity: 0, y: 14, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                  className="tabular font-display text-[76px] font-extrabold leading-[0.9] tracking-tighter sm:text-[120px]"
                >
                  {current}
                </motion.div>
              </AnimatePresence>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={current}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 rounded-[20px] border-[2.5px] border-[#8fb7d8] bg-[#f4f9fd] px-3 pb-1.5 pt-2 shadow-[0_2px_0_#8fb7d8] sm:mt-3 sm:px-4"
                >
                  {callout.map((item) => (
                    <Callout key={`${item.part}|${item.color}`} item={item} />
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          {finished && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute inset-x-0 top-4 flex flex-col items-center px-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-[#ffd23f] text-[#1d1700] shadow-lg">
                <PartyPopper className="size-7" />
              </span>
              <h1 className="mt-3 text-4xl font-extrabold sm:text-6xl">You built it!</h1>
              <p className="mt-1 text-lg text-[#4d6a82]">
                {build.name}, {parts.length} pieces
              </p>
            </motion.div>
          )}
        </div>

        {/* Navigation */}
        <footer className="safe-bottom relative z-20 flex shrink-0 items-center gap-3 px-3 pt-2 sm:gap-5 sm:px-6">
          <button
            type="button"
            aria-label="Previous step"
            disabled={current <= 1}
            onClick={() => go(current - 1)}
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white shadow-md transition active:scale-90 disabled:opacity-35"
          >
            <ArrowLeft className="size-6" strokeWidth={2.5} />
          </button>

          <div className="min-w-0 flex-1">
            <input
              type="range"
              aria-label="Step"
              min={1}
              max={total + 1}
              value={current}
              onChange={(e) => go(Number(e.target.value))}
              className="step-slider block w-full"
              style={{ '--fill': `${((current - 1) / total) * 100}%` } as CSSProperties}
            />
          </div>

          {finished ? (
            <button type="button" onClick={close} className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-[#15171c] px-6 font-display text-lg font-bold text-white shadow-md transition active:scale-95">
              Done
            </button>
          ) : (
            <button
              type="button"
              aria-label="Next step"
              onClick={() => go(current + 1)}
              className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-[#ffd23f] pl-6 pr-5 font-display text-lg font-bold text-[#1d1700] shadow-md transition active:scale-95"
            >
              {current === total ? 'Finish' : 'Next'} <ArrowRight className="size-6" strokeWidth={2.5} />
            </button>
          )}
        </footer>
      </div>

      {booklet && <PrintBooklet name={build.name} description={build.description} booklet={booklet} callouts={callouts} bom={partsList(parts)} />}
    </>
  );
}

function PaperButton({ label, active, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'flex size-11 shrink-0 items-center justify-center rounded-full shadow-sm transition active:scale-90 disabled:opacity-50',
        active ? 'bg-[#15171c] text-white' : 'bg-white/80 text-[#15171c] hover:bg-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** One entry in the "pieces for this step" box: the part, and how many. */
function Callout({ item }: { item: InventoryItem }) {
  const catalog = useCatalog();
  return (
    <div className="flex flex-col items-center" title={`${catalog.part(item.part)?.name ?? item.part}, ${catalog.color(item.color).name}`}>
      <PartThumb part={item.part} color={item.color} eager className="size-12 sm:size-16" />
      <span className="tabular -mt-0.5 font-display text-sm font-bold sm:text-base">{item.qty}x</span>
    </div>
  );
}

// ---------------------------------------------------------------- print

function PrintBooklet({
  name,
  description,
  booklet,
  callouts,
  bom,
}: {
  name: string;
  description: string;
  booklet: Booklet;
  callouts: InventoryItem[][];
  bom: InventoryItem[];
}) {
  const catalog = useCatalog();
  const paper = { background: '#dceaf6', color: INK, fontFamily: 'var(--font-display)' } as const;
  return (
    <div className="print-only">
      {/* Cover */}
      <section className="print-page relative flex flex-col items-center justify-center p-[14mm] text-center" style={{ background: '#ffd23f', color: INK, fontFamily: 'var(--font-display)' }}>
        <img src={booklet.finished} alt="" className="max-h-[62%] max-w-[80%] object-contain" />
        <h1 className="mt-[6mm] text-[40pt] font-extrabold leading-none">{name}</h1>
        <p className="mt-[3mm] max-w-[200mm] font-sans text-[12pt]">{description}</p>
        <p className="mt-[4mm] text-[11pt] font-bold">
          {bom.reduce((n, i) => n + i.qty, 0)} pieces · {booklet.steps.length} steps
        </p>
      </section>

      {/* One step per page */}
      {booklet.steps.map((image, i) => (
        <section key={i} className="print-page relative" style={paper}>
          <img src={image} alt="" className="absolute inset-0 size-full object-contain p-[12mm] pt-[30mm]" />
          <div className="absolute left-[12mm] top-[9mm] flex items-start gap-[7mm]">
            <span className="text-[64pt] font-extrabold leading-[0.85]">{i + 1}</span>
            <div className="flex flex-wrap gap-x-[4mm] rounded-[5mm] border-[0.8mm] border-[#8fb7d8] bg-[#f4f9fd] px-[4mm] pb-[1.5mm] pt-[2.5mm]">
              {callouts[i].map((item) => (
                <div key={`${item.part}|${item.color}`} className="flex flex-col items-center">
                  <img src={booklet.thumbs.get(`${item.part}|${item.color}`)} alt="" className="size-[17mm] object-contain" />
                  <span className="text-[11pt] font-bold">{item.qty}x</span>
                </div>
              ))}
            </div>
          </div>
          <span className="absolute bottom-[7mm] right-[10mm] text-[10pt] font-bold text-[#4d6a82]">{i + 2}</span>
        </section>
      ))}

      {/* Parts list */}
      <section className="print-page p-[14mm]" style={paper}>
        <h2 className="text-[22pt] font-extrabold">Pieces in this build</h2>
        <div className="mt-[6mm] grid grid-cols-8 gap-x-[4mm] gap-y-[5mm]">
          {bom.map((item) => (
            <div key={`${item.part}|${item.color}`} className="flex flex-col items-center text-center">
              <img src={booklet.thumbs.get(`${item.part}|${item.color}`)} alt="" className="size-[19mm] object-contain" />
              <span className="text-[11pt] font-bold">{item.qty}x</span>
              <span className="font-sans text-[7pt] leading-tight text-[#4d6a82]">
                {item.part} · {catalog.color(item.color).name}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
