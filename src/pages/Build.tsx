import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Check, CircleAlert, Play, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { analyze, partsList, planSteps } from '../../shared/build.ts';
import { ModelView, type ModelViewHandle } from '../components/ModelView.tsx';
import { PartThumb } from '../components/PartThumb.tsx';
import { Button, ColorDot, IconButton, toast } from '../components/ui.tsx';
import { useCatalog } from '../lib/catalog.ts';
import { db } from '../lib/db.ts';
import { useInventory } from '../lib/inventory.ts';

export function BuildPage() {
  const { id = '' } = useParams();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const build = useLiveQuery(() => db.builds.get(id).then((b) => b ?? null), [id]);
  const inventory = useInventory();
  const view = useRef<ModelViewHandle>(null);

  // Keep the placements array identity stable across live-query refreshes (saving the cover triggers one)
  // so the 3D view is not rebuilt.
  const partsKey = build ? `${build.id}:${build.parts.length}` : '';
  const parts = useMemo(() => build?.parts ?? [], [partsKey]);
  const bom = useMemo(() => partsList(parts), [parts]);
  const steps = useMemo(() => (parts.length ? planSteps(parts, catalog.shapes) : []), [parts, catalog]);
  const size = useMemo(() => analyze(parts, catalog.shapes).size, [parts, catalog]);

  const missing = useMemo(() => {
    const owned = new Map((inventory ?? []).map((r) => [r.key, r.qty]));
    return bom.map((item) => ({ ...item, short: Math.max(0, item.qty - (owned.get(`${item.part}|${item.color}`) ?? 0)) })).filter((item) => item.short > 0);
  }, [bom, inventory]);

  if (build === undefined) return null;
  if (build === null) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-2xl font-semibold">This build no longer exists</h1>
        <Button className="mt-5" onClick={() => navigate('/builds')}>
          Back to builds
        </Button>
      </div>
    );
  }

  const saveCover = () => {
    if (build.cover) return;
    // Give the first frame a moment to settle, then keep a picture for the gallery.
    setTimeout(() => {
      const cover = view.current?.snapshot(640, 480);
      if (cover) void db.builds.update(build.id, { cover });
    }, 350);
  };

  const remove = async () => {
    if (!confirm(`Delete "${build.name}"? This cannot be undone.`)) return;
    await db.builds.delete(build.id);
    toast('Build deleted');
    navigate('/builds');
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/builds" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Builds
        </Link>
        <IconButton label="Delete build" onClick={remove}>
          <Trash2 className="size-5" />
        </IconButton>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
        <div>
          <div className="relative overflow-hidden rounded-[32px] bg-paper">
            <div className="studs absolute inset-0 [--stud:rgba(40,80,120,0.08)]" />
            <ModelView ref={view} parts={parts} autoRotate onReady={saveCover} className="relative aspect-[4/3] w-full" />
          </div>
          <p className="mt-2 text-center text-xs font-medium text-ink-3">Drag to turn, pinch or scroll to zoom</p>
        </div>

        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/7 px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink-2">
            <Sparkles className="size-3.5" /> {build.engine === 'claude' ? 'Designed by Claude' : build.engine === 'openai' ? 'Designed by GPT' : 'Quick build'}
          </span>
          <h1 className="mt-3 text-[36px] font-bold leading-[1.05] sm:text-5xl">{build.name}</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{build.description}</p>

          <dl className="mt-6 grid grid-cols-3 gap-3">
            {[
              ['Pieces', parts.length],
              ['Steps', steps.length],
              ['Studs', `${size.w} × ${size.d}`],
            ].map(([label, value]) => (
              <div key={label} className="card px-4 py-3">
                <dd className="tabular font-display text-2xl font-bold">{value}</dd>
                <dt className="text-sm text-ink-3">{label}</dt>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="accent" size="lg" className="flex-1" onClick={() => navigate(`/builds/${build.id}/steps`)}>
              <Play className="size-5 fill-current" /> {build.step > 0 && build.step < steps.length ? `Continue at step ${build.step}` : 'Start building'}
            </Button>
            <Button size="lg" onClick={() => navigate(`/create?prompt=${encodeURIComponent(build.prompt)}`)}>
              <RefreshCw className="size-5" /> Redesign
            </Button>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-surface-2 p-3.5 text-sm">
            {missing.length === 0 ? (
              <>
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brick-green text-white">
                  <Check className="size-3.5" strokeWidth={3.5} />
                </span>
                <span className="text-ink-2">You own every piece this build needs.</span>
              </>
            ) : (
              <>
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-brick-amber" />
                <span className="text-ink-2">
                  Your collection has changed: {missing.reduce((n, m) => n + m.short, 0)} piece{missing.reduce((n, m) => n + m.short, 0) === 1 ? ' is' : 's are'} no longer in it. They are marked below.
                </span>
              </>
            )}
          </div>
          {build.repaired && (
            <p className="mt-2 flex items-start gap-2.5 rounded-2xl bg-surface-2 p-3.5 text-sm text-ink-2">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-brick-amber" />
              The designer's last draft had parts that did not attach or fit, so they were left out to keep the build sound.
            </p>
          )}
        </div>
      </div>

      {/* Bill of materials */}
      <section className="mt-10">
        <h2 className="mb-3.5 text-2xl font-semibold">Pieces you will need</h2>
        <div className="grid grid-cols-2 gap-3 xs:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {bom.map((item) => {
            const color = catalog.color(item.color);
            const short = missing.find((m) => m.part === item.part && m.color === item.color)?.short ?? 0;
            return (
              <div key={`${item.part}|${item.color}`} className="card relative overflow-hidden">
                <div className="studs-fine aspect-[5/4] bg-surface-2">
                  <PartThumb part={item.part} color={item.color} className="size-full p-3" />
                </div>
                <span className="tabular absolute right-2 top-2 rounded-full bg-ink px-2.5 py-0.5 font-display text-sm font-bold text-bg">{item.qty}×</span>
                {short > 0 && <span className="absolute left-2 top-2 rounded-full bg-brick-amber px-2 py-0.5 text-xs font-bold text-white">{short} short</span>}
                <div className="p-2.5">
                  <div className="line-clamp-1 text-[13px] font-semibold">{catalog.part(item.part)?.name ?? item.part}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                    <ColorDot color={color} size={10} />
                    <span className="truncate">{color.name}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
